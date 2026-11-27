// Proyectos de prueba para el diagnóstico y las alternativas. No forma parte de la app: tsconfig.app lo excluye.
import { exampleProject } from './defaults';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackup } from './backup';
import { newId, slotKey, type Project } from './types';

export const classPeriods = (p: Project) => p.school.periods.filter((x) => x.kind === 'clase');
export const teacherNamed = (p: Project, name: string) => p.teachers.find((t) => t.name === name)!;

/**
 * El electivo artístico de 2° Medio con profesores que nunca coinciden libres: Música no puede de lunes a miércoles y
 * Artes no puede jueves ni viernes. La revisión previa no lo detecta y el motor solo agota el tiempo.
 */
export function electiveWithoutCommonTime(): Project {
  const p = exampleProject();
  const cls = classPeriods(p);
  teacherNamed(p, 'Constanza Pizarro').unavailable = [0, 1, 2].flatMap((d) => cls.map((x) => slotKey(d, x.id)));
  teacherNamed(p, 'Isidora Reyes').unavailable = [3, 4].flatMap((d) => cls.map((x) => slotKey(d, x.id)));
  return p;
}

/** Colegio grande sintético (24 cursos con 6 copias), armado copiando el liceo de ejemplo. */
export function largeSchool(copies = 6): Project {
  const base = exampleProject();
  const p = structuredClone(base);
  p.courses = []; p.teachers = []; p.assignments = []; p.electives = [];
  for (const s of p.subjects) s.roomId = null; // un laboratorio no alcanza para 24 cursos
  for (let k = 0; k < copies; k++) {
    const tMap = new Map(base.teachers.map((t) => [t.id, { ...structuredClone(t), id: newId(), name: `${t.name} ${k + 1}` }]));
    const cMap = new Map(base.courses.map((c) => [c.id, { ...structuredClone(c), id: newId(), name: `${c.name} ${k + 1}` }]));
    p.teachers.push(...tMap.values());
    p.courses.push(...cMap.values());
    for (const a of base.assignments) {
      const c = cMap.get(a.courseId)!;
      const groupId = a.groupId ? c.divisions[0].groups[base.courses.find((x) => x.id === a.courseId)!.divisions[0].groups.findIndex((g) => g.id === a.groupId)].id : null;
      p.assignments.push({ ...a, id: newId(), courseId: c.id, teacherId: a.teacherId ? tMap.get(a.teacherId)!.id : null, groupId });
    }
    for (const e of base.electives)
      p.electives.push({ ...structuredClone(e), id: newId(), courseIds: e.courseIds.map((id) => cMap.get(id)!.id),
        options: e.options.map((o) => ({ ...o, id: newId(), teacherId: o.teacherId ? tMap.get(o.teacherId)!.id : null })) });
  }
  return p;
}

export const reference = (name: 'generada' | 'dificil'): Project =>
  parseBackup(readFileSync(resolve(__dirname, `fixtures/referencia-${name}.json`), 'utf8'))[0];
