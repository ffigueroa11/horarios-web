// Sincronización de horarios con la nube, sin depender de Firebase ni de la interfaz.
//
// Lo local manda en el día a día: la app edita en IndexedDB y este motor sube los cambios en segundo plano. Cada
// documento tiene un número de revisión; solo se escribe si la revisión en la nube sigue siendo la esperada, y
// nunca se descarta trabajo: si dos equipos cambian el mismo horario, se conservan las dos versiones.
import { BACKUP_VERSION, checkProject } from '../domain/backup';
import type { Id, Project } from '../domain/types';
import { newId } from '../domain/types';

/** Firestore admite documentos de 1 MiB; se deja margen para los demás campos. */
export const MAX_DOC_BYTES = 1_000_000;

export interface RemoteDoc {
  id: Id;
  revision: number;
  schema: number;
  /** El proyecto en JSON; null si se eliminó. */
  data: string | null;
}

export interface CloudBackend {
  /** Avisa de los documentos nuevos o cambiados. `fromServer` indica que la lista ya viene confirmada por el servidor. */
  watch(onDocs: (docs: RemoteDoc[], fromServer: boolean) => void, onError: (e: Error) => void): () => void;
  /** Escribe solo si la revisión actual es `doc.revision - 1`. Devuelve false si otro equipo escribió antes. */
  put(doc: RemoteDoc): Promise<boolean>;
}

/** Lo último que este navegador sabe que está en la nube, por proyecto. */
export type SyncMeta = Record<Id, { rev: number; hash: string; deleted?: boolean }>;

export interface LocalSide {
  projects(): Record<Id, Project>;
  /** Aplica lo que llega de la nube. `moveCurrent` deja al usuario en su copia si la que tenía abierta cambió de id. */
  apply(change: { put: Project[]; remove: Id[]; moveCurrent?: Record<Id, Id> }): void;
  loadMeta(): Promise<SyncMeta>;
  saveMeta(meta: SyncMeta): Promise<void>;
}

export type SyncStatus = 'connecting' | 'saved' | 'pending' | 'saving' | 'offline' | 'error';

export interface SyncEvents {
  status(s: SyncStatus, detail?: string): void;
  notice(message: string): void;
}

/** Lo que se sube: `backupAt` es de cada equipo, y sin él descargar un respaldo no cuenta como un cambio. */
export function payload(p: Project): string {
  const { backupAt: _local, ...rest } = p;
  return JSON.stringify(rest);
}

/** Hash rápido (cyrb53) para saber si un proyecto cambió. No tiene fines de seguridad. */
export function hash(text: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}

