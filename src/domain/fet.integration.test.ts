// Prueba de punta a punta: proyecto → .fet → motor WebAssembly (en Node) → horario → verificación.
// Se omite si el motor no está en public/engine.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { parseFet } from './fetImport';
import { parseActivitiesXml, parseResult } from './fetResult';
import { FET_IN, FET_OUT, fetArgs } from '../engine/args';
import { slotKey, type Project } from './types';
import { teacherLoad, validate } from './validate';
import { courseStudentSets, units } from './units';
import { applyMove, checkMove, companions, lessons } from './manual';

const engineDir = resolve(__dirname, '../../public/engine');
const hasEngine = existsSync(resolve(engineDir, 'fet-cl.wasm'));

async function runEngine(xml: string, args: string[], spanish = false) {
  // fet-cl.js es CommonJS y el proyecto es ESM: se evalúa con un envoltorio de módulo.
  const require = createRequire(import.meta.url);
  const file = resolve(engineDir, 'fet-cl.js');
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))(
    mod, mod.exports, require, engineDir, file);
  const factory = mod.exports as (opts: object) => Promise<any>;
  const lines: string[] = [];
  const M = await factory({
    noInitialRun: true,
    locateFile: (f: string) => resolve(engineDir, f),
    print: (l: string) => lines.push(l),
    printErr: (l: string) => lines.push(l),
  });
  M.FS.mkdirTree('/work/in');
  M.FS.mkdirTree(FET_OUT);
  M.FS.writeFile(FET_IN, xml);
  if (spanish) {
    M.FS.mkdirTree('/translations');
    M.FS.writeFile('/translations/fet_es.qm', readFileSync(resolve(engineDir, 'fet_es.qm')));
    args = [...args, '--language=es'];
  }
  try { M.callMain(args); } catch { /* limpieza de Qt al salir; los resultados ya están escritos */ }
  const read = (p: string) => (M.FS.analyzePath(p).exists ? M.FS.readFile(p, { encoding: 'utf8' }) : '');
  return {
    lines,
    result: read(`${FET_OUT}/logs/result.txt`),
    activities: read(`${FET_OUT}/timetables/horario/horario_activities.xml`),
    errors: read(`${FET_OUT}/logs/errors.txt`),
  };
}

describe.runIf(hasEngine)('importar .fet y generar', () => {
  it('un proyecto exportado e importado se genera con el motor', async () => {
    const { project: p } = parseFet(exportFet(exampleProject()).xml, 'ejemplo.fet');
    const ex = exportFet(p);
    const { result } = await runEngine(ex.xml, fetArgs(60, 7));
    expect(parseResult(result, ex, []).kind).toBe('ok');
  }, 120_000);

  it('un .fet de FET 5 con bloques fijados el mismo día y recreos deducidos conserva los fijados', async () => {
    const hours = ['08:00 - 08:45', '08:45 - 09:30', '09:45 - 10:30', '10:31 - 11:15'];
    const act = (id: number, group: number, dur: number, course: string) =>
      `<Activity><Teacher>Soto ${course}</Teacher><Subject>Matemática</Subject><Students>${course}</Students><Duration>${dur}</Duration><Id>${id}</Id><Activity_Group_Id>${group}</Activity_Group_Id><Active>true</Active></Activity>`;
    const fix = (id: number, day: string, hour: string) =>
      `<ConstraintActivityPreferredStartingTime><Weight_Percentage>100</Weight_Percentage><Activity_Id>${id}</Activity_Id><Preferred_Day>${day}</Preferred_Day><Preferred_Hour>${hour}</Preferred_Hour><Active>true</Active></ConstraintActivityPreferredStartingTime>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><fet version="5.23.1"><Institution_Name>X</Institution_Name>
      <Days_List><Day><Name>Lunes</Name></Day><Day><Name>Martes</Name></Day></Days_List>
      <Hours_List>${hours.map((h) => `<Hour><Name>${h}</Name></Hour>`).join('')}</Hours_List>
      <Students_List><Year><Name>1°A</Name></Year></Students_List>
      <Teachers_List><Teacher><Name>Soto 1°A</Name></Teacher></Teachers_List>
      <Subjects_List><Subject><Name>Matemática</Name></Subject></Subjects_List>
      <Activities_List>${act(1, 1, 2, '1°A')}${act(2, 1, 2, '1°A')}${act(3, 1, 2, '1°A')}</Activities_List>
      <Time_Constraints_List>${fix(1, 'Lunes', hours[0])}${fix(2, 'Lunes', hours[2])}
        <ConstraintMinDaysBetweenActivities><Weight_Percentage>95</Weight_Percentage><Consecutive_If_Same_Day>true</Consecutive_If_Same_Day><Number_of_Activities>3</Number_of_Activities><Activity_Id>1</Activity_Id><Activity_Id>2</Activity_Id><Activity_Id>3</Activity_Id><MinDays>1</MinDays><Active>true</Active></ConstraintMinDaysBetweenActivities>
      </Time_Constraints_List></fet>`;
    const { project: p } = parseFet(xml);
    const ex = exportFet(p);
    const { result, activities } = await runEngine(ex.xml, fetArgs(30, 7));
    expect(parseResult(result, ex, []).kind).toBe('ok');
    const placed = new Map(parseActivitiesXml(activities, ex).map((x) => [x.key, x]));
    expect(placed.size).toBe(3);
    for (const [key, lock] of Object.entries(p.locks)) expect(placed.get(key)).toMatchObject(lock);
  }, 60_000);
});

