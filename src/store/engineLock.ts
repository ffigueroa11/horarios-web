// Un solo cálculo del motor a la vez: cada uno usa un Worker de unos 220 MB, y la generación normal y la evaluación
// de alternativas no deben competir por la memoria ni pisarse los resultados.
export type EngineOwner = 'generacion' | 'alternativas';

let owner: EngineOwner | null = null;

export const engineLock = {
  /** Toma el motor. Devuelve false si lo usa otro. */
  take(o: EngineOwner): boolean {
    if (owner && owner !== o) return false;
    owner = o;
    return true;
  },
  release(o: EngineOwner) {
    if (owner === o) owner = null;
  },
  owner: (): EngineOwner | null => owner,
};
