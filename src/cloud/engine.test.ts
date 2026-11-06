import { beforeEach, describe, expect, it } from 'vitest';
import { exampleProject } from '../domain/defaults';
import type { Id, Project } from '../domain/types';
import { BACKUP_VERSION } from '../domain/backup';
import { countPending, payload, SyncEngine, type CloudBackend, type RemoteDoc, type SyncMeta, type SyncStatus } from './engine';

/** Nube en memoria con la misma regla que firestore.rules: solo se escribe la revisión siguiente. */
class FakeCloud implements CloudBackend {
  docs = new Map<Id, RemoteDoc>();
  listeners = new Set<(docs: RemoteDoc[], fromServer: boolean) => void>();
  failWith: Error | null = null;
  writes = 0;

  watch(onDocs: (docs: RemoteDoc[], fromServer: boolean) => void) {
    this.listeners.add(onDocs);
    onDocs([...this.docs.values()], true);
    return () => { this.listeners.delete(onDocs); };
  }
  async put(doc: RemoteDoc) {
    if (this.failWith) throw this.failWith;
    if ((this.docs.get(doc.id)?.revision ?? 0) !== doc.revision - 1) return false;
    this.docs.set(doc.id, doc);
    this.writes++;
    for (const l of this.listeners) l([doc], true);
    return true;
  }
  /** Otro equipo escribe directamente. */
  remoteWrite(p: Project) {
    const revision = (this.docs.get(p.id)?.revision ?? 0) + 1;
    const doc = { id: p.id, revision, schema: BACKUP_VERSION, data: payload(p) };
    this.docs.set(p.id, doc);
    for (const l of this.listeners) l([doc], true);
  }
}

class Device {
  projects: Record<Id, Project> = {};
  meta: SyncMeta = {};
  notices: string[] = [];
  statuses: SyncStatus[] = [];
  moved: Record<Id, Id> = {};
  savedAt: number[] = [];
  engine: SyncEngine;

  constructor(cloud: CloudBackend, seed: Project[] = [], meta: SyncMeta = {}) {
    for (const p of seed) this.projects[p.id] = p;
    this.meta = meta;
    this.engine = new SyncEngine(cloud, {
      projects: () => this.projects,
      apply: ({ put, remove, moveCurrent }) => {
        this.projects = { ...this.projects };
        for (const id of remove) delete this.projects[id];
        for (const p of put) this.projects[p.id] = p;
        Object.assign(this.moved, moveCurrent);
      },
      loadMeta: async () => structuredClone(this.meta),
      saveMeta: async (m) => { this.meta = structuredClone(m); },
    }, {
      status: (s) => this.statuses.push(s),
      notice: (n) => this.notices.push(n),
      saved: (at) => this.savedAt.push(at),
    }, { debounceMs: 0, maxWaitMs: 0, retryMs: 1_000_000 });
  }
  async open() { await this.engine.start(); await this.engine.flush(); }
  edit(id: Id, name: string) { this.projects = { ...this.projects, [id]: { ...this.projects[id], name } }; }
  remove(id: Id) { const { [id]: _gone, ...rest } = this.projects; this.projects = rest; }
}

const names = (d: Device) => Object.values(d.projects).map((p) => p.name).sort();

