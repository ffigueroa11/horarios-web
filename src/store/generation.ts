// Estado de la generación en curso. Vive fuera de las pantallas para que el cálculo continúe
// aunque el usuario navegue a otro paso mientras FET trabaja.
import { create } from 'zustand';
import type { Id, Project } from '../domain/types';
import { exportFet } from '../domain/fetExport';
import { parseActivitiesXml, parsePartial, parseResult, type FetOutcome, type PartialResult } from '../domain/fetResult';
import { fetArgs } from '../engine/args';
import { runFet, type FetProgress, type RunHandle } from '../engine/runFet';
import { useProjects } from './projects';
import { saveVersion } from './versions';
import { engineLock } from './engineLock';

type Status = 'idle' | 'loading' | 'running' | 'done' | 'error' | 'cancelled';

interface GenState {
  status: Status;
  projectId: Id | null;
  startedAt: number;
  progress: FetProgress | null;
  total: number;
  log: string[];
  outcome: FetOutcome | null;
  /** Mejor intento de una generación que no terminó. Solo para mostrarlo: no se guarda en el proyecto. */
  partial: (PartialResult & { generatedAt: string }) | null;
  error: string;
  seconds: number;
  handle: RunHandle | null;
  /** `seed` repite un resultado ya visto (por ejemplo, el de una alternativa); si falta, se elige al azar. */
  start: (p: Project, timeLimit: number, seed?: number) => void;
  cancel: () => void;
  reset: () => void;
}

export const useGeneration = create<GenState>()((set, get) => ({
  status: 'idle', projectId: null, startedAt: 0, progress: null, total: 0, log: [], outcome: null, partial: null, error: '', seconds: 0, handle: null,

  start: (p, timeLimit, fixedSeed) => {
    if (get().status === 'loading' || get().status === 'running') return;
    const ex = exportFet(p);
    const total = ex.activityById.size;
    const seed = fixedSeed ?? Math.floor(Math.random() * 1_000_000_000);
    // Se usa la hora de inicio: si el usuario edita datos mientras se calcula, el horario queda marcado como desactualizado.
    const generatedAt = new Date().toISOString();
    // Mientras se evalúan alternativas no se genera: un solo cálculo del motor a la vez.
    if (!engineLock.take('generacion')) return;
    let handle: RunHandle;
    try {
      handle = runFet(ex.xml, fetArgs(timeLimit, seed), {
        started: () => set({ status: 'running' }),
        progress: (pr) => set({ progress: pr }),
        log: (line) => set((s) => ({ log: s.log.length > 400 ? [...s.log.slice(-300), line] : [...s.log, line] })),
      });
    } catch (e) {
      engineLock.release('generacion');
      throw e;
    }
    set({ status: 'loading', projectId: p.id, startedAt: performance.now(), progress: null, total, log: [], outcome: null, partial: null, error: '', seconds: 0, handle });

    handle.promise.then((run) => {
      const resultTxt = Object.entries(run.files).find(([k]) => k.endsWith('logs/result.txt'))?.[1] ?? '';
      const xml = Object.entries(run.files).find(([k]) => k.endsWith('_activities.xml'))?.[1] ?? '';
      const errorsTxt = Object.entries(run.files).find(([k]) => k.endsWith('logs/errors.txt'))?.[1];
      const difficultTxt = Object.entries(run.files).find(([k]) => k.endsWith('logs/difficult_activities.txt'))?.[1];
      const outcome = parseResult(resultTxt, ex, run.lines, errorsTxt, difficultTxt);
      const seconds = run.genMs / 1000;
      if (outcome.kind === 'ok') {
        const placements = parseActivitiesXml(xml, ex);
        useProjects.getState().saveTimetable(p.id, { generatedAt, seconds, placements, seed });
        const saved = useProjects.getState().projects[p.id];
        if (saved) void saveVersion(saved, 'Horario generado');
      }
      const found = outcome.kind === 'timeout' || outcome.kind === 'impossible' ? parsePartial(run.files, ex) : null;
      const partial = found && { ...found, generatedAt };
      set({ status: 'done', outcome, partial, seconds, handle: null, progress: outcome.kind === 'ok' ? { placed: total, best: total, total } : get().progress });
    }).catch((e: Error) => {
      if (e.name === 'AbortError') set({ status: 'cancelled', handle: null });
      else set({ status: 'error', error: e.message, handle: null });
    }).finally(() => engineLock.release('generacion'));
  },

  cancel: () => get().handle?.cancel(),
  reset: () => set({ status: 'idle', outcome: null, partial: null, error: '', progress: null, log: [] }),
}));
