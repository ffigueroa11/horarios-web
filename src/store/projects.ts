// Estado de la aplicación. Todo se guarda automáticamente en IndexedDB del navegador (local-first).
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, update } from 'idb-keyval';
import { mergeProjects } from './mergeProjects';
import type { Id, Project, Timetable } from '../domain/types';
import { migrateProject, newId } from '../domain/types';
import { emptyProject, exampleProject } from '../domain/defaults';
import { useHealth } from './health';

export const ANON_KEY = 'horarios-web';
const ACCOUNT_KEY = 'horarios-web-cuenta';

/** La cuenta con que se abrió este navegador por última vez. Decide qué datos locales se usan, antes de cargar Firebase. */
export function savedAccount(): { uid: string; email: string } | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ACCOUNT_KEY);
    const parsed = raw ? JSON.parse(raw) as { uid?: unknown; email?: unknown } : null;
    return parsed && typeof parsed.uid === 'string' ? { uid: parsed.uid, email: typeof parsed.email === 'string' ? parsed.email : '' } : null;
  } catch {
    return null;
  }
}
export const setAccount = (account: { uid: string; email: string }) => localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
export const clearAccount = () => localStorage.removeItem(ACCOUNT_KEY);

// Cada cuenta tiene su propio espacio: en un computador compartido, una cuenta no ve los horarios de otra.
const account = savedAccount();
export const STORE_KEY = account ? `${ANON_KEY}:${account.uid}` : ANON_KEY;

// Avisa a otras pestañas abiertas de la app que hay datos nuevos, para que los recarguen.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(STORE_KEY) : null;
const TAB_ID = newId();

let lastWrite: Promise<unknown> = Promise.resolve();
let saving = false;
let writesClosed = false;
let baseline: string | null = null;
let applyingSnapshot = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!writesClosed && (saving || useHealth.getState().saveError)) event.preventDefault();
  });
}

function applySnapshot(raw: string) {
  const snapshot = JSON.parse(raw);
  if (snapshot.version !== 3) throw new Error('Recarga la página para abrir esta versión de los horarios.');
  const projects = snapshot.state.projects as Record<Id, Project>;
  const current = useProjects.getState();
  for (const [id, project] of Object.entries(projects)) {
    if (JSON.stringify(current.projects[id]) === JSON.stringify(project)) projects[id] = current.projects[id];
  }
  baseline = raw;
  applyingSnapshot = true;
  try {
    useProjects.setState({ projects, currentId: current.currentId && projects[current.currentId] ? current.currentId : null });
  } finally { applyingSnapshot = false; }
}
/** Solo se cumple si el último estado se guardó; los flujos destructivos no deben ignorar un fallo. */
export async function storeFlushed(): Promise<void> {
  let pending: Promise<unknown>;
  do {
    pending = lastWrite;
    try { await pending; } catch {
      if (pending === lastWrite) throw new Error('No se pudo guardar en este navegador. Descarga un respaldo antes de continuar.');
    }
  } while (pending !== lastWrite);
  const health = useHealth.getState();
  if (health.readFailed || health.saveError) throw new Error('No se pudo guardar en este navegador. Descarga un respaldo antes de continuar.');
}

/** Impide nuevas escrituras al borrar los datos de una cuenta. Espera también las ya iniciadas. */
export async function closeProjectWrites(): Promise<void> {
  writesClosed = true;
  await lastWrite.catch(() => undefined);
}

const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      baseline = (await get<string>(name)) ?? null;
      return baseline;
    } catch (e) {
      useHealth.getState().setStorageError(`No se pudieron leer los horarios guardados (${(e as Error).message || e}).`);
      return null;
    }
  },
  setItem: async (name, value) => {
    // Si no se pudo leer al iniciar, no se escribe: se sobrescribirían los datos guardados con un estado vacío.
    if (applyingSnapshot || writesClosed || useHealth.getState().readFailed) return;
    let merged = value;
    saving = true;
    const write = lastWrite.catch(() => undefined).then(async () => {
      await update<string>(name, (stored) => {
        merged = mergeProjects(baseline, value, stored);
        return merged;
      });
      baseline = value;
      if (lastWrite === write && merged !== value) applySnapshot(merged);
    });
    lastWrite = write;
    try {
      await write;
      if (lastWrite !== write) return;
      saving = false;
      useHealth.getState().setSaveError(null);
      channel?.postMessage({ type: 'saved', from: TAB_ID });
    } catch (e) {
      if (lastWrite !== write) return;
      saving = false;
      const quota = (e as Error)?.name === 'QuotaExceededError';
      useHealth.getState().setSaveError(quota
        ? 'El navegador no tiene espacio para guardar. Libera espacio o elimina horarios que no uses, y descarga un respaldo.'
        : `No se pudo guardar el último cambio (${(e as Error)?.message || e}). Descarga un respaldo para no perder datos.`);
    }
  },
  removeItem: (name) => del(name),
};

