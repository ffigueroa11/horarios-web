import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { undoState, useProjects } from '../store/projects';

/** En un campo de texto, Ctrl+Z deshace lo que se está escribiendo, no el último cambio del horario. */
const editingText = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Deshacer y rehacer el último cambio del horario abierto: botones en el menú y Ctrl+Z / Ctrl+Y (Cmd en Mac). */
export function UndoControls() {
  const { canUndo, canRedo } = useProjects(useShallow(undoState));
  const [notice, setNotice] = useState<string | null>(null);

  const run = (redo: boolean) => {
    const done = redo ? useProjects.getState().redo() : useProjects.getState().undo();
    // El cambio puede estar en otra pantalla: se avisa para que no pase inadvertido.
    if (done) setNotice(redo ? 'Se rehízo el cambio.' : 'Se deshizo el último cambio.');
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || editingText(e.target)) return;
      const key = e.key.toLowerCase();
      const redo = key === 'y' || (key === 'z' && e.shiftKey);
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      run(redo);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="undo-controls row no-print">
      <button type="button" className="btn small ghost" disabled={!canUndo} onClick={() => run(false)} title="Deshacer el último cambio (Ctrl+Z)">↶ Deshacer</button>
      <button type="button" className="btn small ghost" disabled={!canRedo} onClick={() => run(true)} title="Rehacer (Ctrl+Y)">↷ Rehacer</button>
      <div className="toast-zone" role="status" aria-live="polite">
        {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
      </div>
    </div>
  );
}
