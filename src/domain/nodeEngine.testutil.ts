// Motor de FET (WebAssembly) ejecutado en Node, para las pruebas. No forma parte de la app: tsconfig.app lo excluye.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FET_IN, FET_OUT } from '../engine/args';

export const engineDir = resolve(__dirname, '../../public/engine');
export const hasEngine = existsSync(resolve(engineDir, 'fet-cl.wasm'));

export async function runEngine(xml: string, args: string[], spanish = false) {
  // fet-cl.js es CommonJS y el proyecto es ESM: se evalúa con un envoltorio de módulo.
  const require = createRequire(import.meta.url);
  const file = resolve(engineDir, 'fet-cl.js');
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))(
    mod, mod.exports, require, engineDir, file);
  const factory = mod.exports as (opts: object) => Promise<any>;
  const lines: string[] = [];
  const M = await factory({
    noInitialRun: true,
    locateFile: (f: string) => resolve(engineDir, f),
    print: (l: string) => lines.push(l),
    printErr: (l: string) => lines.push(l),
  });
  M.FS.mkdirTree('/work/in');
  M.FS.mkdirTree(FET_OUT);
  M.FS.writeFile(FET_IN, xml);
  if (spanish) {
    M.FS.mkdirTree('/translations');
    M.FS.writeFile('/translations/fet_es.qm', readFileSync(resolve(engineDir, 'fet_es.qm')));
    args = [...args, '--language=es'];
  }
  try { M.callMain(args); } catch { /* limpieza de Qt al salir; los resultados ya están escritos */ }
  const read = (p: string) => (M.FS.analyzePath(p).exists ? M.FS.readFile(p, { encoding: 'utf8' }) : '');
  return {
    lines,
    result: read(`${FET_OUT}/logs/result.txt`),
    activities: read(`${FET_OUT}/timetables/horario/horario_activities.xml`),
    errors: read(`${FET_OUT}/logs/errors.txt`),
    difficult: read(`${FET_OUT}/logs/difficult_activities.txt`),
    files: { 'timetables/horario-highest/horario_activities.xml': read(`${FET_OUT}/timetables/horario-highest/horario_activities.xml`) },
    softConflicts: read(`${FET_OUT}/timetables/horario/horario_soft_conflicts.txt`),
  };
}