/** Un cambio hecho con update(): el proyecto antes y después. Son los mismos objetos del almacén, no copias. */
interface Step { before: Project; after: Project }
/** Cuántos cambios se pueden deshacer por horario. Un colegio grande ocupa ~100 KB por paso. */
export const HISTORY_LIMIT = 50;

interface State {
  projects: Record<Id, Project>;
  currentId: Id | null;
  hydrated: boolean;
  /**
   * Deshacer y rehacer, por horario. No se guarda: vale mientras la pestaña está abierta. Un paso solo se aplica si el
   * horario sigue siendo el que dejó ese paso; si cambió por otra vía (generar, la nube, otra pestaña), queda sin efecto.
   */
  history: Record<Id, { past: Step[]; future: Step[] }>;
  /** El último horario eliminado, para poder recuperarlo. */
  lastRemoved: Project | null;
  undo: () => boolean;
  redo: () => boolean;
  restoreRemoved: () => void;
  create: (kind: 'vacio' | 'ejemplo') => Id;
  duplicate: (id: Id) => Id;
  remove: (id: Id) => void;
  /** Agrega horarios desde un respaldo (con ids nuevos para no pisar los existentes). Devuelve el id del primero. */
  importProjects: (list: Project[]) => Id | null;
  select: (id: Id | null) => void;
  markBackup: (ids: Id[]) => void;
  /** Guarda un horario recién generado en el proyecto `id`, aunque el usuario haya abierto otro mientras se calculaba. */
  saveTimetable: (id: Id, timetable: Timetable) => void;
  /** Modifica el proyecto actual sobre una copia; cualquier cambio de datos marca el horario como desactualizado. */
  update: (recipe: (p: Project) => void, opts?: { touch?: boolean }) => void;
}

