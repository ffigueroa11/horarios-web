// Ajuste manual del horario: mover un bloque a otro lugar sin crear choques.
// Revisa lo obligatorio (alumnos, profesor y sala a la misma hora, recreos, tramos cerrados, disponibilidad
// del profesor y consejo, bloques permitidos obligatorios, máximo de días y de horas diarias).
// Las preferencias (ventanas, repartir días, reglas "preferibles") no se revisan.
import type { ActivityKey, Placement, Project } from './types';
import { activityKey, slotKey } from './types';
import { effectiveDivisions, parallelRows, unitById, unitIdOf, type Unit } from './units';

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
export function checkMove(p: Project, keys: ActivityKey[], day: number, periodId: string, all: Lesson[] = lessons(p)): MoveCheck {
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
  return { ok: true };
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
    if (clash && !companions(p, key).includes(clash.key))
      out.push({ key, description: `${describe(key)} (${where})`, reason: `choca con otro bloque fijado: ${describe(clash.key)}.` });
    else placed.push(me);
  }
  return out;
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
