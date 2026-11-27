import { useEffect, useState } from 'react';
import type { Version } from '../domain/versions';
import { listVersions } from '../store/versions';
import { useProjects } from '../store/projects';

const when = (iso: string) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Versiones guardadas de un horario. Restaurar crea una copia: el horario actual no se toca, así que probar una versión
 * antigua no hace perder nada.
 */
export function VersionsPanel({ projectId, name, onClose }: { projectId: string; name: string; onClose: () => void }) {
  const [list, setList] = useState<Version[] | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const importProjects = useProjects((s) => s.importProjects);
  const select = useProjects((s) => s.select);

  useEffect(() => {
    let active = true;
    void listVersions(projectId).then((versions) => { if (active) setList(versions); })
      .catch(() => { if (active) setError('No se pudieron leer las versiones guardadas. El horario actual no se modificó.'); });
    return () => { active = false; };
  }, [projectId]);

  const restore = (v: Version) => {
    const copyName = `${v.project.name} (${when(v.at)})`;
    importProjects([{ ...v.project, name: copyName }]);
    select(null); // se queda en el inicio, donde aparece la copia
    setDone(`Se restauró como “${copyName}”.`);
  };

  return (
    <section className="card" aria-labelledby="versions-title">
      <div className="row"><h2 id="versions-title">Versiones anteriores de “{name}”</h2><span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>✕</button></div>
      <p className="small muted">
        Se guarda una copia cada vez que generas el horario y, al editar, una como máximo cada media hora. Se conservan las
        últimas 15 en este navegador. Restaurar crea una copia aparte: el horario actual no cambia.
      </p>
      {done && <div className="notice ok" role="status">{done}</div>}
      {error ? <div className="notice bad" role="alert">{error}</div> : list == null ? <p className="small muted">Cargando…</p>
        : list.length === 0 ? <div className="empty">Todavía no hay versiones guardadas de este horario.</div>
        : (
          <table className="data versions">
            <thead><tr><th>Fecha</th><th>Motivo</th><th>Contenido</th><th /></tr></thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td>{when(v.at)}</td>
                  <td>{v.reason}</td>
                  <td className="small muted">{v.project.courses.length} cursos · {v.project.teachers.length} profesores · {v.project.timetable ? 'con horario' : 'sin horario'}</td>
                  <td><button type="button" className="btn small" onClick={() => restore(v)}>Restaurar como copia</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
