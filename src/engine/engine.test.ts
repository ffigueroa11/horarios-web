// El motor publicado debe ser el que registró engine/build-engine.sh. Si alguien reemplaza un archivo de public/engine
// a mano (o llega uno distinto por error), esta prueba falla hasta que se vuelva a compilar o a registrar la huella.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const hasEngine = existsSync(resolve(root, 'public/engine/fet-cl.wasm'));

describe.skipIf(!hasEngine)('huellas del motor', () => {
  const entries = readFileSync(resolve(root, 'engine/engine.sha256'), 'utf8').split('\n').filter((l) => l.trim())
    // sha256sum escribe "hash  ruta" en Linux y "hash *ruta" en Windows.
    .map((l) => /^([0-9a-f]{64}) [ *](.+)$/.exec(l.trim())!);

  it('registra los tres archivos generados', () => {
    expect(entries.every(Boolean)).toBe(true);
    expect(entries.map((m) => m[2]).sort()).toEqual(['public/engine/fet-cl.js', 'public/engine/fet-cl.wasm', 'public/engine/fet_es.qm']);
  });

  it.each(entries.map((m) => [m[2], m[1]]))('%s coincide con su huella', (path, expected) => {
    expect(createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')).toBe(expected);
  });
});
