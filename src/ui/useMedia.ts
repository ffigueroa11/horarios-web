import { useEffect, useState } from 'react';

/** ¿Cumple la consulta de medios? Se actualiza si cambia (girar el teléfono, cambiar el ancho de la ventana). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}
/** Pantalla táctil sin mouse: no hay "pasar por encima", así que los textos dicen "toca". */
export const useTouch = () => useMedia('(hover: none)');
