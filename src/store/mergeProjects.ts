import { newId, type Project } from '../domain/types';

interface Snapshot {
  version: number;
  state: { projects: Record<string, Project>; currentId: string | null };
}

/** Combina únicamente las ediciones hechas desde la última instantánea de esta pestaña. */
export function mergeProjects(base: string | null, local: string, stored?: string): string {
  if ((stored ?? null) === base || stored === local) return local;
  if (!stored) throw new Error('Se eliminaron los datos de este navegador en otra pestaña.');
  const disk: Snapshot = JSON.parse(stored);
  const next: Snapshot = JSON.parse(local);
  if (disk.version !== next.version) throw new Error('Cambió la versión del almacenamiento. Recarga después de respaldar.');
  const before: Snapshot | null = base ? JSON.parse(base) : null;
  const previous = before?.state.projects ?? {};
  const projects = disk.state.projects;
  for (const id of new Set([...Object.keys(previous), ...Object.keys(next.state.projects)])) {
    const mine = next.state.projects[id];
    const original = JSON.stringify(previous[id]);
    const changed = JSON.stringify(mine);
    if (original === changed) continue;
    const other = projects[id];
    const current = JSON.stringify(other);
    if (current !== original && current !== changed) {
      // Si una pestaña elimina mientras otra edita, la edición sobrevive como copia.
      const edited = other ?? mine;
      const copy = { ...edited, id: newId(), name: `${edited.name} (copia de otra pestaña)` };
      projects[copy.id] = copy;
      if (!other) continue;
    }
    if (mine) projects[id] = mine;
    else delete projects[id];
  }
  const selected = next.state.currentId;
  disk.state.currentId = selected && projects[selected] ? selected : null;
  return JSON.stringify(disk);
}
