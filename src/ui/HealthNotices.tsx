import { useHealth } from '../store/health';
import { useSw } from '../store/sw';
import { useAccount } from '../store/account';

/** Avisos globales: errores de guardado, otra pestaña abierta, versión nueva disponible, conflictos entre equipos. */
export function HealthNotices() {
  const { storageError, saveError, otherTab, setOtherTab } = useHealth();
  const { updateReady, apply } = useSw();
  const notices = useAccount((s) => s.notices);
  const dismissNotice = useAccount((s) => s.dismissNotice);
  return (
    <div className="health no-print">
      {notices.map((message, i) => (
        <div key={message} className="notice warn" role="status">
          <span>{message}</span>
          <button type="button" className="btn small ghost" onClick={() => dismissNotice(i)}>Entendido</button>
        </div>
      ))}
      {storageError && (
        <div className="notice bad" role="alert">
          <b>{storageError}</b>
          <span>Para no perder lo que ya estaba guardado, en esta sesión no se guardarán cambios. Prueba recargar la página; si usas una ventana de incógnito, ábrela en una ventana normal.</span>
        </div>
      )}
      {saveError && <div className="notice bad" role="alert"><b>{saveError}</b></div>}
      {otherTab && (
        <div className="notice warn" role="status">
          <span>Horarios Web está abierto en otra pestaña y allí se guardaron cambios; esta pestaña se actualizó con ellos. Para evitar confusiones, trabaja en una sola pestaña.</span>
          <button type="button" className="btn small ghost" onClick={() => setOtherTab(false)}>Entendido</button>
        </div>
      )}
      {updateReady && (
        <div className="notice ok" role="status">
          <span>Hay una versión nueva de Horarios Web.</span>
          <button type="button" className="btn small primary" onClick={apply}>Actualizar ahora</button>
        </div>
      )}
    </div>
  );
}
