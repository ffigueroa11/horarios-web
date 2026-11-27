// Alternativas para cuando no hay horario: cambios de una sola regla que se evalúan con el motor, cada uno sobre una
// copia del proyecto. Este archivo es puro: define los cambios, cómo se aplican y describen, en qué orden probarlos y
// cómo leer el resultado. La ejecución (Worker, cancelar, tiempo) está en store/relax.ts.
//
// Reglas:
//  - Las variantes se arman sobre una copia (structuredClone) y nunca se guardan.
//  - Un cambio se aplica al proyecto real solo cuando el usuario lo confirma (applyChange dentro de update()).
//  - "sin resolver" (se agotó el tiempo) nunca se presenta como "no basta" (el motor concluyó que no hay horario).
import type { ActivityKey, Id, Project } from './types';
import { migrateProject } from './types';
import { exportFet, type FetExport } from './fetExport';
import { parseResult, type FetOutcome } from './fetResult';
import type { Diagnosis } from './diagnose';

/** Un cambio de una sola regla o dato. Es un dato cerrado: se puede describir, comparar y aplicar sin funciones. */
export type Change =
  | { kind: 'spread-preferible' }
  | { kind: 'window-preferible'; windowId: Id }
  | { kind: 'teacher-max-days'; teacherId: Id; value: number | null }
  | { kind: 'teacher-available'; teacherId: Id }
  | { kind: 'teacher-max-hours-daily'; value: number | null }
  | { kind: 'course-max-hours-daily'; value: number | null }
  | { kind: 'teacher-gaps-day'; value: number | null }
  | { kind: 'teacher-gaps-week'; value: number | null }
  | { kind: 'courses-no-gaps-off' }
  | { kind: 'courses-start-first-off' }
  | { kind: 'meeting-off' }
  | { kind: 'release-locks'; keys: ActivityKey[]; scope: string };

export function changeId(c: Change): string {
  switch (c.kind) {
    case 'window-preferible': return `${c.kind}:${c.windowId}`;
    case 'teacher-max-days': return `${c.kind}:${c.teacherId}:${c.value ?? '-'}`;
    case 'teacher-available': return `${c.kind}:${c.teacherId}`;
    case 'teacher-max-hours-daily': case 'course-max-hours-daily': case 'teacher-gaps-day': case 'teacher-gaps-week':
      return `${c.kind}:${c.value ?? '-'}`;
    case 'release-locks': return `${c.kind}:${[...c.keys].sort().join(',')}`;
    default: return c.kind;
  }
}

/** ¿El cambio sigue teniendo sentido con estos datos (existe lo que toca y de verdad cambia algo)? */
export function isApplicable(p: Project, c: Change): boolean {
  const r = p.rules;
  const teacher = 'teacherId' in c ? p.teachers.find((t) => t.id === c.teacherId) : undefined;
  switch (c.kind) {
    case 'spread-preferible': return r.spreadSubjectDays && r.spreadStrength === 'obligatoria';
    case 'window-preferible': return r.subjectWindows.some((w) => w.id === c.windowId && w.strength === 'obligatoria');
    case 'teacher-max-days': return !!teacher && teacher.maxDays != null && (c.value == null || c.value > teacher.maxDays);
    case 'teacher-available': return !!teacher && teacher.unavailable.length > 0;
    case 'teacher-max-hours-daily': return r.teacherMaxHoursDaily != null && (c.value == null || c.value > r.teacherMaxHoursDaily);
    case 'course-max-hours-daily': return r.courseMaxHoursDaily != null && (c.value == null || c.value > r.courseMaxHoursDaily);
    case 'teacher-gaps-day': return r.teacherMaxGapsPerDay != null && (c.value == null || c.value > r.teacherMaxGapsPerDay);
    case 'teacher-gaps-week': return r.teacherMaxGapsPerWeek != null && (c.value == null || c.value > r.teacherMaxGapsPerWeek);
    case 'courses-no-gaps-off': return r.coursesNoGaps;
    case 'courses-start-first-off': return r.coursesStartFirstBlock;
    case 'meeting-off': return r.teacherMeetingSlots.length > 0;
    case 'release-locks': return c.keys.some((k) => k in p.locks);
  }
}

