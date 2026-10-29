// Importar la carga académica desde una planilla (Excel, CSV o texto pegado desde Excel).
// Columnas: Curso | Asignatura | Profesor | Horas o bloques | Grupo (opcional).
import type { Project } from './types';
import { newId } from './types';
import { SUBJECT_COLORS } from './defaults';
import { longestRun, parseBlocks } from './validate';

export type Cell = string | number | boolean | null | undefined;

export interface PlannedRow {
  line: number; // fila en la planilla (1 = primera)
  course: string;
  subject: string;
  teacher: string;
  group: string;
  blocks: number[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  errors: { line: number; message: string }[];
  newCourses: string[];
  newSubjects: string[];
  newTeachers: string[];
}

/** Normaliza para comparar nombres: sin tildes, mayúsculas, espacios dobles ni variantes de "°". */
export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[º°ª]/g, '°').replace(/\s+/g, ' ').trim().toLowerCase();

const HEADERS: Record<string, keyof Omit<PlannedRow, 'line' | 'blocks'> | 'blocks'> = {
  curso: 'course', cursos: 'course', nivel: 'course',
  asignatura: 'subject', asignaturas: 'subject', ramo: 'subject', materia: 'subject',
  profesor: 'teacher', profesora: 'teacher', 'profesor(a)': 'teacher', docente: 'teacher', profesores: 'teacher',
  horas: 'blocks', bloques: 'blocks', 'horas semanales': 'blocks', 'hrs': 'blocks', 'horas/bloques': 'blocks',
  grupo: 'group', 'grupo o nivel': 'group',
};

/** Texto pegado desde Excel (separado por tabulaciones) o CSV con "," o ";". */
export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sample = lines[0];
  const sep = sample.includes('\t') ? '\t' : (sample.split(';').length >= sample.split(',').length ? ';' : ',');
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
}

/**
 * "2+2+2" → [2,2,2]. Un número solo se interpreta como horas semanales y se reparte en bloques de 2
 * (o del tramo más largo sin recreo, si es menor): 7 → 2+2+2+1.
 */
export function blocksFromCell(value: Cell, maxRun: number): number[] | null {
  const text = String(value ?? '').toLowerCase().replace(/horas?|hrs?|h\b|bloques?/g, '').trim();
  if (/^\d+$/.test(text)) {
    let n = Number(text);
    if (n < 1 || n > 60) return null;
    const size = Math.max(1, Math.min(2, maxRun));
    const out: number[] = [];
    while (n > 0) { const b = Math.min(size, n); out.push(b); n -= b; }
    return out;
  }
  return parseBlocks(text);
}

