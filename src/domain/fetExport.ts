// Traduce un Project al formato XML de FET (.fet). FET usa nombres como identificadores,
// así que se generan nombres únicos y se guarda el mapa de vuelta (Id de actividad → bloque).
import type { ActivityKey, Project } from './types';
import { activityKey, slotKey } from './types';
import { courseStudentSets, effectiveDivisions, parallelRows, units } from './units';

export interface FetExport {
  xml: string;
  /** Id de actividad FET → clave de la actividad en el proyecto. */
  activityById: Map<number, ActivityKey>;
  dayNames: string[];
  /** Nombre de "hora" FET → id del tramo. */
  periodByName: Map<string, string>;
  /** Nombre de sala FET → id de sala. */
  roomByName: Map<string, string>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Asigna nombres únicos (FET no admite dos profesores, cursos o asignaturas con el mismo nombre). */
function uniqueNames<T extends { id: string }>(items: T[], name: (t: T) => string): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const it of items) {
    const base = name(it).trim() || 'Sin nombre';
    let n = base, i = 2;
    while (used.has(n.toLowerCase())) n = `${base} (${i++})`;
    used.add(n.toLowerCase());
    out.set(it.id, n);
  }
  return out;
}

const weight = (strength: 'obligatoria' | 'preferible') => (strength === 'obligatoria' ? '100' : '95');
const isClass = (p: Project, d: number, periodId: string) =>
  p.school.periods.some((x) => x.id === periodId && x.kind === 'clase') && !p.school.closed.includes(slotKey(d, periodId));

