// Los módulos de Firebase deben ser la misma versión que fija el paquete `firebase`.
//
// firebase fija versiones exactas de @firebase/*, pero esos módulos declaran @firebase/app como dependencia par con
// rango "0.x". Al actualizar, npm (y por lo tanto Dependabot) puede dejar la versión antigua de @firebase/app en la raíz
// y la nueva anidada dentro de firebase: el código nuevo de @firebase/auth importa entonces algo que la copia antigua no
// exporta y el build falla ("_setTrustedScriptSrc" is not exported by "@firebase/app"). Se corrige con `npm dedupe`.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const version = (dir: string) => JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).version as string;

describe('dependencias de Firebase', () => {
  it('cada @firebase/* que usa la app es la versión que fija firebase (si no, ejecuta npm dedupe)', () => {
    const firebase = resolve(root, 'node_modules/firebase');
    const pinned = JSON.parse(readFileSync(resolve(firebase, 'package.json'), 'utf8')).dependencies as Record<string, string>;
    const wrong: string[] = [];
    for (const [name, wanted] of Object.entries(pinned)) {
      if (!name.startsWith('@firebase/')) continue;
      const hoisted = resolve(root, 'node_modules', name);
      // Lo que importa el código es la copia de la raíz; una copia anidada dentro de firebase no la reemplaza.
      if (existsSync(hoisted) && version(hoisted) !== wanted) wrong.push(`${name}: raíz ${version(hoisted)}, firebase pide ${wanted}`);
      if (existsSync(resolve(firebase, 'node_modules', name))) wrong.push(`${name}: copia anidada dentro de firebase`);
    }
    expect(wrong).toEqual([]);
  });
});
