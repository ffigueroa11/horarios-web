import { describe, expect, it } from 'vitest';
import { emptyProject, exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { describeActivity, fetMessages, parseActivitiesXml, parseResult } from './fetResult';
import { courseLoad, longestRun, openSlots, parseBlocks, teacherLoad, validate } from './validate';
import { units } from './units';
import { migrateProject, newId, slotKey } from './types';

describe('jornada', () => {
  it('cuenta bloques abiertos y el tramo continuo más largo', () => {
    const p = exampleProject();
    expect(openSlots(p).map((d) => d.length)).toEqual([8, 8, 8, 8, 6]);
    expect(longestRun(p)).toBe(2); // los recreos cortan cada 2 bloques
  });
});

describe('revisión previa', () => {
  it('el liceo de ejemplo no tiene errores', () => {
    expect(validate(exampleProject()).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('un proyecto vacío pide cursos y carga', () => {
    const steps = validate(emptyProject()).map((i) => i.step);
    expect(steps).toContain('cursos');
    expect(steps).toContain('carga');
  });
  it('detecta un bloque que no cabe entre recreos', () => {
    const p = exampleProject();
    p.assignments[0].blocks = [3, 3];
    expect(validate(p).some((i) => i.level === 'error' && /bloque de 3 horas/.test(i.message))).toBe(true);
  });
  it('detecta un profesor con más horas que bloques disponibles', () => {
    const p = exampleProject();
    const t = p.teachers.find((x) => x.name === 'Isidora Reyes')!;
    t.unavailable = p.school.days.flatMap((_, d) => p.school.periods.map((x) => slotKey(d, x.id))).slice(4);
    expect(validate(p).some((i) => i.level === 'error' && i.message.startsWith('Isidora Reyes'))).toBe(true);
  });
  it('detecta un curso con más horas que la semana', () => {
    const p = exampleProject();
    p.assignments.push({ id: newId(), courseId: p.courses[0].id, groupId: null, subjectId: p.subjects[0].id, teacherId: null, blocks: [2, 2] });
    expect(validate(p).some((i) => i.level === 'error' && i.message.includes('40 horas'))).toBe(true);
  });
});

describe('exportador .fet', () => {
  it('genera una actividad por bloque y nombres únicos', () => {
    const p = exampleProject();
    p.teachers[1].name = p.teachers[0].name; // nombre repetido
    const ex = exportFet(p);
    expect(ex.activityById.size).toBe(units(p).reduce((n, u) => n + u.blocks.length, 0));
    expect(ex.xml).toContain(`<Name>${p.teachers[0].name} (2)</Name>`);
    expect(ex.xml).toContain('<ConstraintBreakTimes>');
    expect(ex.xml).toContain('<ConstraintSubjectPreferredRoom>');
  });
  it('escapa caracteres especiales de XML', () => {
    const p = exampleProject();
    p.school.name = 'Colegio "Santa María" & <Anexo>';
    expect(exportFet(p).xml).toContain('Colegio &quot;Santa María&quot; &amp; &lt;Anexo&gt;');
  });
  it('lee el horario y traduce el error de FET', () => {
    const p = exampleProject();
    const ex = exportFet(p);
    const per = p.school.periods[0];
    const xml = `<Activities_Timetable><Activity><Id>1</Id><Day>${ex.dayNames[3]}</Day><Hour>${per.label}</Hour><Room></Room></Activity></Activities_Timetable>`;
    expect(parseActivitiesXml(xml, ex)).toEqual([{ key: ex.activityById.get(1), day: 3, periodId: per.id, roomId: null }]);
    const res = 'Impossible\nFET managed to schedule correctly the first 12 most difficult activities. ... This activity is listed below:\n\nId: 1 (Teacher ...)';
    const out = parseResult(res, ex, []);
    expect(out).toMatchObject({ kind: 'impossible', placedMax: 12, activity: ex.activityById.get(1) });
    expect(describeActivity(p, ex.activityById.get(1)!)).toMatch(/^Lengua y Literatura · 1° Medio A · Carolina Muñoz \(bloque 1 de 3, 2 h\)$/);
  });
});

describe('divisiones', () => {
  it('cuenta las horas por alumno y exporta grupos y clases en paralelo', () => {
    const p = exampleProject();
    const c = p.courses[2];
    expect(c.divisions[0].groups.map((g) => g.name)).toEqual(['Básico', 'Avanzado']);
    expect(courseLoad(p, c.id)).toBe(36); // 28 comunes + 4 de inglés de su grupo + 4 del electivo
    const xml = exportFet(p).xml;
    expect(xml).toContain('<Group><Name>2° Medio A Básico</Name>');
    // 2 bloques de inglés en paralelo + 2 bloques del electivo artístico
    expect((xml.match(/<ConstraintActivitiesSameStartingTime>/g) ?? []).length).toBe(4);
  });
  it('con dos divisiones crea un subgrupo por combinación', () => {
    const p = exampleProject();
    const c = p.courses[2];
    c.divisions.push({ id: newId(), name: 'Taller', parallel: false, groups: [{ id: newId(), name: 'Música' }, { id: newId(), name: 'Teatro' }] });
    const xml = exportFet(p).xml;
    // Inglés por nivel × Taller × electivo artístico (que también divide al curso).
    expect(xml).toContain('<Subgroup><Name>2° Medio A Básico + Música + Artes Visuales</Name>');
    expect((xml.match(/<Subgroup><Name>2° Medio A Avanzado \+ Teatro \+ Tecnología<\/Name>/g) ?? []).length).toBe(3); // listado en sus tres grupos
    expect(validate(p).some((i) => i.message.includes('El grupo Música'))).toBe(true);
  });
  it('migra proyectos guardados sin divisiones', () => {
    const p = exampleProject() as any;
    for (const c of p.courses) delete c.divisions;
    for (const a of p.assignments) delete a.groupId;
    const m = migrateProject(p);
    expect(m.courses.every((c) => Array.isArray(c.divisions))).toBe(true);
    expect(m.assignments.every((a) => a.groupId === null)).toBe(true);
  });
});

describe('electivos entre cursos', () => {
  it('exporta cada opción como una actividad de varios cursos, a la misma hora', () => {
    const p = exampleProject();
    const e = p.electives[0];
    const ex = exportFet(p);
    // Cada opción llega a 2° Medio A y 2° Medio B (como grupos del electivo en cada curso).
    expect(ex.xml).toContain('<Students>2° Medio A Música</Students><Students>2° Medio B Música</Students>');
    expect(ex.xml).toContain('<Group><Name>2° Medio B Artes Visuales</Name>');
    expect([...ex.activityById.values()].filter((k) => k.startsWith(`${e.id}:`))).toHaveLength(e.options.length * e.blocks.length);
    // La profesora de Artes suma 1° A y 1° B (2 + 2) y el electivo una sola vez (4), no por curso.
    expect(teacherLoad(p, e.options[0].teacherId!)).toBe(8);
    expect(courseLoad(p, p.courses[3].id)).toBe(36);
  });
  it('avisa si dos opciones de una franja tienen el mismo profesor', () => {
    const p = exampleProject();
    p.electives[0].options[2].teacherId = p.electives[0].options[0].teacherId;
    expect(validate(p).some((i) => i.level === 'error' && i.step === 'electivos' && i.message.includes('dicta 2 opciones'))).toBe(true);
  });
  it('limpia referencias a cursos, asignaturas y profesores eliminados', () => {
    const p = exampleProject();
    const e = p.electives[0];
    p.courses = p.courses.filter((c) => c.id !== e.courseIds[0]);
    p.subjects = p.subjects.filter((s) => s.id !== e.options[2].subjectId);
    p.teachers = p.teachers.filter((t) => t.id !== e.options[0].teacherId);
    migrateProject(p);
    expect(e.courseIds).toHaveLength(1);
    expect(e.options).toHaveLength(2);
    expect(e.options[0].teacherId).toBeNull();
  });
  it('describe un bloque de electivo', () => {
    const p = exampleProject();
    const e = p.electives[0];
    expect(describeActivity(p, `${e.id}:${e.options[2].id}#1`)).toBe('Música · electivo de 2° Medio A, 2° Medio B · Constanza Pizarro (bloque 2 de 2, 2 h)');
  });
});

describe('mensajes de FET en español', () => {
  it('reconoce el resultado y los mensajes traducidos', () => {
    const p = exampleProject();
    const ex = exportFet(p);
    const res = 'Impossible\nFET logró programar correctamente las primeras 30 actividades más difíciles. ... Esta actividad se muestra a continuación:\n\nId: 2 (Profesor ...)';
    expect(parseResult(res, ex, [])).toMatchObject({ kind: 'impossible', placedMax: 30, activity: ex.activityById.get(2) });
    const errors = 'Título: Advertencia de FET\nMensaje: No es posible optimizar para el profesor X.\nTexto botón 0: Saltar el resto\nPresionar el botón predefinido 1\n\nTítulo: Advertencia de FET\nMensaje: Otra cosa\n\nen dos líneas\nTexto botón 0: Saltar el resto\n';
    expect(fetMessages(errors)).toEqual(['No es posible optimizar para el profesor X.', 'Otra cosa\n\nen dos líneas']);
    expect(parseResult('Cannot precompute - data is wrong - aborting', ex, [], errors)).toEqual({ kind: 'invalid', details: 'No es posible optimizar para el profesor X.\n\nOtra cosa\n\nen dos líneas' });
  });
});

describe('bloques', () => {
  it('interpreta la notación 2+2+2', () => {
    expect(parseBlocks('2+2+2')).toEqual([2, 2, 2]);
    expect(parseBlocks('2, 1')).toEqual([2, 1]);
    expect(parseBlocks('0')).toBeNull();
    expect(parseBlocks('abc')).toBeNull();
  });
});
