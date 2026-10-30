// Ajuste manual sobre un horario real generado por el motor: los motivos que se muestran son verdaderos
// y todo movimiento o intercambio que la app acepta deja el horario sin choques.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { parseActivitiesXml } from './fetResult';
import { FET_IN, FET_OUT, fetArgs } from '../engine/args';
import type { Project } from './types';
import { applyMove, applySwap, checkPlace, companions, lessons, shareStudents } from './manual';

const engineDir = resolve(__dirname, '../../public/engine');

async function generated(): Promise<Project> {
  const p = exampleProject();
  const ex = exportFet(p);
  const require = createRequire(import.meta.url);
  const file = resolve(engineDir, 'fet-cl.js');
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))(mod, mod.exports, require, engineDir, file);
  const M = await (mod.exports as (o: object) => Promise<any>)({ noInitialRun: true, locateFile: (f: string) => resolve(engineDir, f), print: () => {}, printErr: () => {} });
  M.FS.mkdirTree('/work/in'); M.FS.mkdirTree(FET_OUT); M.FS.writeFile(FET_IN, ex.xml);
  try { M.callMain(fetArgs(60, 5)); } catch { /* cierre de Qt */ }
  const placed = parseActivitiesXml(M.FS.readFile(`${FET_OUT}/timetables/horario/horario_activities.xml`, { encoding: 'utf8' }), ex);
  p.timetable = { generatedAt: '', seconds: 0, placements: placed };
  return p;
}

/** Choques: dos clases que se superponen con alumnos, profesor o sala en común. */
function clashes(p: Project): string[] {
  const all = lessons(p);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.pl.day !== b.pl.day || a.startIdx >= b.startIdx + b.dur || b.startIdx >= a.startIdx + a.dur) continue;
    if (shareStudents(p, a.unit, b.unit) || (a.unit.teacherId && a.unit.teacherId === b.unit.teacherId) || (a.pl.roomId && a.pl.roomId === b.pl.roomId))
      out.push(`${a.pl.key} / ${b.pl.key}`);
  }
  return out;
}

describe.skipIf(!existsSync(resolve(engineDir, 'fet-cl.wasm')))('ajuste manual sobre un horario real', () => {
  it('motivos verdaderos; movimientos e intercambios aceptados quedan sin choques', async () => {
    const p = await generated();
    expect(clashes(p)).toEqual([]);
    const all = lessons(p);
    const classes = p.school.periods.filter((x) => x.kind === 'clase');
    let moves = 0, swaps = 0;
    const wrong: string[] = [];
    for (const l of all) {
      const keys = companions(p, l.pl.key);
      for (let d = 0; d < p.school.days.length; d++) for (const per of classes) {
        const r = checkPlace(p, keys, d, per.id, all);
        const start = p.school.periods.findIndex((x) => x.id === per.id);
        if (!r.ok) {
          // "Los alumnos ya tienen X a esa hora": tiene que existir esa clase superpuesta con alumnos en común.
          const m = /^Los alumnos ya tienen (.+?) a esa hora/.exec(r.reason);
          if (m && !all.some((o) => !keys.includes(o.pl.key) && o.pl.day === d && p.subjects.find((s) => s.id === o.unit.subjectId)!.name === m[1]
            && o.startIdx < start + l.dur && start < o.startIdx + o.dur && shareStudents(p, l.unit, o.unit)))
            wrong.push(`${l.pl.key} → ${d}/${per.label}: ${r.reason}`);
          continue;
        }
        const copy = structuredClone(p);
        if (r.swapWith) { applySwap(copy, keys, r.swapWith); swaps++; } else { applyMove(copy, keys, d, per.id); moves++; }
        const c = clashes(copy);
        if (c.length) wrong.push(`${r.swapWith ? 'intercambio' : 'movimiento'} ${l.pl.key} → ${d}/${per.label}: ${c[0]}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(moves).toBeGreaterThan(10);
    expect(swaps).toBeGreaterThan(10);
  }, 180_000);
});
