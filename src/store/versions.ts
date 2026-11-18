// Guarda el historial de versiones en IndexedDB, aparte de los horarios: no se sincroniza con la cuenta ni entra en los
// respaldos, y si se pierde, los horarios siguen intactos.
import { get, set } from 'idb-keyval';
import type { Project } from '../domain/types';
import { newId } from '../domain/types';
import { addVersion, needsAutosave, versionsOf, type Version } from '../domain/versions';
import { STORE_KEY, useProjects } from './projects';
import { useHealth } from './health';

const KEY = `${STORE_KEY}:versiones`;
let cache: Version[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Version[]> {
  if (!cache) {
    try { cache = (await get<Version[]>(KEY)) ?? []; } catch { cache = []; }
  }
  return cache;
}

/** Guarda una copia del horario. Los errores no se informan: el historial es una ayuda, no la copia principal. */
export function saveVersion(project: Project, reason: string): Promise<void> {
  const next = queue.then(async () => {
    if (useHealth.getState().readFailed) return;
    cache = addVersion(await load(), { id: newId(), projectId: project.id, at: new Date().toISOString(), reason, project });
    await set(KEY, cache);
  }).catch(() => undefined);
  queue = next;
  return next;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  await queue;
  return versionsOf(await load(), projectId);
}

/**
 * Al editar un horario, guarda cómo estaba antes del cambio si la última copia tiene más de 30 minutos. Así siempre hay
 * una versión de "esta mañana" aunque se haya editado mucho después.
 */
const pending = new Set<string>();

export function startAutoVersions() {
  useProjects.subscribe((s, prev) => {
    if (!s.hydrated || !prev.hydrated || s.projects === prev.projects) return;
    for (const [id, p] of Object.entries(s.projects)) {
      const before = prev.projects[id];
      if (!before || before === p) continue;
      // Se marca antes de esperar la lectura: dos cambios seguidos no deben guardar dos copias.
      if (pending.has(id)) continue;
      pending.add(id);
      void load().then((list) => { if (needsAutosave(list, id, Date.now())) return saveVersion(before, 'Antes de un cambio'); })
        .finally(() => pending.delete(id));
    }
  });
}