describe('sincronización', () => {
  let cloud: FakeCloud;
  let p: Project;
  beforeEach(() => { cloud = new FakeCloud(); p = exampleProject(); });

  it('sube un horario local y otro equipo lo recibe', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    expect(cloud.docs.get(p.id)?.revision).toBe(1);

    const b = new Device(cloud);
    await b.open();
    expect(b.projects[p.id].name).toBe(p.name);
    expect(payload(b.projects[p.id])).toBe(payload(p));
    expect(cloud.writes).toBe(1);
  });

  it('el horario generado y los bloques fijados viajan aunque no cambie updatedAt', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    const b = new Device(cloud);
    await b.open();

    a.projects = { ...a.projects, [p.id]: { ...a.projects[p.id], timetable: { generatedAt: p.updatedAt, seconds: 1, placements: [] }, locks: { 'x#0': { day: 1, periodId: 'y' } } } };
    await a.engine.flush();
    expect(b.projects[p.id].timetable).not.toBeNull();
    expect(b.projects[p.id].locks['x#0'].day).toBe(1);
    expect(b.projects[p.id].updatedAt).toBe(p.updatedAt);
  });

  it('no vuelve a escribir si nada cambió', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    await a.engine.flush();
    await a.engine.flush();
    expect(cloud.writes).toBe(1);
  });

  it('descargar un respaldo no cuenta como un cambio y su fecha no viaja', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    a.projects = { ...a.projects, [p.id]: { ...a.projects[p.id], backupAt: '2030-01-01T00:00:00.000Z' } };
    await a.engine.flush();
    expect(cloud.writes).toBe(1);
    expect(JSON.parse(cloud.docs.get(p.id)!.data!).backupAt).toBeUndefined();
  });

  it('un cambio remoto conserva el respaldo local y no genera conflicto', async () => {
    const a = new Device(cloud, [{ ...p, backupAt: '2030-01-01T00:00:00.000Z' }]);
    await a.open();
    cloud.remoteWrite({ ...p, name: 'Desde otro equipo' });
    await a.engine.flush();
    expect(a.projects[p.id].name).toBe('Desde otro equipo');
    expect(a.projects[p.id].backupAt).toBe('2030-01-01T00:00:00.000Z');
    expect(a.notices).toEqual([]);
    expect(a.engine.pendingCount()).toBe(0);
  });

  it('un conflicto conserva las dos versiones y deja al usuario en la suya', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    a.edit(p.id, 'Versión de A');
    cloud.remoteWrite({ ...p, name: 'Versión de B' });
    await a.engine.flush();

    expect(a.projects[p.id].name).toBe('Versión de B');
    const copyId = a.moved[p.id];
    expect(a.projects[copyId].name).toMatch(/^Versión de A \(conflicto /);
    expect(a.notices).toHaveLength(1);
    // La copia también se sube.
    await a.engine.flush();
    expect(cloud.docs.get(copyId)?.revision).toBe(1);
    expect(cloud.docs.get(p.id)?.revision).toBe(2);
  });

  it('un cambio local hecho durante un conflicto de escritura no se pierde', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    a.edit(p.id, 'Sin conexión');
    // La nube avanzó y el aviso aún no llega: la escritura se rechaza y nada se sobrescribe.
    cloud.docs.set(p.id, { id: p.id, revision: 2, schema: BACKUP_VERSION, data: payload({ ...p, name: 'Otro equipo' }) });
    await a.engine.flush();
    expect(cloud.docs.get(p.id)?.data).toContain('Otro equipo');
    expect(a.projects[p.id].name).toBe('Sin conexión');
  });

  it('una eliminación llega al otro equipo y no reaparece', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    const b = new Device(cloud);
    await b.open();

    a.remove(p.id);
    await a.engine.flush();
    expect(cloud.docs.get(p.id)?.data).toBeNull();
    expect(b.projects[p.id]).toBeUndefined();

    const c = new Device(cloud);
    await c.open();
    expect(c.projects[p.id]).toBeUndefined();
    expect(cloud.docs.get(p.id)?.revision).toBe(2);
  });

  it('una eliminación remota no borra lo que se estaba editando', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    const b = new Device(cloud);
    await b.open();
    a.edit(p.id, 'Editado en A');
    b.remove(p.id);
    await b.engine.flush();

    expect(names(a)).toEqual([expect.stringMatching(/^Editado en A \(conflicto /)]);
    expect(a.notices).toHaveLength(1);
  });

  it('una eliminación local no se impone a un cambio remoto', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    a.remove(p.id);
    cloud.remoteWrite({ ...p, name: 'Editado en B' });
    await a.engine.flush();
    expect(a.projects[p.id].name).toBe('Editado en B');
    expect(cloud.docs.get(p.id)?.data).toContain('Editado en B');
  });

  it('si se perdieron los datos del navegador, se recuperan en vez de borrar la nube', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    const wiped = new Device(cloud, [], structuredClone(a.meta));
    await wiped.open();
    expect(wiped.projects[p.id].name).toBe(p.name);
    expect(cloud.docs.get(p.id)?.data).not.toBeNull();
  });

  it('no sube nada hasta conocer lo que hay en la nube', async () => {
    const listeners: ((docs: RemoteDoc[], fromServer: boolean) => void)[] = [];
    const puts: RemoteDoc[] = [];
    const slow: CloudBackend = {
      watch: (cb) => { listeners.push(cb); return () => undefined; },
      put: async (d) => { puts.push(d); return true; },
    };
    const a = new Device(slow, [p]);
    await a.engine.start();
    listeners[0]([], false); // Solo el caché: todavía sin confirmar por el servidor.
    await a.engine.flush();
    expect(puts).toHaveLength(0);
    listeners[0]([], true);
    await a.engine.flush();
    expect(puts).toHaveLength(1);
  });

  it('sin conexión queda pendiente y sube al reconectarse', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    a.engine.stop();
    const b = new Device(cloud, [{ ...p, name: 'Offline' }], structuredClone(a.meta));
    cloud.failWith = new Error('sin red');
    await b.open();
    expect(b.statuses.at(-1)).toBe('offline');
    expect(b.engine.pendingCount()).toBe(1);
    cloud.failWith = null;
    b.engine.reconnected();
    await b.engine.flush();
    expect(b.engine.pendingCount()).toBe(0);
    expect(cloud.docs.get(p.id)?.data).toContain('Offline');
    b.engine.stop();
  });

  it('un rechazo de permisos se informa y no da el cambio por guardado', async () => {
    const a = new Device(cloud, [p]);
    cloud.failWith = Object.assign(new Error('denied'), { code: 'permission-denied' });
    await a.open();
    expect(a.statuses.at(-1)).toBe('error');
    expect(a.engine.pendingCount()).toBe(1);
  });

  it('una versión más nueva no se lee ni se sobrescribe', async () => {
    cloud.docs.set(p.id, { id: p.id, revision: 5, schema: BACKUP_VERSION + 1, data: '{"futuro":true}' });
    const a = new Device(cloud, [{ ...p, name: 'Local' }]);
    await a.open();
    expect(a.projects[p.id].name).toBe('Local');
    expect(cloud.docs.get(p.id)?.revision).toBe(5);
    expect(a.notices[0]).toMatch(/versión más nueva/);
  });

  it('un documento dañado no rompe la app ni reemplaza la copia local', async () => {
    cloud.docs.set(p.id, { id: p.id, revision: 3, schema: BACKUP_VERSION, data: '{no es json' });
    const a = new Device(cloud, [{ ...p, name: 'Local' }]);
    await a.open();
    expect(a.projects[p.id].name).toBe('Local');
    expect(cloud.docs.get(p.id)?.data).toBe('{no es json');
    expect(a.notices[0]).toMatch(/no se pudo leer/);
  });

  it('un horario demasiado grande no se intenta subir, y los demás sí', async () => {
    const big = { ...exampleProject(), name: 'x'.repeat(1_100_000) };
    const a = new Device(cloud, [big, p]);
    await a.open();
    expect(cloud.docs.has(big.id)).toBe(false);
    expect(cloud.docs.has(p.id)).toBe(true);
    expect(a.statuses.at(-1)).toBe('saved');
    expect(a.notices[0]).toMatch(/demasiado grande/);
  });

  it('la hora de guardado solo se informa cuando la nube confirmó la escritura', async () => {
    const a = new Device(cloud, [p]);
    await a.open();
    expect(a.savedAt).toHaveLength(1);
    await a.engine.flush(); // Nada que subir.
    expect(a.savedAt).toHaveLength(1);

    a.edit(p.id, 'Sin red');
    cloud.failWith = new Error('sin red');
    await a.engine.flush();
    expect(a.savedAt).toHaveLength(1);
    cloud.failWith = null;

    // La nube avanzó: la escritura se rechaza y no cuenta como guardada.
    cloud.docs.set(p.id, { id: p.id, revision: 9, schema: BACKUP_VERSION, data: payload({ ...p, name: 'Otro equipo' }) });
    await a.engine.flush();
    expect(a.savedAt).toHaveLength(1);
    a.engine.stop();
  });

  it('cuenta los horarios con cambios sin subir', () => {
    const q = exampleProject();
    const meta: SyncMeta = { gone: { rev: 1, hash: 'h' }, dead: { rev: 2, hash: '', deleted: true } };
    expect(countPending({ [q.id]: q }, meta)).toBe(2);
  });
});