/** Aplica el cambio sobre `d`, que debe ser una copia (un borrador de update() o el de variantProject). */
export function applyChange(d: Project, c: Change): void {
  const r = d.rules;
  const teacher = 'teacherId' in c ? d.teachers.find((t) => t.id === c.teacherId) : undefined;
  switch (c.kind) {
    case 'spread-preferible': r.spreadStrength = 'preferible'; break;
    case 'window-preferible': for (const w of r.subjectWindows) if (w.id === c.windowId) w.strength = 'preferible'; break;
    case 'teacher-max-days': if (teacher) teacher.maxDays = c.value; break;
    case 'teacher-available': if (teacher) teacher.unavailable = []; break;
    case 'teacher-max-hours-daily': r.teacherMaxHoursDaily = c.value; break;
    case 'course-max-hours-daily': r.courseMaxHoursDaily = c.value; break;
    case 'teacher-gaps-day': r.teacherMaxGapsPerDay = c.value; break;
    case 'teacher-gaps-week': r.teacherMaxGapsPerWeek = c.value; break;
    case 'courses-no-gaps-off': r.coursesNoGaps = false; break;
    case 'courses-start-first-off': r.coursesStartFirstBlock = false; break;
    case 'meeting-off': r.teacherMeetingSlots = []; break;
    case 'release-locks': for (const k of c.keys) delete d.locks[k]; break;
  }
}

/** Liberar fijados no cambia los datos del colegio: igual que en la pantalla de generación, no marca el horario como desactualizado. */
export const changeTouches = (c: Change) => c.kind !== 'release-locks';

/** Lo que verá el usuario en la lista y en la confirmación. Sin términos de FET. */
export function describeChange(p: Project, c: Change): { title: string; effect: string } {
  const teacher = 'teacherId' in c ? p.teachers.find((t) => t.id === c.teacherId) : undefined;
  const tn = teacher?.name ?? 'el profesor';
  const limit = (v: number | null, unit: string) => (v == null ? 'sin límite' : `${v} ${unit}`);
  switch (c.kind) {
    case 'spread-preferible':
      return { title: 'Dejar como preferible "repartir cada asignatura en días distintos"', effect: 'Algunas asignaturas podrían quedar dos veces el mismo día.' };
    case 'window-preferible': {
      const w = p.rules.subjectWindows.find((x) => x.id === c.windowId);
      const s = p.subjects.find((x) => x.id === w?.subjectId)?.name ?? 'la asignatura';
      return { title: `Dejar como preferibles los bloques permitidos de ${s}`, effect: `${s} podría ir fuera de los bloques elegidos.` };
    }
    case 'teacher-max-days':
      return { title: `Permitir que ${tn} venga ${c.value == null ? 'todos los días' : `${c.value} días`}`, effect: `Hoy puede venir ${teacher?.maxDays ?? '—'} días. Hay que confirmarlo con ${tn}.` };
    case 'teacher-available':
      return { title: `Suponer que ${tn} está disponible en todos los bloques`, effect: `Se borran sus ${teacher?.unavailable.length ?? 0} bloques no disponibles. Sirve para saber si su disponibilidad es la causa; confírmalo con ${tn} antes de aplicarlo.` };
    case 'teacher-max-hours-daily':
      return { title: `Subir el máximo de horas diarias de los profesores a ${limit(c.value, 'horas')}`, effect: `Hoy es ${p.rules.teacherMaxHoursDaily ?? 'sin límite'}. Afecta a todos los profesores.` };
    case 'course-max-hours-daily':
      return { title: `Subir el máximo de horas diarias de los cursos a ${limit(c.value, 'horas')}`, effect: `Hoy es ${p.rules.courseMaxHoursDaily ?? 'sin límite'}. Afecta a todos los cursos.` };
    case 'teacher-gaps-day':
      return { title: `Subir el máximo de ventanas por día a ${limit(c.value, '')}`.trim(), effect: `Hoy es ${p.rules.teacherMaxGapsPerDay}. Algunos profesores podrían tener más horas libres entre clases.` };
    case 'teacher-gaps-week':
      return { title: `Subir el máximo de ventanas por semana a ${limit(c.value, '')}`.trim(), effect: `Hoy es ${p.rules.teacherMaxGapsPerWeek}. Algunos profesores podrían tener más horas libres entre clases.` };
    case 'courses-no-gaps-off':
      return { title: 'Permitir horas libres entre clases de los cursos', effect: 'Algunos cursos podrían tener un bloque libre en medio del día.' };
    case 'courses-start-first-off':
      return { title: 'No exigir que los cursos empiecen en el primer bloque', effect: 'Algunos cursos podrían entrar más tarde algún día.' };
    case 'meeting-off':
      return { title: 'Quitar los bloques reservados para el consejo de profesores', effect: 'El consejo tendría que ir en otro momento.' };
    case 'release-locks':
      return { title: `Liberar ${c.keys.length === 1 ? 'el bloque fijado' : `${c.keys.length} bloques fijados`} ${c.scope}`.trim(), effect: 'Esos bloques se podrán mover al generar. No se borran clases.' };
  }
}

