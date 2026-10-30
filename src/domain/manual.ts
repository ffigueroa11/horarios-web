// Ajuste manual del horario: mover un bloque a otro lugar sin crear choques.
// Revisa lo obligatorio (alumnos, profesor y sala a la misma hora, recreos, tramos cerrados, disponibilidad
// del profesor y consejo, bloques permitidos obligatorios, máximo de días y de horas diarias, repartir en
// días distintos, cursos sin horas libres, empezar en el primer bloque y ventanas de profesores).
// Las reglas "preferibles" no se revisan.
import type { ActivityKey, Placement, Project } from './types';
import { activityKey, slotKey } from './types';
import { courseStudentSets, effectiveDivisions, parallelRows, unitById, unitIdOf, type Unit } from './units';

export interface Lesson {
  pl: Placement;
  unit: Unit;
  /** Índice del bloque dentro de la unidad. */
  idx: number;
  dur: number;
  /** Posición del tramo de inicio en school.periods. */
  startIdx: number;
}

export function lessons(p: Project): Lesson[] {
  const per = new Map(p.school.periods.map((x, i) => [x.id, i]));
  const byId = unitById(p);
  const out: Lesson[] = [];
  for (const pl of p.timetable?.placements ?? []) {
    const unit = byId.get(unitIdOf(pl.key));
    const startIdx = per.get(pl.periodId);
    const idx = Number(pl.key.split('#')[1]);
    if (!unit || startIdx == null || !(idx < unit.blocks.length)) continue;
    out.push({ pl, unit, idx, dur: unit.blocks[idx], startIdx });
  }
  return out;
}

/** Bloques que se mueven juntos con este (grupos en paralelo, opciones de una franja de electivos). */
export function companions(p: Project, key: ActivityKey): ActivityKey[] {
  const uid = unitIdOf(key);
  const idx = Number(key.split('#')[1]);
  const row = parallelRows(p).find((r) => r.unitIds.includes(uid) && idx < r.blocks);
  return row ? row.unitIds.map((id) => activityKey(id, idx)) : [key];
}

