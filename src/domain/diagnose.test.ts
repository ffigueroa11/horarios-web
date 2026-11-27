import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { diagnose, type Finding } from './diagnose';
import { slotKey, type Project } from './types';
import { validate } from './validate';
import { units } from './units';
import { classPeriods, electiveWithoutCommonTime, teacherNamed, largeSchool, reference } from './cases.testutil';

const classes = classPeriods;
const teacher = teacherNamed;
const proven = (p: Project) => diagnose(p).findings.filter((f) => f.certainty === 'demostrado');
const errors = (p: Project) => validate(p).filter((i) => i.level === 'error');

describe('diagnóstico: no afirma imposibilidades falsas', () => {
  it('el liceo de ejemplo no tiene hallazgos demostrados', () => {
    expect(proven(exampleProject())).toEqual([]);
  });

  it('un colegio real con horario generado (que cumple todas las reglas obligatorias) no tiene hallazgos demostrados', () => {
    const p = reference('generada');
    expect(p.timetable?.placements.length).toBeGreaterThan(400);
    expect(proven(p)).toEqual([]);
  });

  it('el colegio sintético grande y el difícil tampoco', () => {
    expect(proven(largeSchool())).toEqual([]);
    // El difícil agota el tiempo, pero no se ha demostrado que sea imposible: la revisión no debe afirmarlo.
    expect(proven(reference('dificil'))).toEqual([]);
  });

  it('no modifica el proyecto', () => {
    const p = reference('dificil');
    const before = JSON.stringify(p);
    diagnose(p, { outcome: { kind: 'timeout', activity: Object.keys(p.locks)[0], placedMax: 10 }, missing: Object.keys(p.locks).slice(0, 5), placed: 10 });
    expect(JSON.stringify(p)).toBe(before);
  });

  it('las hipótesis nunca se presentan como hechos', () => {
    const outcome = { kind: 'timeout', activity: null, placedMax: null } as const;
    for (const p of [reference('dificil'), reference('generada'), exampleProject()]) {
      const d = diagnose(p, { outcome });
      const hyp = d.findings.filter((f) => f.certainty === 'hipotesis');
      for (const f of hyp) {
        expect(f.severity).not.toBe('critica');
        expect(`${f.title} ${f.evidence.join(' ')}`).not.toMatch(/imposible|no existe ningún horario|no alcanzan/i);
      }
      expect(d.proven).toBe(0);
      expect(d.summary).toMatch(/no demuestra que sea imposible/);
    }
    expect(diagnose(reference('dificil'), { outcome: { kind: 'impossible', activity: null, placedMax: null } }).summary)
      .toMatch(/hipótesis, no hechos comprobados/);
  });
});

