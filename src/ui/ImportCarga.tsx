import { useRef, useState } from 'react';
import { useCurrent, useProjects } from '../store/projects';
import { applyImport, parseDelimited, planImport, TEMPLATE_CSV, type Cell, type ImportPlan } from '../domain/importCarga';
import { downloadText } from './download';

async function readTable(file: File): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    // Se carga solo cuando se usa, para no agrandar la descarga inicial de la app.
    const { readSheet } = await import('read-excel-file/universal');
    return (await readSheet(file)) as Cell[][];
  }
  if (/\.xls$/i.test(file.name)) throw new Error('El formato .xls antiguo no se puede leer. En Excel, usa “Guardar como” › Libro de Excel (.xlsx).');
  return parseDelimited(await file.text());
}

export function ImportCarga({ onClose }: { onClose: () => void }) {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [replace, setReplace] = useState(true);
  const [done, setDone] = useState('');

  const load = (table: Cell[][], from: string) => { setError(''); setDone(''); setSource(from); setPlan(planImport(p, table)); };

  const onFile = async (f: File) => {
    try { load(await readTable(f), f.name); }
    catch (e) { setPlan(null); setError(e instanceof Error && e.message.includes('.xls') ? e.message : 'No se pudo leer el archivo. Usa .xlsx, .csv o copia y pega las celdas desde Excel.'); }
  };

  const apply = () => {
    if (!plan || plan.rows.length === 0) return;
    update((d) => applyImport(d, plan, replace));
    setDone(`Se importaron ${plan.rows.length} filas.`);
    setPlan(null);
  };

  return (
    <section className="card" aria-labelledby="imp-title">
      <div className="row"><h2 id="imp-title">Importar carga desde Excel</h2><span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>✕</button></div>
      <p className="small muted">
        Columnas: <b>Curso</b>, <b>Asignatura</b>, <b>Profesor</b>, <b>Horas</b> (un número como “6” o bloques como “2+2+2”) y, si el curso está dividido, <b>Grupo</b>.
        Los cursos, asignaturas y profesores que no existan se crean automáticamente.
      </p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>Elegir archivo (.xlsx o .csv)</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        <button type="button" className="btn ghost" onClick={() => downloadText('plantilla-carga-academica.csv', TEMPLATE_CSV, 'text/csv')}>Descargar plantilla</button>
      </div>
      <label className="field"><span>O pega aquí las celdas copiadas desde Excel</span>
        <textarea className="input" rows={4} placeholder={'Curso\tAsignatura\tProfesor\tHoras\n1° Medio A\tMatemática\tValentina Soto\t2+2+2+1'}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); load(parseDelimited(t), 'texto pegado'); } }}
          onChange={(e) => { if (e.target.value.includes('\n')) load(parseDelimited(e.target.value), 'texto pegado'); }} />
      </label>

      {error && <div className="notice bad" role="alert">{error}</div>}
      {done && <div className="notice ok">{done}</div>}

      {plan && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="row small">
            <span className="badge">{source}</span>
            <span className={`badge ${plan.rows.length ? 'ok' : ''}`}>{plan.rows.length} filas listas</span>
            {plan.errors.length > 0 && <span className="badge bad">{plan.errors.length} con problemas</span>}
            {plan.newCourses.length > 0 && <span className="badge">Cursos nuevos: {plan.newCourses.join(', ')}</span>}
            {plan.newSubjects.length > 0 && <span className="badge">Asignaturas nuevas: {plan.newSubjects.length}</span>}
            {plan.newTeachers.length > 0 && <span className="badge">Profesores nuevos: {plan.newTeachers.length}</span>}
          </div>
          {plan.errors.length > 0 && (
            <ul className="issues small">
              {plan.errors.map((e, i) => <li key={i}><span className="badge bad">Fila {e.line}</span><span>{e.message}</span></li>)}
            </ul>
          )}
          {plan.rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
              <table className="data small">
                <thead><tr><th>Fila</th><th>Curso</th><th>Grupo</th><th>Asignatura</th><th>Profesor</th><th>Bloques</th></tr></thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.line}><td>{r.line}</td><td>{r.course}</td><td>{r.group || '—'}</td><td>{r.subject}</td><td>{r.teacher || 'Sin profesor'}</td><td>{r.blocks.join('+')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>Reemplazar la carga actual de los cursos que aparecen en la planilla<br />
              <span className="small muted">Si lo desmarcas, las filas se agregan a lo que ya existe.</span></span></label>
          <div className="row">
            <button type="button" className="btn primary" disabled={plan.rows.length === 0} onClick={apply}>
              Importar {plan.rows.length} filas{plan.errors.length ? ' (omitir las con problemas)' : ''}</button>
            <button type="button" className="btn ghost" onClick={() => setPlan(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
