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
  /** Última subida confirmada por la nube desde este navegador. */
  savedAt: number | null;
  /** Avisos de la sincronización, como un conflicto entre equipos. */
  notices: string[];
  /** Horarios guardados en este navegador sin cuenta que se pueden pasar a la cuenta. */
  anonCount: number;
  /** Entró con contraseña. Si no, confirma su identidad con Google. */
  hasPassword: boolean;
  dismissNotice: (i: number) => void;
}

const SAVED_AT_KEY = `${STORE_KEY}:guardado`;
function readSavedAt(): number | null {
  try {
    return Number(localStorage.getItem(SAVED_AT_KEY)) || null;
  } catch {
    return null;
  }
}

export const useAccount = create<AccountState>()((setState) => ({
  phase: savedAccount() ? 'loading' : 'local',
  email: savedAccount()?.email ?? '',
  sync: 'connecting',
  syncDetail: '',
  savedAt: readSavedAt(),
  notices: [],
  anonCount: 0,
  hasPassword: true,
  dismissNotice: (i) => setState((s) => ({ notices: s.notices.filter((_, n) => n !== i) })),
}));

const META_KEY = `${STORE_KEY}:sync`;
const SKIP_ADOPT_KEY = `${STORE_KEY}:sin-traspaso`;
let engine: SyncEngine | null = null;
/** Al salir por cerrar sesión o cambiar de cuenta no se pregunta por lo que falta subir. */
let leaving = false;

/** Otra pestaña inició o cerró sesión: esta debe usar los datos de esa cuenta. */
if (typeof addEventListener !== 'undefined') {
  addEventListener('storage', (e) => {
    if (e.key === 'horarios-web-cuenta') { leaving = true; location.reload(); }
  });
}

type TabMessage = { type: 'ask' } | { type: 'status'; sync: SyncStatus; syncDetail: string; savedAt: number | null };
let tabs: BroadcastChannel | null = null;

/** Solo una pestaña sincroniza: comparte su estado con las demás para que todas muestren lo mismo. */
function shareStatus() {
  if (!engine) return;
  const { sync, syncDetail, savedAt } = useAccount.getState();
  tabs?.postMessage({ type: 'status', sync, syncDetail, savedAt } satisfies TabMessage);
}

function connectTabs() {
  if (tabs || typeof BroadcastChannel === 'undefined') return;
  tabs = new BroadcastChannel(`${STORE_KEY}:estado`);
  tabs.addEventListener('message', (e: MessageEvent<TabMessage>) => {
    if (e.data.type === 'ask') shareStatus();
    else if (!engine) useAccount.setState({ sync: e.data.sync, syncDetail: e.data.syncDetail, savedAt: e.data.savedAt });
  });
  tabs.postMessage({ type: 'ask' } satisfies TabMessage);
}

/** Avisa al cerrar la pestaña si faltan cambios por subir. Sin conexión no pregunta: no serviría de nada esperar. */
function warnBeforeClosing() {
  addEventListener('beforeunload', (e) => {
    const { phase, sync } = useAccount.getState();
    if (leaving || phase !== 'ready' || (sync !== 'pending' && sync !== 'saving')) return;
    void engine?.flush();
    e.preventDefault();
  });
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
    status: (sync, detail) => { useAccount.setState({ sync, syncDetail: detail ?? '' }); shareStatus(); },
    notice: (message) => useAccount.setState((s) => (s.notices.includes(message) ? s : { notices: [...s.notices, message] })),
    saved: (savedAt) => {
      useAccount.setState({ savedAt });
      try { localStorage.setItem(SAVED_AT_KEY, String(savedAt)); } catch { /* Solo se pierde la hora al recargar. */ }
    },
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
  if (!tabs) warnBeforeClosing();
  connectTabs();
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
  leaving = true;
  engine?.stop();
  await Promise.all([del(STORE_KEY), del(META_KEY)]);
  localStorage.removeItem(SKIP_ADOPT_KEY);
  localStorage.removeItem(SAVED_AT_KEY);
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

function savedText(at: number | null): string {
  if (!at) return 'Todo guardado en tu cuenta';
  const date = new Date(at);
  const hour = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (date.toDateString() === new Date().toDateString()) return `Guardado en tu cuenta a las ${hour}`;
  return `Guardado en tu cuenta el ${date.toLocaleDateString('es-CL')} a las ${hour}`;
}

export interface SyncView {
  tone: 'ok' | 'busy' | 'warn' | 'bad' | 'neutral';
  text: string;
  /** Explicación más larga, al dejar el cursor encima. */
  detail: string;
}

const ONLY_HERE = 'Tus cambios están seguros en este navegador, pero todavía no en tu cuenta.';

/** Dónde está guardado lo último que hizo el usuario. */
export function useSyncView(): SyncView {
  const phase = useAccount((s) => s.phase);
  const sync = useAccount((s) => s.sync);
  const syncDetail = useAccount((s) => s.syncDetail);
  const savedAt = useAccount((s) => s.savedAt);
  if (phase === 'local') {
    return { tone: 'neutral', text: 'Guardado solo en este navegador', detail: 'Si borras los datos de navegación se pierde. Descarga un respaldo de vez en cuando.' };
  }
  if (phase === 'loading') return { tone: 'busy', text: 'Revisando tu sesión…', detail: 'Tus horarios están en este navegador.' };
  if (phase === 'unverified') return { tone: 'warn', text: 'Confirma tu correo para guardar en tu cuenta', detail: ONLY_HERE };
  if (phase === 'expired') return { tone: 'warn', text: 'Sesión cerrada: guardado solo en este navegador', detail: 'Vuelve a iniciar sesión en la pantalla de inicio para subir tus cambios.' };
  switch (sync) {
    case 'saved': return { tone: 'ok', text: savedText(savedAt), detail: 'Tus horarios están en tu cuenta y en este navegador.' };
    case 'pending': return { tone: 'busy', text: 'Cambios por subir…', detail: `${ONLY_HERE} Se suben en unos segundos.` };
    case 'saving': return { tone: 'busy', text: 'Guardando en tu cuenta…', detail: ONLY_HERE };
    case 'connecting': return { tone: 'busy', text: 'Conectando con tu cuenta…', detail: ONLY_HERE };
    case 'offline': return { tone: 'warn', text: 'Sin conexión: se subirá al volver', detail: ONLY_HERE };
    case 'error': return { tone: 'bad', text: 'No se pudo guardar en tu cuenta', detail: `${syncDetail ? `${syncDetail} ` : ''}${ONLY_HERE}` };
  }
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
