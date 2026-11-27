// Evaluación de alternativas cuando no hay horario (F3). Ejecuta con el motor, una por una, variantes del proyecto con
// un solo cambio (domain/relax.ts), con la misma semilla y un tiempo corto por variante.
//
// Reglas que hay que mantener:
//  - No escribe en el proyecto: no importa store/projects. Aplicar un cambio lo hace la pantalla, tras confirmar.
//  - No usa useGeneration.start(): esa función guarda el horario si sale bien y pisa el resultado mostrado.
//  - Un Worker a la vez (engineLock), terminado al acabar cada variante: así la memoria queda acotada.
//  - "sin-resolver" (tiempo agotado) no es "no-basta": se ofrece reintentar con más tiempo.
import { create } from 'zustand';
import type { Id, Project } from '../domain/types';
import { changeId, describeChange, runVariant, type Change, type EngineRunner, type VariantStatus } from '../domain/relax';
import { fetArgs } from '../engine/args';
import { runFet } from '../engine/runFet';
import { engineLock } from './engineLock';

/** Semilla fija: todas las variantes se comparan desde el mismo punto de partida del motor. */
export const RELAX_SEED = 20261126;
export const RELAX_SECONDS = 15;
export const RELAX_MAX_SECONDS = 120;
export const RELAX_MAX_VARIANTS = 12;

export type ItemStatus = VariantStatus | 'pendiente' | 'evaluando';

export interface RelaxItem {
  id: string;
  /** null = el proyecto sin cambios, con la misma semilla y el mismo tiempo. */
  change: Change | null;
  title: string;
  effect: string;
  status: ItemStatus;
  placedMax: number | null;
  total: number;
  seconds: number;
  /** Tiempo máximo con que se evaluó (o se evaluará). */
  budget: number;
}

export type RelaxPhase = 'idle' | 'running' | 'done' | 'cancelled';

export interface RelaxOptions {
  seconds?: number;
  /** Detenerse en la primera variante que funciona (por defecto, sí). */
  stopAtFirst?: boolean;
  /** Evaluar primero el proyecto sin cambios. No tiene sentido si el diagnóstico ya demostró que es imposible. */
  baseline?: boolean;
  runner?: EngineRunner;
}

interface RelaxState {
  phase: RelaxPhase;
  projectId: Id | null;
  /**
   * El proyecto evaluado (el mismo objeto del almacén). Como un proyecto guardado nunca se modifica en su lugar, si el
   * proyecto actual ya no es este objeto, los resultados corresponden a otros datos.
   */
  source: Project | null;
  items: RelaxItem[];
  seed: number;
  error: string;
  start: (p: Project, changes: Change[], opts?: RelaxOptions) => boolean;
  /** Evalúa las que quedaron pendientes o detenidas, sin parar en la primera que funciona. */
  continueRest: () => boolean;
  /** Vuelve a evaluar las que quedaron sin resolver, con cuatro veces más tiempo (hasta RELAX_MAX_SECONDS). */
  retryLonger: () => boolean;
  cancel: () => void;
  reset: () => void;
}

const defaultRunner: EngineRunner = (xml, seconds, seed) => runFet(xml, fetArgs(seconds, seed), {});

// Lo que dura una ejecución y no se muestra.
let session = 0;
let current: { cancel: () => void } | null = null;
let runner: EngineRunner = defaultRunner;
/** Copia congelada del proyecto: lo que se evalúa no cambia aunque el usuario edite a mitad de camino. */
let frozen: Project | null = null;

export const useRelax = create<RelaxState>()((set, get) => {
  async function evaluate(indices: number[], stopAtFirst: boolean) {
    const me = ++session;
    set({ phase: 'running', error: '' });
    const patch = (i: number, item: Partial<RelaxItem>) => set((s) => ({ items: s.items.map((x, k) => (k === i ? { ...x, ...item } : x)) }));
    try {
      for (const i of indices) {
        if (me !== session || !frozen) return;
        const { items, seed } = get();
        patch(i, { status: 'evaluando' });
        const run = runVariant(frozen, items[i].change, runner, items[i].budget, seed);
        current = run;
        try {
          const r = await run.promise;
          if (me !== session) return;
          patch(i, { status: r.status, placedMax: r.placedMax, total: r.total, seconds: r.seconds });
          if (r.status === 'funciona' && stopAtFirst) break;
        } catch (e) {
          if (me !== session) return;
          if ((e as Error).name === 'AbortError') { patch(i, { status: 'cancelada' }); return; }
          patch(i, { status: 'fallo' });
          set({ error: (e as Error).message });
        } finally {
          if (me === session) current = null;
        }
      }
      if (me === session) set({ phase: 'done' });
    } finally {
      if (me === session) engineLock.release('alternativas');
    }
  }

  const newItem = (p: Project, change: Change | null, budget: number): RelaxItem => ({
    id: change ? changeId(change) : 'sin-cambios',
    change,
    ...(change ? describeChange(p, change) : { title: 'Sin cambios', effect: 'Los datos actuales, con la misma semilla y el mismo tiempo que las demás, para comparar.' }),
    status: 'pendiente', placedMax: null, total: 0, seconds: 0, budget,
  });

  const resume = (pick: (x: RelaxItem) => boolean, prepare: (x: RelaxItem) => RelaxItem, stopAtFirst: boolean) => {
    const s = get();
    if (s.phase === 'running' || !frozen) return false;
    const indices = s.items.flatMap((x, i) => (pick(x) ? [i] : []));
    if (indices.length === 0 || !engineLock.take('alternativas')) return false;
    set({ items: s.items.map((x, i) => (indices.includes(i) ? prepare(x) : x)) });
    void evaluate(indices, stopAtFirst);
    return true;
  };

  return {
    phase: 'idle', projectId: null, source: null, items: [], seed: RELAX_SEED, error: '',

    start: (p, changes, opts = {}) => {
      if (get().phase === 'running' || !engineLock.take('alternativas')) return false;
      runner = opts.runner ?? defaultRunner;
      frozen = structuredClone(p);
      const budget = Math.min(RELAX_MAX_SECONDS, Math.max(1, opts.seconds ?? RELAX_SECONDS));
      const list = [...(opts.baseline ? [null] : []), ...changes.slice(0, RELAX_MAX_VARIANTS)];
      set({ projectId: p.id, source: p, items: list.map((c) => newItem(p, c, budget)), seed: RELAX_SEED });
      void evaluate(list.map((_, i) => i), opts.stopAtFirst ?? true);
      return true;
    },

    continueRest: () => resume((x) => x.status === 'pendiente' || x.status === 'cancelada', (x) => ({ ...x, status: 'pendiente' }), false),

    retryLonger: () => resume((x) => x.status === 'sin-resolver' && x.budget < RELAX_MAX_SECONDS,
      (x) => ({ ...x, status: 'pendiente', budget: Math.min(RELAX_MAX_SECONDS, x.budget * 4) }), true),

    cancel: () => {
      if (get().phase !== 'running') return;
      session++; // lo que llegue del motor después de esto se ignora
      current?.cancel();
      current = null;
      set((s) => ({ phase: 'cancelled', items: s.items.map((x) => (x.status === 'evaluando' ? { ...x, status: 'cancelada' } : x)) }));
      engineLock.release('alternativas');
    },

    reset: () => {
      get().cancel();
      frozen = null;
      set({ phase: 'idle', projectId: null, source: null, items: [], error: '' });
    },
  };
});
