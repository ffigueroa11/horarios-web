// Historial local: las transacciones de IndexedDB conservan las escrituras de distintas pestañas.
import { get, update } from 'idb-keyval';
import type { Project } from '../domain/types';
import { newId } from '../domain/types';
import { addVersion, needsAutosave, versionsOf, type Version } from '../domain/versions';
import { STORE_KEY, useProjects } from './projects';
import { useHealth } from './health';

const KEY = `${STORE_KEY}:versiones`;
let queue: Promise<unknown> = Promise.resolve();
let closed = false;

/** La comprobación del intervalo y la escritura se realizan en la misma transacción. */
export function saveVersion(project: Project, reason: string, automatic = false): Promise<void> {
  const next = queue.then(async () => {
    if (closed || useHealth.getState().readFailed) return;
    await update<Version[]>(KEY, (stored) => {
      const list = stored ?? [];
      const now = Date.now();
      if (automatic && !needsAutosave(list, project.id, now)) return list;
      return addVersion(list, { id: newId(), projectId: project.id, at: new Date(now).toISOString(), reason, project });
    });
  }).catch(() => undefined); // El historial es auxiliar: no impide guardar el proyecto principal.
  queue = next;
  return next;
}

export async function closeVersionWrites(): Promise<void> {
  closed = true;
  await queue;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  await queue;
  return versionsOf((await get<Version[]>(KEY)) ?? [], projectId);
}

/** Conserva el estado anterior, como máximo cada media hora por horario. */
const pending = new Set<string>();
export function startAutoVersions() {
  useProjects.subscribe((s, prev) => {
    if (!s.hydrated || !prev.hydrated || s.projects === prev.projects || closed) return;
    for (const [id, p] of Object.entries(s.projects)) {
      const before = prev.projects[id];
      if (!before || before === p || pending.has(id)) continue;
      pending.add(id);
      void saveVersion(before, 'Antes de un cambio', true).finally(() => pending.delete(id));
    }
  });
}
