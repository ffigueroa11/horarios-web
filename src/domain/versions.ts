// Historial automático de versiones de cada horario (F6): copias locales para volver atrás más allá de deshacer, que
// solo vale mientras la pestaña está abierta. Aquí, las reglas puras; el almacenamiento está en store/versions.ts.
import type { Id, Project } from './types';

export interface Version {
  id: Id;
  projectId: Id;
  /** Cuándo se guardó (ISO). */
  at: string;
  /** Por qué: "Horario generado", "Antes de un cambio". */
  reason: string;
  project: Project;
}

/** Copias que se conservan por horario y en total. Un colegio grande ocupa ~100 KB por copia. */
export const PER_PROJECT = 15;
export const TOTAL = 120;
/** Al editar, una copia automática como máximo cada 30 minutos por horario. */
export const AUTOSAVE_GAP_MS = 30 * 60 * 1000;

/** Agrega una copia y descarta las más antiguas que pasen los límites (por horario y en total). */
export function addVersion(list: Version[], v: Version, perProject = PER_PROJECT, total = TOTAL): Version[] {
  const all = [...list, v].sort((a, b) => b.at.localeCompare(a.at));
  const count = new Map<Id, number>();
  const kept = all.filter((x) => {
    const n = (count.get(x.projectId) ?? 0) + 1;
    count.set(x.projectId, n);
    return n <= perProject;
  });
  return kept.slice(0, total);
}

/** ¿Corresponde una copia automática de este horario? No si la última es de hace menos de `gap`. */
export function needsAutosave(list: Version[], projectId: Id, now: number, gap = AUTOSAVE_GAP_MS): boolean {
  const last = list.filter((x) => x.projectId === projectId).reduce((m, x) => (x.at > m ? x.at : m), '');
  return !last || now - Date.parse(last) >= gap;
}

/** Copias de un horario, de la más reciente a la más antigua. */
export const versionsOf = (list: Version[], projectId: Id) =>
  list.filter((x) => x.projectId === projectId).sort((a, b) => b.at.localeCompare(a.at));