describe('diagnóstico: condiciones demostradas que validate no detecta', () => {
  it('una franja de electivos sin bloques en que todos sus profesores estén libres a la vez', () => {
    const p = electiveWithoutCommonTime();
    expect(errors(p)).toEqual([]);
    const [f] = proven(p);
    expect(f).toMatchObject({ kind: 'paralelas', certainty: 'demostrado', severity: 'critica', step: 'electivos' });
    expect(f.title).toContain('Electivo artístico');
    expect(f.evidence.join(' ')).toMatch(/todos están disponibles.*: 0/);
    expect(f.entities.teachers).toEqual(expect.arrayContaining([teacher(p, 'Constanza Pizarro').id, teacher(p, 'Isidora Reyes').id]));
    expect(f.changes.map((c) => c.kind)).toContain('teacher-available');
  });

  it('clases de 2 horas sin dos bloques seguidos disponibles', () => {
    const p = exampleProject();
    const t = teacher(p, 'Felipe Morales'); // Física: 4 clases de 2 horas, máximo 4 días
    t.maxDays = null;
    // Disponible solo en bloques sueltos: 1°, 3°, 5° y 7° de cada día. Le caben las 8 horas, pero ninguna clase de 2.
    t.unavailable = p.school.days.flatMap((_, d) => classes(p).filter((_, i) => i % 2 === 1).map((x) => slotKey(d, x.id)));
    expect(errors(p)).toEqual([]);
    const f = proven(p).find((x) => x.kind === 'bloques-seguidos')!;
    expect(f.title).toMatch(/Felipe Morales tiene 4 clases de 2 horas seguidas o más, pero su disponibilidad solo admite 0/);
    expect(f.changes).toContainEqual({ kind: 'teacher-available', teacherId: t.id });
  });

  it('repartir en días distintos obligatoria con más bloques que días que puede venir el profesor', () => {
    const p = exampleProject();
    p.rules.spreadStrength = 'obligatoria';
    teacher(p, 'Carolina Muñoz').maxDays = 2; // Lengua de 1° Medio A y B: 3 bloques cada una
    expect(errors(p)).toEqual([]);
    const f = proven(p).filter((x) => x.kind === 'repartir-dias');
    expect(f).toHaveLength(2);
    expect(f[0].title).toMatch(/3 bloques que deben ir en días distintos, pero Carolina Muñoz puede venir 2 días/);
    expect(f[0].changes[0]).toEqual({ kind: 'spread-preferible' });
  });

  it('bloques fijados en más días que el máximo del profesor', () => {
    const p = exampleProject();
    const t = teacher(p, 'Felipe Morales'); // máximo 4 días
    const fis = units(p).filter((u) => u.teacherId === t.id);
    const cls = classes(p);
    fis.forEach((u, i) => { p.locks[`${u.id}#0`] = { day: i, periodId: cls[0].id }; });
    t.maxDays = 3;
    const f = proven(p).find((x) => x.id === `fijados:dias:${t.id}`)!;
    expect(f.title).toMatch(/bloques fijados en 4 días, pero puede venir como máximo 3/);
    expect(f.changes[0]).toMatchObject({ kind: 'release-locks' });
  });

  it('una asignatura con bloques permitidos en que no caben sus horas', () => {
    const p = exampleProject();
    const mat = p.subjects.find((s) => s.name === 'Matemática')!;
    // Matemática (7 horas por curso) solo en el 1° bloque: 5 bloques a la semana.
    p.rules.subjectWindows.push({ id: 'w-mat', subjectId: mat.id, periodIds: [classes(p)[0].id], strength: 'obligatoria' });
    expect(errors(p)).toEqual([]);
    const f = proven(p).filter((x) => x.kind === 'ventana-asignatura');
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.changes.some((c) => c.kind === 'window-preferible'))).toBe(true);
    // Como preferible deja de ser una condición obligatoria.
    p.rules.subjectWindows.at(-1)!.strength = 'preferible';
    expect(proven(p).filter((x) => x.kind === 'ventana-asignatura')).toEqual([]);
  });
});

describe('diagnóstico: foco y pendientes', () => {
  it('marca como relacionados los hallazgos del bloque que señaló el motor y resume los pendientes', () => {
    const p = electiveWithoutCommonTime();
    const music = units(p).find((u) => u.teacherId === teacher(p, 'Constanza Pizarro').id)!;
    const missing = [`${music.id}#0`, `${music.id}#1`];
    const d = diagnose(p, { outcome: { kind: 'timeout', activity: missing[0], placedMax: 120 }, missing, placed: 120 });
    expect(d.focus?.teachers).toEqual([teacher(p, 'Constanza Pizarro').id]);
    expect(d.pending).toMatchObject({ total: 122, placed: 120 });
    expect(d.pending!.teachers[0]).toMatchObject({ name: 'Constanza Pizarro', n: 2 });
    const first: Finding = d.findings[0];
    expect(first).toMatchObject({ certainty: 'demostrado', kind: 'paralelas', related: true });
    expect(d.summary).toMatch(/no existe ningún horario.*Más tiempo de cálculo no lo resuelve/);
    // Con la generación fallida se agregan, como hipótesis, las reglas estrictas activas.
    expect(d.findings.some((f) => f.kind === 'reglas' && f.certainty === 'hipotesis')).toBe(true);
  });
});
