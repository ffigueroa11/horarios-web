// Diagnóstico determinista: por qué un horario puede no tener solución. Es puro e instantáneo, no llama al motor.
//
// Cada hallazgo es "demostrado" o una "hipótesis":
//  - demostrado: una condición necesaria que los datos no cumplen (un conteo de horas, de bloques seguidos o de días).
//    Si aparece, NINGÚN horario respeta las reglas obligatorias, y da lo mismo cuánto tiempo se le dé al motor.
//  - hipótesis: poco margen o una combinación de reglas estrictas. Puede explicar la falla, pero no la demuestra:
//    se comprueba con las alternativas de relax.ts.
// Los conteos son relajaciones del problema real (no consideran todas las reglas a la vez), así que nunca afirman que
// algo es imposible cuando no lo es; a cambio, no detectan todas las imposibilidades.
import type { ActivityKey, Id, Project, Teacher } from './types';
import { parseActivityKey, slotKey } from './types';
import { courseStudentSets, parallelRows, unitById, unitIdOf, units, type Unit } from './units';
import { hours, type Step } from './validate';
import { lockProblems, slotProblem } from './manual';
import { describeActivity, describeUnit, type FetOutcome } from './fetResult';
import type { Change } from './relax';

export type Certainty = 'demostrado' | 'hipotesis';
export type Severity = 'critica' | 'alta' | 'media' | 'baja';
export type FindingKind =
  | 'carga-profesor' | 'bloques-seguidos' | 'dias-profesor' | 'repartir-dias' | 'ventana-asignatura' | 'sala'
  | 'paralelas' | 'fijados' | 'carga-curso' | 'reglas';

export interface Entities {
  teachers: Id[];
  courses: Id[];
  subjects: Id[];
  rooms: Id[];
  activities: ActivityKey[];
}

export interface Finding {
  /** Estable mientras no cambien los datos: `${tipo}:${ids}`. */
  id: string;
  kind: FindingKind;
  certainty: Certainty;
  severity: Severity;
  /** Qué pasa, en una frase. */
  title: string;
  /** Los números que lo sostienen. */
  evidence: string[];
  /** Qué hacer. */
  action: string;
  step: Step;
  entities: Entities;
  /** Cambios que se pueden evaluar con el motor (relax.ts), del más pequeño al más grande. */
  changes: Change[];
  /** Toca al bloque que el motor no pudo ubicar o a los bloques que quedaron pendientes. */
  related: boolean;
}

export interface PendingSummary {
  total: number;
  placed: number;
  /** Los más repetidos entre los bloques sin ubicar, con cuántos tiene cada uno. */
  teachers: { id: Id; name: string; n: number }[];
  courses: { id: Id; name: string; n: number }[];
  subjects: { id: Id; name: string; n: number }[];
}

export interface Diagnosis {
  findings: Finding[];
  proven: number;
  hypotheses: number;
  /** Una o dos frases para el encabezado del diagnóstico. */
  summary: string;
  pending: PendingSummary | null;
  /** Profesores, cursos y asignaturas del bloque que señaló el motor. */
  focus: Entities | null;
}

export interface DiagnoseContext {
  outcome?: FetOutcome | null;
  /** Bloques sin ubicar en el mejor intento (horario parcial). */
  missing?: ActivityKey[];
  placed?: number;
}

// ---------- Máscaras de disponibilidad: [día][índice del tramo en school.periods] ----------

type Mask = boolean[][];

const schoolMask = (p: Project): Mask => p.school.days.map((_, d) =>
  p.school.periods.map((x) => x.kind === 'clase' && !p.school.closed.includes(slotKey(d, x.id))));

function teacherMask(p: Project, t: Teacher | undefined, opts: { ignoreUnavailable?: boolean; ignoreMeeting?: boolean } = {}): Mask {
  const base = schoolMask(p);
  if (!t) return base;
  const blocked = new Set([...(opts.ignoreUnavailable ? [] : t.unavailable), ...(opts.ignoreMeeting ? [] : p.rules.teacherMeetingSlots)]);
  return base.map((row, d) => row.map((ok, i) => ok && !blocked.has(slotKey(d, p.school.periods[i].id))));
}

/** Tramos permitidos por las reglas de bloques permitidos obligatorias de la asignatura (todas a la vez). */
function windowMask(p: Project, subjectId: Id): Mask | null {
  const wins = p.rules.subjectWindows.filter((w) => w.subjectId === subjectId && w.strength === 'obligatoria');
  if (wins.length === 0) return null;
  return p.school.days.map(() => p.school.periods.map((x) => wins.every((w) => w.periodIds.includes(x.id))));
}

const and = (a: Mask, b: Mask | null): Mask => (b ? a.map((row, d) => row.map((ok, i) => ok && b[d][i])) : a);
const countMask = (m: Mask) => m.reduce((s, row) => s + row.filter(Boolean).length, 0);

/** Largo de cada tramo seguido disponible del día (un recreo, un tramo cerrado o un bloque no disponible lo corta). */
function runs(row: boolean[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const ok of row) {
    if (ok) n++;
    else if (n) { out.push(n); n = 0; }
  }
  if (n) out.push(n);
  return out;
}

