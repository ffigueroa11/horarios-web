// Revisión previa: detecta lo que haría imposible o muy difícil el horario, antes de llamar a FET.
import type { Project, Teacher } from './types';
import { slotKey } from './types';
import { courseStudentSets, findEffectiveGroup, units, type Unit } from './units';

export type Step = 'jornada' | 'cursos' | 'asignaturas' | 'profesores' | 'salas' | 'carga' | 'electivos' | 'reglas';

export interface Issue {
  level: 'error' | 'aviso';
  step: Step;
  message: string;
}

/** Tramos de clase abiertos por día (sin recreos ni tramos cerrados). */
export function openSlots(p: Project): string[][] {
  return p.school.days.map((_, d) =>
    p.school.periods.filter((x) => x.kind === 'clase' && !p.school.closed.includes(slotKey(d, x.id))).map((x) => x.id));
}

/** Bloque continuo más largo (sin recreo ni tramo cerrado en medio) de cada día. */
export function longestRun(p: Project): number {
  let best = 0;
  p.school.days.forEach((_, d) => {
    let run = 0;
    for (const x of p.school.periods) {
      if (x.kind === 'clase' && !p.school.closed.includes(slotKey(d, x.id))) best = Math.max(best, ++run);
      else run = 0;
    }
  });
  return best;
}

/** "2+2+2" → [2,2,2]. Devuelve null si no es válido. */
export function parseBlocks(text: string): number[] | null {
  const parts = text.split(/[+\s,]+/).filter(Boolean).map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 12)) return null;
  return parts;
}

export const hours = (blocks: number[]) => blocks.reduce((a, b) => a + b, 0);

/** Horas semanales del profesor (una opción de electivo cuenta una vez aunque reúna varios cursos). */
export function teacherLoad(p: Project, teacherId: string, list: Unit[] = units(p)): number {
  return list.filter((u) => u.teacherId === teacherId).reduce((s, u) => s + hours(u.blocks), 0);
}

/** Bloques de clase en que el profesor puede estar (descontando su indisponibilidad y el consejo de profesores). */
export function teacherSlotsPerDay(p: Project, t: Teacher): number[] {
  const blocked = new Set([...t.unavailable, ...p.rules.teacherMeetingSlots]);
  return openSlots(p).map((d, di) => d.filter((pid) => !blocked.has(slotKey(di, pid))).length);
}

/**
 * Horas semanales que tiene un alumno del curso: lo común a todo el curso más lo de sus grupos
 * (divisiones y franjas de electivos). Se toma la combinación de grupos con más horas.
 */
export function courseLoad(p: Project, courseId: string, list: Unit[] = units(p)): number {
  const c = p.courses.find((x) => x.id === courseId);
  const mine = list.flatMap((u) => u.audience.filter((a) => a.courseId === courseId).map((a) => ({ groupId: a.groupId, h: hours(u.blocks) })));
  const whole = mine.filter((a) => !findEffectiveGroup(p, c, a.groupId)).reduce((s, a) => s + a.h, 0);
  if (!c) return whole;
  return Math.max(...courseStudentSets(p, c).map((combo) => {
    const ids = new Set(combo.map((g) => g.id));
    return whole + mine.filter((a) => a.groupId && ids.has(a.groupId)).reduce((s, a) => s + a.h, 0);
  }));
}