/** Verifica un horario: sin choques de alumnos, profesores ni salas; sin recreos ni tramos cerrados. */
function checkTimetable(p: Project, placed: ReturnType<typeof parseActivitiesXml>) {
  const per = new Map(p.school.periods.map((x, i) => [x.id, i]));
  const byId = new Map(units(p).map((u) => [u.id, u]));
  const occupied = new Map<string, string>(); // `${quien}|${dia}|${tramo}` → actividad
  const daily = new Map<string, number>();
  for (const pl of placed) {
    const [uid, idx] = pl.key.split('#');
    const u = byId.get(uid)!;
    const dur = u.blocks[Number(idx)];
    const start = per.get(pl.periodId)!;
    for (let k = 0; k < dur; k++) {
      const period = p.school.periods[start + k];
      expect(period?.kind, 'un bloque no puede caer en recreo').toBe('clase');
      const sk = slotKey(pl.day, period.id);
      expect(p.school.closed.includes(sk)).toBe(false);
      // Un alumno (combinación de grupos, incluidas las franjas de electivos) no puede tener dos clases a la vez.
      const who: string[] = [];
      for (const a of u.audience) {
        const course = p.courses.find((c) => c.id === a.courseId)!;
        courseStudentSets(p, course).forEach((combo, i) => {
          if (!a.groupId || combo.some((g) => g.id === a.groupId)) who.push(`s:${a.courseId}:${i}`);
        });
      }
      if (u.teacherId) who.push(`t:${u.teacherId}`);
      if (pl.roomId) who.push(`r:${pl.roomId}`);
      for (const w of who) {
        const key = `${w}|${pl.day}|${period.id}`;
        expect(occupied.has(key), `choque en ${key}`).toBe(false);
        occupied.set(key, pl.key);
      }
      if (u.teacherId) {
        const t = p.teachers.find((x) => x.id === u.teacherId)!;
        expect(t.unavailable.includes(sk), `${t.name} no disponible`).toBe(false);
        expect(p.rules.teacherMeetingSlots.includes(sk), 'clase durante el consejo').toBe(false);
        daily.set(`${u.teacherId}|${pl.day}`, (daily.get(`${u.teacherId}|${pl.day}`) ?? 0) + 1);
      }
    }
    const s = p.subjects.find((x) => x.id === u.subjectId)!;
    if (s.roomId) expect(pl.roomId).toBe(s.roomId);
  }
  if (p.rules.teacherMaxHoursDaily != null)
    for (const [k, n] of daily) expect(n, `horas diarias de ${k}`).toBeLessThanOrEqual(p.rules.teacherMaxHoursDaily);
}

const sameStart = (placed: ReturnType<typeof parseActivitiesXml>, keys: string[]) => {
  const pls = keys.map((k) => placed.find((q) => q.key === k)!);
  for (const x of pls) expect([x.day, x.periodId]).toEqual([pls[0].day, pls[0].periodId]);
};