/**
 * Orden de prueba, del cambio más pequeño al más grande: primero lo que señalan los hallazgos demostrados y los
 * relacionados con los bloques pendientes; después pasar a preferible lo que lo admite; luego liberar fijados cercanos
 * y aflojar reglas globales; al final, liberar todos los fijados.
 */
export function relaxPlan(p: Project, dx: Diagnosis | null, max = 10): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();
  const push = (c: Change) => {
    const id = changeId(c);
    if (seen.has(id) || !isApplicable(p, c)) return;
    seen.add(id);
    out.push(c);
  };
  const findings = dx?.findings ?? [];
  for (const f of findings) if (f.certainty === 'demostrado') f.changes.forEach(push);
  for (const f of findings) if (f.certainty === 'hipotesis' && f.related && f.kind !== 'reglas') f.changes.forEach(push);
  push({ kind: 'spread-preferible' });
  for (const w of p.rules.subjectWindows) push({ kind: 'window-preferible', windowId: w.id });
  for (const f of findings) if (f.kind === 'fijados' && f.certainty === 'hipotesis' && f.related) f.changes.forEach(push);
  const r = p.rules;
  if (r.teacherMaxGapsPerDay != null) push({ kind: 'teacher-gaps-day', value: r.teacherMaxGapsPerDay + 1 });
  if (r.teacherMaxGapsPerWeek != null) push({ kind: 'teacher-gaps-week', value: r.teacherMaxGapsPerWeek + 2 });
  if (r.teacherMaxHoursDaily != null) push({ kind: 'teacher-max-hours-daily', value: r.teacherMaxHoursDaily + 1 });
  if (r.courseMaxHoursDaily != null) push({ kind: 'course-max-hours-daily', value: r.courseMaxHoursDaily + 1 });
  push({ kind: 'courses-start-first-off' });
  push({ kind: 'courses-no-gaps-off' });
  for (const f of findings) if (f.certainty === 'hipotesis') f.changes.forEach(push);
  push({ kind: 'meeting-off' });
  const allLocks = Object.keys(p.locks);
  if (allLocks.length) push({ kind: 'release-locks', keys: allLocks, scope: 'todos' });
  return out.slice(0, max);
}

/** Copia independiente del proyecto con el cambio aplicado (null = sin cambios, para comparar con la misma semilla). */
export function variantProject(p: Project, c: Change | null): Project {
  const d = structuredClone(p);
  if (c) applyChange(d, c);
  d.timetable = null; // el motor no lo usa, y la variante no debe parecer un horario guardado
  return migrateProject(d);
}

/** Resultado de una variante. "sin-resolver" = se agotó el tiempo: no dice nada sobre si el cambio basta. */
export type VariantStatus = 'funciona' | 'no-basta' | 'sin-resolver' | 'rechazada' | 'fallo' | 'cancelada';

export function classify(o: FetOutcome): VariantStatus {
  switch (o.kind) {
    case 'ok': return 'funciona';
    case 'impossible': return 'no-basta';
    case 'timeout': return 'sin-resolver';
    case 'invalid': return 'rechazada';
  }
}

export interface EngineFiles { files: Record<string, string>; lines: string[] }

/** Cómo se ejecuta el motor: en el navegador, un Worker (runFet); en las pruebas, el motor en Node. */
export type EngineRunner = (xml: string, seconds: number, seed: number) => { promise: Promise<EngineFiles>; cancel: () => void };

export interface VariantRun {
  status: VariantStatus;
  /** Lo más que se ubicó (si el motor lo informa) y el total de bloques. */
  placedMax: number | null;
  total: number;
  seconds: number;
}

/** Lee la salida del motor para una exportación: el mismo camino que la generación normal. */
export function readOutcome(run: EngineFiles, ex: FetExport): FetOutcome {
  const file = (end: string) => Object.entries(run.files).find(([k]) => k.endsWith(end))?.[1];
  return parseResult(file('logs/result.txt') ?? '', ex, run.lines, file('logs/errors.txt'), file('logs/difficult_activities.txt'));
}

/** Ejecuta una variante. Devuelve también `cancel`, que termina el motor y hace fallar la promesa con AbortError. */
export function runVariant(p: Project, c: Change | null, runner: EngineRunner, seconds: number, seed: number) {
  const ex = exportFet(variantProject(p, c));
  const started = Date.now();
  const h = runner(ex.xml, seconds, seed);
  const promise = h.promise.then((run): VariantRun => {
    const o = readOutcome(run, ex);
    return { status: classify(o), placedMax: o.kind === 'ok' ? ex.activityById.size : 'placedMax' in o ? o.placedMax : null, total: ex.activityById.size, seconds: (Date.now() - started) / 1000 };
  });
  return { promise, cancel: h.cancel };
}
