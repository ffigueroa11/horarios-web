// Respaldo de un horario en un archivo .json y lectura con validación (el archivo puede venir editado,
// truncado o ser de otra aplicación: mejor un mensaje claro que un proyecto que rompe la app).
import type { Project } from './types';
import { migrateProject } from './types';

export const BACKUP_APP = 'horarios-web';
export const BACKUP_VERSION = 2;

export function makeBackup(projects: Project[]): string {
  return JSON.stringify(
    projects.length === 1
      ? { app: BACKUP_APP, version: BACKUP_VERSION, project: projects[0] }
      : { app: BACKUP_APP, version: BACKUP_VERSION, projects },
    null, 1);
}

export class BackupError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const arr = (x: unknown, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new BackupError(`falta la lista de ${what}`);
  return x;
};
const withIds = (x: unknown, what: string) => {
  const list = arr(x, what);
  for (const it of list) if (!isObj(it) || !isStr(it.id)) throw new BackupError(`hay ${what} sin identificador`);
  return list as Record<string, unknown>[];
};
const isIdOrNone = (x: unknown) => x == null || isStr(x);
const isBlocks = (x: unknown) => Array.isArray(x) && x.every((b) => Number.isInteger(b) && (b as number) > 0);
/** Lista de textos: puede faltar (versiones anteriores), pero si está debe ser válida. */
const texts = (x: unknown, message: string) => {
  if (x != null && !(Array.isArray(x) && x.every(isStr))) throw new BackupError(message);
};
const isPlacement = (x: unknown) => isObj(x) && isStr(x.key) && Number.isInteger(x.day) && isStr(x.periodId) && isIdOrNone(x.roomId);

/** Revisa la forma de un proyecto y completa lo que falte de versiones anteriores. */
export function checkProject(x: unknown): Project {
  if (!isObj(x)) throw new BackupError('no contiene un horario');
  if (!isObj(x.school)) throw new BackupError('falta la jornada');
  const school = x.school;
  if (!arr(school.days, 'días').every(isStr)) throw new BackupError('los días de la jornada no son válidos');
  for (const per of withIds(school.periods, 'bloques de la jornada')) {
    if (!['clase', 'recreo', 'almuerzo'].includes(per.kind as string) || !isStr(per.start) || !isStr(per.end))
      throw new BackupError('un bloque de la jornada no es válido');
    if (!isStr(per.label)) per.label = '';
  }
  if (!Array.isArray(school.closed)) school.closed = [];
  texts(school.closed, 'los tramos sin clases no son válidos');
  for (const c of withIds(x.courses, 'cursos')) {
    if (!isStr(c.name)) throw new BackupError('un curso no tiene nombre');
    if (!isStr(c.level)) c.level = c.name;
    for (const d of withIds(c.divisions ?? [], 'divisiones de un curso')) {
      if (!isStr(d.name)) throw new BackupError('una división no tiene nombre');
      for (const g of withIds(d.groups, 'grupos de una división')) if (!isStr(g.name)) throw new BackupError('un grupo no tiene nombre');
    }
  }
  for (const s of withIds(x.subjects, 'asignaturas')) {
    if (!isStr(s.name)) throw new BackupError('una asignatura no tiene nombre');
    if (!isStr(s.short)) s.short = '';
    if (!isStr(s.color)) s.color = '#777777';
    if (!isIdOrNone(s.roomId)) throw new BackupError('una asignatura tiene una sala no válida');
  }
  for (const t of withIds(x.teachers, 'profesores')) {
    if (!isStr(t.name)) throw new BackupError('un profesor no tiene nombre');
    if (!Array.isArray(t.unavailable)) t.unavailable = [];
    texts(t.unavailable, 'la disponibilidad de un profesor no es válida');
  }
  for (const r of withIds(x.rooms ?? [], 'salas')) if (!isStr(r.name)) throw new BackupError('una sala no tiene nombre');
  x.rooms ??= [];
  for (const a of withIds(x.assignments, 'carga académica')) {
    arr(a.blocks, 'bloques de la carga');
    if (!isBlocks(a.blocks)) throw new BackupError('la carga académica tiene bloques no válidos');
    if (!isStr(a.courseId) || !isStr(a.subjectId) || !isIdOrNone(a.teacherId) || !isIdOrNone(a.groupId))
      throw new BackupError('una fila de la carga académica no es válida');
  }
  for (const e of withIds(x.electives ?? [], 'franjas de electivos')) {
    texts(arr(e.courseIds, 'cursos de un electivo'), 'los cursos de un electivo no son válidos');
    for (const o of withIds(e.options, 'opciones de un electivo'))
      if (!isStr(o.subjectId) || !isIdOrNone(o.teacherId)) throw new BackupError('una opción de un electivo no es válida');
    arr(e.blocks, 'bloques de un electivo');
    if (!isBlocks(e.blocks)) throw new BackupError('un electivo tiene bloques no válidos');
  }
  if (!isObj(x.rules)) throw new BackupError('faltan las preferencias');
  x.rules.subjectWindows ??= [];
  for (const w of withIds(x.rules.subjectWindows, 'reglas de bloques permitidos')) {
    if (!isStr(w.subjectId)) throw new BackupError('una regla de bloques permitidos no es válida');
    texts(arr(w.periodIds, 'bloques de una regla'), 'una regla de bloques permitidos no es válida');
  }
  texts(x.rules.teacherMeetingSlots, 'el consejo de profesores no es válido');
  if (!isObj(x.locks)) x.locks = {};
  for (const lock of Object.values(x.locks as object) as unknown[])
    if (!isObj(lock) || !Number.isInteger(lock.day) || !isStr(lock.periodId)) throw new BackupError('un bloque fijado no es válido');
  if (x.timetable != null && (!isObj(x.timetable) || !Array.isArray(x.timetable.placements) || !x.timetable.placements.every(isPlacement))) x.timetable = null;
  x.timetable ??= null;
  // El informe de una importación anterior es prescindible.
  if (x.importReport != null && !(isObj(x.importReport) && Array.isArray(x.importReport.kept) && Array.isArray(x.importReport.lost))) delete x.importReport;
  if (!isStr(x.name)) x.name = 'Horario importado';
  if (!Number.isInteger(x.year)) x.year = new Date().getFullYear();
  if (!isStr(x.updatedAt)) x.updatedAt = new Date().toISOString();
  return migrateProject(x as unknown as Project);
}

/** Lee un archivo de respaldo (uno o varios horarios). */
export function parseBackup(text: string): Project[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new BackupError('no es un archivo .json válido'); }
  if (isObj(data) && data.app != null && data.app !== BACKUP_APP) throw new BackupError('es de otra aplicación');
  if (isObj(data) && typeof data.version === 'number' && data.version > BACKUP_VERSION)
    throw new BackupError('fue creado con una versión más nueva de Horarios Web; recarga la página para actualizarla');
  const list = isObj(data) && Array.isArray(data.projects) ? data.projects : [isObj(data) && data.project ? data.project : data];
  if (list.length === 0) throw new BackupError('no contiene horarios');
  return list.map(checkProject);
}
