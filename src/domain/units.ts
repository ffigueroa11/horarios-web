// "Unidades de clase": la forma común de todo lo que hay que ubicar en el horario.
// Una fila de la carga académica es una unidad para un curso (o un grupo de él). Una opción de una
// franja de electivos es una unidad cuyos alumnos vienen de varios cursos. La exportación a FET, la
// revisión previa, las vistas y el ajuste manual trabajan sobre unidades, sin distinguir el origen.
import type { Course, CourseGroup, Division, Id, Project } from './types';

export interface Audience {
  courseId: Id;
  /** Grupo de una división del curso (real o de una franja de electivos); null = todo el curso. */
  groupId: Id | null;
}

export interface Unit {
  /** Id de la asignación, o `${franja}:${opción}` para electivos. Las claves de actividad son `${id}#${i}`. */
  id: string;
  kind: 'carga' | 'electivo';
  subjectId: Id;
  teacherId: Id | null;
  blocks: number[];
  audience: Audience[];
  /** Para electivos: la franja; sus opciones van a la misma hora. */
  electiveId?: Id;
}

export const electiveGroupId = (electiveId: Id, optionId: Id) => `${electiveId}:${optionId}`;

/** Divisiones del curso más una división por cada franja de electivos en que participa (un grupo por opción). */
export function effectiveDivisions(p: Project, c: Course): Division[] {
  const synthetic: Division[] = p.electives
    .filter((e) => e.courseIds.includes(c.id) && e.options.length > 0)
    .map((e) => ({
      id: e.id,
      name: e.name,
      parallel: true,
      groups: e.options.map((o) => ({ id: electiveGroupId(e.id, o.id), name: p.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Electivo' })),
    }));
  return [...c.divisions, ...synthetic];
}

/** Combinaciones de grupos (una por división, incluidas las franjas) = los distintos horarios de alumnos del curso. */
export function courseStudentSets(p: Project, c: Course): CourseGroup[][] {
  return effectiveDivisions(p, c).filter((d) => d.groups.length > 0)
    .reduce<CourseGroup[][]>((acc, d) => acc.flatMap((combo) => d.groups.map((g) => [...combo, g])), [[]]);
}

export function findEffectiveGroup(p: Project, c: Course | undefined, groupId: Id | null) {
  if (!c || !groupId) return null;
  for (const division of effectiveDivisions(p, c)) {
    const group = division.groups.find((g) => g.id === groupId);
    if (group) return { division, group };
  }
  return null;
}

export function units(p: Project): Unit[] {
  const out: Unit[] = p.assignments.map((a) => ({
    id: a.id, kind: 'carga', subjectId: a.subjectId, teacherId: a.teacherId, blocks: a.blocks,
    audience: [{ courseId: a.courseId, groupId: a.groupId }],
  }));
  for (const e of p.electives) {
    const courses = e.courseIds.filter((id) => p.courses.some((c) => c.id === id));
    if (courses.length === 0) continue;
    for (const o of e.options)
      out.push({
        id: electiveGroupId(e.id, o.id), kind: 'electivo', subjectId: o.subjectId, teacherId: o.teacherId, blocks: e.blocks,
        audience: courses.map((courseId) => ({ courseId, groupId: electiveGroupId(e.id, o.id) })), electiveId: e.id,
      });
  }
  return out;
}

export const unitById = (p: Project) => new Map(units(p).map((u) => [u.id, u]));
export const unitIdOf = (key: string) => key.split('#')[0];

/**
 * Unidades que deben ir a la misma hora, bloque por bloque:
 *  - divisiones "en paralelo" de un curso: la k-ésima asignatura de cada grupo (si tienen los mismos bloques);
 *  - franjas de electivos: todas sus opciones.
 */
export function parallelRows(p: Project): { unitIds: string[]; blocks: number }[] {
  const out: { unitIds: string[]; blocks: number }[] = [];
  for (const c of p.courses) for (const d of c.divisions) {
    if (!d.parallel || d.groups.length < 2) continue;
    const perGroup = d.groups.map((g) => p.assignments.filter((a) => a.courseId === c.id && a.groupId === g.id && a.blocks.length > 0));
    const n = Math.min(...perGroup.map((l) => l.length));
    for (let k = 0; k < n; k++) {
      const row = perGroup.map((l) => l[k]);
      if (row.every((a) => a.blocks.join('+') === row[0].blocks.join('+'))) out.push({ unitIds: row.map((a) => a.id), blocks: row[0].blocks.length });
    }
  }
  for (const e of p.electives)
    if (e.options.length >= 2 && e.blocks.length > 0 && e.courseIds.some((id) => p.courses.some((c) => c.id === id)))
      out.push({ unitIds: e.options.map((o) => electiveGroupId(e.id, o.id)), blocks: e.blocks.length });
  return out;
}
