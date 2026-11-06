import { useSyncView } from '../store/account';

/** Indica dónde está guardado el trabajo. El color acompaña al texto, que siempre dice el estado. */
export function SyncStatus() {
  const { tone, text, detail } = useSyncView();
  return (
    <span className={`sync-status ${tone}`} role="status" title={detail}>
      <span className="sync-dot" aria-hidden="true" />{text}
    </span>
  );
}
