// Referencias de rendimiento. Las mediciones se corren solo con LARGE=1:
//   LARGE=1 npx vitest run src/domain/large.test.ts
//
// - Colegio grande sintético (24 cursos, ~50 profesores, ~600 bloques), armado copiando el liceo de ejemplo.
// - Dos colegios reales anonimizados (fixtures/): nombres de profesores y del colegio reemplazados, sin el informe de
//   importación. "generada" (492 bloques, sin fijados) trae un horario generado con la semilla 7, para medir el ajuste
//   manual sin el motor. "difícil" (517 bloques, 293 fijados) agota el tiempo: sirve para medir el motor (F4, F3).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { parseResult } from './fetResult';
import { parseBackup } from './backup';
import { validate } from './validate';
import { newId, type Project } from './types';
import { lessons, checkMove, companions, placeTargets } from './manual';
import { fetArgs } from '../engine/args';
import { hasEngine, runEngine } from './nodeEngine.testutil';
import { countPending, hash, payload, projectHash, type SyncMeta } from '../cloud/engine';

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

export const reference = (name: 'generada' | 'dificil'): Project =>
  parseBackup(readFileSync(resolve(__dirname, `fixtures/referencia-${name}.json`), 'utf8'))[0];

/**
 * Como al seleccionar un bloque en "Ver y ajustar": revisa todos los lugares de la semana. Devuelve ms por selección.
 * Una primera vuelta sin medir deja el código ya optimizado por el motor de JavaScript, como tras unos clics.
 */
function measureTargets(p: Project, every = 10) {
  const all = lessons(p);
  const selections = all.filter((_, i) => i % every === 0).map((l) => companions(p, l.pl.key));
  const week = (keys: string[]) => placeTargets(p, keys, all);
  selections.forEach(week);
  const times = selections.map((keys) => { const t = performance.now(); week(keys); return performance.now() - t; });
  return { avg: times.reduce((a, b) => a + b, 0) / times.length, worst: Math.max(...times), n: times.length };
}

describe('colegios de referencia', () => {
  it('se leen y no tienen errores', () => {
    for (const name of ['generada', 'dificil'] as const) {
      const p = reference(name);
      expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
      expect(p.teachers.every((t) => /^Profesor\(a\) \d+$/.test(t.name))).toBe(true);
    }
    expect(lessons(reference('generada'))).toHaveLength(492);
  });
});

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
    const m = measureTargets(p);
    console.log(`sintético: destinos de un bloque (${m.n} bloques): promedio ${m.avg.toFixed(1)} ms, peor ${m.worst.toFixed(1)} ms`);
  });

  it('referencia generada: revisar los destinos de un bloque', () => {
    const p = reference('generada');
    const t = performance.now();
    validate(p);
    const tv = performance.now() - t;
    const m = measureTargets(p);
    console.log(`referencia generada: validar ${tv.toFixed(0)} ms; destinos de un bloque (${m.n} bloques): promedio ${m.avg.toFixed(1)} ms, peor ${m.worst.toFixed(1)} ms`);
    expect(m.worst).toBeLessThan(500);
  });

  it('sincronización: horarios pendientes tras cada edición, con 20 horarios guardados', () => {
    const base = reference('generada');
    let projects: Record<string, Project> = {};
    for (let i = 0; i < 20; i++) { const p = { ...structuredClone(base), id: `p${i}` }; projects[p.id] = p; }
    const meta: SyncMeta = Object.fromEntries(Object.values(projects).map((p) => [p.id, { rev: 1, hash: projectHash(p) }]));
    const edits = 30;
    // Como antes de R2: se serializaba y se calculaba el hash de todos los horarios en cada edición.
    let t = performance.now();
    for (let i = 0; i < edits; i++) for (const p of Object.values(projects)) hash(payload(p));
    const before = (performance.now() - t) / edits;
    t = performance.now();
    for (let i = 0; i < edits; i++) {
      projects = { ...projects, p0: { ...projects.p0, name: `Edición ${i}` } }; // update() deja un objeto nuevo
      expect(countPending(projects, meta)).toBe(1);
    }
    const after = (performance.now() - t) / edits;
    console.log(`pendientes por edición con 20 horarios: todos ${before.toFixed(1)} ms, solo el editado ${after.toFixed(1)} ms`);
  });

  it.runIf(hasEngine)('referencia difícil: el motor en 30 s', async () => {
    const p = reference('dificil');
    const ex = exportFet(p);
    const t = performance.now();
    const out = await runEngine(ex.xml, fetArgs(30, 7));
    const r = parseResult(out.result, ex, out.lines, out.errors, out.difficult);
    console.log(`referencia difícil: ${r.kind} en ${((performance.now() - t) / 1000).toFixed(1)} s${r.kind === 'timeout' && r.placedMax != null ? `, ${r.placedMax} de ${ex.activityById.size} ubicados` : ''}`);
    expect(r.kind).not.toBe('invalid');
  }, 120_000);
});
