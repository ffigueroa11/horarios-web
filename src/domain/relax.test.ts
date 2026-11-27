import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { diagnose } from './diagnose';
import { exportFet } from './fetExport';
import { applyChange, changeId, classify, describeChange, isApplicable, relaxPlan, variantProject, type Change } from './relax';
import { slotKey, type Project } from './types';
import { units } from './units';
import { electiveWithoutCommonTime, reference } from './cases.testutil';

/** Cuenta cada tipo de restricción del .fet, para comparar lo que cambió entre dos exportaciones. */
function constraints(p: Project) {
  const counts = new Map<string, number>();
  for (const m of exportFet(p).xml.matchAll(/<(Constraint\w+)>[\s\S]*?<\/\1>/g)) {
    const key = `${m[1]}${/<Weight_Percentage>(\d+)/.exec(m[0])?.[1] ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function withLock(p: Project) {
  const u = units(p)[0];
  p.locks[`${u.id}#0`] = { day: 1, periodId: p.school.periods[0].id };
  return p;
}

describe('variantes', () => {
  it('se arman sobre una copia: el proyecto original no cambia', () => {
    const p = withLock(electiveWithoutCommonTime());
    p.rules.spreadStrength = 'obligatoria';
    const before = JSON.stringify(p);
    const all: Change[] = [
      { kind: 'spread-preferible' }, { kind: 'teacher-available', teacherId: p.teachers[0].id },
      { kind: 'courses-no-gaps-off' }, { kind: 'release-locks', keys: Object.keys(p.locks), scope: 'todos' },
      { kind: 'teacher-gaps-day', value: 3 }, { kind: 'window-preferible', windowId: p.rules.subjectWindows[0].id },
    ];
    for (const c of all) variantProject(p, c);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('cambian solo lo indicado: los fijados y las demás reglas obligatorias se mantienen', () => {
    const p = withLock(exampleProject());
    const base = constraints(p);
    expect(base.ConstraintActivityPreferredStartingTime100).toBe(1);
    // Repartir pasa de 95 a 100 % solo en el caso obligatorio; aquí se prueba con la ventana de Ed. Física.
    const v = constraints(variantProject(p, { kind: 'window-preferible', windowId: p.rules.subjectWindows[0].id }));
    expect(v).toEqual({ ...base, ConstraintActivitiesPreferredTimeSlots100: undefined, ConstraintActivitiesPreferredTimeSlots95: 1 });
    const gaps = constraints(variantProject(p, { kind: 'courses-no-gaps-off' }));
    expect(gaps).toEqual({ ...base, ConstraintStudentsMaxGapsPerWeek100: undefined });
    // Liberar fijados es el único cambio que los quita.
    const free = constraints(variantProject(p, { kind: 'release-locks', keys: Object.keys(p.locks), scope: 'todos' }));
    expect(free).toEqual({ ...base, ConstraintActivityPreferredStartingTime100: undefined });
  });

  it('aplicar un cambio sobre un borrador hace lo que dice su descripción', () => {
    const p = exampleProject();
    const t = p.teachers.find((x) => x.name === 'Felipe Morales')!;
    const d = structuredClone(p);
    applyChange(d, { kind: 'teacher-max-days', teacherId: t.id, value: 5 });
    expect(d.teachers.find((x) => x.id === t.id)!.maxDays).toBe(5);
    expect(describeChange(p, { kind: 'teacher-max-days', teacherId: t.id, value: 5 }).title).toBe('Permitir que Felipe Morales venga 5 días');
  });

  it('las descripciones no usan términos del motor', () => {
    const p = withLock(exampleProject());
    p.rules.teacherMeetingSlots = [slotKey(0, p.school.periods[0].id)];
    p.rules.teacherMaxHoursDaily = 6;
    const plan = relaxPlan(p, diagnose(p, { outcome: { kind: 'timeout', activity: null, placedMax: null } }), 50);
    expect(plan.length).toBeGreaterThan(4);
    for (const c of plan) {
      const { title, effect } = describeChange(p, c);
      expect(`${title} ${effect}`).not.toMatch(/FET|constraint|restricci|peso|weight|%/i);
    }
  });
});

describe('orden de las alternativas', () => {
  it('empieza por lo que señalan los hallazgos demostrados, sin repetir ni proponer cambios sin efecto', () => {
    const p = electiveWithoutCommonTime();
    const plan = relaxPlan(p, diagnose(p, { outcome: { kind: 'timeout', activity: null, placedMax: null } }));
    expect(plan[0]).toMatchObject({ kind: 'teacher-available' });
    expect(new Set(plan.map(changeId)).size).toBe(plan.length);
    expect(plan.every((c) => isApplicable(p, c))).toBe(true);
    // El ejemplo deja "repartir" como preferible: no se propone pasarla a preferible.
    expect(plan.some((c) => c.kind === 'spread-preferible')).toBe(false);
    expect(plan.length).toBeLessThanOrEqual(10);
  });

  it('con muchos fijados, liberarlos aparece al final', () => {
    const p = reference('dificil');
    const plan = relaxPlan(p, diagnose(p, { outcome: { kind: 'timeout', activity: null, placedMax: null } }), 50);
    expect(plan.at(-1)).toMatchObject({ kind: 'release-locks', scope: 'todos' });
  });
});

describe('resultado de una variante', () => {
  it('agotar el tiempo no es lo mismo que no bastar', () => {
    expect(classify({ kind: 'ok' })).toBe('funciona');
    expect(classify({ kind: 'impossible', activity: null, placedMax: null })).toBe('no-basta');
    expect(classify({ kind: 'timeout', activity: null, placedMax: 10 })).toBe('sin-resolver');
    expect(classify({ kind: 'invalid', details: '', activities: [] })).toBe('rechazada');
  });
});
