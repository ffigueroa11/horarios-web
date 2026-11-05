import { useCurrent, useProjects } from '../store/projects';
import { downloadText, fileSafe } from './download';
import type { ImportReport } from '../domain/types';

const reportText = (r: ImportReport) => [
  `Importación de ${r.fileName}`, '', 'Se traspasó:', ...r.kept.map((l) => `- ${l}`),
  '', 'No se traspasó o quedó aproximado:', ...r.lost.map((l) => `- ${l}`), '',
].join('\n');

/** Informe de lo que se traspasó al importar un archivo .fet; queda a la vista hasta que el usuario lo cierre. */
export function ImportReportCard() {
  const report = useCurrent()?.importReport;
  const update = useProjects((s) => s.update);
  if (!report) return null;
  return (
    <section className="card no-print" role="status">
      <details open>
        <summary><b>“{report.fileName}” quedó importado</b></summary>
        <p className="muted small">Ve a Generar para ver el horario: los bloques fijados se mantienen en su lugar. Para partir de cero con estos datos, libéralos desde "Ver y ajustar".</p>
        <h3>Se traspasó</h3>
        <ul className="small">{report.kept.map((l) => <li key={l}>{l}</li>)}</ul>
        {report.lost.length > 0 && <>
          <h3>No se traspasó o quedó aproximado</h3>
          <ul className="small">{report.lost.map((l) => <li key={l}>{l}</li>)}</ul>
        </>}
      </details>
      <div className="row">
        <button type="button" className="btn small" onClick={() => downloadText(`${fileSafe(report.fileName.replace(/\.fet$/i, ''))}-informe.txt`, reportText(report))}>Descargar informe</button>
        <button type="button" className="btn small ghost" onClick={() => update((d) => { delete d.importReport; }, { touch: false })}>Cerrar informe</button>
      </div>
    </section>
  );
}
