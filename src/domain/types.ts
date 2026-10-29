// Modelo de datos del colegio. Es lo que el usuario edita; el archivo .fet se genera a partir de esto.

export type Id = string;

/** Un tramo de la jornada. Solo los de tipo "clase" reciben actividades. */
export interface Period {
  id: Id;
  label: string; // "1° bloque"
  start: string; // "08:00"
  end: string; // "08:45"
  kind: 'clase' | 'recreo' | 'almuerzo';
}

export interface School {
  name: string;
  days: string[]; // ["Lunes", ..., "Viernes"]
  periods: Period[];
  /** Tramos de clase sin clases en un día específico (ej. viernes jornada corta). Clave `${dayIndex}:${periodId}`. */
  closed: string[];
}

/** Un grupo dentro de una división del curso: "Básico" en "Inglés por nivel". */
export interface CourseGroup {
  id: Id;
  name: string;
}

/**
 * Forma de separar a los alumnos de un curso para algunas asignaturas.
 * Ej.: "Inglés por nivel" → Básico / Avanzado. Cada alumno pertenece a un grupo de cada división.
 */
export interface Division {
  id: Id;
  name: string;
  groups: CourseGroup[];
  /** Las clases de los grupos van a la misma hora (ej. todos los niveles de inglés en paralelo). */
  parallel: boolean;
}

export interface Course {
  id: Id;
  name: string; // "1° Medio A"
  level: string; // "1° Medio", para agrupar y copiar carga
  divisions: Division[];
}

export interface Subject {
  id: Id;
  name: string;
  short: string;
  color: string;
  /** Sala especial obligatoria para esta asignatura (gimnasio, laboratorio). */
  roomId: Id | null;
}

export interface Teacher {
  id: Id;
  name: string;
  /** Horas de contrato disponibles para clases; solo se usa para avisar sobrecarga. */
  maxHours: number | null;
  /** Máximo de días a la semana que puede venir. */
  maxDays: number | null;
  /** Tramos en que NO puede hacer clases. Clave `${dayIndex}:${periodId}`. */
  unavailable: string[];
}

export interface Room {
  id: Id;
  name: string;
}

/** Carga académica: un curso, una asignatura, un profesor y cómo se reparten las horas. */
export interface Assignment {
  id: Id;
  courseId: Id;
  /** Grupo de una división del curso; null = todo el curso. */
  groupId: Id | null;
  subjectId: Id;
  teacherId: Id | null;
  /** Bloques semanales; [2,2,2] = 6 horas en tres bloques de 2. */
  blocks: number[];
}

export type Strength = 'obligatoria' | 'preferible';

export interface SubjectWindow {
  id: Id;
  subjectId: Id;
  /** Tramos de clase permitidos para la asignatura (todos los días). */
  periodIds: Id[];
  strength: Strength;
}

export interface Rules {
  /** Los cursos no tienen horas libres entre clases. */
  coursesNoGaps: boolean;
  /** Los cursos empiezan siempre en el primer bloque. */
  coursesStartFirstBlock: boolean;
  /** Los bloques de una misma asignatura y curso van en días distintos. */
  spreadSubjectDays: boolean;
  spreadStrength: Strength;
  /** Máximo de ventanas (horas libres entre clases) por profesor, por día. null = sin límite. */
  teacherMaxGapsPerDay: number | null;
  /** Máximo de ventanas por profesor en la semana. null = sin límite. */
  teacherMaxGapsPerWeek: number | null;
  subjectWindows: SubjectWindow[];
  /** Máximo de horas de clase de un profesor en un día. null = sin límite. */
  teacherMaxHoursDaily: number | null;
  /** Máximo de horas de clase de un curso en un día. null = sin límite. */
  courseMaxHoursDaily: number | null;
  /** Tramos reservados para todos los profesores (consejo, reunión). Clave `${dayIndex}:${periodId}`. */
  teacherMeetingSlots: string[];
}

