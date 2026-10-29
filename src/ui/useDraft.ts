import { useState } from 'react';

/**
 * Borrador local de un valor guardado: se edita libremente y se reinicia si el valor guardado cambia
 * desde fuera (patrón de React "ajustar estado cuando cambia una prop", sin efectos).
 */
export function useDraft(saved: string): [string, (t: string) => void] {
  const [text, setText] = useState(saved);
  const [prev, setPrev] = useState(saved);
  if (saved !== prev) { setPrev(saved); setText(saved); }
  return [text, setText];
}
