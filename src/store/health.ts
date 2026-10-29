// Estado del almacenamiento del navegador: errores al leer o guardar, otra pestaña abierta.
import { create } from 'zustand';

interface Health {
  /** No se pudo leer lo guardado: se bloquea el guardado para no sobrescribirlo. */
  readFailed: boolean;
  storageError: string | null;
  saveError: string | null;
  /** Otra pestaña de la app guardó cambios. */
  otherTab: boolean;
  /** El navegador aceptó guardar los datos de forma persistente (no los borra si falta espacio). */
  persisted: boolean | null;
  setStorageError: (msg: string) => void;
  setSaveError: (msg: string | null) => void;
  setOtherTab: (v: boolean) => void;
}

export const useHealth = create<Health>()((set, get) => ({
  readFailed: false,
  storageError: null,
  saveError: null,
  otherTab: false,
  persisted: null,
  setStorageError: (msg) => set({ storageError: msg, readFailed: true }),
  setSaveError: (msg) => { if (get().saveError !== msg) set({ saveError: msg }); },
  setOtherTab: (v) => { if (get().otherTab !== v) set({ otherTab: v }); },
}));

/** Pide al navegador que no borre los datos de la app por falta de espacio. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return;
    const already = await navigator.storage.persisted();
    useHealth.setState({ persisted: already || (await navigator.storage.persist()) });
  } catch {
    useHealth.setState({ persisted: false });
  }
}

/** Lo que el navegador necesita para que la app funcione. */
export function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof indexedDB === 'undefined') missing.push('guardar datos (IndexedDB)');
  if (typeof WebAssembly === 'undefined') missing.push('WebAssembly');
  if (typeof Worker === 'undefined') missing.push('Web Workers');
  if (typeof structuredClone === 'undefined') missing.push('structuredClone');
  return missing;
}
