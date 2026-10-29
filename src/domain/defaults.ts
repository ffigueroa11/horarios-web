import type { Assignment, Course, Period, Project, Room, Rules, Subject, Teacher } from './types';
import { newId, slotKey } from './types';

export const SUBJECT_COLORS = [
  '#4f7cac', '#c0603a', '#5a9367', '#9b6bb3', '#c99a2e', '#3f8f8f',
  '#b5547a', '#6d7a3a', '#7a5c45', '#5566c2', '#a8463f', '#2f7a5c',
];

export const DEFAULT_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

/** Jornada escolar completa típica: 8 bloques de 45 minutos, dos recreos y almuerzo. */
export function defaultPeriods(): Period[] {
  const p = (label: string, start: string, end: string, kind: Period['kind'] = 'clase'): Period =>
    ({ id: newId(), label, start, end, kind });
  return [
    p('1° bloque', '08:00', '08:45'),
    p('2° bloque', '08:45', '09:30'),
    p('Recreo', '09:30', '09:45', 'recreo'),
    p('3° bloque', '09:45', '10:30'),
    p('4° bloque', '10:30', '11:15'),
    p('Recreo', '11:15', '11:30', 'recreo'),
    p('5° bloque', '11:30', '12:15'),
    p('6° bloque', '12:15', '13:00'),
    p('Almuerzo', '13:00', '13:45', 'almuerzo'),
    p('7° bloque', '13:45', '14:30'),
    p('8° bloque', '14:30', '15:15'),
  ];
}

export function defaultRules(): Rules {
  return {
    coursesNoGaps: true,
    coursesStartFirstBlock: true,
    spreadSubjectDays: true,
    spreadStrength: 'preferible',
    teacherMaxGapsPerDay: null,
    teacherMaxGapsPerWeek: null,
    subjectWindows: [],
    teacherMaxHoursDaily: null,
    courseMaxHoursDaily: null,
    teacherMeetingSlots: [],
  };
}

export function emptyProject(name = 'Nuevo horario'): Project {
  return {
    id: newId(),
    name,
    year: new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0),
    updatedAt: new Date().toISOString(),
    school: { name: '', days: [...DEFAULT_DAYS], periods: defaultPeriods(), closed: [] },
    courses: [], subjects: [], teachers: [], rooms: [], assignments: [], electives: [],
    rules: defaultRules(),
    locks: {},
    timetable: null,
  };
}

/**
 * Liceo de ejemplo: cuatro cursos de 1° y 2° Medio con 36 horas semanales; los 2° comparten un electivo artístico.
 * Las horas por asignatura son ilustrativas, no el plan de estudios oficial.
 */