interface Limits {
  /** Máximo de horas en un día. */
  daily?: number | null;
  /** Máximo de días a la semana. */
  maxDays?: number | null;
  /** Días que ya están ocupados por bloques fijados: cuentan dentro del máximo de días. */
  requiredDays?: Set<number>;
}

/** Suma lo que caben en los mejores días, respetando el máximo de días e incluyendo los días obligados. */
function bestDays(perDay: number[], limits: Limits): number {
  const req = limits.requiredDays ?? new Set<number>();
  const max = limits.maxDays;
  if (max == null || max >= perDay.length) return perDay.reduce((a, b) => a + b, 0);
  const forced = perDay.filter((_, d) => req.has(d)).reduce((a, b) => a + b, 0);
  const rest = perDay.filter((_, d) => !req.has(d)).sort((a, b) => b - a).slice(0, Math.max(0, max - req.size));
  return forced + rest.reduce((a, b) => a + b, 0);
}

interface Gap { size: number; need: number; fit: number }

/**
 * Condición necesaria: ¿caben estos bloques en los tramos disponibles? Para las horas, cada día aporta sus tramos
 * libres (hasta el máximo diario). Para cada duración k ≥ 2, los bloques de k horas o más necesitan k tramos seguidos,
 * y un tramo seguido de largo L admite a lo más ⌊L/k⌋ de ellos. Devuelve el primer conteo que no alcanza.
 */
function capacityGap(mask: Mask, sizes: number[], limits: Limits = {}): Gap | null {
  if (sizes.length === 0) return null;
  const daily = limits.daily ?? Infinity;
  const hoursFit = bestDays(mask.map((row) => Math.min(row.filter(Boolean).length, daily)), limits);
  const need = sizes.reduce((a, b) => a + b, 0);
  if (need > hoursFit) return { size: 1, need, fit: hoursFit };
  for (const k of [...new Set(sizes)].filter((x) => x >= 2).sort((a, b) => a - b)) {
    const n = sizes.filter((x) => x >= k).length;
    const fit = bestDays(mask.map((row) => Math.min(runs(row).reduce((s, l) => s + Math.floor(l / k), 0), Math.floor(daily / k))), limits);
    if (n > fit) return { size: k, need: n, fit };
  }
  return null;
}

/** Horas que caben (para medir el margen de lo que sí cabe). */
const hoursCapacity = (mask: Mask, limits: Limits = {}) =>
  bestDays(mask.map((row) => Math.min(row.filter(Boolean).length, limits.daily ?? Infinity)), limits);

/**
 * "Repartir en días distintos" obligatoria: cada bloque de la unidad va en un día diferente. Los bloques de k horas o
 * más necesitan días distintos con k tramos seguidos (condición de Hall para las duraciones).
 */