/** Una opción dentro de una franja de electivos: una asignatura con su profesor. */
export interface ElectiveOption {
  id: Id;
  subjectId: Id;
  teacherId: Id | null;
}

/**
 * Franja de electivos entre cursos (ej. plan diferenciado de 3° y 4° Medio): los alumnos de varios cursos
 * se reparten entre las opciones, que se dictan todas a la misma hora. Cada alumno toma una opción por franja.
 */
export interface ElectiveBlock {
  id: Id;
  name: string;
  courseIds: Id[];
  options: ElectiveOption[];
  /** Bloques semanales de la franja, iguales para todas las opciones. */
  blocks: number[];
}

/** Clave estable de una actividad: bloque número `index` de una asignación. */
export type ActivityKey = string; // `${assignmentId}#${index}`

export interface Placement {
  key: ActivityKey;
  day: number;
  periodId: Id;
  roomId: Id | null;
}

export interface Timetable {
  generatedAt: string;
  seconds: number;
  placements: Placement[];
}

export interface Project {
  id: Id;
  name: string;
  year: number;
  /** Fecha del último respaldo descargado (para recordar respaldar). */
  backupAt?: string;
  updatedAt: string;
  school: School;
  courses: Course[];
  subjects: Subject[];
  teachers: Teacher[];
  rooms: Room[];
  assignments: Assignment[];
  electives: ElectiveBlock[];
  rules: Rules;
  /** Bloques fijados por el usuario: se mantienen al regenerar. */
  locks: Record<ActivityKey, { day: number; periodId: Id }>;
  timetable: Timetable | null;
}

/** Combinaciones de grupos (una por división) = los distintos horarios de alumnos que tiene un curso. */
export function studentSets(c: Course): CourseGroup[][] {
  return c.divisions.filter((d) => d.groups.length > 0)
    .reduce<CourseGroup[][]>((acc, d) => acc.flatMap((combo) => d.groups.map((g) => [...combo, g])), [[]]);
}

export function findGroup(c: Course | undefined, groupId: Id | null): { division: Division; group: CourseGroup } | null {
  if (!c || !groupId) return null;
  for (const division of c.divisions) {
    const group = division.groups.find((g) => g.id === groupId);
    if (group) return { division, group };
  }
  return null;
}

/** Normaliza proyectos (versiones anteriores, respaldos importados) y limpia referencias a elementos eliminados. */
export function migrateProject(p: Project): Project {
  p.electives ??= [];
  p.rules.teacherMaxHoursDaily ??= null;
  p.rules.courseMaxHoursDaily ??= null;
  p.rules.teacherMeetingSlots ??= [];
  for (const c of p.courses) c.divisions ??= [];
  for (const a of p.assignments) {
    a.groupId ??= null;
    if (a.groupId && !findGroup(p.courses.find((c) => c.id === a.courseId), a.groupId)) a.groupId = null;
  }
  // Referencias a cosas eliminadas (cursos, asignaturas, profesores) en las franjas de electivos.
  const courses = new Set(p.courses.map((c) => c.id));
  const subjects = new Set(p.subjects.map((s) => s.id));
  const teachers = new Set(p.teachers.map((t) => t.id));
  for (const e of p.electives) {
    if (e.courseIds.some((id) => !courses.has(id))) e.courseIds = e.courseIds.filter((id) => courses.has(id));
    if (e.options.some((o) => !subjects.has(o.subjectId))) e.options = e.options.filter((o) => subjects.has(o.subjectId));
    for (const o of e.options) if (o.teacherId && !teachers.has(o.teacherId)) o.teacherId = null;
  }
  for (const a of p.assignments) if (a.teacherId && !teachers.has(a.teacherId)) a.teacherId = null;
  return p;
}

export const slotKey = (day: number, periodId: Id) => `${day}:${periodId}`;
export const activityKey = (assignmentId: Id, index: number): ActivityKey => `${assignmentId}#${index}`;
export const newId = () => crypto.randomUUID().slice(0, 8);
