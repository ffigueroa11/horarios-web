// Ajuste manual del horario: mover un bloque a otro lugar sin crear choques.
// Revisa lo obligatorio (alumnos, profesor y sala a la misma hora, recreos, tramos cerrados,
// disponibilidad del profesor y consejo). Las preferencias (ventanas, repartir días) no se revisan.
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

/** Revisa si los bloques `keys` (que hoy empiezan juntos) pueden empezar en el día y tramo indicados. */
export function checkMove(p: Project, keys: ActivityKey[], day: number, periodId: string, all: Lesson[] = lessons(p)): MoveCheck {
  const moving = all.filter((l) => keys.includes(l.pl.key));
  if (moving.length === 0) return { ok: false, reason: 'El bloque ya no existe.' };
  const start = p.school.periods.findIndex((x) => x.id === periodId);
  if (start < 0 || day < 0 || day >= p.school.days.length) return { ok: false, reason: 'Ese lugar no existe en la jornada.' };
  const others = all.filter((l) => !keys.includes(l.pl.key));
  const name = <T extends { id: string; name: string }>(list: T[], id: string | null) => list.find((x) => x.id === id)?.name ?? '';
  const subject = (u: Unit) => name(p.subjects, u.subjectId);

  for (const m of moving) {
    for (let k = 0; k < m.dur; k++) {
      const per = p.school.periods[start + k];
      if (!per) return { ok: false, reason: `${subject(m.unit)} dura ${m.dur} horas y no cabe antes del final del día.` };
      if (per.kind !== 'clase') return { ok: false, reason: `${subject(m.unit)} quedaría cruzando ${per.label.toLowerCase() || 'un recreo'}.` };
      if (p.school.closed.includes(slotKey(day, per.id))) return { ok: false, reason: `El bloque ${per.label} del ${p.school.days[day]} está cerrado.` };
      const t = p.teachers.find((x) => x.id === m.unit.teacherId);
      if (t?.unavailable.includes(slotKey(day, per.id))) return { ok: false, reason: `${t.name} no está disponible ese bloque.` };
      if (t && p.rules.teacherMeetingSlots.includes(slotKey(day, per.id))) return { ok: false, reason: 'Ese bloque está reservado para el consejo de profesores.' };
      const at = start + k;
      for (const o of others) {
        if (o.pl.day !== day || at < o.startIdx || at >= o.startIdx + o.dur) continue;
        if (m.unit.teacherId && m.unit.teacherId === o.unit.teacherId)
          return { ok: false, reason: `${name(p.teachers, m.unit.teacherId)} ya tiene ${subject(o.unit)} a esa hora.` };
        if (m.pl.roomId && m.pl.roomId === o.pl.roomId)
          return { ok: false, reason: `La sala ${name(p.rooms, m.pl.roomId)} ya está ocupada por ${subject(o.unit)}.` };
        if (shareStudents(p, m.unit, o.unit))
          return { ok: false, reason: `Los alumnos ya tienen ${subject(o.unit)} a esa hora.` };
      }
    }
  }
  return { ok: true };
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