/** Cuántos horarios tienen cambios que aún no están en la nube. */
export function countPending(projects: Record<Id, Project>, meta: SyncMeta): number {
  let n = 0;
  for (const p of Object.values(projects)) if (hash(payload(p)) !== meta[p.id]?.hash) n++;
  for (const [id, m] of Object.entries(meta)) if (!m.deleted && !projects[id]) n++;
  return n;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;
const conflictName = (name: string) => `${name} (conflicto ${new Date().toLocaleDateString('es-CL')})`;

export class SyncEngine {
  private meta: SyncMeta = {};
  /** Serializa todo el trabajo: un cambio remoto nunca se evalúa mientras se está subiendo otro. */
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;
  private stopped = false;
  private offline = false;
  private unwatch: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstScheduled = 0;
  /** No se suben: en la nube hay una versión que este navegador no puede leer, o no caben. */
  private blocked = new Set<Id>();
  private tooBig = new Set<Id>();

  private backend: CloudBackend;
  private local: LocalSide;
  private events: SyncEvents;
  private opts: { debounceMs: number; maxWaitMs: number; retryMs: number };

  constructor(backend: CloudBackend, local: LocalSide, events: SyncEvents, opts = { debounceMs: 5_000, maxWaitMs: 60_000, retryMs: 30_000 }) {
    this.backend = backend;
    this.local = local;
    this.events = events;
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.events.status('connecting');
    this.meta = await this.local.loadMeta();
    // Sin horarios locales pero con registro de haberlos tenido: lo más probable es que se hayan perdido los datos del
    // navegador, no que se hayan eliminado uno por uno. Se vuelven a descargar en vez de borrarlos de la nube.
    if (Object.keys(this.local.projects()).length === 0) {
      for (const [id, m] of Object.entries(this.meta)) if (!m.deleted) delete this.meta[id];
    }
    this.unwatch = this.backend.watch(
      (docs, fromServer) => { void this.enqueue(() => this.receive(docs, fromServer)); },
      (e) => this.events.status('error', e.message),
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.unwatch?.();
  }

  /** Programa una subida para cuando el usuario haga una pausa, sin esperar indefinidamente si no para de editar. */
  schedule(): void {
    if (this.stopped || !this.ready) return;
    const now = Date.now();
    if (!this.timer) this.firstScheduled = now;
    else clearTimeout(this.timer);
    const wait = Math.min(this.opts.debounceMs, Math.max(0, this.firstScheduled + this.opts.maxWaitMs - now));
    this.reportIdle();
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, wait);
  }

  /** Sube ahora lo pendiente. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.enqueue(() => this.upload());
  }

  /** Volvió la conexión. */
  reconnected(): void {
    this.offline = false;
    void this.flush();
  }

  pendingCount(): number {
    return countPending(this.local.projects(), this.meta);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private reportIdle() {
    if (this.offline) return this.events.status('offline');
    this.events.status(this.pendingCount() - this.tooBig.size > 0 ? 'pending' : 'saved');
  }

  private async receive(docs: RemoteDoc[], fromServer: boolean) {
    if (this.stopped) return;
    const projects = this.local.projects();
    const put: Project[] = [];
    const remove: Id[] = [];
    const moveCurrent: Record<Id, Id> = {};
    let changedMeta = false;

    for (const doc of docs) {
      const known = this.meta[doc.id];
      if (known && doc.revision <= known.rev) continue;
      const mine = projects[doc.id];
      const mineHash = mine ? hash(payload(mine)) : null;
      const clean = mine ? mineHash === known?.hash : !known || !!known.deleted;

      let incoming: Project | null = null;
      if (doc.data != null) {
        try {
          if (doc.schema > BACKUP_VERSION) throw new Error('newer');
          incoming = checkProject(JSON.parse(doc.data));
          incoming.id = doc.id;
        } catch (e) {
          this.blocked.add(doc.id);
          this.events.notice((e as Error).message === 'newer'
            ? 'Un horario de tu cuenta se guardó con una versión más nueva de Horarios Web. Recarga la página para actualizarla.'
            : 'Un horario de tu cuenta no se pudo leer y no se modificó. Tu copia en este navegador sigue intacta.');
          continue;
        }
      }
      this.blocked.delete(doc.id);
      const incomingHash = incoming ? hash(payload(incoming)) : '';

      // Es lo mismo que ya hay aquí (por ejemplo, la confirmación de una subida propia tras cerrar la pestaña).
      if (incoming && mine && incomingHash === mineHash) {
        this.meta[doc.id] = { rev: doc.revision, hash: incomingHash };
        changedMeta = true;
        continue;
      }
      // Cambió en los dos lados: la versión local queda como una copia nueva y la de la nube conserva el id.
      if (mine && !clean) {
        const copy: Project = { ...mine, id: newId(), name: conflictName(mine.name) };
        put.push(copy);
        moveCurrent[doc.id] = copy.id;
        this.events.notice(incoming
          ? `“${mine.name}” cambió en otro equipo mientras lo editabas aquí. Se conservaron las dos versiones: la tuya quedó como “${copy.name}”.`
          : `“${mine.name}” se eliminó en otro equipo mientras lo editabas aquí. Tu versión quedó como “${copy.name}”.`);
      }
      if (incoming) {
        put.push(mine?.backupAt ? { ...incoming, backupAt: mine.backupAt } : incoming);
        this.meta[doc.id] = { rev: doc.revision, hash: incomingHash };
      } else {
        if (mine) remove.push(doc.id);
        this.meta[doc.id] = { rev: doc.revision, hash: '', deleted: true };
      }
      changedMeta = true;
    }

    if (put.length || remove.length) this.local.apply({ put, remove, moveCurrent });
    if (changedMeta) await this.local.saveMeta(this.meta);
    if (fromServer && !this.ready) {
      this.ready = true;
      await this.upload();
    } else if (this.ready) {
      this.reportIdle();
    } else {
      // Firestore respondió desde su caché porque no alcanza al servidor.
      this.events.status('offline');
    }
  }

  private async upload() {
    if (this.stopped || !this.ready) return;
    const projects = this.local.projects();
    const docs: { doc: RemoteDoc; hash: string; deleted: boolean }[] = [];
    this.tooBig.clear();

    for (const p of Object.values(projects)) {
      if (this.blocked.has(p.id)) continue;
      const data = payload(p);
      const h = hash(data);
      const known = this.meta[p.id];
      if (h === known?.hash) continue;
      if (byteLength(data) > MAX_DOC_BYTES) {
        this.tooBig.add(p.id);
        this.events.notice(`“${p.name}” es demasiado grande para guardarlo en la cuenta. Sigue guardado en este navegador; descarga un respaldo.`);
        continue;
      }
      docs.push({ doc: { id: p.id, revision: (known?.rev ?? 0) + 1, schema: BACKUP_VERSION, data }, hash: h, deleted: false });
    }
    for (const [id, m] of Object.entries(this.meta)) {
      if (projects[id] || m.deleted || this.blocked.has(id)) continue;
      docs.push({ doc: { id, revision: m.rev + 1, schema: BACKUP_VERSION, data: null }, hash: '', deleted: true });
    }

    if (docs.length === 0) return this.reportIdle();
    this.events.status('saving');
    try {
      for (const { doc, hash: h, deleted } of docs) {
        if (this.stopped) return;
        // Si otro equipo escribió antes, su versión llega por watch() y ahí se resuelve el conflicto.
        if (await this.backend.put(doc)) {
          this.meta[doc.id] = deleted ? { rev: doc.revision, hash: '', deleted: true } : { rev: doc.revision, hash: h };
          await this.local.saveMeta(this.meta);
        }
      }
      this.offline = false;
      this.reportIdle();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'permission-denied' || code === 'firestore/permission-denied') {
        this.events.status('error', 'La cuenta no tiene permiso para guardar. Tus cambios siguen en este navegador.');
        return;
      }
      this.offline = true;
      this.events.status('offline');
      this.timer ??= setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.retryMs);
    }
  }
}
