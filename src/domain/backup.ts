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

/** Revisa la forma de un proyecto y completa lo que falte de versiones anteriores. */
export function checkProject(x: unknown): Project {
  if (!isObj(x)) throw new BackupError('no contiene un horario');
  if (!isObj(x.school)) throw new BackupError('falta la jornada');
  const school = x.school;
  if (!arr(school.days, 'días').every(isStr)) throw new BackupError('los días de la jornada no son válidos');
  for (const per of withIds(school.periods, 'bloques de la jornada'))
    if (!['clase', 'recreo', 'almuerzo'].includes(per.kind as string) || !isStr(per.start) || !isStr(per.end))
      throw new BackupError('un bloque de la jornada no es válido');
  if (!Array.isArray(school.closed)) school.closed = [];
  for (const c of withIds(x.courses, 'cursos')) if (!isStr(c.name)) throw new BackupError('un curso no tiene nombre');
  for (const s of withIds(x.subjects, 'asignaturas')) if (!isStr(s.name)) throw new BackupError('una asignatura no tiene nombre');
  for (const t of withIds(x.teachers, 'profesores')) {
    if (!isStr(t.name)) throw new BackupError('un profesor no tiene nombre');
    if (!Array.isArray(t.unavailable)) t.unavailable = [];
  }
  withIds(x.rooms ?? [], 'salas');
  x.rooms ??= [];
  for (const a of withIds(x.assignments, 'carga académica')) {
    const blocks = arr(a.blocks, 'bloques de la carga');
    if (!blocks.every((b) => Number.isInteger(b) && (b as number) > 0)) throw new BackupError('la carga académica tiene bloques no válidos');
  }
  for (const e of withIds(x.electives ?? [], 'franjas de electivos')) {
    arr(e.courseIds, 'cursos de un electivo');
    withIds(e.options, 'opciones de un electivo');
    arr(e.blocks, 'bloques de un electivo');
  }
  if (!isObj(x.rules)) throw new BackupError('faltan las preferencias');
  x.rules.subjectWindows ??= [];
  if (!isObj(x.locks)) x.locks = {};
  if (x.timetable != null && (!isObj(x.timetable) || !Array.isArray(x.timetable.placements))) x.timetable = null;
  x.timetable ??= null;
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
