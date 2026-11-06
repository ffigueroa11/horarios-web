// Cuenta opcional y sincronización. Sin sesión iniciada este módulo no carga Firebase ni se conecta a ningún servidor.
import { create } from 'zustand';
import { del, get, set } from 'idb-keyval';
import { cloudEnabled } from '../cloud/config';
import { countPending, SyncEngine, type SyncMeta, type SyncStatus } from '../cloud/engine';
import type { Project } from '../domain/types';
import { useHealth } from './health';
import { ANON_KEY, clearAccount, savedAccount, setAccount, STORE_KEY, storeFlushed, useProjects } from './projects';

type Firebase = typeof import('../cloud/firebase');
const loadFirebase = (): Promise<Firebase> => import('../cloud/firebase');
const healthReadFailed = () => useHealth.getState().readFailed;

/** local: sin cuenta. loading: revisando la sesión. unverified: falta confirmar el correo. ready: sincronizando. expired: hay que volver a entrar. */
type Phase = 'local' | 'loading' | 'unverified' | 'ready' | 'expired';

interface AccountState {
  phase: Phase;
  email: string;
  sync: SyncStatus;
  syncDetail: string;
  /** Avisos de la sincronización, como un conflicto entre equipos. */
  notices: string[];
  /** Horarios guardados en este navegador sin cuenta que se pueden pasar a la cuenta. */
  anonCount: number;
  /** Entró con contraseña. Si no, confirma su identidad con Google. */
  hasPassword: boolean;
  dismissNotice: (i: number) => void;
}

export const useAccount = create<AccountState>()((setState) => ({
  phase: savedAccount() ? 'loading' : 'local',
  email: savedAccount()?.email ?? '',
  sync: 'connecting',
  syncDetail: '',
  notices: [],
  anonCount: 0,
  hasPassword: true,
  dismissNotice: (i) => setState((s) => ({ notices: s.notices.filter((_, n) => n !== i) })),
}));

const META_KEY = `${STORE_KEY}:sync`;
const SKIP_ADOPT_KEY = `${STORE_KEY}:sin-traspaso`;
let engine: SyncEngine | null = null;

/** Otra pestaña inició o cerró sesión: esta debe usar los datos de esa cuenta. */
if (typeof addEventListener !== 'undefined') {
  addEventListener('storage', (e) => { if (e.key === 'horarios-web-cuenta') location.reload(); });
}

function startSync(fb: Firebase, uid: string) {
  if (engine) return;
  const local = {
    projects: () => useProjects.getState().projects,
    apply: ({ put, remove, moveCurrent }: { put: Project[]; remove: string[]; moveCurrent?: Record<string, string> }) => {
      useProjects.setState((s) => {
        const projects = { ...s.projects };
        for (const id of remove) delete projects[id];
        for (const p of put) projects[p.id] = p;
        const moved = s.currentId ? moveCurrent?.[s.currentId] : undefined;
        const currentId = moved ?? (s.currentId && projects[s.currentId] ? s.currentId : null);
        return { projects, currentId };
      });
    },
    loadMeta: async () => (await get<SyncMeta>(META_KEY)) ?? {},
    // Primero lo que cambió en los horarios: si se registrara como sincronizado sin estar guardado y la pestaña se
    // cerrara justo ahí, la versión antigua parecería un cambio local y sobrescribiría la nube.
    saveMeta: async (meta: SyncMeta) => { await storeFlushed(); await set(META_KEY, meta); },
  };
  const current = new SyncEngine(fb.cloudBackend(uid), local, {
    status: (sync, detail) => useAccount.setState({ sync, syncDetail: detail ?? '' }),
    notice: (message) => useAccount.setState((s) => (s.notices.includes(message) ? s : { notices: [...s.notices, message] })),
  });
  engine = current;
  useProjects.subscribe((s, prev) => { if (s.projects !== prev.projects) current.schedule(); });
  addEventListener('online', () => current.reconnected());
  // Al salir de la pestaña se sube lo pendiente sin esperar la pausa de edición.
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void current.flush(); });
  void current.start().catch((e: Error) => useAccount.setState({ sync: 'error', syncDetail: e.message }));
}

/** Solo una pestaña sincroniza; las demás reciben los cambios por el aviso entre pestañas de store/projects.ts. */
function startSyncInOneTab(fb: Firebase, uid: string) {
  if (!navigator.locks) return startSync(fb, uid);
  void navigator.locks.request(`${STORE_KEY}:sync`, () => {
    startSync(fb, uid);
    return new Promise<void>(() => undefined); // Se libera al cerrar la pestaña, y entonces otra toma el relevo.
  });
}

const whenHydrated = () => new Promise<void>((resolve) => {
  if (useProjects.getState().hydrated) return resolve();
  const off = useProjects.subscribe((s) => { if (s.hydrated) { off(); resolve(); } });
});