export function validate(p: Project): Issue[] {
  const out: Issue[] = [];
  const err = (step: Step, message: string) => out.push({ level: 'error', step, message });
  const warn = (step: Step, message: string) => out.push({ level: 'aviso', step, message });
  const name = <T extends { id: string; name: string }>(list: T[], id: string | null) => list.find((x) => x.id === id)?.name ?? '—';

  const allUnits = units(p);
  const slots = openSlots(p);
  const weekSlots = slots.reduce((s, d) => s + d.length, 0);
  const run = longestRun(p);

  if (p.school.days.length === 0) err('jornada', 'La jornada no tiene días.');
  if (weekSlots === 0) err('jornada', 'La jornada no tiene bloques de clase.');
  if (p.courses.length === 0) err('cursos', 'Agrega al menos un curso.');
  if (allUnits.length === 0) err('carga', 'La carga académica está vacía: asigna asignaturas a los cursos.');

  for (const c of p.courses) {
    const load = courseLoad(p, c.id, allUnits);
    if (load === 0) warn('carga', `${c.name} no tiene asignaturas en la carga académica.`);
    else if (load > weekSlots) err('carga', `${c.name} tiene ${load} horas, pero la semana solo tiene ${weekSlots} bloques de clase.`);
    const maxDaily = p.rules.courseMaxHoursDaily;
    if (maxDaily != null) {
      const cap = slots.reduce((s, d) => s + Math.min(d.length, maxDaily), 0);
      if (load > cap) err('reglas', `${c.name} tiene ${load} horas, pero con un máximo de ${maxDaily} horas diarias caben ${cap} a la semana.`);
    }
  }

  const seen = new Set<string>();
  for (const a of p.assignments) {
    const course = p.courses.find((c) => c.id === a.courseId);
    const grp = findEffectiveGroup(p, course, a.groupId);
    const label = `${name(p.subjects, a.subjectId)} en ${name(p.courses, a.courseId)}${grp ? ` (${grp.group.name})` : ''}`;
    const dup = `${a.courseId}|${a.groupId ?? ''}|${a.subjectId}`;
    if (seen.has(dup)) warn('carga', `${label} aparece dos veces en la carga académica.`);
    seen.add(dup);
    if (a.blocks.length === 0 || hours(a.blocks) === 0) warn('carga', `${label} no tiene horas.`);
    if (!a.teacherId) warn('carga', `${label} no tiene profesor asignado.`);
    const big = Math.max(0, ...a.blocks);
    if (big > run) err('carga', `${label} tiene un bloque de ${big} horas, pero el tramo más largo sin recreo es de ${run}.`);
    if (p.rules.spreadSubjectDays && a.blocks.length > p.school.days.length)
      warn('carga', `${label} tiene ${a.blocks.length} bloques y solo hay ${p.school.days.length} días: algunos quedarán el mismo día.`);
  }

  // Franjas de electivos: varias opciones a la misma hora para alumnos de distintos cursos.
  for (const e of p.electives) {
    const label = `La franja "${e.name || 'sin nombre'}"`;
    const courses = e.courseIds.filter((id) => p.courses.some((c) => c.id === id));
    if (courses.length === 0) { warn('electivos', `${label} no tiene cursos: no se incluirá en el horario.`); continue; }
    if (e.options.length === 0) { warn('electivos', `${label} no tiene opciones: no se incluirá en el horario.`); continue; }
    if (e.blocks.length === 0) err('electivos', `${label} no tiene horas.`);
    const big = Math.max(0, ...e.blocks);
    if (big > run) err('electivos', `${label} tiene un bloque de ${big} horas, pero el tramo más largo sin recreo es de ${run}.`);
    if (e.options.length === 1) warn('electivos', `${label} tiene una sola opción; todos sus alumnos tendrán la misma clase.`);
    const byTeacher = new Map<string, number>();
    const byRoom = new Map<string, number>();
    for (const o of e.options) {
      const subject = p.subjects.find((s) => s.id === o.subjectId);
      if (!subject) err('electivos', `${label} tiene una opción sin asignatura.`);
      if (!o.teacherId) warn('electivos', `${label}: la opción ${subject?.name ?? ''} no tiene profesor.`);
      else byTeacher.set(o.teacherId, (byTeacher.get(o.teacherId) ?? 0) + 1);
      if (subject?.roomId) byRoom.set(subject.roomId, (byRoom.get(subject.roomId) ?? 0) + 1);
    }
    for (const [tid, n] of byTeacher)
      if (n > 1) err('electivos', `${label}: ${name(p.teachers, tid)} dicta ${n} opciones, pero todas van a la misma hora.`);
    for (const [rid, n] of byRoom)
      if (n > 1) err('electivos', `${label}: ${n} opciones usan la sala ${name(p.rooms, rid)} a la misma hora.`);
  }

  for (const c of p.courses) for (const d of c.divisions) {
    if (d.groups.length < 2) warn('cursos', `La división "${d.name}" de ${c.name} necesita al menos dos grupos.`);
    for (const g of d.groups)
      if (!p.assignments.some((a) => a.courseId === c.id && a.groupId === g.id)) warn('carga', `El grupo ${g.name} (${d.name}) de ${c.name} no tiene asignaturas.`);
    if (d.parallel && d.groups.length >= 2) {
      const per = d.groups.map((g) => p.assignments.filter((a) => a.courseId === c.id && a.groupId === g.id));
      const n = Math.max(...per.map((l) => l.length));
      for (let k = 0; k < n; k++) {
        const row = per.map((l) => l[k]);
        if (row.some((a) => !a) || !row.every((a) => a.blocks.join('+') === row[0].blocks.join('+')))
          warn('carga', `En "${d.name}" de ${c.name}, la asignatura n° ${k + 1} de cada grupo no tiene los mismos bloques en todos los grupos; esas clases no quedarán en paralelo.`);
      }
    }
  }

  for (const t of p.teachers) {
    const load = teacherLoad(p, t.id, allUnits);
    if (load === 0) continue;
    const perDayAll = teacherSlotsPerDay(p, t);
    const maxDaily = p.rules.teacherMaxHoursDaily;
    const perDayCap = perDayAll.map((n) => (maxDaily != null ? Math.min(n, maxDaily) : n));
    const avail = perDayCap.reduce((a, b) => a + b, 0);
    if (load > avail)
      err('profesores', maxDaily != null && avail < perDayAll.reduce((a, b) => a + b, 0)
        ? `${t.name} tiene ${load} horas asignadas; con su disponibilidad y el máximo de ${maxDaily} horas diarias caben ${avail}.`
        : `${t.name} tiene ${load} horas asignadas, pero solo está disponible en ${avail} bloques.`);
    if (t.maxHours != null && load > t.maxHours) warn('profesores', `${t.name} tiene ${load} horas asignadas y su contrato es de ${t.maxHours}.`);
    if (t.maxDays != null) {
      const perDay = [...perDayCap].sort((a, b) => b - a);
      const cap = perDay.slice(0, t.maxDays).reduce((a, b) => a + b, 0);
      if (load > cap) err('profesores', `${t.name} puede venir ${t.maxDays} días, que suman como máximo ${cap} bloques, y tiene ${load} horas.`);
    }
  }

  for (const s of p.subjects) {
    if (!s.roomId) continue;
    const room = p.rooms.find((r) => r.id === s.roomId);
    if (!room) { err('asignaturas', `${s.name} usa una sala que ya no existe.`); continue; }
    const inRoom = allUnits.filter((u) => p.subjects.find((x) => x.id === u.subjectId)?.roomId === room.id)
      .reduce((acc, u) => acc + hours(u.blocks), 0);
    if (inRoom > weekSlots) err('asignaturas', `${room.name} necesita ${inRoom} horas a la semana y solo hay ${weekSlots} bloques.`);
  }

  for (const win of p.rules.subjectWindows) {
    const s = p.subjects.find((x) => x.id === win.subjectId);
    if (!s) continue;
    if (win.periodIds.length === 0) err('reglas', `La regla de horario para ${s.name} no permite ningún bloque.`);
  }

  for (const [rule, label] of [[p.rules.teacherMaxHoursDaily, 'profesores'], [p.rules.courseMaxHoursDaily, 'cursos']] as const) {
    if (rule == null) continue;
    const big = Math.max(0, ...allUnits.flatMap((u) => u.blocks));
    if (big > rule) err('reglas', `Hay clases de ${big} horas seguidas, pero el máximo diario de los ${label} es ${rule}.`);
  }
  if (p.rules.teacherMeetingSlots.length > 0 && p.teachers.length > 0 && p.rules.teacherMeetingSlots.length >= weekSlots)
    err('reglas', 'El consejo de profesores ocupa todos los bloques de la semana.');

  if (p.rules.coursesNoGaps && p.rules.coursesStartFirstBlock)
    for (const c of p.courses) {
      const load = courseLoad(p, c.id, allUnits);
      if (load > 0 && load < p.school.days.length)
        warn('reglas', `${c.name} tiene menos horas (${load}) que días; con "empezar en el primer bloque" algunos días quedarán sin clases.`);
    }
  return out;
}
