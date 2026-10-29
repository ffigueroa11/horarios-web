// Web Worker que ejecuta fet-cl (FET compilado a WebAssembly) dentro del navegador.
// Recibe { xml, inputPath, outputDir, args, keep } y devuelve los archivos de salida que coinciden con `keep`.
// Los mensajes de FET salen en español gracias a la traducción oficial (fet_es.qm), si se puede cargar.
importScripts('fet-cl.js');

async function loadTranslation() {
  try {
    const r = await fetch('fet_es.qm');
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function collect(FS, root, dir, keep, out) {
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const path = dir + '/' + name;
    if (FS.isDir(FS.stat(path).mode)) collect(FS, root, path, keep, out);
    else if (keep.test(path)) out[path.slice(root.length + 1)] = FS.readFile(path, { encoding: 'utf8' });
  }
  return out;
}

self.onmessage = async ({ data }) => {
  const { xml, inputPath, outputDir, args, keep } = data;
  const t0 = performance.now();
  const lines = [];
  const print = (line) => {
    const m = /^FETPROGRESS (\d+) (\d+) (\d+)/.exec(line);
    if (m) self.postMessage({ type: 'progress', placed: +m[1], best: +m[2], total: +m[3] });
    else { lines.push(line); self.postMessage({ type: 'log', line }); }
  };
  try {
    const [M, qm] = await Promise.all([
      fet_cl_entry({ noInitialRun: true, print, printErr: print, locateFile: (f) => f }),
      loadTranslation(),
    ]);
    let runArgs = args;
    if (qm) {
      M.FS.mkdirTree('/translations');
      M.FS.writeFile('/translations/fet_es.qm', qm);
      runArgs = [...args, '--language=es'];
    }
    const loadMs = performance.now() - t0;
    self.postMessage({ type: 'started', loadMs });
    M.FS.mkdirTree(inputPath.slice(0, inputPath.lastIndexOf('/')));
    M.FS.mkdirTree(outputDir);
    M.FS.writeFile(inputPath, xml);
    const t1 = performance.now();
    try { M.callMain(runArgs); }
    catch (e) {
      // Al cerrar, Qt usa window.clearTimeout, que no existe en un Worker. Ocurre después de escribir
      // los resultados, así que solo es un error real si FET no alcanzó a escribir nada.
      if (!(e && e.name === 'ExitStatus') && !M.FS.analyzePath(outputDir + '/logs/result.txt').exists) throw e;
    }
    const files = collect(M.FS, outputDir, outputDir, new RegExp(keep), {});
    self.postMessage({ type: 'done', files, lines, loadMs, genMs: performance.now() - t1 });
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e), lines });
  }
};