export function exampleProject(): Project {
  const pr = emptyProject('Liceo de ejemplo');
  pr.school.name = 'Liceo de ejemplo';
  const classPeriods = pr.school.periods.filter((p) => p.kind === 'clase');
  // Viernes jornada corta: sin 7° ni 8° bloque.
  pr.school.closed = [slotKey(4, classPeriods[6].id), slotKey(4, classPeriods[7].id)];

  const gym: Room = { id: newId(), name: 'Gimnasio' };
  const lab: Room = { id: newId(), name: 'Laboratorio de ciencias' };
  pr.rooms = [gym, lab];

  const subj = (name: string, short: string, i: number, roomId: string | null = null): Subject =>
    ({ id: newId(), name, short, color: SUBJECT_COLORS[i % SUBJECT_COLORS.length], roomId });
  const S = {
    len: subj('Lengua y Literatura', 'LEN', 0),
    mat: subj('Matemática', 'MAT', 1),
    ing: subj('Inglés', 'ING', 2),
    his: subj('Historia, Geografía y Cs. Sociales', 'HIS', 3),
    bio: subj('Biología', 'BIO', 4, lab.id),
    fis: subj('Física', 'FIS', 5),
    qui: subj('Química', 'QUI', 6, lab.id),
    edf: subj('Educación Física y Salud', 'EFI', 7, gym.id),
    art: subj('Artes Visuales', 'ART', 8),
    tec: subj('Tecnología', 'TEC', 9),
    ori: subj('Orientación', 'ORI', 10),
    mus: subj('Música', 'MUS', 11),
  };
  pr.subjects = Object.values(S);

  const t = (name: string, maxHours: number | null = null, maxDays: number | null = null): Teacher =>
    ({ id: newId(), name, maxHours, maxDays, unavailable: [] });
  const T = {
    len1: t('Carolina Muñoz', 30), len2: t('Rodrigo Pérez', 30),
    mat1: t('Valentina Soto', 32), mat2: t('Andrés Rojas', 32),
    ing: t('Francisca Díaz', 30), ing2: t('Paula Vera', 12), his: t('Matías González', 30),
    bio: t('Daniela Fuentes', 20), fis: t('Felipe Morales', 20, 4), qui: t('Camila Silva', 20),
    edf: t('Javier Contreras', 30), art: t('Isidora Reyes', 12), tec: t('Tomás Herrera', 12),
    mus: t('Constanza Pizarro', 8),
  };
  // La profesora de Química trabaja los lunes en otro colegio.
  T.qui.unavailable = classPeriods.map((p) => slotKey(0, p.id));
  pr.teachers = Object.values(T);

  const C: Course[] = ['1° Medio A', '1° Medio B', '2° Medio A', '2° Medio B'].map((name) =>
    ({ id: newId(), name, level: name.slice(0, 8), divisions: [] }));
  // 2° Medio A separa Inglés por nivel: dos grupos con clases a la misma hora.
  const basico = { id: newId(), name: 'Básico' }, avanzado = { id: newId(), name: 'Avanzado' };
  C[2].divisions = [{ id: newId(), name: 'Inglés por nivel', groups: [basico, avanzado], parallel: true }];
  pr.courses = C;

  const as: Assignment[] = [];
  const add = (c: Course, s: Subject, teacher: Teacher, blocks: number[], groupId: string | null = null) =>
    as.push({ id: newId(), courseId: c.id, groupId, subjectId: s.id, teacherId: teacher.id, blocks });
  C.forEach((c, i) => {
    const first = i < 2;
    add(c, S.len, first ? T.len1 : T.len2, [2, 2, 2]);
    add(c, S.mat, first ? T.mat1 : T.mat2, [2, 2, 2, 1]);
    if (i === 2) {
      add(c, S.ing, T.ing, [2, 2], basico.id);
      add(c, S.ing, T.ing2, [2, 2], avanzado.id);
    } else add(c, S.ing, T.ing, [2, 2]);
    add(c, S.his, T.his, [2, 2]);
    add(c, S.bio, T.bio, [2]);
    add(c, S.fis, T.fis, [2]);
    add(c, S.qui, T.qui, [2]);
    add(c, S.edf, T.edf, [2, 2]);
    if (first) {
      add(c, S.art, T.art, [2]);
      add(c, S.tec, T.tec, [2]);
    }
    // Orientación la hace el profesor jefe.
    add(c, S.ori, [T.len1, T.mat1, T.len2, T.mat2][i], [1]);
  });
  pr.assignments = as;

  // 2° Medio A y B juntan a sus alumnos en un electivo artístico: cada alumno elige una opción y todas van a la misma hora.
  pr.electives = [{
    id: newId(), name: 'Electivo artístico', courseIds: [C[2].id, C[3].id], blocks: [2, 2],
    options: [
      { id: newId(), subjectId: S.art.id, teacherId: T.art.id },
      { id: newId(), subjectId: S.tec.id, teacherId: T.tec.id },
      { id: newId(), subjectId: S.mus.id, teacherId: T.mus.id },
    ],
  }];

  // Educación Física no después del almuerzo.
  pr.rules.subjectWindows = [{
    id: newId(), subjectId: S.edf.id, strength: 'obligatoria',
    periodIds: classPeriods.slice(0, 6).map((p) => p.id),
  }];
  pr.rules.teacherMaxGapsPerDay = 2;
  return pr;
}