export function exportFet(p: Project): FetExport {
  const { school, rules } = p;
  const L: string[] = [];
  const w = (s: string) => L.push(s);
  const allUnits = units(p);

  const dayNames = [...uniqueNames(school.days.map((d, i) => ({ id: String(i), d })), (x) => x.d).values()];
  const periodNames = uniqueNames(school.periods, (x) => x.label || `${x.start}-${x.end}`);
  const periodByName = new Map([...periodNames].map(([id, n]) => [n, id]));
  const subjectNames = uniqueNames(p.subjects, (x) => x.name);
  const teacherNames = uniqueNames(p.teachers, (x) => x.name);
  const courseNames = uniqueNames(p.courses, (x) => x.name);
  const roomNames = uniqueNames(p.rooms, (x) => x.name);
  const roomByName = new Map([...roomNames].map(([id, n]) => [n, id]));
  const classPeriods = school.periods.filter((x) => x.kind === 'clase');

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<fet version="7.12.0">');
  w('<Mode>Official</Mode>');
  w(`<Institution_Name>${esc(school.name || p.name)}</Institution_Name>`);
  w('<Comments>Generado por Horarios Web</Comments>');

  w(`<Days_List><Number_of_Days>${dayNames.length}</Number_of_Days>`);
  for (const d of dayNames) w(`<Day><Name>${esc(d)}</Name><Long_Name></Long_Name></Day>`);
  w('</Days_List>');

  w(`<Hours_List><Number_of_Hours>${school.periods.length}</Number_of_Hours>`);
  for (const per of school.periods)
    w(`<Hour><Name>${esc(periodNames.get(per.id)!)}</Name><Long_Name>${esc(`${per.start}-${per.end}`)}</Long_Name></Hour>`);
  w('</Hours_List>');

  w('<Subjects_List>');
  for (const s of p.subjects) w(`<Subject><Name>${esc(subjectNames.get(s.id)!)}</Name><Long_Name></Long_Name><Code>${esc(s.short)}</Code><Comments></Comments></Subject>`);
  w('</Subjects_List>');
  w('<Activity_Tags_List></Activity_Tags_List>');

  w('<Teachers_List>');
  for (const t of p.teachers)
    w(`<Teacher><Name>${esc(teacherNames.get(t.id)!)}</Name><Long_Name></Long_Name><Code></Code><Target_Number_of_Hours>0</Target_Number_of_Hours><Qualified_Subjects></Qualified_Subjects><Comments></Comments></Teacher>`);
  w('</Teachers_List>');

  // ---------- Alumnos: cursos, grupos (divisiones y franjas de electivos) y subgrupos ----------
  // Cursos, grupos y subgrupos comparten el mismo espacio de nombres en FET.
  const usedStudentNames = new Set([...courseNames.values()].map((n) => n.toLowerCase()));
  const uniqueStudent = (base: string) => {
    let n = base, i = 2;
    while (usedStudentNames.has(n.toLowerCase())) n = `${base} (${i++})`;
    usedStudentNames.add(n.toLowerCase());
    return n;
  };
  const groupNames = new Map<string, string>(); // `${curso}|${grupo}` → nombre FET
  const studentTag = (name: string, inner = '') =>
    `<Name>${esc(name)}</Name><Long_Name></Long_Name><Code></Code><Number_of_Students>0</Number_of_Students><Comments></Comments>${inner}`;

  w('<Students_List>');
  for (const c of p.courses) {
    const year = courseNames.get(c.id)!;
    const divisions = effectiveDivisions(p, c).filter((d) => d.groups.length > 0);
    const yearHead = `<Year>${studentTag(year)}<Number_of_Categories>0</Number_of_Categories><First_Category_Is_Permanent>false</First_Category_Is_Permanent><Separator> </Separator>`;
    if (divisions.length === 0) { w(`${yearHead}</Year>`); continue; }
    for (const d of divisions) for (const g of d.groups) groupNames.set(`${c.id}|${g.id}`, uniqueStudent(`${year} ${g.name}`));
    w(yearHead);
    if (divisions.length === 1) {
      // Una sola división: cada grupo es un conjunto de alumnos sin subdivisiones.
      for (const g of divisions[0].groups) w(`<Group>${studentTag(groupNames.get(`${c.id}|${g.id}`)!)}</Group>`);
    } else {
      // Varias divisiones: cada combinación de grupos es un subgrupo (los alumnos que comparten horario).
      const combos = courseStudentSets(p, c).map((combo) => ({ ids: new Set(combo.map((g) => g.id)), name: uniqueStudent(`${year} ${combo.map((g) => g.name).join(' + ')}`) }));
      for (const d of divisions) for (const g of d.groups) {
        w(`<Group>${studentTag(groupNames.get(`${c.id}|${g.id}`)!)}`);
        for (const sg of combos.filter((x) => x.ids.has(g.id))) w(`<Subgroup>${studentTag(sg.name)}</Subgroup>`);
        w('</Group>');
      }
    }
    w('</Year>');
  }
  w('</Students_List>');

  // ---------- Actividades: un bloque de una unidad = una actividad FET ----------
  const activityById = new Map<number, ActivityKey>();
  const spread: number[][] = [];
  const idsByUnit = new Map<string, number[]>();
  let nextId = 1;
  w('<Activities_List>');
  for (const u of allUnits) {
    if (!subjectNames.has(u.subjectId) || u.blocks.length === 0) continue;
    const students = u.audience
      .filter((a) => courseNames.has(a.courseId))
      .map((a) => (a.groupId && groupNames.get(`${a.courseId}|${a.groupId}`)) || courseNames.get(a.courseId)!);
    if (students.length === 0) continue;
    const total = u.blocks.reduce((x, y) => x + y, 0);
    const groupId = u.blocks.length > 1 ? nextId : 0;
    const teacher = u.teacherId && teacherNames.has(u.teacherId) ? `<Teacher>${esc(teacherNames.get(u.teacherId)!)}</Teacher>` : '';
    const studentsXml = [...new Set(students)].map((s) => `<Students>${esc(s)}</Students>`).join('');
    const ids: number[] = [];
    u.blocks.forEach((dur, i) => {
      const id = nextId++;
      ids.push(id);
      activityById.set(id, activityKey(u.id, i));
      w(`<Activity>${teacher}<Subject>${esc(subjectNames.get(u.subjectId)!)}</Subject>${studentsXml}<Duration>${dur}</Duration><Total_Duration>${total}</Total_Duration><Id>${id}</Id><Activity_Group_Id>${groupId}</Activity_Group_Id><Active>true</Active><Comments></Comments></Activity>`);
    });
    if (ids.length > 1) spread.push(ids);
    idsByUnit.set(u.id, ids);
  }
  w('</Activities_List>');

  // Clases a la misma hora (divisiones en paralelo y opciones de una franja de electivos), bloque por bloque.
  const sameStart: number[][] = [];
  for (const row of parallelRows(p)) {
    const rowIds = row.unitIds.map((id) => idsByUnit.get(id));
    if (rowIds.some((x) => !x)) continue;
    for (let i = 0; i < row.blocks; i++) sameStart.push(rowIds.map((x) => x![i]));
  }

  w('<Buildings_List></Buildings_List>');
  w('<Rooms_List>');
  for (const r of p.rooms)
    w(`<Room><Name>${esc(roomNames.get(r.id)!)}</Name><Long_Name></Long_Name><Code></Code><Building></Building><Capacity>30000</Capacity><Virtual>false</Virtual><Comments></Comments></Room>`);
  w('</Rooms_List>');

  // ---------- Restricciones de tiempo ----------
  w('<Time_Constraints_List>');
  w('<ConstraintBasicCompulsoryTime><Weight_Percentage>100</Weight_Percentage><Active>true</Active><Comments></Comments></ConstraintBasicCompulsoryTime>');

  // Recreos, almuerzo y tramos cerrados: FET no pone clases ahí ni deja que un bloque los cruce.
  const breaks: [number, string][] = [];
  dayNames.forEach((_, d) => school.periods.forEach((per) => { if (!isClass(p, d, per.id)) breaks.push([d, per.id]); }));
  if (breaks.length) {
    w(`<ConstraintBreakTimes><Weight_Percentage>100</Weight_Percentage><Number_of_Break_Times>${breaks.length}</Number_of_Break_Times>`);
    for (const [d, pid] of breaks) w(`<Break_Time><Day>${esc(dayNames[d])}</Day><Hour>${esc(periodNames.get(pid)!)}</Hour></Break_Time>`);
    w('<Active>true</Active><Comments>Recreos, almuerzo y tramos sin clases</Comments></ConstraintBreakTimes>');
  }

  for (const t of p.teachers) {
    // Su propia indisponibilidad más los bloques reservados para todos (consejo de profesores).
    const na = [...new Set([...t.unavailable, ...rules.teacherMeetingSlots])].filter((k) => {
      const [d, pid] = k.split(':');
      return +d < dayNames.length && periodNames.has(pid) && isClass(p, +d, pid);
    });
    if (na.length) {
      w(`<ConstraintTeacherNotAvailableTimes><Weight_Percentage>100</Weight_Percentage><Teacher>${esc(teacherNames.get(t.id)!)}</Teacher><Number_of_Not_Available_Times>${na.length}</Number_of_Not_Available_Times>`);
      for (const k of na) {
        const [d, pid] = k.split(':');
        w(`<Not_Available_Time><Day>${esc(dayNames[+d])}</Day><Hour>${esc(periodNames.get(pid)!)}</Hour></Not_Available_Time>`);
      }
      w('<Active>true</Active><Comments></Comments></ConstraintTeacherNotAvailableTimes>');
    }
    if (t.maxDays && t.maxDays < dayNames.length)
      w(`<ConstraintTeacherMaxDaysPerWeek><Weight_Percentage>100</Weight_Percentage><Teacher_Name>${esc(teacherNames.get(t.id)!)}</Teacher_Name><Max_Days_Per_Week>${t.maxDays}</Max_Days_Per_Week><Active>true</Active><Comments></Comments></ConstraintTeacherMaxDaysPerWeek>`);
  }

  if (rules.spreadSubjectDays)
    for (const ids of spread) {
      w(`<ConstraintMinDaysBetweenActivities><Weight_Percentage>${weight(rules.spreadStrength)}</Weight_Percentage><Consecutive_If_Same_Day>true</Consecutive_If_Same_Day><Number_of_Activities>${ids.length}</Number_of_Activities>`);
      for (const id of ids) w(`<Activity_Id>${id}</Activity_Id>`);
      w('<MinDays>1</MinDays><Active>true</Active><Comments></Comments></ConstraintMinDaysBetweenActivities>');
    }

  if (rules.teacherMaxGapsPerDay != null)
    w(`<ConstraintTeachersMaxGapsPerDay><Weight_Percentage>100</Weight_Percentage><Max_Gaps>${rules.teacherMaxGapsPerDay}</Max_Gaps><Active>true</Active><Comments></Comments></ConstraintTeachersMaxGapsPerDay>`);
  if (rules.teacherMaxGapsPerWeek != null)
    w(`<ConstraintTeachersMaxGapsPerWeek><Weight_Percentage>100</Weight_Percentage><Max_Gaps>${rules.teacherMaxGapsPerWeek}</Max_Gaps><Active>true</Active><Comments></Comments></ConstraintTeachersMaxGapsPerWeek>`);
  if (rules.teacherMaxHoursDaily != null)
    w(`<ConstraintTeachersMaxHoursDaily><Weight_Percentage>100</Weight_Percentage><Maximum_Hours_Daily>${rules.teacherMaxHoursDaily}</Maximum_Hours_Daily><Active>true</Active><Comments></Comments></ConstraintTeachersMaxHoursDaily>`);
  if (rules.courseMaxHoursDaily != null)
    w(`<ConstraintStudentsMaxHoursDaily><Weight_Percentage>100</Weight_Percentage><Maximum_Hours_Daily>${rules.courseMaxHoursDaily}</Maximum_Hours_Daily><Active>true</Active><Comments></Comments></ConstraintStudentsMaxHoursDaily>`);
  if (rules.coursesNoGaps)
    w('<ConstraintStudentsMaxGapsPerWeek><Weight_Percentage>100</Weight_Percentage><Max_Gaps>0</Max_Gaps><Active>true</Active><Comments></Comments></ConstraintStudentsMaxGapsPerWeek>');
  if (rules.coursesStartFirstBlock)
    w('<ConstraintStudentsEarlyMaxBeginningsAtSecondHour><Weight_Percentage>100</Weight_Percentage><Max_Beginnings_At_Second_Hour>0</Max_Beginnings_At_Second_Hour><Active>true</Active><Comments></Comments></ConstraintStudentsEarlyMaxBeginningsAtSecondHour>');

  for (const win of rules.subjectWindows) {
    if (!subjectNames.has(win.subjectId)) continue;
    const allowed = classPeriods.filter((x) => win.periodIds.includes(x.id));
    const slots: [number, string][] = [];
    dayNames.forEach((_, d) => allowed.forEach((x) => slots.push([d, x.id])));
    w(`<ConstraintActivitiesPreferredTimeSlots><Weight_Percentage>${weight(win.strength)}</Weight_Percentage><Teacher_Name></Teacher_Name><Students_Name></Students_Name><Subject_Name>${esc(subjectNames.get(win.subjectId)!)}</Subject_Name><Activity_Tag_Name></Activity_Tag_Name><Duration></Duration><Number_of_Preferred_Time_Slots>${slots.length}</Number_of_Preferred_Time_Slots>`);
    for (const [d, pid] of slots) w(`<Preferred_Time_Slot><Preferred_Day>${esc(dayNames[d])}</Preferred_Day><Preferred_Hour>${esc(periodNames.get(pid)!)}</Preferred_Hour></Preferred_Time_Slot>`);
    w('<Active>true</Active><Comments></Comments></ConstraintActivitiesPreferredTimeSlots>');
  }

  for (const ids of sameStart) {
    w(`<ConstraintActivitiesSameStartingTime><Weight_Percentage>100</Weight_Percentage><Number_of_Activities>${ids.length}</Number_of_Activities>`);
    for (const id of ids) w(`<Activity_Id>${id}</Activity_Id>`);
    w('<Active>true</Active><Comments>Clases en paralelo</Comments></ConstraintActivitiesSameStartingTime>');
  }

  // Bloques fijados por el usuario.
  for (const [id, key] of activityById) {
    const lock = p.locks[key];
    if (!lock || lock.day >= dayNames.length || !periodNames.has(lock.periodId)) continue;
    w(`<ConstraintActivityPreferredStartingTime><Weight_Percentage>100</Weight_Percentage><Activity_Id>${id}</Activity_Id><Preferred_Day>${esc(dayNames[lock.day])}</Preferred_Day><Preferred_Hour>${esc(periodNames.get(lock.periodId)!)}</Preferred_Hour><Permanently_Locked>false</Permanently_Locked><Active>true</Active><Comments></Comments></ConstraintActivityPreferredStartingTime>`);
  }
  w('</Time_Constraints_List>');

  // ---------- Restricciones de espacio ----------
  w('<Space_Constraints_List>');
  w('<ConstraintBasicCompulsorySpace><Weight_Percentage>100</Weight_Percentage><Active>true</Active><Comments></Comments></ConstraintBasicCompulsorySpace>');
  for (const s of p.subjects)
    if (s.roomId && roomNames.has(s.roomId))
      w(`<ConstraintSubjectPreferredRoom><Weight_Percentage>100</Weight_Percentage><Subject>${esc(subjectNames.get(s.id)!)}</Subject><Room>${esc(roomNames.get(s.roomId)!)}</Room><Active>true</Active><Comments></Comments></ConstraintSubjectPreferredRoom>`);
  w('</Space_Constraints_List>');
  w('</fet>');

  return { xml: L.join('\n'), activityById, dayNames, periodByName, roomByName };
}
