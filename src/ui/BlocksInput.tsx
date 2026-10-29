import { parseBlocks } from '../domain/validate';
import { useDraft } from './useDraft';

/** Campo de bloques semanales: "2+2+2" = 6 horas en tres bloques de 2. */
export function BlocksInput({ blocks, onChange, maxRun }: { blocks: number[]; onChange: (b: number[]) => void; maxRun: number }) {
  const [text, setText] = useDraft(blocks.join('+'));
  const parsed = parseBlocks(text);
  const tooBig = parsed && Math.max(...parsed) > maxRun;
  return (
    <input className="input" style={{ width: 110, borderColor: !parsed || tooBig ? 'var(--bad)' : undefined }} value={text}
      aria-label="Bloques" title="Ej: 2+2+2 = 6 horas en tres bloques de 2"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (parsed ? onChange(parsed) : setText(blocks.join('+')))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}
