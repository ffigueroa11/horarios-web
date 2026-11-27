import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

async function openTab() {
  vi.resetModules();
  const tab = await import('./projects');
  await vi.waitFor(() => expect(tab.useProjects.getState().hydrated).toBe(true));
  return tab;
}

beforeEach(async () => {
  // Fuerza el caso en que los avisos llegan después de las dos ediciones.
  vi.stubGlobal('BroadcastChannel', undefined);
  await clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('conserva proyectos distintos y ediciones incompatibles del mismo proyecto', async () => {
  const a = await openTab();
  const id = a.useProjects.getState().create('vacio');
  await a.storeFlushed();
  const b = await openTab();
  await b.storeFlushed();
  a.useProjects.getState().update(p => { p.name = 'Primero'; });
  a.useProjects.getState().create('vacio');
  b.useProjects.getState().update(p => { p.name = 'Segundo'; });
  await Promise.all([a.storeFlushed(), b.storeFlushed()]);
  const reopened = await openTab();
  const projects = reopened.useProjects.getState().projects;
  expect(projects[id]).toBeDefined();
  const names = Object.values(projects).map(p => p.name.replace(' (copia de otra pestaña)', ''));
  expect(names).toHaveLength(3);
  expect(names).toEqual(expect.arrayContaining(['Primero', 'Segundo']));
});

it.each([true, false])('preserva la edición que coincide con un borrado (borrar primero: %s)', async (deleteFirst) => {
  const a = await openTab();
  const id = a.useProjects.getState().create('vacio');
  await a.storeFlushed();
  const b = await openTab();
  await b.storeFlushed();
  const edit = async () => { a.useProjects.getState().update(p => { p.name = 'Editado'; }); await a.storeFlushed(); };
  const remove = async () => { b.useProjects.getState().remove(id); await b.storeFlushed(); };
  if (deleteFirst) { await remove(); await edit(); } else { await edit(); await remove(); }
  const projects = (await openTab()).useProjects.getState().projects;
  expect(projects[id]).toBeUndefined();
  expect(Object.values(projects).map(p => p.name)).toEqual(['Editado (copia de otra pestaña)']);
});

it('un fallo de cuota impide confirmar el guardado y la siguiente escritura recupera los cambios', async () => {
  const tab = await openTab();
  await tab.storeFlushed();
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new DOMException('Sin espacio', 'QuotaExceededError');
  });
  const id = tab.useProjects.getState().create('vacio');
  await expect(tab.storeFlushed()).rejects.toThrow();
  put.mockRestore();
  tab.useProjects.getState().select(id);
  await tab.storeFlushed();
  expect((await openTab()).useProjects.getState().projects[id]).toBeDefined();
});

it('un registro ilegible sobrevive a la hidratación y a las ediciones', async () => {
  await set('horarios-web', '{');
  const tab = await openTab();
  tab.useProjects.getState().create('vacio');
  await expect(tab.storeFlushed()).rejects.toThrow();
  expect(await get('horarios-web')).toBe('{');
});

it('dos pestañas comprueban el intervalo de versiones dentro de la transacción', async () => {
  const a = await openTab();
  const first = await import('./versions');
  const id = a.useProjects.getState().create('vacio');
  await a.storeFlushed();
  const project = a.useProjects.getState().projects[id];
  await openTab();
  const second = await import('./versions');
  await Promise.all([first.saveVersion(project, 'Edición', true), second.saveVersion(project, 'Edición', true)]);
  await Promise.all([first.saveVersion(project, 'Manual A'), second.saveVersion(project, 'Manual B')]);
  expect((await first.listVersions(id)).map(v => v.reason).sort()).toEqual(['Edición', 'Manual A', 'Manual B']);
});