/** ¿Pueden dos unidades tener alumnos en común? */
export function shareStudents(p: Project, a: Unit, b: Unit): boolean {
  for (const x of a.audience) for (const y of b.audience) {
    if (x.courseId !== y.courseId) continue;
    if (!x.groupId || !y.groupId || x.groupId === y.groupId) return true;
    const course = p.courses.find((c) => c.id === x.courseId);
    if (!course) return true;
    const divisions = effectiveDivisions(p, course);
    const dx = divisions.find((d) => d.groups.some((g) => g.id === x.groupId));
    const dy = divisions.find((d) => d.groups.some((g) => g.id === y.groupId));
    // Grupos de una misma división son alumnos distintos; de divisiones distintas, se cruzan.
    if (!dx || !dy || dx.id !== dy.id) return true;
  }
  return false;
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

const nameOf = <T extends { id: string; name: string }>(list: T[], id: string | null) => list.find((x) => x.id === id)?.name ?? '';

/**
 * Problemas de un bloque en un lugar, sin mirar las demás clases: recreos, tramos cerrados, fin del día,
 * disponibilidad del profesor, consejo y bloques permitidos obligatorios. Devuelve el motivo o null.
 */
export function slotProblem(p: Project, unit: Unit, idx: number, day: number, periodId: string): string | null {
  const start = p.school.periods.findIndex((x) => x.id === periodId);
  if (start < 0 || day < 0 || day >= p.school.days.length) return 'ese lugar ya no existe en la jornada.';
  const dur = unit.blocks[idx] ?? 1;
  const subject = nameOf(p.subjects, unit.subjectId);
  const t = p.teachers.find((x) => x.id === unit.teacherId);
  const windows = p.rules.subjectWindows.filter((w) => w.subjectId === unit.subjectId && w.strength === 'obligatoria');
  for (let k = 0; k < dur; k++) {
    const per = p.school.periods[start + k];
    if (!per) return `${subject} dura ${dur} horas y no cabe antes del final del día.`;
    if (per.kind !== 'clase') return `${subject} quedaría cruzando ${per.label.toLowerCase() || 'un recreo'}.`;
    const sk = slotKey(day, per.id);
    if (p.school.closed.includes(sk)) return `el ${per.label} del ${p.school.days[day]} no tiene clases.`;
    if (t?.unavailable.includes(sk)) return `${t.name} no está disponible ese bloque.`;
    if (t && p.rules.teacherMeetingSlots.includes(sk)) return 'ese bloque está reservado para el consejo de profesores.';
    if (windows.some((w) => !w.periodIds.includes(per.id))) return `${subject} solo puede ir en los bloques permitidos en Preferencias.`;
  }
  return null;
}

/** Revisa si los bloques `keys` (que hoy empiezan juntos) pueden empezar en el día y tramo indicados. */
export function checkMove(p: Project, keys: ActivityKey[], day: number, periodId: string, all: Lesson[] = lessons(p), opts: { skipRules?: boolean } = {}): MoveCheck {
  const moving = all.filter((l) => keys.includes(l.pl.key));
  if (moving.length === 0) return { ok: false, reason: 'El bloque ya no existe.' };
  const start = p.school.periods.findIndex((x) => x.id === periodId);
  if (start < 0 || day < 0 || day >= p.school.days.length) return { ok: false, reason: 'Ese lugar no existe en la jornada.' };
  const others = all.filter((l) => !keys.includes(l.pl.key));
  const subject = (u: Unit) => nameOf(p.subjects, u.subjectId);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  for (const m of moving) {
    const problem = slotProblem(p, m.unit, m.idx, day, periodId);
    if (problem) return { ok: false, reason: cap(problem) };
    for (let k = 0; k < m.dur; k++) {
      const at = start + k;
      for (const o of others) {
        if (o.pl.day !== day || at < o.startIdx || at >= o.startIdx + o.dur) continue;
        if (m.unit.teacherId && m.unit.teacherId === o.unit.teacherId)
          return { ok: false, reason: `${nameOf(p.teachers, m.unit.teacherId)} ya tiene ${subject(o.unit)} a esa hora.` };
        if (m.pl.roomId && m.pl.roomId === o.pl.roomId)
          return { ok: false, reason: `La sala ${nameOf(p.rooms, m.pl.roomId)} ya está ocupada por ${subject(o.unit)}.` };
        if (shareStudents(p, m.unit, o.unit))
          return { ok: false, reason: `Los alumnos ya tienen ${subject(o.unit)} a esa hora.` };
      }
    }
    // Reglas del profesor que dependen del resto de su semana.
    const t = p.teachers.find((x) => x.id === m.unit.teacherId);
    if (t) {
      const his = others.filter((o) => o.unit.teacherId === t.id);
      const days = new Set([...his.map((o) => o.pl.day), day]);
      if (t.maxDays != null && days.size > t.maxDays)
        return { ok: false, reason: `${t.name} puede venir como máximo ${t.maxDays} días y ese día no tiene clases.` };
      const max = p.rules.teacherMaxHoursDaily;
      const hoursThatDay = his.filter((o) => o.pl.day === day).reduce((n, o) => n + o.dur, 0) + m.dur;
      if (max != null && hoursThatDay > max) return { ok: false, reason: `${t.name} quedaría con ${hoursThatDay} horas ese día (máximo ${max}).` };
    }
    const maxCourse = p.rules.courseMaxHoursDaily;
    if (maxCourse != null) {
      const hoursThatDay = others.filter((o) => o.pl.day === day && shareStudents(p, m.unit, o.unit)).reduce((n, o) => n + o.dur, 0) + m.dur;
      if (hoursThatDay > maxCourse) return { ok: false, reason: `Los alumnos quedarían con más de ${maxCourse} horas ese día.` };
    }
  }
  if (!opts.skipRules) {
    const rule = ruleProblem(p, all, withLessonsAt(p, all, keys, day, periodId), moving.map((m) => m.unit));
    if (rule) return { ok: false, reason: rule };
  }
  return { ok: true };
}

/**
 * Reglas obligatorias que dependen del día completo: repartir en días distintos, cursos sin horas libres,
 * empezar en el primer bloque y ventanas de profesores. Se compara el horario antes y después del cambio:
 * solo se rechaza lo que el cambio empeora (si el horario ya incumplía algo, no se culpa al movimiento).
 */
export function ruleProblem(p: Project, before: Lesson[], after: Lesson[], moved: Unit[]): string | null {
  const { rules, school } = p;
  const days = school.days.map((_, d) => d);
  const open = (d: number) => school.periods.map((x, i) => ({ x, i }))
    .filter(({ x }) => x.kind === 'clase' && !school.closed.includes(slotKey(d, x.id))).map(({ i }) => i);
  const busy = (list: Lesson[], d: number, applies: (l: Lesson) => boolean) => {
    const set = new Set<number>();
    for (const l of list) if (l.pl.day === d && applies(l)) for (let k = 0; k < l.dur; k++) set.add(l.startIdx + k);
    return set;
  };
  const gaps = (slots: number[], b: Set<number>) => {
    const used = slots.filter((i) => b.has(i));
    if (used.length === 0) return 0;
    return slots.filter((i) => i > used[0] && i < used[used.length - 1] && !b.has(i)).length;
  };
  const dayName = (d: number) => school.days[d]?.toLowerCase() ?? '';

  // Repartir cada asignatura en días distintos (obligatoria).
  if (rules.spreadSubjectDays && rules.spreadStrength === 'obligatoria')
    for (const u of moved) {
      if (u.blocks.length < 2 || u.blocks.length > school.days.length) continue;
      const repeated = (list: Lesson[]) => {
        const ds = list.filter((l) => l.unit.id === u.id).map((l) => l.pl.day);
        return ds.length - new Set(ds).size;
      };
      if (repeated(after) > repeated(before))
        return `${nameOf(p.subjects, u.subjectId)} quedaría dos veces el mismo día, y la regla "repartir cada asignatura en días distintos" es obligatoria.`;
    }

  // Alumnos: cada combinación de grupos de los cursos involucrados.
  const courseIds = [...new Set(moved.flatMap((u) => u.audience.map((a) => a.courseId)))];
  for (const cid of courseIds) {
    const c = p.courses.find((x) => x.id === cid);
    if (!c) continue;
    for (const combo of courseStudentSets(p, c)) {
      const ids = new Set(combo.map((g) => g.id));
      const applies = (l: Lesson) => l.unit.audience.some((a) => a.courseId === cid && (!a.groupId || ids.has(a.groupId)));
      const who = combo.length ? `${c.name} (${combo.map((g) => g.name).join(', ')})` : c.name;
      for (const d of days) {
        const slots = open(d);
        const b0 = busy(before, d, applies), b1 = busy(after, d, applies);
        if (rules.coursesNoGaps && gaps(slots, b1) > gaps(slots, b0))
          return `${who} quedaría con una hora libre entre clases el ${dayName(d)}, y la regla "sin horas libres entre clases" está activa.`;
        const late = (b: Set<number>) => b.size > 0 && slots.length > 0 && !b.has(slots[0]);
        if (rules.coursesStartFirstBlock && late(b1) && !late(b0))
          return `${who} empezaría el ${dayName(d)} después del primer bloque, y la regla "todos los días empiezan en el primer bloque" está activa.`;
      }
    }
  }

  // Ventanas de profesores (los bloques no disponibles y el consejo no cuentan como ventana).
  for (const tid of [...new Set(moved.map((u) => u.teacherId).filter((x): x is string => !!x))]) {
    const t = p.teachers.find((x) => x.id === tid);
    if (!t) continue;
    const blocked = new Set([...t.unavailable, ...rules.teacherMeetingSlots]);
    const applies = (l: Lesson) => l.unit.teacherId === tid;
    const perDay = (list: Lesson[]) => days.map((d) => gaps(open(d).filter((i) => !blocked.has(slotKey(d, school.periods[i].id))), busy(list, d, applies)));
    const g0 = perDay(before), g1 = perDay(after);
    const maxDay = rules.teacherMaxGapsPerDay;
    if (maxDay != null) {
      const d = days.find((x) => g1[x] > maxDay && g1[x] > g0[x]);
      if (d != null) return `${t.name} quedaría con ${g1[d]} ventanas el ${dayName(d)} (máximo ${maxDay}).`;
    }
    const maxWeek = rules.teacherMaxGapsPerWeek;
    const sum = (g: number[]) => g.reduce((a, b) => a + b, 0);
    if (maxWeek != null && sum(g1) > maxWeek && sum(g1) > sum(g0))
      return `${t.name} quedaría con ${sum(g1)} ventanas en la semana (máximo ${maxWeek}).`;
  }
  return null;
}

export interface LockProblem { key: ActivityKey; description: string; reason: string }

/**
 * Bloques fijados que ya no se pueden respetar (por cambios en la jornada, la carga o las reglas, o porque
 * dos fijados chocan entre sí). FET rechazaría los datos; la app avisa y permite liberarlos.
 */
export function lockProblems(p: Project, describe: (key: ActivityKey) => string): LockProblem[] {
  const byId = unitById(p);
  const out: LockProblem[] = [];
  const placed: { key: ActivityKey; unit: Unit; day: number; from: number; to: number }[] = [];
  for (const [key, lock] of Object.entries(p.locks)) {
    const unit = byId.get(unitIdOf(key));
    const idx = Number(key.split('#')[1]);
    if (!unit || !(idx < unit.blocks.length)) continue; // bloque eliminado: no se exporta
    const where = `${p.school.days[lock.day] ?? 'día eliminado'}, ${p.school.periods.find((x) => x.id === lock.periodId)?.label ?? 'bloque eliminado'}`;
    const problem = slotProblem(p, unit, idx, lock.day, lock.periodId);
    if (problem) { out.push({ key, description: `${describe(key)} (${where})`, reason: problem }); continue; }
    const from = p.school.periods.findIndex((x) => x.id === lock.periodId);
    const me = { key, unit, day: lock.day, from, to: from + unit.blocks[idx] };
    const clash = placed.find((o) => o.day === me.day && o.from < me.to && me.from < o.to && (
      (unit.teacherId && unit.teacherId === o.unit.teacherId) || shareStudents(p, unit, o.unit)));
    // Clases en paralelo (misma franja o división) sí comparten hora.
    const sameDay = p.rules.spreadSubjectDays && p.rules.spreadStrength === 'obligatoria' && unit.blocks.length <= p.school.days.length
      ? placed.find((o) => o.unit.id === unit.id && o.day === me.day) : undefined;
    if (clash && !companions(p, key).includes(clash.key))
      out.push({ key, description: `${describe(key)} (${where})`, reason: `choca con otro bloque fijado: ${describe(clash.key)}.` });
    else if (sameDay)
      out.push({ key, description: `${describe(key)} (${where})`, reason: `queda el mismo día que otro bloque fijado de la misma asignatura (${describe(sameDay.key)}), y la regla "repartir cada asignatura en días distintos" es obligatoria.` });
    else placed.push(me);
  }
  return out;
}

/** Resultado de soltar un bloque: mover a un lugar libre o intercambiar con el bloque que está ahí. */
export type PlaceCheck = { ok: true; swapWith?: ActivityKey[] } | { ok: false; reason: string };

const withLessonsAt = (p: Project, all: Lesson[], keys: ActivityKey[], day: number, periodId: string): Lesson[] => {
  const startIdx = p.school.periods.findIndex((x) => x.id === periodId);
  return all.map((l) => (keys.includes(l.pl.key) ? { ...l, startIdx, pl: { ...l.pl, day, periodId } } : l));
};

/** ¿Se pueden intercambiar los bloques `a` y `b` (cada uno con sus clases en paralelo)? */
export function checkSwap(p: Project, a: ActivityKey[], b: ActivityKey[], all: Lesson[] = lessons(p)): MoveCheck {
  const la = all.find((l) => a.includes(l.pl.key)), lb = all.find((l) => b.includes(l.pl.key));
  if (!la || !lb) return { ok: false, reason: 'El bloque ya no existe.' };
  const subject = (l: Lesson) => nameOf(p.subjects, l.unit.subjectId);
  const r1 = checkMove(p, a, lb.pl.day, lb.pl.periodId, withLessonsAt(p, all, b, la.pl.day, la.pl.periodId), { skipRules: true });
  if (!r1.ok) return r1;
  const r2 = checkMove(p, b, la.pl.day, la.pl.periodId, withLessonsAt(p, all, a, lb.pl.day, lb.pl.periodId), { skipRules: true });
  if (!r2.ok) return { ok: false, reason: `${subject(lb)} no puede ir donde está ${subject(la)}: ${r2.reason.charAt(0).toLowerCase()}${r2.reason.slice(1)}` };
  const final = withLessonsAt(p, withLessonsAt(p, all, b, la.pl.day, la.pl.periodId), a, lb.pl.day, lb.pl.periodId);
  const units = [la.unit, lb.unit, ...all.filter((l) => a.includes(l.pl.key) || b.includes(l.pl.key)).map((l) => l.unit)];
  const rule = ruleProblem(p, all, final, [...new Map(units.map((u) => [u.id, u])).values()]);
  if (rule) return { ok: false, reason: rule };
  return { ok: true };
}

/**
 * Revisa dónde soltar un bloque: si el lugar está libre se mueve; si lo ocupa otro bloque del mismo curso o
 * profesor, con la misma duración y que empieza ahí, se ofrece intercambiarlos.
 */
export function checkPlace(p: Project, keys: ActivityKey[], day: number, periodId: string, all: Lesson[] = lessons(p)): PlaceCheck {
  const move = checkMove(p, keys, day, periodId, all);
  if (move.ok) return move;
  const moving = all.filter((l) => keys.includes(l.pl.key));
  if (moving.length === 0) return move;
  const occupant = all.find((o) => !keys.includes(o.pl.key) && o.pl.day === day && o.pl.periodId === periodId && o.dur === moving[0].dur
    && moving.some((m) => shareStudents(p, m.unit, o.unit) || (!!m.unit.teacherId && m.unit.teacherId === o.unit.teacherId)));
  if (!occupant) return move;
  const other = companions(p, occupant.pl.key);
  const swap = checkSwap(p, keys, other, all);
  if (swap.ok) return { ok: true, swapWith: other };
  return { ok: false, reason: `${move.reason} Tampoco se pueden intercambiar: ${swap.reason.charAt(0).toLowerCase()}${swap.reason.slice(1)}` };
}

/** Intercambia dos bloques y los deja fijados en su nuevo lugar. */
export function applySwap(d: Project, a: ActivityKey[], b: ActivityKey[]) {
  const pa = d.timetable?.placements.find((x) => a.includes(x.key));
  const pb = d.timetable?.placements.find((x) => b.includes(x.key));
  if (!pa || !pb) return;
  const [da, ra] = [pa.day, pa.periodId], [db, rb] = [pb.day, pb.periodId];
  applyMove(d, a, db, rb);
  applyMove(d, b, da, ra);
}

/** Mueve los bloques y los fija en su nuevo lugar (para que se mantengan al regenerar). */
export function applyMove(d: Project, keys: ActivityKey[], day: number, periodId: string) {
  if (!d.timetable) return;
  for (const pl of d.timetable.placements)
    if (keys.includes(pl.key)) {
      pl.day = day;
      pl.periodId = periodId;
      d.locks[pl.key] = { day, periodId };
    }
}