export function planImport(p: Project, table: Cell[][]): ImportPlan {
  const plan: ImportPlan = { rows: [], errors: [], newCourses: [], newSubjects: [], newTeachers: [] };
  const rows = table.map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
  while (rows.length && rows[0].every((c) => c === '')) rows.shift();
  if (rows.length === 0) { plan.errors.push({ line: 0, message: 'La planilla está vacía.' }); return plan; }

  // ¿La primera fila es un encabezado? Si no, se asume el orden Curso, Asignatura, Profesor, Horas, Grupo.
  let cols: Record<string, number> = { course: 0, subject: 1, teacher: 2, blocks: 3, group: 4 };
  let first = 0;
  const header = rows[0].map((h) => HEADERS[norm(h)]);
  if (header.filter(Boolean).length >= 2) {
    cols = {};
    header.forEach((k, i) => { if (k && cols[k] == null) cols[k] = i; });
    first = 1;
    for (const need of ['course', 'subject', 'blocks'] as const)
      if (cols[need] == null) plan.errors.push({ line: 1, message: `Falta la columna ${{ course: 'Curso', subject: 'Asignatura', blocks: 'Horas' }[need]}.` });
    if (plan.errors.length) return plan;
  }

  const maxRun = Math.max(1, longestRun(p));
  const known = (list: { name: string }[]) => new Set(list.map((x) => norm(x.name)));
  const courses = known(p.courses), subjects = known(p.subjects), teachers = known(p.teachers);
  const addNew = (set: Set<string>, list: string[], name: string) => {
    if (name && !set.has(norm(name)) && !list.some((x) => norm(x) === norm(name))) list.push(name);
  };

  rows.slice(first).forEach((r, i) => {
    const line = first + i + 1 + (table.length - rows.length);
    const get = (k: string) => (cols[k] != null ? r[cols[k]] ?? '' : '');
    const course = get('course'), subject = get('subject'), teacher = get('teacher'), group = get('group');
    if ([course, subject, teacher, get('blocks')].every((x) => x === '')) return;
    if (!course) return plan.errors.push({ line, message: 'Falta el curso.' });
    if (!subject) return plan.errors.push({ line, message: 'Falta la asignatura.' });
    const blocks = blocksFromCell(get('blocks'), maxRun);
    if (!blocks) return plan.errors.push({ line, message: `No se entienden las horas "${get('blocks')}". Usa un número (6) o bloques (2+2+2).` });
    if (group) {
      const c = p.courses.find((x) => norm(x.name) === norm(course));
      if (!c || !c.divisions.some((d) => d.groups.some((g) => norm(g.name) === norm(group))))
        return plan.errors.push({ line, message: `El curso ${course} no tiene un grupo "${group}". Créalo antes en Cursos › Divisiones.` });
    }
    addNew(courses, plan.newCourses, course);
    addNew(subjects, plan.newSubjects, subject);
    addNew(teachers, plan.newTeachers, teacher);
    plan.rows.push({ line, course, subject, teacher, group, blocks });
  });
  return plan;
}

/** Aplica la importación. Con `replace`, primero borra la carga actual de los cursos incluidos. */
export function applyImport(d: Project, plan: ImportPlan, replace: boolean) {
  const findBy = <T extends { name: string }>(list: T[], name: string) => list.find((x) => norm(x.name) === norm(name));
  for (const name of plan.newCourses) {
    const level = name.replace(/\s+[A-Z]$/i, '').trim();
    d.courses.push({ id: newId(), name, level: level || name, divisions: [] });
  }
  for (const name of plan.newSubjects)
    d.subjects.push({ id: newId(), name, short: name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase(), color: SUBJECT_COLORS[d.subjects.length % SUBJECT_COLORS.length], roomId: null });
  for (const name of plan.newTeachers)
    d.teachers.push({ id: newId(), name, maxHours: null, maxDays: null, unavailable: [] });

  if (replace) {
    const ids = new Set(plan.rows.map((r) => findBy(d.courses, r.course)!.id));
    const gone = new Set(d.assignments.filter((a) => ids.has(a.courseId)).map((a) => a.id));
    d.assignments = d.assignments.filter((a) => !gone.has(a.id));
    for (const k of Object.keys(d.locks)) if (gone.has(k.split('#')[0])) delete d.locks[k];
  }
  for (const r of plan.rows) {
    const c = findBy(d.courses, r.course)!;
    const groupId = r.group ? c.divisions.flatMap((x) => x.groups).find((g) => norm(g.name) === norm(r.group))?.id ?? null : null;
    d.assignments.push({
      id: newId(), courseId: c.id, groupId, subjectId: findBy(d.subjects, r.subject)!.id,
      teacherId: r.teacher ? findBy(d.teachers, r.teacher)?.id ?? null : null, blocks: r.blocks,
    });
  }
}

export const TEMPLATE_CSV =
  '﻿Curso;Asignatura;Profesor;Horas;Grupo\r\n' +
  '1° Medio A;Matemática;Valentina Soto;2+2+2+1;\r\n' +
  '1° Medio A;Lengua y Literatura;Carolina Muñoz;6;\r\n' +
  '2° Medio A;Inglés;Francisca Díaz;2+2;Básico\r\n';