function spreadGap(mask: Mask, sizes: number[], daily: number | null, maxDays: number | null): Gap | null {
  if (maxDays != null && sizes.length > maxDays) return { size: 0, need: sizes.length, fit: maxDays };
  for (const k of [...new Set(sizes)].sort((a, b) => a - b)) {
    const n = sizes.filter((x) => x >= k).length;
    const fit = daily != null && daily < k ? 0 : mask.filter((row) => runs(row).some((l) => l >= k)).length;
    if (n > fit) return { size: k, need: n, fit };
  }
  return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const emptyEntities = (): Entities => ({ teachers: [], courses: [], subjects: [], rooms: [], activities: [] });
const severityRank: Record<Severity, number> = { critica: 0, alta: 1, media: 2, baja: 3 };

export function diagnose(p: Project, ctx: DiagnoseContext = {}): Diagnosis {
  const out: Finding[] = [];
  const all = units(p);
  const byId = unitById(p);
  const days = p.school.days.length;
  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string | null | undefined) => list.find((x) => x.id === id)?.name ?? '—';
  const subjectName = (id: Id) => nameOf(p.subjects, id);
  const spreadHard = p.rules.spreadSubjectDays && p.rules.spreadStrength === 'obligatoria';
  const tDaily = p.rules.teacherMaxHoursDaily;
  const cDaily = p.rules.courseMaxHoursDaily;
  const school = schoolMask(p);
  const effectiveMaxDays = (t: Teacher | undefined) => (t?.maxDays != null && t.maxDays < days ? t.maxDays : null);
  const unitCourses = (u: Unit) => [...new Set(u.audience.map((a) => a.courseId))];

  const add = (f: Omit<Finding, 'related' | 'entities' | 'changes'> & { entities?: Partial<Entities>; changes?: Change[] }) => {
    if (out.some((x) => x.id === f.id)) return;
    out.push({ ...f, entities: { ...emptyEntities(), ...f.entities }, changes: f.changes ?? [], related: false });
  };

  // Fijados que el motor sí recibe (la exportación omite los que no caben en su lugar).
  const locks = Object.entries(p.locks).flatMap(([key, lock]) => {
    const u = byId.get(unitIdOf(key));
    const idx = parseActivityKey(key).index;
    if (!u || !(idx < u.blocks.length) || slotProblem(p, u, idx, lock.day, lock.periodId)) return [];
    return [{ key, unit: u, day: lock.day }];
  });

  // ---------- Profesores: horas, bloques seguidos, días y fijados ----------
  for (const t of p.teachers) {
    const mine = all.filter((u) => u.teacherId === t.id);
    if (mine.length === 0) continue;
    const sizes = mine.flatMap((u) => u.blocks);
    const load = hours(sizes);
    const mask = teacherMask(p, t);
    const maxDays = effectiveMaxDays(t);
    const myLocks = locks.filter((l) => l.unit.teacherId === t.id);
    const requiredDays = new Set(myLocks.map((l) => l.day));
    const limits: Limits = { daily: tDaily, maxDays, requiredDays };
    const ent = { teachers: [t.id], subjects: [...new Set(mine.map((u) => u.subjectId))], courses: [...new Set(mine.flatMap(unitCourses))] };

    if (maxDays != null && requiredDays.size > maxDays) {
      add({
        id: `fijados:dias:${t.id}`, kind: 'fijados', certainty: 'demostrado', severity: 'critica', step: 'horario',
        title: `${t.name} tiene bloques fijados en ${requiredDays.size} días, pero puede venir como máximo ${maxDays}.`,
        evidence: [`Días con bloques fijados: ${[...requiredDays].sort().map((d) => p.school.days[d]).join(', ')}.`, `Máximo de días: ${maxDays}.`],
        action: `Libera los bloques fijados de ${t.name} en algún día, o sube su máximo de días.`,
        entities: { ...ent, activities: myLocks.map((l) => l.key) },
        changes: [{ kind: 'release-locks', keys: myLocks.map((l) => l.key), scope: `de ${t.name}` }, { kind: 'teacher-max-days', teacherId: t.id, value: requiredDays.size >= days ? null : requiredDays.size }],
      });
      continue;
    }

    const gap = capacityGap(mask, sizes, limits);
    if (gap) {
      // Qué límite, si se quitara, haría que alcance: así se sugieren cambios concretos.
      const changes: Change[] = [];
      if (maxDays != null && !capacityGap(mask, sizes, { ...limits, maxDays: null })) {
        let v = maxDays + 1;
        while (v < days && capacityGap(mask, sizes, { ...limits, maxDays: v })) v++;
        changes.push({ kind: 'teacher-max-days', teacherId: t.id, value: v >= days ? null : v });
      }
      if (myLocks.length && !capacityGap(mask, sizes, { ...limits, requiredDays: new Set() }))
        changes.push({ kind: 'release-locks', keys: myLocks.map((l) => l.key), scope: `de ${t.name}` });
      if (t.unavailable.length && !capacityGap(teacherMask(p, t, { ignoreUnavailable: true }), sizes, limits))
        changes.push({ kind: 'teacher-available', teacherId: t.id });
      if (tDaily != null && !capacityGap(mask, sizes, { ...limits, daily: null }))
        changes.push({ kind: 'teacher-max-hours-daily', value: tDaily + 1 });
      if (p.rules.teacherMeetingSlots.length && !capacityGap(teacherMask(p, t, { ignoreMeeting: true }), sizes, limits))
        changes.push({ kind: 'meeting-off' });
      const limitsText = [
        maxDays != null && `máximo ${plural(maxDays, 'día', 'días')}`,
        tDaily != null && `máximo ${tDaily} horas diarias`,
        requiredDays.size > 0 && `${plural(myLocks.length, 'bloque fijado', 'bloques fijados')}`,
      ].filter(Boolean).join(', ');
      add(gap.size === 1 ? {
        id: `carga-profesor:${t.id}`, kind: 'carga-profesor', certainty: 'demostrado', severity: 'critica', step: 'profesores',
        title: `${t.name} tiene ${load} horas de clase, pero con su disponibilidad${limitsText ? ` y sus límites (${limitsText})` : ''} caben ${gap.fit}.`,
        evidence: [`Horas asignadas: ${load}.`, `Bloques en que puede hacer clases: ${countMask(mask)}.`, `Horas que caben con los límites: ${gap.fit}.`],
        action: `Reparte parte de la carga de ${t.name} con otro profesor, o amplía su disponibilidad o sus límites.`,
        entities: ent, changes,
      } : {
        id: `bloques-seguidos:${t.id}:${gap.size}`, kind: 'bloques-seguidos', certainty: 'demostrado', severity: 'critica', step: 'profesores',
        title: `${t.name} tiene ${gap.need} clases de ${gap.size} horas seguidas o más, pero su disponibilidad solo admite ${gap.fit}.`,
        evidence: [`Clases de ${gap.size} h o más: ${gap.need}.`, `Espacios de ${gap.size} bloques seguidos disponibles${limitsText ? ` (con ${limitsText})` : ''}: ${gap.fit}.`,
          'Un recreo, un tramo sin clases o un bloque no disponible corta la secuencia.'],
        action: `Divide algunas clases de ${t.name} en bloques más cortos, o deja libres bloques seguidos en su disponibilidad.`,
        entities: ent, changes,
      });
    } else {
      const cap = hoursCapacity(mask, limits);
      const slack = cap - load;
      if (slack <= 2 || load / cap >= 0.9) {
        const changes: Change[] = [];
        if (maxDays != null) changes.push({ kind: 'teacher-max-days', teacherId: t.id, value: maxDays + 1 >= days ? null : maxDays + 1 });
        if (t.unavailable.length) changes.push({ kind: 'teacher-available', teacherId: t.id });
        if (myLocks.length) changes.push({ kind: 'release-locks', keys: myLocks.map((l) => l.key), scope: `de ${t.name}` });
        add({
          id: `carga-profesor:${t.id}`, kind: 'carga-profesor', certainty: 'hipotesis', severity: slack <= 1 || load / cap >= 0.97 ? 'alta' : 'media', step: 'profesores',
          title: `${t.name} tiene poco margen: ${load} horas de clase en ${cap} bloques posibles.`,
          evidence: [`Le ${slack === 1 ? 'sobra' : 'sobran'} ${plural(slack, 'bloque', 'bloques')} en la semana.`, ...(maxDays != null ? [`Puede venir ${plural(maxDays, 'día', 'días')}.`] : [])],
          action: `Si el motor no ubica sus clases, amplía la disponibilidad de ${t.name} o reparte parte de su carga.`,
          entities: ent, changes,
        });
      }
    }

    // Repartir en días distintos (obligatoria) frente al máximo de días y la disponibilidad de cada día.
    if (spreadHard)
      for (const u of mine) {
        if (u.blocks.length < 2 || u.blocks.length > days) continue; // más bloques que días: lo revisa validate
        const g = spreadGap(and(mask, windowMask(p, u.subjectId)), u.blocks, tDaily, maxDays);
        if (!g) continue;
        const label = describeUnit(p, u);
        add({
          id: `repartir-dias:${u.id}`, kind: 'repartir-dias', certainty: 'demostrado', severity: 'critica', step: g.size === 0 ? 'profesores' : 'reglas',
          title: g.size === 0
            ? `${label} tiene ${u.blocks.length} bloques que deben ir en días distintos, pero ${t.name} puede venir ${plural(maxDays!, 'día', 'días')}.`
            : `${label} necesita ${g.need} días distintos con ${g.size} bloques seguidos libres, y solo hay ${g.fit}.`,
          evidence: [`Bloques: ${u.blocks.join(' + ')}.`, '"Repartir cada asignatura en días distintos" es obligatoria.',
            g.size === 0 ? `Máximo de días de ${t.name}: ${maxDays}.` : `Días en que caben (disponibilidad${windowMask(p, u.subjectId) ? ' y bloques permitidos' : ''}): ${g.fit}.`],
          action: 'Deja como preferible la regla de repartir en días distintos, junta bloques de esta asignatura, o amplía la disponibilidad.',
          entities: { teachers: [t.id], subjects: [u.subjectId], courses: unitCourses(u) },
          changes: [{ kind: 'spread-preferible' }, ...(maxDays != null ? [{ kind: 'teacher-max-days', teacherId: t.id, value: u.blocks.length >= days ? null : u.blocks.length } as Change] : [])],
        });
      }
  }

  // ---------- Bloques permitidos obligatorios de cada asignatura ----------
  for (const s of p.subjects) {
    const win = windowMask(p, s.id);
    if (!win) continue;
    const mine = all.filter((u) => u.subjectId === s.id);
    if (mine.length === 0) continue;
    const windowIds = p.rules.subjectWindows.filter((w) => w.subjectId === s.id && w.strength === 'obligatoria').map((w) => w.id);
    const soften: Change[] = windowIds.map((windowId) => ({ kind: 'window-preferible', windowId }));
    const allowed = countMask(and(school, win));
    // Por profesor: sus clases de la asignatura caben en la ventana y en su disponibilidad.
    for (const tid of new Set(mine.map((u) => u.teacherId))) {
      const t = p.teachers.find((x) => x.id === tid);
      const list = mine.filter((u) => u.teacherId === tid);
      const sizes = list.flatMap((u) => u.blocks);
      const gap = capacityGap(and(teacherMask(p, t), win), sizes, { daily: t ? tDaily : cDaily, maxDays: effectiveMaxDays(t) });
      if (!gap) continue;
      const who = t ? t.name : 'Las clases sin profesor';
      add({
        id: `ventana-asignatura:${s.id}:${tid ?? '-'}`, kind: 'ventana-asignatura', certainty: 'demostrado', severity: 'critica', step: 'reglas',
        title: gap.size === 1
          ? `${s.name} solo puede ir en ciertos bloques, y ahí no caben las ${gap.need} horas de ${t ? t.name : 'sus clases sin profesor'}.`
          : `${s.name} tiene clases de ${gap.size} horas, pero en sus bloques permitidos ${t ? `y con la disponibilidad de ${t.name} ` : ''}solo caben ${gap.fit} de las ${gap.need}.`,
        evidence: [`Bloques permitidos en la semana: ${allowed}.`, gap.size === 1 ? `${who}: ${gap.need} horas, caben ${gap.fit}.` : `Espacios de ${gap.size} bloques seguidos dentro de lo permitido: ${gap.fit}.`],
        action: `Amplía los bloques permitidos de ${s.name} en Preferencias, déjala como preferible${t?.unavailable.length ? `, o amplía la disponibilidad de ${t.name}` : ''}.`,
        entities: { teachers: t ? [t.id] : [], subjects: [s.id], courses: [...new Set(list.flatMap(unitCourses))] },
        changes: [...soften, ...(t?.unavailable.length ? [{ kind: 'teacher-available', teacherId: t.id } as Change] : [])],
      });
    }
    // Por sala: una asignatura con sala especial y bloques permitidos usa la sala solo en esos bloques.
    if (s.roomId && p.rooms.some((r) => r.id === s.roomId)) {
      const sizes = all.filter((u) => p.subjects.find((x) => x.id === u.subjectId)?.roomId === s.roomId && u.subjectId === s.id).flatMap((u) => u.blocks);
      const gap = capacityGap(and(school, win), sizes);
      if (gap && gap.size === 1) {
        const room = nameOf(p.rooms, s.roomId);
        add({
          id: `sala:${s.roomId}:${s.id}`, kind: 'sala', certainty: 'demostrado', severity: 'critica', step: 'reglas',
          title: `${s.name} necesita ${room} ${gap.need} horas, pero en sus bloques permitidos la sala está disponible ${gap.fit}.`,
          evidence: [`Horas de ${s.name} en ${room}: ${gap.need}.`, `Bloques permitidos en la semana: ${gap.fit}.`],
          action: `Amplía los bloques permitidos de ${s.name}, déjala como preferible o quita la sala especial de la asignatura.`,
          entities: { subjects: [s.id], rooms: [s.roomId] }, changes: soften,
        });
      }
    }
    // Por alumno: las horas de la asignatura que tiene cada combinación de grupos caben en la ventana.
    for (const c of p.courses) {
      const combos = courseStudentSets(p, c);
      if (combos.length > 64) continue;
      for (const combo of combos) {
        const ids = new Set(combo.map((g) => g.id));
        const list = mine.filter((u) => u.audience.some((a) => a.courseId === c.id && (!a.groupId || ids.has(a.groupId))));
        const gap = capacityGap(and(school, win), list.flatMap((u) => u.blocks), { daily: cDaily });
        if (!gap) continue;
        add({
          id: `ventana-asignatura:${s.id}:curso:${c.id}`, kind: 'ventana-asignatura', certainty: 'demostrado', severity: 'critica', step: 'reglas',
          title: `${c.name} tiene ${hours(list.flatMap((u) => u.blocks))} horas de ${s.name}, que no caben en sus bloques permitidos.`,
          evidence: [`Bloques permitidos en la semana: ${allowed}.`, gap.size === 1 ? `Horas: ${gap.need}, caben ${gap.fit}.` : `Clases de ${gap.size} h o más: ${gap.need}; espacios seguidos: ${gap.fit}.`],
          action: `Amplía los bloques permitidos de ${s.name} en Preferencias o déjala como preferible.`,
          entities: { courses: [c.id], subjects: [s.id] }, changes: soften,
        });
        break;
      }
    }
  }

  // ---------- Cursos: las horas y los bloques de cada alumno caben en la jornada ----------
  for (const c of p.courses) {
    const combos = courseStudentSets(p, c);
    if (combos.length > 64) continue;
    for (const combo of combos) {
      const ids = new Set(combo.map((g) => g.id));
      const list = all.filter((u) => u.audience.some((a) => a.courseId === c.id && (!a.groupId || ids.has(a.groupId))));
      const gap = capacityGap(school, list.flatMap((u) => u.blocks), { daily: cDaily });
      if (!gap) continue;
      const who = combo.length ? `${c.name} (${combo.map((g) => g.name).join(', ')})` : c.name;
      add({
        id: `carga-curso:${c.id}`, kind: 'carga-curso', certainty: 'demostrado', severity: 'critica', step: 'carga',
        title: gap.size === 1
          ? `${who} tiene ${gap.need} horas, pero ${cDaily != null ? `con un máximo de ${cDaily} horas diarias ` : ''}caben ${gap.fit}.`
          : `${who} tiene ${gap.need} clases de ${gap.size} horas seguidas o más, y la jornada solo admite ${gap.fit}.`,
        evidence: [`Bloques de clase en la semana: ${countMask(school)}.`, ...(cDaily != null ? [`Máximo diario de los cursos: ${cDaily}.`] : [])],
        action: 'Reduce la carga del curso, divide bloques largos o amplía la jornada.',
        entities: { courses: [c.id] }, changes: cDaily != null ? [{ kind: 'course-max-hours-daily', value: cDaily + 1 }] : [],
      });
      break;
    }
  }

  // ---------- Salas especiales ----------
  for (const r of p.rooms) {
    const list = all.filter((u) => p.subjects.find((x) => x.id === u.subjectId)?.roomId === r.id);
    if (list.length === 0) continue;
    const need = hours(list.flatMap((u) => u.blocks));
    const cap = countMask(school);
    const gap = capacityGap(school, list.flatMap((u) => u.blocks));
    const subjects = [...new Set(list.map((u) => u.subjectId))];
    if (gap) {
      add({
        id: `sala:${r.id}`, kind: 'sala', certainty: 'demostrado', severity: 'critica', step: 'asignaturas',
        title: `${r.name} se necesita ${need} horas a la semana, y la jornada tiene ${cap} bloques.`,
        evidence: [`Asignaturas que la usan: ${subjects.map(subjectName).join(', ')}.`],
        action: `Quita ${r.name} de alguna asignatura o agrega otra sala.`,
        entities: { rooms: [r.id], subjects },
      });
    } else if (need / cap >= 0.85) {
      add({
        id: `sala:${r.id}`, kind: 'sala', certainty: 'hipotesis', severity: need / cap >= 0.95 ? 'alta' : 'media', step: 'asignaturas',
        title: `${r.name} está ocupada casi toda la semana: ${need} de ${cap} bloques.`,
        evidence: [`Asignaturas que la usan: ${subjects.map(subjectName).join(', ')}.`, 'Sus clases deben coincidir con la disponibilidad de cada profesor y curso.'],
        action: `Si el motor no ubica estas clases, quita ${r.name} de alguna asignatura.`,
        entities: { rooms: [r.id], subjects },
      });
    }
  }

  // ---------- Clases en paralelo: electivos y grupos que van a la misma hora ----------
  for (const row of parallelRows(p)) {
    const rowUnits = row.unitIds.map((id) => byId.get(id)).filter((u): u is Unit => !!u);
    if (rowUnits.length < 2) continue;
    const electiveId = rowUnits[0].electiveId;
    const label = electiveId
      ? `La franja "${p.electives.find((e) => e.id === electiveId)?.name || 'sin nombre'}"`
      : `Las clases en paralelo de ${rowUnits.map((u) => describeUnit(p, u)).join(' y ')}`;
    const teachers = rowUnits.map((u) => p.teachers.find((t) => t.id === u.teacherId)).filter((t): t is Teacher => !!t);
    const ent = { teachers: [...new Set(teachers.map((t) => t.id))], subjects: [...new Set(rowUnits.map((u) => u.subjectId))], courses: [...new Set(rowUnits.flatMap(unitCourses))] };
    const rowId = row.unitIds.join('|');
    const dup = teachers.find((t, i) => teachers.findIndex((x) => x.id === t.id) !== i);
    if (dup && !electiveId) { // en las franjas lo revisa validate
      add({
        id: `paralelas:profesor:${rowId}`, kind: 'paralelas', certainty: 'demostrado', severity: 'critica', step: 'carga',
        title: `${label} van a la misma hora, y ${dup.name} dicta más de una.`,
        evidence: ['Un profesor no puede estar en dos clases a la vez.'],
        action: 'Asigna otro profesor a uno de los grupos, o desmarca "en paralelo" en la división del curso.',
        entities: ent,
      });
      continue;
    }
    let common = rowUnits.reduce<Mask>((m, u) => and(m, windowMask(p, u.subjectId)), school);
    for (const t of teachers) common = and(common, teacherMask(p, t));
    const sizes = rowUnits[0].blocks.slice(0, row.blocks);
    const maxDays = teachers.reduce<number | null>((m, t) => { const v = effectiveMaxDays(t); return v == null ? m : m == null ? v : Math.min(m, v); }, null);
    const tight = teachers.filter((t) => t.unavailable.length > 0).sort((a, b) => b.unavailable.length - a.unavailable.length).slice(0, 2);
    const changes: Change[] = [
      ...tight.map((t) => ({ kind: 'teacher-available', teacherId: t.id }) as Change),
      ...teachers.filter((t) => effectiveMaxDays(t) != null).slice(0, 2).map((t) => ({ kind: 'teacher-max-days', teacherId: t.id, value: t.maxDays! + 1 >= days ? null : t.maxDays! + 1 }) as Change),
    ];
    const gap = capacityGap(common, sizes, { daily: tDaily, maxDays }) ?? (spreadHard && sizes.length >= 2 && sizes.length <= days ? spreadGap(common, sizes, tDaily, maxDays) : null);
    const free = countMask(common);
    if (gap) {
      add({
        id: `paralelas:${rowId}`, kind: 'paralelas', certainty: 'demostrado', severity: 'critica', step: electiveId ? 'electivos' : 'profesores',
        title: `${label} necesita${electiveId ? '' : 'n'} ${hours(sizes)} horas en que todos sus profesores estén libres a la vez, y no alcanzan.`,
        evidence: [
          `Bloques en que todos están disponibles${windowMask(p, rowUnits[0].subjectId) ? ' (y permitidos)' : ''}: ${free}.`,
          gap.size === 0 ? `Deben ir en ${sizes.length} días distintos y uno de sus profesores puede venir ${plural(gap.fit, 'día', 'días')}.`
            : gap.size === 1 ? `Horas: ${gap.need}, caben ${gap.fit}.` : `Clases de ${gap.size} h o más: ${gap.need}; espacios seguidos comunes: ${gap.fit}.`,
        ],
        action: 'Amplía la disponibilidad de los profesores de estas clases en los mismos bloques, o cambia a un profesor.',
        entities: ent, changes: gap.size === 0 || spreadHard ? [...changes, { kind: 'spread-preferible' }] : changes,
      });
    } else if (free < 2 * hours(sizes)) {
      add({
        id: `paralelas:${rowId}`, kind: 'paralelas', certainty: 'hipotesis', severity: free <= 1.25 * hours(sizes) ? 'alta' : 'media', step: electiveId ? 'electivos' : 'profesores',
        title: `${label} tiene pocos bloques en que todos sus profesores coinciden libres: ${free} para ${hours(sizes)} horas.`,
        evidence: [`Profesores: ${teachers.map((t) => t.name).join(', ') || 'sin profesor'}.`, 'Todas sus clases deben ir a la misma hora.'],
        action: 'Si el motor no ubica estas clases, amplía la disponibilidad de sus profesores en los mismos bloques.',
        entities: ent, changes,
      });
    }
  }

  // ---------- Bloques fijados ----------
  for (const lp of lockProblems(p, (k) => describeActivity(p, k))) {
    const u = byId.get(unitIdOf(lp.key));
    add({
      id: `fijados:${lp.key}`, kind: 'fijados', certainty: 'demostrado', severity: 'critica', step: 'horario',
      title: `El bloque fijado ${lp.description} ya no es posible.`,
      evidence: [lp.reason],
      action: 'Libera ese bloque o vuelve a fijarlo en un lugar válido.',
      entities: { activities: [lp.key], teachers: u?.teacherId ? [u.teacherId] : [], subjects: u ? [u.subjectId] : [], courses: u ? unitCourses(u) : [] },
      changes: [{ kind: 'release-locks', keys: [lp.key], scope: 'con problemas' }],
    });
  }
  const nActs = all.reduce((n, u) => n + u.blocks.length, 0);
  if (locks.length > 0 && locks.length >= 0.4 * nActs)
    add({
      id: 'fijados:muchos', kind: 'fijados', certainty: 'hipotesis', severity: 'media', step: 'horario',
      title: `Hay ${locks.length} de ${nActs} bloques fijados: el motor tiene poco espacio para acomodar el resto.`,
      evidence: ['Un bloque fijado no se puede mover aunque eso permita ubicar otro.'],
      action: 'Si el motor no termina, libera los fijados que no sean imprescindibles.',
      entities: { activities: locks.map((l) => l.key) },
      changes: [{ kind: 'release-locks', keys: locks.map((l) => l.key), scope: 'todos' }],
    });

  // ---------- Foco: el bloque que señaló el motor y los pendientes ----------
  const o = ctx.outcome;
  const failed = o?.kind === 'impossible' || o?.kind === 'timeout';
  const focusKey = o && (o.kind === 'impossible' || o.kind === 'timeout') ? o.activity : null;
  const focusUnit = focusKey ? byId.get(unitIdOf(focusKey)) : undefined;
  const focus: Entities | null = focusUnit && focusKey
    ? { ...emptyEntities(), teachers: focusUnit.teacherId ? [focusUnit.teacherId] : [], courses: unitCourses(focusUnit), subjects: [focusUnit.subjectId], activities: [focusKey] }
    : null;
  if (failed && focusUnit) {
    const near = locks.filter((l) => (focusUnit.teacherId && l.unit.teacherId === focusUnit.teacherId) || unitCourses(l.unit).some((c) => focus!.courses.includes(c)));
    if (near.length > 0 && near.length < locks.length)
      add({
        id: `fijados:foco:${focusUnit.id}`, kind: 'fijados', certainty: 'hipotesis', severity: 'media', step: 'horario',
        title: `Hay ${plural(near.length, 'bloque fijado', 'bloques fijados')} del mismo profesor o curso que el bloque que no se pudo ubicar.`,
        evidence: [`Bloque señalado: ${describeActivity(p, focusKey!)}.`],
        action: 'Prueba liberando esos fijados para que el motor pueda reacomodarlos.',
        entities: { ...focus!, activities: near.map((l) => l.key) },
        changes: [{ kind: 'release-locks', keys: near.map((l) => l.key), scope: 'del mismo profesor o curso que el bloque señalado' }],
      });
  }

  // Reglas obligatorias que, combinadas, restringen mucho. Solo se mencionan cuando la generación falló.
  if (failed) {
    const r = p.rules;
    if (r.coursesNoGaps && r.coursesStartFirstBlock)
      add({
        id: 'reglas:alumnos', kind: 'reglas', certainty: 'hipotesis', severity: 'media', step: 'reglas',
        title: '"Sin horas libres" y "empezar en el primer bloque" obligan a llenar cada día de cada curso desde el inicio y sin huecos.',
        evidence: ['Las dos reglas son siempre obligatorias.', 'Cada primer bloque debe tener un profesor disponible para cada curso.'],
        action: 'Si un profesor con poca disponibilidad no calza, prueba sin "empezar en el primer bloque".',
        changes: [{ kind: 'courses-start-first-off' }, { kind: 'courses-no-gaps-off' }],
      });
    else if (r.coursesNoGaps)
      add({
        id: 'reglas:sin-huecos', kind: 'reglas', certainty: 'hipotesis', severity: 'baja', step: 'reglas',
        title: '"Sin horas libres entre clases" obliga a que las clases de cada curso vayan seguidas.',
        evidence: ['La regla es siempre obligatoria.'], action: 'Pruébala desactivada para saber si es la causa.',
        changes: [{ kind: 'courses-no-gaps-off' }],
      });
    if ((r.teacherMaxGapsPerDay != null && r.teacherMaxGapsPerDay <= 1) || (r.teacherMaxGapsPerWeek != null && r.teacherMaxGapsPerWeek <= 3))
      add({
        id: 'reglas:ventanas', kind: 'reglas', certainty: 'hipotesis', severity: 'media', step: 'reglas',
        title: 'El máximo de ventanas de los profesores es bajo: sus clases tienen que ir casi seguidas.',
        evidence: [
          ...(r.teacherMaxGapsPerDay != null ? [`Máximo por día: ${r.teacherMaxGapsPerDay}.`] : []),
          ...(r.teacherMaxGapsPerWeek != null ? [`Máximo por semana: ${r.teacherMaxGapsPerWeek}.`] : []),
        ],
        action: 'Sube el máximo de ventanas en Preferencias.',
        changes: [
          ...(r.teacherMaxGapsPerDay != null ? [{ kind: 'teacher-gaps-day', value: r.teacherMaxGapsPerDay + 1 } as Change] : []),
          ...(r.teacherMaxGapsPerWeek != null ? [{ kind: 'teacher-gaps-week', value: r.teacherMaxGapsPerWeek + 2 } as Change] : []),
        ],
      });
    if (spreadHard)
      add({
        id: 'reglas:repartir', kind: 'reglas', certainty: 'hipotesis', severity: 'media', step: 'reglas',
        title: '"Repartir cada asignatura en días distintos" es obligatoria: cada bloque de una asignatura necesita su propio día.',
        evidence: ['Esta regla también se puede dejar como preferible.'], action: 'Déjala como preferible.',
        changes: [{ kind: 'spread-preferible' }],
      });
  }

  // ---------- Pendientes ----------
  let pending: PendingSummary | null = null;
  if (ctx.missing && ctx.missing.length > 0) {
    const count = (ids: (Id | null | undefined)[], list: { id: Id; name: string }[]) => {
      const m = new Map<Id, number>();
      for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, name: nameOf(list, id), n }));
    };
    const missUnits = ctx.missing.map((k) => byId.get(unitIdOf(k))).filter((u): u is Unit => !!u);
    pending = {
      total: (ctx.placed ?? 0) + ctx.missing.length,
      placed: ctx.placed ?? 0,
      teachers: count(missUnits.map((u) => u.teacherId), p.teachers),
      courses: count(missUnits.flatMap(unitCourses), p.courses),
      subjects: count(missUnits.map((u) => u.subjectId), p.subjects),
    };
  }

  // Relacionado: comparte profesor, curso o asignatura con el bloque señalado o con los más repetidos entre los pendientes.
  const hot = {
    teachers: new Set([...(focus?.teachers ?? []), ...(pending?.teachers.map((x) => x.id) ?? [])]),
    courses: new Set([...(focus?.courses ?? []), ...(pending?.courses.map((x) => x.id) ?? [])]),
    subjects: new Set([...(focus?.subjects ?? []), ...(pending?.subjects.map((x) => x.id) ?? [])]),
  };
  for (const f of out)
    f.related = f.entities.teachers.some((x) => hot.teachers.has(x)) || f.entities.courses.some((x) => hot.courses.has(x))
      || (f.entities.teachers.length === 0 && f.entities.subjects.some((x) => hot.subjects.has(x)));

  out.sort((a, b) => (a.certainty === b.certainty ? 0 : a.certainty === 'demostrado' ? -1 : 1)
    || Number(b.related) - Number(a.related) || severityRank[a.severity] - severityRank[b.severity]);

  const proven = out.filter((f) => f.certainty === 'demostrado').length;
  const hypotheses = out.length - proven;
  const summary = proven > 0
    ? `Con estos datos no existe ningún horario que respete las reglas obligatorias: ${proven === 1 ? 'hay 1 condición que lo impide' : `hay ${proven} condiciones que lo impiden`}. Más tiempo de cálculo no lo resuelve; corrige lo indicado.`
    : o?.kind === 'impossible'
      ? `El motor concluyó que no hay horario, pero esta revisión no encontró una causa que se pueda demostrar contando horas y bloques.${hypotheses ? ` Hay ${plural(hypotheses, 'posible causa', 'posibles causas')}: son hipótesis, no hechos comprobados.` : ''}`
      : o?.kind === 'timeout'
        ? `No se encontró un horario en el tiempo máximo. Eso no demuestra que sea imposible: puede faltar tiempo o haber muy poco margen.${hypotheses ? ` Hay ${plural(hypotheses, 'posible dificultad', 'posibles dificultades')} que conviene revisar.` : ''}`
        : proven === 0 && hypotheses === 0 ? 'La revisión no encontró impedimentos.' : `Hay ${plural(hypotheses, 'posible dificultad', 'posibles dificultades')}, ninguna demostrada.`;

  return { findings: out, proven, hypotheses, summary, pending, focus };
}
