import { afterEach, describe, expect, it, vi } from 'vitest';

/** Carga el almacén como si la app abriera con este contenido en localStorage. */
async function loadWith(raw: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined });
  return import('./projects');
}

describe('espacio de datos por cuenta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sin cuenta usa la clave de siempre, para no perder los datos existentes', async () => {
    const { STORE_KEY, savedAccount } = await loadWith(null);
    expect(STORE_KEY).toBe('horarios-web');
    expect(savedAccount()).toBeNull();
  });
  it('cada cuenta tiene su propia clave', async () => {
    const a = await loadWith(JSON.stringify({ uid: 'u1', email: 'a@b.cl' }));
    expect(a.STORE_KEY).toBe('horarios-web:u1');
    expect(a.savedAccount()).toEqual({ uid: 'u1', email: 'a@b.cl' });
    const b = await loadWith(JSON.stringify({ uid: 'u2', email: 'c@d.cl' }));
    expect(b.STORE_KEY).toBe('horarios-web:u2');
  });
  it('un registro dañado se trata como sin cuenta', async () => {
    expect((await loadWith('{dañado')).STORE_KEY).toBe('horarios-web');
    expect((await loadWith('{"uid":5}')).STORE_KEY).toBe('horarios-web');
  });
});
