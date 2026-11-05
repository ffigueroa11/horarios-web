// Lee un archivo .fet (de FET de escritorio, versiones 5 en adelante) y arma un proyecto para usarlo de base.
// Lo que el modelo no puede representar no se inventa: se conserva lo posible y el informe dice qué quedó fuera.
// Se usa regex, igual que fetResult, para funcionar igual en el navegador y en las pruebas.
import type { Course, Division, ElectiveBlock, ImportReport, Period, Project, Teacher } from './types';
import { activityKey, migrateProject, newId, slotKey } from './types';
import { emptyProject, SUBJECT_COLORS } from './defaults';
import { unesc } from './fetResult';
import { electiveGroupId } from './units';

export class FetImportError extends Error {}

const vals = (x: string, name: string) => [...x.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => unesc(m[1]).trim());
const val = (x: string, name: string) => vals(x, name)[0] ?? '';
const blocks = (x: string, name: string) => [...x.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
const section = (x: string, name: string) => {
  const a = x.indexOf(`<${name}>`), b = x.indexOf(`</${name}>`);
  return a < 0 || b < a ? '' : x.slice(a, b);
};
const num = (x: string, name: string) => Number(val(x, name));
const isHard = (c: string) => num(c, 'Weight_Percentage') >= 100;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "08:00 - 08:45", "15:30  -16:30" u "08:00" → minutos de inicio y término. */
function parseTimes(text: string): { start: number | null; end: number | null } {
  const found = [...text.matchAll(/(\d{1,2})[:.](\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return { start: found[0] ?? null, end: found[1] ?? null };
}

/** Un hueco de 5 minutos o más entre dos horas es un recreo; los de 1 a 4 minutos son solo el cambio de sala. */
const MIN_BREAK = 5;
const breakPeriod = (start: string, end: string, minutes: number | null): Period => {
  const lunch = minutes != null && minutes >= 30;
  return { id: newId(), label: lunch ? 'Almuerzo' : 'Recreo', start, end, kind: lunch ? 'almuerzo' : 'recreo' };
};

/** Jornada: las horas de FET más los recreos declarados (ConstraintBreakTimes) o deducidos de los horarios. */
function readSchool(xml: string, time: string, p: Project) {
  const hourXml = blocks(section(xml, 'Hours_List'), 'Hour');
  const names = hourXml.length ? hourXml.map((h) => val(h, 'Name')) : vals(section(xml, 'Hours_List'), 'Name');
  const times = names.map((n, i) => {
    const own = parseTimes(n);
    return own.start != null ? own : parseTimes(val(hourXml[i] ?? '', 'Long_Name'));
  });
  // Solo con hora de inicio ("08:00"), cada bloque termina cuando empieza el siguiente.
  times.forEach((t, i) => { if (t.start != null && t.end == null) t.end = times[i + 1]?.start ?? t.start + 45; });

  const days = vals(section(xml, 'Days_List'), 'Name');
  const breakSlots = blocks(time, 'ConstraintBreakTimes')
    .filter((c) => val(c, 'Active') !== 'false' && isHard(c))
    .flatMap((c) => blocks(c, 'Break_Time').map((b) => ({ day: val(b, 'Day'), hour: val(b, 'Hour') })));
  const declared = breakSlots.length > 0;

  // Una clase fijada que cruza un hueco muestra que ahí no hay recreo real: con él, el horario no se podría generar.
  const durations = new Map(blocks(section(xml, 'Activities_List'), 'Activity')
    .filter((a) => val(a, 'Students') && val(a, 'Active') !== 'false').map((a) => [num(a, 'Id'), num(a, 'Duration')]));
  const crossed = new Set<number>();
  for (const c of blocks(time, 'ConstraintActivityPreferredStartingTime')) {
    if (val(c, 'Active') === 'false' || !isHard(c)) continue;
    const h = names.indexOf(val(c, 'Preferred_Hour'));
    for (let k = 1; h >= 0 && k < (durations.get(num(c, 'Activity_Id')) ?? 0); k++) crossed.add(h + k);
  }
  const notBreaks: string[] = [];

  const hourPeriods: Period[] = [];
  const periods: Period[] = [];
  names.forEach((name, i) => {
    const { start, end } = times[i];
    const startText = start != null ? hhmm(start) : '', endText = end != null ? hhmm(end) : '';
    const prevEnd = i > 0 ? times[i - 1].end : null;
    if (!declared && start != null && prevEnd != null && start - prevEnd >= MIN_BREAK) {
      if (crossed.has(i)) notBreaks.push(hhmm(prevEnd));
      else periods.push(breakPeriod(hhmm(prevEnd), startText, start - prevEnd));
    }
    const whole = declared && days.every((d) => breakSlots.some((b) => b.day === d && b.hour === name));
    const period: Period = whole
      ? breakPeriod(startText, endText, start != null && end != null ? end - start : null)
      : { id: newId(), label: start != null ? `${hourPeriods.filter((x) => x.kind === 'clase').length + 1}° bloque` : name, start: startText, end: endText, kind: 'clase' };
    periods.push(period);
    hourPeriods.push(period);
  });

  // Recreos de solo algunos días: tramos sin clases.
  const hourIndex = new Map(names.map((n, i) => [n, i]));
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const closed: string[] = [];
  for (const b of breakSlots) {
    const d = dayIndex.get(b.day), h = hourIndex.get(b.hour);
    if (d != null && h != null && hourPeriods[h].kind === 'clase') closed.push(slotKey(d, hourPeriods[h].id));
  }
  p.school.days = days;
  p.school.periods = periods;
  p.school.closed = [...new Set(closed)];
  return { hourPeriods, hourIndex, dayIndex, notBreaks };
}

interface StudentSet {
  course: Course;
  /** Nombre del grupo FET; null = todo el curso. */
  group: string | null;
  /** El subgrupo está en más de un grupo: la clase queda en el primero. */
  approximate: boolean;
}

interface FetClass {
  activities: { id: number; dur: number }[];
  teachers: string[];
  subject: string;
  students: string[];
}

export function parseFet(text: string, fileName = 'horario.fet'): { project: Project; report: ImportReport } {
  if (!/<fet[\s>]/.test(text) || !text.includes('</fet>')) throw new FetImportError('no es un archivo de FET o está incompleto');
  const time = section(text, 'Time_Constraints_List');
  const space = section(text, 'Space_Constraints_List');

  const p = emptyProject(fileName.replace(/\.fet$/i, '') || 'Horario importado');
  const year = /20\d\d/.exec(fileName);
  if (year) p.year = Number(year[0]);
  p.school.name = val(text, 'Institution_Name');
  p.rules = { ...p.rules, coursesNoGaps: false, coursesStartFirstBlock: false, spreadSubjectDays: false };

  const { hourPeriods, hourIndex, dayIndex, notBreaks } = readSchool(text, time, p);
  if (p.school.days.length === 0 || hourPeriods.length === 0) throw new FetImportError('no tiene días u horas');

  const lost: string[] = [];
  for (const at of notBreaks) lost.push(`El recreo de las ${at} no se creó porque un bloque fijado lo cruza: agrégalo en Jornada si corresponde y mueve ese bloque.`);

  // ---------- Listas básicas ----------
  const addSubject = (name: string) => {
    const s = { id: newId(), name, short: name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase(), color: SUBJECT_COLORS[p.subjects.length % SUBJECT_COLORS.length], roomId: null };
    p.subjects.push(s);
    return s;
  };
  const addTeacher = (name: string) => {
    const t: Teacher = { id: newId(), name, maxHours: null, maxDays: null, unavailable: [] };
    p.teachers.push(t);
    return t;
  };
  blocks(section(text, 'Subjects_List'), 'Subject').forEach((s) => addSubject(val(s, 'Name')));
  blocks(section(text, 'Teachers_List'), 'Teacher').forEach((t) => addTeacher(val(t, 'Name')));
  p.rooms = blocks(section(text, 'Rooms_List'), 'Room').map((r) => ({ id: newId(), name: val(r, 'Name') }));
  const subjectOf = (name: string) => p.subjects.find((s) => s.name === name) ?? addSubject(name);
  const teacherOf = (name: string) => p.teachers.find((t) => t.name === name) ?? addTeacher(name);

  // ---------- Alumnos ----------
  const sets = new Map<string, StudentSet>();
  /** Subgrupos de cada grupo FET, para saber qué grupos se cruzan. */
  const subgroupsOf = new Map<string, string[]>();
  for (const y of blocks(section(text, 'Students_List'), 'Year')) {
    const name = val(y, 'Name');
    const level = name.replace(/\s*[A-Z]$/i, '').trim();
    const course: Course = { id: newId(), name, level: level || name, divisions: [] };
    p.courses.push(course);
    sets.set(name, { course, group: null, approximate: false });
    for (const g of blocks(y, 'Group')) {
      const groupName = val(g, 'Name');
      sets.set(groupName, { course, group: groupName, approximate: false });
      const subs = blocks(g, 'Subgroup').map((s) => val(s, 'Name'));
      subgroupsOf.set(groupName, subs);
      for (const sub of subs) {
        const seen = sets.get(sub);
        if (seen) seen.approximate = true;
        else sets.set(sub, { course, group: groupName, approximate: false });
      }
    }
  }

  // ---------- Actividades: las de un mismo grupo FET con iguales datos forman una clase ----------
  const classes = new Map<string, FetClass>();
  let inactive = 0;
  for (const a of blocks(section(text, 'Activities_List'), 'Activity')) {
    if (val(a, 'Active') === 'false') { inactive++; continue; }
    const id = num(a, 'Id'), group = num(a, 'Activity_Group_Id');
    const teachers = vals(a, 'Teacher'), subject = val(a, 'Subject'), students = vals(a, 'Students');
    const key = `${group || `solo${id}`}|${teachers.join('+')}|${subject}|${students.join('+')}`;
    const c = classes.get(key) ?? { activities: [], teachers, subject, students };
    c.activities.push({ id, dur: num(a, 'Duration') });
    classes.set(key, c);
  }

  const fixed = new Map<number, { day: number; hour: number }>();
  for (const c of blocks(time, 'ConstraintActivityPreferredStartingTime')) {
    const day = dayIndex.get(val(c, 'Preferred_Day')), hour = hourIndex.get(val(c, 'Preferred_Hour'));
    if (val(c, 'Active') !== 'false' && isHard(c) && day != null && hour != null) fixed.set(num(c, 'Activity_Id'), { day, hour });
  }

  // Ocupa al profesor con una indisponibilidad: la app no tiene clases sin curso ni con dos profesores.
  const occupy = (name: string, activity: { id: number; dur: number }) => {
    const f = fixed.get(activity.id);
    if (!f) return false;
    const t = teacherOf(name);
    for (let k = 0; k < activity.dur; k++) if (hourPeriods[f.hour + k]) t.unavailable.push(slotKey(f.day, hourPeriods[f.hour + k].id));
    return true;
  };
  const lockClass = (unitId: string, c: FetClass) => c.activities.forEach((a, i) => {
    const f = fixed.get(a.id);
    if (f) p.locks[activityKey(unitId, i)] = { day: f.day, periodId: hourPeriods[f.hour].id };
  });

  // Franjas: las clases que juntan varios cursos, reunidas si FET las pide a la misma hora.
  const sameStart = blocks(time, 'ConstraintActivitiesSameStartingTime').filter((c) => val(c, 'Active') !== 'false' && isHard(c));
  const sameStartIds = sameStart.map((c) => new Set(vals(c, 'Activity_Id').map(Number)));
  const usedSameStart = new Set<number>();

  const teacherOnly = new Map<string, { kept: number; dropped: number }>();
  let coTeacherKept = 0, coTeacherDropped = 0, unknownStudents = 0, approximated = 0;
  const groupsUsed = new Map<Course, Set<string>>();
  const singleCourse: { c: FetClass; set: StudentSet; group: string | null }[] = [];
  const multiCourse: { c: FetClass; courses: Course[] }[] = [];

  for (const c of classes.values()) {
    if (c.students.length === 0) {
      const tally = teacherOnly.get(c.subject) ?? { kept: 0, dropped: 0 };
      for (const a of c.activities) for (const t of c.teachers) if (occupy(t, a)) tally.kept++; else tally.dropped++;
      teacherOnly.set(c.subject, tally);
      continue;
    }
    const targets = c.students.map((s) => sets.get(s));
    if (targets.some((x) => !x)) unknownStudents++;
    const known = targets.filter((x): x is StudentSet => !!x);
    if (known.length === 0) continue;
    for (const a of c.activities) for (const t of c.teachers.slice(1)) if (occupy(t, a)) coTeacherKept++; else coTeacherDropped++;
    const courses = [...new Set(known.map((x) => x.course))];
    if (courses.length > 1) { multiCourse.push({ c, courses }); continue; }
    if (known.length > 1 || known[0].approximate) approximated++;
    const group = known.length === 1 ? known[0].group : null;
    if (group) {
      if (!groupsUsed.has(courses[0])) groupsUsed.set(courses[0], new Set());
      groupsUsed.get(courses[0])!.add(group);
    }
    singleCourse.push({ c, set: known[0], group });
  }

  // ---------- Divisiones: los grupos que no comparten alumnos forman una división ----------
  const groupIds = new Map<string, string>();
  for (const [course, used] of groupsUsed) {
    const divisions: Division[] = [];
    const members: string[][] = [];
    for (const name of used) {
      const subs = subgroupsOf.get(name) ?? [];
      let at = members.findIndex((l) => l.every((other) => !(subgroupsOf.get(other) ?? []).some((s) => subs.includes(s))));
      if (at < 0) {
        at = members.length;
        members.push([]);
        divisions.push({ id: newId(), name: at === 0 ? 'Grupos' : `Grupos ${at + 1}`, groups: [], parallel: false });
      }
      members[at].push(name);
      const id = newId();
      groupIds.set(name, id);
      // "1°A G1" se muestra como "G1": el curso ya se ve en la pantalla.
      divisions[at].groups.push({ id, name: name.startsWith(`${course.name} `) ? name.slice(course.name.length + 1) : name });
    }
    course.divisions = divisions;
  }

  for (const { c, set, group } of singleCourse) {
    const id = newId();
    p.assignments.push({
      id, courseId: set.course.id, groupId: group ? groupIds.get(group)! : null, subjectId: subjectOf(c.subject).id,
      teacherId: c.teachers[0] ? teacherOf(c.teachers[0]).id : null, blocks: c.activities.map((a) => a.dur),
    });
    lockClass(id, c);
  }

  // Cada clase entre cursos es una opción; se juntan en una franja las que FET pide a la misma hora, bloque a bloque.
  const taken = new Set<FetClass>();
  const durations = (c: FetClass) => c.activities.map((a) => a.dur).join('+');
  for (const { c, courses } of multiCourse) {
    if (taken.has(c)) continue;
    taken.add(c);
    const options = [c];
    const courseSet = new Set(courses);
    for (const other of multiCourse) {
      if (taken.has(other.c) || durations(other.c) !== durations(c)) continue;
      const linked = sameStartIds.filter((ids) => c.activities.some((a) => ids.has(a.id)) && other.c.activities.some((a) => ids.has(a.id)));
      if (linked.length === 0) continue;
      linked.forEach((ids) => ids.forEach((id) => usedSameStart.add(id)));
      taken.add(other.c);
      options.push(other.c);
      other.courses.forEach((x) => courseSet.add(x));
    }
    const block: ElectiveBlock = { id: newId(), name: options.length > 1 ? `Franja ${p.electives.length + 1}` : `${c.subject} (cursos juntos)`, courseIds: [...courseSet].map((x) => x.id), options: [], blocks: c.activities.map((a) => a.dur) };
    for (const o of options) {
      const option = { id: newId(), subjectId: subjectOf(o.subject).id, teacherId: o.teachers[0] ? teacherOf(o.teachers[0]).id : null };
      block.options.push(option);
      lockClass(electiveGroupId(block.id, option.id), o);
    }
    p.electives.push(block);
  }

  // ---------- Restricciones ----------
  const lostConstraints = new Map<string, number>();
  const lose = (label: string) => lostConstraints.set(label, (lostConstraints.get(label) ?? 0) + 1);
  const minDays: string[] = [];
  for (const m of `${time}${space}`.matchAll(/<(Constraint\w+)>([\s\S]*?)<\/\1>/g)) {
    const [, kind, c] = m;
    if (val(c, 'Active') === 'false') continue;
    const hard = isHard(c);
    switch (kind) {
      case 'ConstraintBasicCompulsoryTime': case 'ConstraintBasicCompulsorySpace': case 'ConstraintBreakTimes':
        break;
      case 'ConstraintActivityPreferredStartingTime':
        if (!hard) lose('Hora preferida de una actividad, con peso menor a 100 %');
        break;
      case 'ConstraintActivitiesSameStartingTime':
        if (!vals(c, 'Activity_Id').every((id) => usedSameStart.has(Number(id)))) lose('Actividades a la misma hora');
        break;
      case 'ConstraintTeacherNotAvailableTimes': {
        if (!hard) { lose('Disponibilidad de profesor, con peso menor a 100 %'); break; }
        const t = teacherOf(val(c, 'Teacher'));
        for (const n of blocks(c, 'Not_Available_Time')) {
          const d = dayIndex.get(val(n, 'Day')), h = hourIndex.get(val(n, 'Hour'));
          if (d != null && h != null) t.unavailable.push(slotKey(d, hourPeriods[h].id));
        }
        break;
      }
      case 'ConstraintTeacherMaxDaysPerWeek':
        if (hard) teacherOf(val(c, 'Teacher_Name')).maxDays = num(c, 'Max_Days_Per_Week');
        else lose('Máximo de días de un profesor, con peso menor a 100 %');
        break;
      case 'ConstraintMinDaysBetweenActivities':
        minDays.push(c);
        if (num(c, 'MinDays') > 1) lose('Mínimo de 2 o más días entre actividades (quedó como días distintos)');
        break;
      case 'ConstraintTeachersMaxGapsPerDay':
        if (hard) p.rules.teacherMaxGapsPerDay = num(c, 'Max_Gaps'); else lose('Ventanas de profesores, con peso menor a 100 %');
        break;
      case 'ConstraintTeachersMaxGapsPerWeek':
        if (hard) p.rules.teacherMaxGapsPerWeek = num(c, 'Max_Gaps'); else lose('Ventanas de profesores, con peso menor a 100 %');
        break;
      case 'ConstraintTeachersMaxHoursDaily':
        if (hard) p.rules.teacherMaxHoursDaily = num(c, 'Maximum_Hours_Daily'); else lose('Horas diarias de profesores, con peso menor a 100 %');
        break;
      case 'ConstraintStudentsMaxHoursDaily':
        if (hard) p.rules.courseMaxHoursDaily = num(c, 'Maximum_Hours_Daily'); else lose('Horas diarias de cursos, con peso menor a 100 %');
        break;
      case 'ConstraintStudentsMaxGapsPerWeek':
        if (hard && num(c, 'Max_Gaps') === 0) p.rules.coursesNoGaps = true; else lose('Horas libres de los cursos, distintas de cero');
        break;
      case 'ConstraintStudentsEarlyMaxBeginningsAtSecondHour':
        if (hard && num(c, 'Max_Beginnings_At_Second_Hour') === 0) p.rules.coursesStartFirstBlock = true; else lose('Inicio en el primer bloque, con excepciones');
        break;
      case 'ConstraintSubjectPreferredRoom': {
        const room = p.rooms.find((r) => r.name === val(c, 'Room'));
        if (hard && room) subjectOf(val(c, 'Subject')).roomId = room.id; else lose('Sala de una asignatura, con peso menor a 100 %');
        break;
      }
      case 'ConstraintActivitiesPreferredTimeSlots': {
        const onlySubject = val(c, 'Subject_Name') && !val(c, 'Teacher_Name') && !val(c, 'Students_Name') && !val(c, 'Activity_Tag_Name') && !val(c, 'Duration');
        const slots = blocks(c, 'Preferred_Time_Slot').map((s) => ({ day: val(s, 'Preferred_Day'), hour: val(s, 'Preferred_Hour') }));
        const hoursAllowed = [...new Set(slots.map((s) => s.hour))];
        // La app permite bloques "todos los días": solo calza si cada hora permitida vale los días de la jornada.
        const everyDay = hoursAllowed.every((h) => p.school.days.every((d) => slots.some((s) => s.day === d && s.hour === h)));
        if (onlySubject && everyDay) {
          p.rules.subjectWindows.push({
            id: newId(), subjectId: subjectOf(val(c, 'Subject_Name')).id, strength: hard ? 'obligatoria' : 'preferible',
            periodIds: hoursAllowed.flatMap((h) => { const i = hourIndex.get(h); return i != null ? [hourPeriods[i].id] : []; }),
          });
        } else lose('Horarios permitidos por curso, profesor o actividad');
        break;
      }
      default:
        lose(CONSTRAINT_LABELS[kind] ?? kind.replace(/^Constraint/, ''));
    }
  }
  if (minDays.length > 0) {
    p.rules.spreadSubjectDays = true;
    p.rules.spreadStrength = minDays.every(isHard) ? 'obligatoria' : 'preferible';
  }

  // Disponibilidad y bloques ocupados pueden repetirse.
  for (const t of p.teachers) t.unavailable = [...new Set(t.unavailable)];

  // ---------- Bloques que solo usaba el trabajo sin curso (ej. la tarde): quedan sin clases ----------
  const hourHasClass = hourPeriods.map(() => false);
  for (const { c } of [...singleCourse, ...multiCourse]) for (const a of c.activities) {
    const f = fixed.get(a.id);
    if (f) for (let k = 0; k < a.dur; k++) hourHasClass[f.hour + k] = true;
  }
  const hourHasTeacherWork = hourPeriods.map(() => false);
  for (const c of classes.values()) if (c.students.length === 0) for (const a of c.activities) {
    const f = fixed.get(a.id);
    if (f) for (let k = 0; k < a.dur; k++) hourHasTeacherWork[f.hour + k] = true;
  }
  let lastClass = hourHasClass.lastIndexOf(true);
  if (lastClass < 0) lastClass = hourPeriods.length - 1;
  const afterClasses = hourPeriods.filter((x, i) => i > lastClass && hourHasTeacherWork[i] && x.kind === 'clase');
  for (const per of afterClasses) p.school.days.forEach((_, d) => p.school.closed.push(slotKey(d, per.id)));

  // ---------- Informe ----------
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const nLocks = Object.keys(p.locks).length;
  const nBlocks = p.assignments.reduce((n, a) => n + a.blocks.length, 0) + p.electives.reduce((n, e) => n + e.options.length * e.blocks.length, 0);
  const nBreaks = p.school.periods.filter((x) => x.kind !== 'clase').length;
  const kept = [
    `Jornada: ${p.school.days.length} días y ${p.school.periods.filter((x) => x.kind === 'clase').length} bloques${nBreaks ? `, con ${nBreaks} recreos o almuerzo` : ''}.`,
    `${p.courses.length} cursos, ${p.subjects.length} asignaturas, ${p.teachers.length} profesores${p.rooms.length ? ` y ${p.rooms.length} salas` : ''}.`,
    `Carga académica: ${count(nBlocks, 'bloque', 'bloques')} de clase, ${nLocks} con su lugar fijado.`,
  ];
  if (p.electives.length) kept.push(`${count(p.electives.length, 'franja o clase que junta', 'franjas o clases que juntan')} varios cursos.`);
  if (nBlocks > nLocks) kept.push(`${count(nBlocks - nLocks, 'bloque', 'bloques')} sin lugar fijado: los ubicará el motor al generar y pueden quedar distintos al horario original.`);
  if (minDays.length) kept.push(`Repartir asignaturas en días distintos: quedó como regla ${p.rules.spreadStrength} para todos los cursos.`);

  const list = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(', ')} y ${names.length - 4} más` : names.join(', '));
  const keptOnly = [...teacherOnly].filter(([, t]) => t.kept > 0).map(([n]) => n);
  const nKept = [...teacherOnly.values()].reduce((n, t) => n + t.kept, 0);
  const droppedOnly = [...teacherOnly].filter(([, t]) => t.dropped > 0).map(([n]) => n);
  const nDropped = [...teacherOnly.values()].reduce((n, t) => n + t.dropped, 0);
  if (nKept) lost.push(`${count(nKept, 'actividad sin curso', 'actividades sin curso')} (${list(keptOnly)}) ${nKept === 1 ? 'quedó' : 'quedaron'} solo como bloques en que el profesor no está disponible.`);
  if (nDropped) lost.push(`${count(nDropped, 'actividad sin curso y sin lugar fijado', 'actividades sin curso y sin lugar fijado')} (${list(droppedOnly)}) no se ${nDropped === 1 ? 'importó' : 'importaron'}.`);
  if (coTeacherKept) lost.push(`${count(coTeacherKept, 'bloque', 'bloques')} con más de un profesor: la clase queda con el primero y, para los demás, figura como no disponible.`);
  if (coTeacherDropped) lost.push(`${count(coTeacherDropped, 'bloque', 'bloques')} con más de un profesor y sin lugar fijado: la clase queda solo con el primero.`);
  if (unknownStudents) lost.push(`${count(unknownStudents, 'clase nombra', 'clases nombran')} alumnos que no están en la lista de cursos; se omitieron esos alumnos.`);
  if (approximated) lost.push(`${count(approximated, 'clase', 'clases')} de subgrupos o de varios grupos de un curso se asignaron a un grupo o al curso completo: revísalas.`);
  if (inactive) lost.push(`${count(inactive, 'actividad desactivada', 'actividades desactivadas')} en FET no se ${inactive === 1 ? 'importó' : 'importaron'}.`);
  if (afterClasses.length) lost.push(`${count(afterClasses.length, 'bloque del final del día quedó', 'bloques del final del día quedaron')} sin clases, porque solo tenían actividades sin curso.`);
  for (const [label, n] of lostConstraints) lost.push(`${label}: ${n} ${n === 1 ? 'restricción no se traspasó' : 'restricciones no se traspasaron'}.`);

  const report = { fileName, kept, lost };
  p.importReport = report;
  return { project: migrateProject(p), report };
}

/** Restricciones de FET sin equivalente en la app que aparecen seguido; las demás se informan con su nombre técnico. */
const CONSTRAINT_LABELS: Record<string, string> = {
  ConstraintTwoActivitiesConsecutive: 'Dos actividades seguidas',
  ConstraintActivityEndsStudentsDay: 'Actividad al final del día de los alumnos',
  ConstraintActivitiesEndStudentsDay: 'Actividades al final del día de los alumnos',
  ConstraintActivityPreferredTimeSlots: 'Horarios permitidos de una actividad',
  ConstraintActivitiesPreferredStartingTimes: 'Horas de inicio permitidas por curso o asignatura',
  ConstraintActivityPreferredStartingTimes: 'Horas de inicio permitidas de una actividad',
  ConstraintStudentsSetHomeRoom: 'Sala fija de un curso',
  ConstraintTeacherHomeRoom: 'Sala fija de un profesor',
  ConstraintActivityPreferredRoom: 'Sala de una actividad',
  ConstraintStudentsSetNotAvailableTimes: 'Disponibilidad de un curso',
  ConstraintRoomNotAvailableTimes: 'Disponibilidad de una sala',
  ConstraintStudentsSetMaxGapsPerWeek: 'Horas libres de un curso',
  ConstraintStudentsSetMaxHoursDaily: 'Horas diarias de un curso',
  ConstraintTeacherMaxHoursDaily: 'Horas diarias de un profesor',
  ConstraintTeacherMaxGapsPerWeek: 'Ventanas de un profesor',
};