describe.skipIf(!hasEngine)('motor FET (WebAssembly)', () => {
  it('genera el liceo de ejemplo sin choques y respetando las reglas', async () => {
    const p = exampleProject();
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
    const ex = exportFet(p);
    const out = await runEngine(ex.xml, fetArgs(120, 42));
    const outcome = parseResult(out.result, ex, out.lines);
    expect(outcome, out.lines.slice(-20).join('\n')).toEqual({ kind: 'ok' });
    const placed = parseActivitiesXml(out.activities, ex);
    const expected = units(p).reduce((n, u) => n + u.blocks.length, 0);
    expect(placed.length).toBe(expected);
    checkTimetable(p, placed);
    // Inglés por nivel en 2° Medio A: Básico y Avanzado a la misma hora, bloque por bloque.
    const [g1, g2] = p.courses[2].divisions[0].groups;
    const b = p.assignments.find((x) => x.groupId === g1.id)!, v = p.assignments.find((x) => x.groupId === g2.id)!;
    for (const i of [0, 1]) sameStart(placed, [`${b.id}#${i}`, `${v.id}#${i}`]);
    // Electivo artístico de 2° Medio A y B: las tres opciones a la misma hora.
    const e = p.electives[0];
    for (const i of [0, 1]) sameStart(placed, e.options.map((o) => `${e.id}:${o.id}#${i}`));
    // Educación Física solo antes del almuerzo.
    const edf = p.subjects.find((s) => s.short === 'EFI')!;
    const allowed = new Set(p.rules.subjectWindows[0].periodIds);
    const byId = new Map(units(p).map((u) => [u.id, u]));
    for (const pl of placed)
      if (byId.get(pl.key.split('#')[0])!.subjectId === edf.id) expect(allowed.has(pl.periodId)).toBe(true);
  }, 180_000);

  it('respeta los bloques fijados al regenerar', async () => {
    const p = exampleProject();
    const a = p.assignments[0];
    const firstClass = p.school.periods.find((x) => x.kind === 'clase')!;
    p.locks[`${a.id}#0`] = { day: 2, periodId: firstClass.id };
    const ex = exportFet(p);
    const out = await runEngine(ex.xml, fetArgs(120, 7));
    expect(parseResult(out.result, ex, out.lines).kind).toBe('ok');
    const pl = parseActivitiesXml(out.activities, ex).find((x) => x.key === `${a.id}#0`)!;
    expect([pl.day, pl.periodId]).toEqual([2, firstClass.id]);
  }, 180_000);

  it('respeta el consejo de profesores y el máximo de horas diarias', async () => {
    const p = exampleProject();
    const classes = p.school.periods.filter((x) => x.kind === 'clase');
    p.rules.teacherMeetingSlots = [slotKey(2, classes[6].id), slotKey(2, classes[7].id)];
    p.rules.teacherMaxHoursDaily = 7;
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
    const ex = exportFet(p);
    expect(ex.xml).toContain('<ConstraintTeachersMaxHoursDaily>');
    const out = await runEngine(ex.xml, fetArgs(120, 11));
    expect(parseResult(out.result, ex, out.lines).kind).toBe('ok');
    const placed = parseActivitiesXml(out.activities, ex);
    checkTimetable(p, placed);
    // Ajuste manual: cualquier lugar que checkMove acepta deja el horario sin choques.
    p.timetable = { generatedAt: new Date().toISOString(), seconds: 1, placements: placed };
    const all = lessons(p);
    let tried = 0;
    for (const l of all.filter((_, i) => i % 4 === 0)) {
      const keys = companions(p, l.pl.key);
      for (let d = 0; d < p.school.days.length; d++) for (const per of classes) {
        const ok = checkMove(p, keys, d, per.id, all).ok;
        if (!ok) continue;
        const copy = structuredClone(p);
        applyMove(copy, keys, d, per.id);
        checkTimetable(copy, copy.timetable!.placements);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(3);
    expect(teacherLoad(p, p.teachers[0].id)).toBeGreaterThan(0);
  }, 180_000);

  it('informa la actividad problemática cuando el horario es imposible', async () => {
    const p = exampleProject();
    // El profesor de Física solo puede venir el lunes al primer bloque: imposible ubicar sus 8 horas.
    const fis = p.teachers.find((t) => t.name === 'Felipe Morales')!;
    fis.maxDays = null;
    fis.unavailable = p.school.days.flatMap((_, d) => p.school.periods.map((x) => slotKey(d, x.id)))
      .filter((k) => k !== slotKey(0, p.school.periods[0].id));
    const ex = exportFet(p);
    const out = await runEngine(ex.xml, fetArgs(20, 3), true);
    const outcome = parseResult(out.result, ex, out.lines, out.errors);
    // FET lo detecta antes de buscar y lo explica en español.
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind === 'invalid') expect(outcome.details).toMatch(/profesor Felipe Morales/);
  }, 180_000);

  it('detecta un horario imposible durante la búsqueda', async () => {
    const p = exampleProject();
    // Matemática de 1° A en un solo día con 4 bloques y "repartir en días" obligatorio: FET no puede ubicarlo.
    p.rules.spreadStrength = 'obligatoria';
    const mat = p.assignments.find((a) => a.courseId === p.courses[0].id && p.subjects.find((s) => s.id === a.subjectId)!.short === 'MAT')!;
    const classes = p.school.periods.filter((x) => x.kind === 'clase');
    for (const [i, d] of [0, 0, 0, 0].entries()) p.locks[`${mat.id}#${i}`] = { day: d, periodId: classes[i * 2].id };
    const ex = exportFet(p);
    const out = await runEngine(ex.xml, fetArgs(15, 5), true);
    const outcome = parseResult(out.result, ex, out.lines, out.errors);
    expect(outcome.kind).not.toBe('ok');
  }, 180_000);
});
