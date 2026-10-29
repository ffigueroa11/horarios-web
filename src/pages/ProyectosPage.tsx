import { useRef, useState } from 'react';
import { needsBackup, useProjects } from '../store/projects';
import { parseBackup } from '../domain/backup';
import { ConfirmButton } from '../ui/common';
import { downloadBackup } from '../ui/backup';
import { AppFooter } from '../ui/AppFooter';

export function ProyectosPage({ onOpen }: { onOpen: () => void }) {
  const { projects, create, duplicate, remove, select, importProjects } = useProjects();
  const list = Object.values(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const open = (id: string) => { select(id); onOpen(); };
  const onImport = async (file: File) => {
    setError('');
    try {
      const list = parseBackup(await file.text());
      importProjects(list);
      if (list.length === 1) onOpen();
    } catch (e) {
      setError(`No se pudo importar “${file.name}”: ${(e as Error).message}. Usa el .json que se descarga con “Respaldo”.`);
    }
  };

  return (
    <div className="welcome">
      <header className="page-head">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />Horarios Web</div>
        <h1>Arma el horario de tu colegio</h1>
        <p>Ingresa la jornada, los cursos, los profesores y la carga académica. El horario se calcula en este computador con el motor de FET; los datos no salen de tu navegador.</p>
      </header>

      <div className="row">
        <button type="button" className="btn primary" onClick={() => { create('vacio'); onOpen(); }}>Nuevo horario</button>
        <button type="button" className="btn" onClick={() => { create('ejemplo'); onOpen(); }}>Probar con un liceo de ejemplo</button>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>Importar respaldo…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}

      {list.length > 0 && (
        <section className="card">
          <div className="row"><h2>Tus horarios</h2><span className="spacer" />
            {list.length > 1 && <button type="button" className="btn small ghost" onClick={() => downloadBackup(list)}>Respaldar todos</button>}</div>
          <div className="projects">
            {list.map((p) => (
              <article key={p.id} className="card project">
                <div>
                  <h3>{p.name}</h3>
                  <span className="small muted">Año {p.year} · editado {new Date(p.updatedAt).toLocaleDateString('es-CL')}</span>
                </div>
                <div className="meta">
                  <span className="badge">{p.courses.length} cursos</span>
                  <span className="badge">{p.teachers.length} profesores</span>
                  {p.timetable ? <span className="badge ok">Horario generado</span> : <span className="badge">Sin generar</span>}
                  {needsBackup(p) && <span className="badge warn" title="Hay cambios sin respaldar desde hace más de una semana">Sin respaldo reciente</span>}
                </div>
                <div className="row">
                  <button type="button" className="btn primary small" onClick={() => open(p.id)}>Abrir</button>
                  <button type="button" className="btn small" onClick={() => duplicate(p.id)} title="Útil para empezar el año siguiente">Duplicar</button>
                  <button type="button" className="btn small" onClick={() => downloadBackup([p])}>Respaldo</button>
                  <span className="spacer" />
                  <ConfirmButton label="Eliminar" confirmLabel="Sí, eliminar" onConfirm={() => remove(p.id)} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="small muted">Los horarios se guardan en este navegador. Si borras los datos de navegación se pierden: descarga un respaldo de vez en cuando.</p>
      <AppFooter />
    </div>
  );
}
