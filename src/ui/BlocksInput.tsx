import { useId, useState } from 'react';
import { describeBlocks, parseBlocks } from '../domain/validate';
import { useDraft } from './useDraft';

/**
 * Campo de bloques semanales: "2+2+2" = 6 horas en tres bloques de 2. Al escribir, o si no se entiende, dice debajo cómo
 * lo interpretó: el formato es propio de la app y así no hay que adivinarlo.
 */
export function BlocksInput({ blocks, onChange, maxRun }: { blocks: number[]; onChange: (b: number[]) => void; maxRun: number }) {
  const [text, setText] = useDraft(blocks.join('+'));
  const [focused, setFocused] = useState(false);
  const id = useId();
  const parsed = parseBlocks(text);
  const tooBig = !!parsed && Math.max(...parsed) > maxRun;
  const bad = !parsed || tooBig;
  const hint = !parsed
    ? 'Escribe las horas (6) o los bloques (2+2+2).'
    : tooBig ? `Un bloque de ${Math.max(...parsed)} h no cabe entre recreos (máximo ${maxRun} h seguidas).` : describeBlocks(parsed);
  return (
    <span className="blocks-field">
      <input className="input" style={{ width: 110, borderColor: bad ? 'var(--bad)' : undefined }} value={text}
        aria-label="Bloques" aria-invalid={bad || undefined} aria-describedby={focused || bad ? id : undefined}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (parsed) onChange(parsed); else setText(blocks.join('+')); }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {(focused || bad) && <span id={id} className={`blocks-hint${bad ? ' bad' : ''}`} role="status">{hint}</span>}
    </span>
  );
}
