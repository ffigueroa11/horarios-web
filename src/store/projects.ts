// Estado de la aplicación. Todo se guarda automáticamente en IndexedDB del navegador (local-first).
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import type { Id, Project } from '../domain/types';
import { migrateProject, newId } from '../domain/types';
import { emptyProject, exampleProject } from '../domain/defaults';
import { useHealth } from './health';

const STORE_KEY = 'horarios-web';
// Avisa a otras pestañas abiertas de la app que hay datos nuevos, para que los recarguen.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(STORE_KEY) : null;
const TAB_ID = newId();

const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await get<string>(name)) ?? null;
    } catch (e) {
      useHealth.getState().setStorageError(`No se pudieron leer los horarios guardados (${(e as Error).message || e}).`);
      return null;
    }
  },
  setItem: async (name, value) => {
    // Si no se pudo leer al iniciar, no se escribe: se sobrescribirían los datos guardados con un estado vacío.
    if (useHealth.getState().readFailed) return;
    try {
      await set(name, value);
      useHealth.getState().setSaveError(null);
      channel?.postMessage({ type: 'saved', from: TAB_ID });
    } catch (e) {
      const quota = (e as Error)?.name === 'QuotaExceededError';
      useHealth.getState().setSaveError(quota
        ? 'El navegador no tiene espacio para guardar. Libera espacio o elimina horarios que no uses, y descarga un respaldo.'
        : `No se pudo guardar el último cambio (${(e as Error)?.message || e}). Descarga un respaldo para no perder datos.`);
    }
  },
  removeItem: (name) => del(name),
};

interface State {
  projects: Record<Id, Project>;
  currentId: Id | null;
  hydrated: boolean;
  create: (kind: 'vacio' | 'ejemplo') => Id;
  duplicate: (id: Id) => Id;
  remove: (id: Id) => void;
  /** Agrega horarios desde un respaldo (con ids nuevos para no pisar los existentes). Devuelve el id del primero. */
  importProjects: (list: Project[]) => Id | null;
  select: (id: Id | null) => void;
  markBackup: (ids: Id[]) => void;
  /** Modifica el proyecto actual sobre una copia; cualquier cambio de datos marca el horario como desactualizado. */
  update: (recipe: (p: Project) => void, opts?: { touch?: boolean }) => void;
}

export const useProjects = create<State>()(
  persist(
    (setState, getState) => ({
      projects: {},
      currentId: null,
      hydrated: false,
      create: (kind) => {
        const p = kind === 'ejemplo' ? exampleProject() : emptyProject();
        setState((s) => ({ projects: { ...s.projects, [p.id]: p }, currentId: p.id }));
        return p.id;
      },
      duplicate: (id) => {
        const src = getState().projects[id];
        const p: Project = { ...structuredClone(src), id: newId(), name: `${src.name} (copia)`, updatedAt: new Date().toISOString(), backupAt: undefined };
        setState((s) => ({ projects: { ...s.projects, [p.id]: p }, currentId: p.id }));
        return p.id;
      },
      remove: (id) =>
        setState((s) => {
          const { [id]: _gone, ...rest } = s.projects;
          return { projects: rest, currentId: s.currentId === id ? null : s.currentId };
        }),
      importProjects: (list) => {
        const now = new Date().toISOString();
        const added = list.map((src) => migrateProject({ ...structuredClone(src), id: newId(), updatedAt: now, backupAt: now }));
        if (added.length === 0) return null;
        setState((s) => ({ projects: { ...s.projects, ...Object.fromEntries(added.map((p) => [p.id, p])) }, currentId: added[0].id }));
        return added[0].id;
      },
      select: (id) => setState({ currentId: id }),
      markBackup: (ids) => {
        const now = new Date().toISOString();
        setState((s) => ({ projects: { ...s.projects, ...Object.fromEntries(ids.filter((id) => s.projects[id]).map((id) => [id, { ...s.projects[id], backupAt: now }])) } }));
      },
      update: (recipe, opts) => {
        const { currentId, projects } = getState();
        if (!currentId || !projects[currentId]) return;
        const draft = structuredClone(projects[currentId]);
        recipe(draft);
        migrateProject(draft);
        // Guardar el horario o fijar bloques no cambia los datos del colegio (touch: false).
        if (opts?.touch !== false) draft.updatedAt = new Date().toISOString();
        setState({ projects: { ...projects, [currentId]: draft } });
      },
    }),
    {
      name: STORE_KEY,
      version: 3,
      // v2: divisiones de curso. v3: electivos entre cursos y reglas de horas diarias/consejo.
      migrate: (persisted) => {
        const st = persisted as { projects?: Record<Id, Project>; currentId?: Id | null };
        for (const p of Object.values(st.projects ?? {})) migrateProject(p);
        return st as State;
      },
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId }),
      // Al recargar por cambios de otra pestaña se conserva el horario abierto en esta.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        const projects = p.projects ?? current.projects;
        const currentId = current.hydrated ? current.currentId : p.currentId ?? null;
        return { ...current, projects, currentId: currentId && projects[currentId] ? currentId : null };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) useHealth.getState().setStorageError(`No se pudieron leer los horarios guardados (${(error as Error).message || error}).`);
        // Solo la primera vez: volver a escribir tras cada recarga entre pestañas haría que se avisen sin fin.
        if (!useProjects.getState().hydrated) useProjects.setState({ hydrated: true });
      },
    },
  ),
);

channel?.addEventListener('message', (e: MessageEvent<{ type: string; from: string }>) => {
  if (e.data?.type !== 'saved' || e.data.from === TAB_ID) return;
  useHealth.getState().setOtherTab(true);
  void useProjects.persist.rehydrate();
});

export const useCurrent = () => useProjects((s) => (s.currentId ? s.projects[s.currentId] ?? null : null));

/** El horario guardado ya no corresponde a los datos actuales (se editó algo después de generar). */
export const isStale = (p: Project) => !!p.timetable && p.updatedAt > p.timetable.generatedAt;

/** Hay cambios sin respaldar desde hace más de una semana. */
export const needsBackup = (p: Project) =>
  (!p.backupAt || p.updatedAt > p.backupAt) && Date.now() - Date.parse(p.backupAt ?? p.updatedAt) > 7 * 24 * 3600 * 1000;
