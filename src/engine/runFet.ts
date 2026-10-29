// Ejecuta FET en un Web Worker. Se crea un Worker nuevo por generación: así "Detener" es inmediato
// (se termina el Worker) y la memoria del motor se libera al terminar.
import { FET_IN, FET_OUT, KEEP_OUTPUT } from './args';

export interface FetProgress { placed: number; best: number; total: number }

export interface FetRun {
  files: Record<string, string>;
  lines: string[];
  loadMs: number;
  genMs: number;
}

export interface RunHandle {
  promise: Promise<FetRun>;
  cancel: () => void;
}

export function runFet(xml: string, args: string[], on: {
  progress?: (p: FetProgress) => void;
  log?: (line: string) => void;
  started?: () => void;
}): RunHandle {
  const worker = new Worker(`${import.meta.env.BASE_URL}engine/fet-worker.js`);
  let reject!: (e: Error) => void;
  const promise = new Promise<FetRun>((res, rej) => {
    reject = rej;
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') on.progress?.(m);
      else if (m.type === 'log') on.log?.(m.line);
      else if (m.type === 'started') on.started?.();
      else if (m.type === 'done') { worker.terminate(); res(m); }
      else if (m.type === 'error') { worker.terminate(); rej(new Error(m.message)); }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || 'No se pudo cargar el motor. Revisa que public/engine tenga fet-cl.js y fet-cl.wasm.'));
    };
    worker.postMessage({ xml, inputPath: FET_IN, outputDir: FET_OUT, args, keep: KEEP_OUTPUT.source });
  });
  return {
    promise,
    cancel: () => { worker.terminate(); reject(new DOMException('Generación detenida', 'AbortError')); },
  };
}