export const useProjects = create<State>()(
  persist(
    (setState, getState) => ({
      projects: {},
      currentId: null,
      hydrated: false,
      history: {},
      lastRemoved: null,
      create: (kind) => {
        const p = kind === 'ejemplo' ? exampleProject() : emptyProject();
        setState((s) => ({ projects: { ...s.projects, [p.id]: p }, currentId: p.id, lastRemoved: null }));
        return p.id;
      },
      duplicate: (id) => {
        const src = getState().projects[id];
        // Se conservan las fechas: los datos son los mismos, así que el horario sigue tan vigente como el original.
        const p: Project = { ...structuredClone(src), id: newId(), name: `${src.name} (copia)` };
        setState((s) => ({ projects: { ...s.projects, [p.id]: p }, currentId: p.id }));
        return p.id;
      },
      remove: (id) =>
        setState((s) => {
          const { [id]: gone, ...rest } = s.projects;
          const { [id]: _history, ...history } = s.history;
          return { projects: rest, currentId: s.currentId === id ? null : s.currentId, history, lastRemoved: gone ?? null };
        }),
      restoreRemoved: () =>
        setState((s) => (s.lastRemoved && !s.projects[s.lastRemoved.id]
          ? { projects: { ...s.projects, [s.lastRemoved.id]: s.lastRemoved }, lastRemoved: null }
          : { lastRemoved: null })),
      importProjects: (list) => {
        const now = new Date().toISOString();
        // updatedAt se conserva: restaurar no cambia los datos, y con la fecha actual el horario parecería desactualizado.
        const added = list.map((src) => migrateProject({ ...structuredClone(src), id: newId(), backupAt: now }));
        if (added.length === 0) return null;
        setState((s) => ({ projects: { ...s.projects, ...Object.fromEntries(added.map((p) => [p.id, p])) }, currentId: added[0].id }));
        return added[0].id;
      },
      // Abrir o crear otro horario cierra la posibilidad de recuperar el eliminado.
      select: (id) => setState(id ? { currentId: id, lastRemoved: null } : { currentId: id }),
      markBackup: (ids) => {
        const now = new Date().toISOString();
        setState((s) => ({ projects: { ...s.projects, ...Object.fromEntries(ids.filter((id) => s.projects[id]).map((id) => [id, { ...s.projects[id], backupAt: now }])) } }));
      },
      saveTimetable: (id, timetable) => setState((s) => {
        const target = s.projects[id];
        if (!target) return s;
        // Los fijados que había al empezar son obligatorios para el motor, así que el horario los respeta. Si durante el
        // cálculo se movió o fijó un bloque en otro lugar (touch: false), el horario nuevo no lo refleja: queda marcado
        // como desactualizado para que se vuelva a generar.
        const at = new Map(timetable.placements.map((pl) => [pl.key, pl]));
        const contradicted = Object.entries(target.locks).some(([k, lock]) => {
          const pl = at.get(k);
          return !!pl && (pl.day !== lock.day || pl.periodId !== lock.periodId);
        });
        const updatedAt = contradicted ? new Date(Math.max(Date.now(), Date.parse(timetable.generatedAt) + 1)).toISOString() : target.updatedAt;
        return { projects: { ...s.projects, [id]: { ...target, timetable, updatedAt } } };
      }),
      update: (recipe, opts) => {
        const { currentId, projects } = getState();
        if (!currentId || !projects[currentId]) return;
        const draft = structuredClone(projects[currentId]);
        recipe(draft);
        migrateProject(draft);
        // Guardar el horario o fijar bloques no cambia los datos del colegio (touch: false).
        if (opts?.touch !== false) draft.updatedAt = new Date().toISOString();
        const h = getState().history[currentId];
        const past = [...(h?.past ?? []), { before: projects[currentId], after: draft }].slice(-HISTORY_LIMIT);
        setState({ projects: { ...projects, [currentId]: draft }, history: { ...getState().history, [currentId]: { past, future: [] } } });
      },
      // Deshacer devuelve el objeto anterior tal cual, con su updatedAt: un cambio con touch: false (fijar, mover) no
      // cambia si el horario parece desactualizado, y deshacer una edición de datos devuelve la fecha que tenía.
      undo: () => {
        const { currentId, projects, history } = getState();
        const h = currentId ? history[currentId] : undefined;
        const step = h?.past.at(-1);
        if (!currentId || !h || !step || projects[currentId] !== step.after) return false;
        setState({
          projects: { ...projects, [currentId]: step.before },
          history: { ...history, [currentId]: { past: h.past.slice(0, -1), future: [...h.future, step] } },
        });
        return true;
      },
      redo: () => {
        const { currentId, projects, history } = getState();
        const h = currentId ? history[currentId] : undefined;
        const step = h?.future.at(-1);
        if (!currentId || !h || !step || projects[currentId] !== step.before) return false;
        setState({
          projects: { ...projects, [currentId]: step.after },
          history: { ...history, [currentId]: { past: [...h.past, step], future: h.future.slice(0, -1) } },
        });
        return true;
      },
    }),
    {
      name: STORE_KEY,
      version: 3,
      // v2: divisiones de curso. v3: electivos entre cursos y reglas de horas diarias/consejo.
      migrate: (persisted, version) => {
        if (version > 3) throw new Error('Los horarios se guardaron con una versión más nueva de la aplicación.');
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

channel?.addEventListener('message', async (e: MessageEvent<{ type: string; from: string }>) => {
  if (e.data?.type !== 'saved' || e.data.from === TAB_ID) return;
  try {
    await storeFlushed();
    const pending = lastWrite;
    const raw = await get<string>(STORE_KEY);
    if (!raw || pending !== lastWrite || writesClosed || !useProjects.getState().hydrated) return;
    if (raw !== baseline) applySnapshot(raw);
    useHealth.getState().setOtherTab(true);
  } catch { /* Los cambios sin guardar siguen disponibles para respaldar o reintentar. */ }
});

/** ¿Se puede deshacer o rehacer en el horario abierto? */
export function undoState(s: Pick<State, 'currentId' | 'projects' | 'history'>) {
  const p = s.currentId ? s.projects[s.currentId] : undefined;
  const h = s.currentId ? s.history[s.currentId] : undefined;
  return { canUndo: !!p && h?.past.at(-1)?.after === p, canRedo: !!p && h?.future.at(-1)?.before === p };
}

export const useCurrent = () => useProjects((s) => (s.currentId ? s.projects[s.currentId] ?? null : null));

/** El horario guardado ya no corresponde a los datos actuales (se editó algo después de generar). */
export const isStale = (p: Project) => !!p.timetable && p.updatedAt > p.timetable.generatedAt;

/** Hay cambios sin respaldar desde hace más de una semana. */
export const needsBackup = (p: Project) =>
  (!p.backupAt || p.updatedAt > p.backupAt) && Date.now() - Date.parse(p.backupAt ?? p.updatedAt) > 7 * 24 * 3600 * 1000;
