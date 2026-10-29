// Colegio grande sintético (24 cursos, ~50 profesores, ~600 bloques). Se corre solo con LARGE=1:
//   LARGE=1 npx vitest run src/domain/large.test.ts
import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { validate } from './validate';
import { newId, type Project } from './types';
import { lessons, checkMove } from './manual';

export function largeSchool(copies = 6): Project {
  const base = exampleProject();
  const p = structuredClone(base);
  p.courses = []; p.teachers = []; p.assignments = []; p.electives = [];
  for (const s of p.subjects) s.roomId = null; // un laboratorio no alcanza para 24 cursos
  for (let k = 0; k < copies; k++) {
    const tMap = new Map(base.teachers.map((t) => [t.id, { ...structuredClone(t), id: newId(), name: `${t.name} ${k + 1}` }]));
    const cMap = new Map(base.courses.map((c) => [c.id, { ...structuredClone(c), id: newId(), name: `${c.name} ${k + 1}` }]));
    p.teachers.push(...tMap.values());
    p.courses.push(...cMap.values());
    for (const a of base.assignments) {
      const c = cMap.get(a.courseId)!;
      const groupId = a.groupId ? c.divisions[0].groups[base.courses.find((x) => x.id === a.courseId)!.divisions[0].groups.findIndex((g) => g.id === a.groupId)].id : null;
      p.assignments.push({ ...a, id: newId(), courseId: c.id, teacherId: a.teacherId ? tMap.get(a.teacherId)!.id : null, groupId });
    }
    for (const e of base.electives)
      p.electives.push({ ...structuredClone(e), id: newId(), courseIds: e.courseIds.map((id) => cMap.get(id)!.id),
        options: e.options.map((o) => ({ ...o, id: newId(), teacherId: o.teacherId ? tMap.get(o.teacherId)!.id : null })) });
  }
  return p;
}

describe.skipIf(!process.env.LARGE)('colegio grande', () => {
  it('valida, exporta y revisa movimientos rápido', () => {
    const p = largeSchool();
    let t = performance.now();
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
    const tv = performance.now() - t;
    t = performance.now();
    const ex = exportFet(p);
    const te = performance.now() - t;
    console.log(`cursos ${p.courses.length}, profesores ${p.teachers.length}, bloques ${ex.activityById.size}; validar ${tv.toFixed(0)} ms, exportar ${te.toFixed(0)} ms`);
    // Horario ficticio para medir la revisión de movimientos (todas las celdas de la semana).
    const classes = p.school.periods.filter((x) => x.kind === 'clase');
    p.timetable = { generatedAt: '', seconds: 0, placements: [...ex.activityById.values()].map((key, i) => ({ key, day: i % 5, periodId: classes[i % 6].id, roomId: null })) };
    t = performance.now();
    const all = lessons(p);
    for (let d = 0; d < 5; d++) for (const per of classes) checkMove(p, [all[0].pl.key], d, per.id, all);
    console.log(`revisar 40 lugares: ${(performance.now() - t).toFixed(0)} ms`);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