/** Horarios que se crearon en este navegador antes de entrar a la cuenta. */
async function readAnonProjects(): Promise<Project[]> {
  const raw = await get<string>(ANON_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { state?: { projects?: Record<string, Project> } };
  return Object.values(parsed.state?.projects ?? {});
}

async function refreshAnonCount() {
  try {
    const skipped = localStorage.getItem(SKIP_ADOPT_KEY);
    useAccount.setState({ anonCount: skipped ? 0 : (await readAnonProjects()).length });
  } catch { /* Es solo una oferta: si no se puede leer, no se muestra. */ }
}

/** Revisa la sesión guardada al abrir la app. */
export async function initAccount() {
  const saved = savedAccount();
  if (!cloudEnabled || !saved) return;
  await whenHydrated();
  try {
    const fb = await loadFirebase();
    let watchingFocus = false;
    fb.onUser((user) => {
      if (!user) return useAccount.setState({ phase: 'expired' });
      if (user.uid !== saved.uid) { setAccount({ uid: user.uid, email: user.email }); location.reload(); return; }
      useAccount.setState({ email: user.email, hasPassword: user.hasPassword, phase: user.verified ? 'ready' : 'unverified' });
      void refreshAnonCount();
      // Nunca se sincroniza si no se pudo leer lo local: se tomaría como si todo se hubiera eliminado.
      if (user.verified && !healthReadFailed()) startSyncInOneTab(fb, user.uid);
      else if (!user.verified && !watchingFocus) {
        watchingFocus = true;
        // Quien confirma el correo vuelve desde otra pestaña: se detecta sin que tenga que recargar.
        addEventListener('focus', () => {
          if (useAccount.getState().phase === 'unverified') void checkVerified().catch(() => undefined);
        });
      }
    });
  } catch (e) {
    // Sin conexión y sin el SDK guardado: los horarios locales siguen disponibles.
    useAccount.setState({ phase: 'ready', sync: 'offline', syncDetail: (e as Error).message });
  }
}

export async function signIn(email: string, password: string) {
  const fb = await loadFirebase();
  const user = await fb.signIn(email, password);
  await storeFlushed();
  setAccount({ uid: user.uid, email: user.email });
  location.reload();
}

export async function signInWithGoogle() {
  const fb = await loadFirebase();
  const user = await fb.signInWithGoogle();
  await storeFlushed();
  setAccount({ uid: user.uid, email: user.email });
  location.reload();
}

export async function signUp(email: string, password: string) {
  const fb = await loadFirebase();
  const user = await fb.signUp(email, password);
  await storeFlushed();
  setAccount({ uid: user.uid, email: user.email });
  location.reload();
}

export async function resetPassword(email: string) {
  await (await loadFirebase()).resetPassword(email);
}

export async function resendVerification() {
  await (await loadFirebase()).resendVerification();
}

/** Devuelve si el correo ya está confirmado y, en ese caso, parte la sincronización. */
export async function checkVerified(): Promise<boolean> {
  const fb = await loadFirebase();
  const verified = await fb.refreshVerified();
  const saved = savedAccount();
  if (verified && saved && useAccount.getState().phase === 'unverified') {
    useAccount.setState({ phase: 'ready' });
    if (!healthReadFailed()) startSyncInOneTab(fb, saved.uid);
  }
  return verified;
}

/** Cuántos horarios se perderían al cerrar sesión ahora. */
export async function unsyncedCount(): Promise<number> {
  const projects = useProjects.getState().projects;
  await engine?.flush().catch(() => undefined);
  return countPending(projects, (await get<SyncMeta>(META_KEY)) ?? {});
}

async function forgetLocalAccount() {
  engine?.stop();
  await Promise.all([del(STORE_KEY), del(META_KEY)]);
  localStorage.removeItem(SKIP_ADOPT_KEY);
  clearAccount();
  location.reload();
}

/** Cierra la sesión y borra de este navegador la copia de la cuenta, porque puede ser un computador compartido. */
export async function signOut() {
  await (await loadFirebase()).logOut();
  await forgetLocalAccount();
}

/** Elimina los horarios de la nube, la cuenta y la copia local de esa cuenta. */
export async function deleteAccount(password: string | null) {
  // La sincronización se detiene solo tras confirmar la contraseña: con una incorrecta, todo sigue igual.
  await (await loadFirebase()).deleteAccount(password, () => engine?.stop());
  await forgetLocalAccount();
}

/** Pasa a la cuenta los horarios guardados en este navegador sin cuenta. */
export async function adoptAnonProjects() {
  const list = await readAnonProjects();
  if (list.length > 0) useProjects.getState().importProjects(list);
  await storeFlushed();
  await del(ANON_KEY);
  useProjects.getState().select(null);
  useAccount.setState({ anonCount: 0 });
}

const SYNC_TEXT: Record<SyncStatus, string> = {
  connecting: 'Conectando…',
  saved: 'Todo guardado en tu cuenta',
  pending: 'Hay cambios por subir',
  saving: 'Guardando en tu cuenta…',
  offline: 'Sin conexión: tus cambios se subirán al volver',
  error: 'No se pudo sincronizar',
};
export const syncText = (s: SyncStatus) => SYNC_TEXT[s];

/** Texto breve del estado, para el menú lateral. Devuelve null si no hay cuenta. */
export function useSyncLabel(): string | null {
  const phase = useAccount((s) => s.phase);
  const sync = useAccount((s) => s.sync);
  if (phase === 'local' || phase === 'loading') return null;
  if (phase === 'unverified') return 'Confirma tu correo para guardar en tu cuenta.';
  if (phase === 'expired') return 'La sesión se cerró: los cambios solo quedan en este navegador.';
  return SYNC_TEXT[sync];
}

export function skipAdoption() {
  try { localStorage.setItem(SKIP_ADOPT_KEY, '1'); } catch { /* Solo volverá a preguntar. */ }
  useAccount.setState({ anonCount: 0 });
}

export async function authErrorMessage(e: unknown): Promise<string> {
  try {
    return (await loadFirebase()).authErrorMessage(e);
  } catch {
    return 'No hay conexión. Revisa internet y vuelve a probar.';
  }
}
