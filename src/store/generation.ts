// Estado de la generación en curso. Vive fuera de las pantallas para que el cálculo continúe
// aunque el usuario navegue a otro paso mientras FET trabaja.
import { create } from 'zustand';
import type { Id, Project } from '../domain/types';
import { exportFet } from '../domain/fetExport';
import { parseActivitiesXml, parseResult, type FetOutcome } from '../domain/fetResult';
import { fetArgs } from '../engine/args';
import { runFet, type FetProgress, type RunHandle } from '../engine/runFet';
import { useProjects } from './projects';

type Status = 'idle' | 'loading' | 'running' | 'done' | 'error' | 'cancelled';

interface GenState {
  status: Status;
  projectId: Id | null;
  startedAt: number;
  progress: FetProgress | null;
  total: number;
  log: string[];
  outcome: FetOutcome | null;
  error: string;
  seconds: number;
  handle: RunHandle | null;
  start: (p: Project, timeLimit: number) => void;
  cancel: () => void;
  reset: () => void;
}

export const useGeneration = create<GenState>()((set, get) => ({
  status: 'idle', projectId: null, startedAt: 0, progress: null, total: 0, log: [], outcome: null, error: '', seconds: 0, handle: null,

  start: (p, timeLimit) => {
    if (get().status === 'loading' || get().status === 'running') return;
    const ex = exportFet(p);
    const total = ex.activityById.size;
    const seed = Math.floor(Math.random() * 1_000_000_000);
    // Se usa la hora de inicio: si el usuario edita datos mientras se calcula, el horario queda marcado como desactualizado.
    const generatedAt = new Date().toISOString();
    const handle = runFet(ex.xml, fetArgs(timeLimit, seed), {
      started: () => set({ status: 'running' }),
      progress: (pr) => set({ progress: pr }),
      log: (line) => set((s) => ({ log: s.log.length > 400 ? [...s.log.slice(-300), line] : [...s.log, line] })),
    });
    set({ status: 'loading', projectId: p.id, startedAt: performance.now(), progress: null, total, log: [], outcome: null, error: '', seconds: 0, handle });

    handle.promise.then((run) => {
      const resultTxt = Object.entries(run.files).find(([k]) => k.endsWith('logs/result.txt'))?.[1] ?? '';
      const xml = Object.entries(run.files).find(([k]) => k.endsWith('_activities.xml'))?.[1] ?? '';
      const errorsTxt = Object.entries(run.files).find(([k]) => k.endsWith('logs/errors.txt'))?.[1];
      const outcome = parseResult(resultTxt, ex, run.lines, errorsTxt);
      const seconds = run.genMs / 1000;
      if (outcome.kind === 'ok') {
        const placements = parseActivitiesXml(xml, ex);
        // Se guarda en el proyecto que se generó, aunque el usuario haya cambiado de horario mientras tanto.
        useProjects.setState((s) => {
          const target = s.projects[p.id];
          if (!target) return s;
          return { projects: { ...s.projects, [p.id]: { ...target, timetable: { generatedAt, seconds, placements } } } };
        });
      }
      set({ status: 'done', outcome, seconds, handle: null, progress: outcome.kind === 'ok' ? { placed: total, best: total, total } : get().progress });
    }).catch((e: Error) => {
      if (e.name === 'AbortError') set({ status: 'cancelled', handle: null });
      else set({ status: 'error', error: e.message, handle: null });
    });
  },

  cancel: () => get().handle?.cancel(),
  reset: () => set({ status: 'idle', outcome: null, error: '', progress: null, log: [] }),
}));
