import { useRef, useState } from 'react';
import { isStale, needsBackup, useProjects } from '../store/projects';
import { parseBackup } from '../domain/backup';
import { parseFet } from '../domain/fetImport';
import { MenuButton } from '../ui/common';
import { downloadBackup } from '../ui/backup';
import { AppFooter } from '../ui/AppFooter';
import { AccountCard } from '../ui/AccountCard';
import { VersionsPanel } from '../ui/VersionsPanel';
import { useAccount } from '../store/account';

export function ProyectosPage({ onOpen }: { onOpen: () => void }) {
  const { projects, create, duplicate, remove, select, importProjects, lastRemoved, restoreRemoved } = useProjects();
  const inCloud = useAccount((s) => s.phase === 'ready');
  const list = Object.values(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [versionsId, setVersionsId] = useState<string | null>(null);
  const versionsOf = versionsId ? projects[versionsId] : undefined;

  const open = (id: string) => { select(id); onOpen(); };
  const onImport = async (file: File) => {
    setError('');
    try {
      const text = await file.text();
      if (/\.fet$/i.test(file.name)) {
        importProjects([parseFet(text, file.name).project]);
        onOpen();
        return;
      }
      const list = parseBackup(text);
      importProjects(list);
      if (list.length === 1) onOpen();
    } catch (e) {
      setError(`No se pudo importar “${file.name}”: ${(e as Error).message}. Usa un archivo .fet de FET o el .json que se descarga con “Respaldo”.`);
    }
  };

  return (
    <div className="welcome">
      <header className="page-head">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />Horarios Web</div>
        <h1>Arma el horario de tu colegio</h1>
        <p>Ingresa la jornada, los cursos, los profesores y la carga académica. El horario se calcula en este computador con el motor de FET{inCloud ? '; tus datos se guardan en este navegador y en tu cuenta.' : '; los datos no salen de tu navegador.'}</p>
      </header>

      <div className="row">
        <button type="button" className="btn primary" onClick={() => { create('vacio'); onOpen(); }}>Nuevo horario</button>
        <button type="button" className="btn" onClick={() => { create('ejemplo'); onOpen(); }}>Probar con un liceo de ejemplo</button>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>Importar respaldo o archivo FET…</button>
        <input ref={fileRef} type="file" accept=".json,.fet,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {lastRemoved && (
        <div className="notice row" role="status">
          <span>Se eliminó “{lastRemoved.name}”.</span>
          <button type="button" className="btn small" onClick={restoreRemoved}>Deshacer</button>
        </div>
      )}

      <AccountCard />

      {list.length > 0 && (
        <section className="card">
          <div className="row"><h2>Tus horarios</h2><span className="spacer" />
            {list.length > 1 && <button type="button" className="btn small ghost" onClick={() => downloadBackup(list)}>Respaldar todos</button>}</div>
          <div className="projects">
            {list.map((p) => (
              // La tarjeta completa abre el horario; las demás acciones están en el menú ⋯.
              <article key={p.id} className="card project clickable" onClick={() => open(p.id)}>
                <div>
                  <h3>{p.name}</h3>
                  <span className="small muted">Año {p.year} · editado {new Date(p.updatedAt).toLocaleDateString('es-CL')}</span>
                </div>
                <div className="meta">
                  <span className="badge">{p.courses.length} cursos</span>
                  <span className="badge">{p.teachers.length} profesores</span>
                  {!p.timetable ? <span className="badge">Sin generar</span>
                    : isStale(p) ? <span className="badge warn" title="Los datos cambiaron después de generar">Horario desactualizado</span>
                    : <span className="badge ok">Horario generado</span>}
                  {needsBackup(p) && <span className="badge warn" title="Hay cambios sin respaldar desde hace más de una semana">Sin respaldo reciente</span>}
                </div>
                <div className="row" onClick={(e) => e.stopPropagation()}>
                  {confirmId === p.id ? <>
                    <span className="small">¿Eliminar este horario?</span>
                    <button type="button" className="btn small danger" onClick={() => { setConfirmId(null); remove(p.id); }}>Sí, eliminar</button>
                    <button type="button" className="btn small ghost" onClick={() => setConfirmId(null)}>Cancelar</button>
                  </> : <>
                    <button type="button" className="btn primary small" onClick={() => open(p.id)}>Abrir</button>
                    <span className="spacer" />
                    <MenuButton label="⋯" summaryClass="icon-btn" ariaLabel={`Más acciones para ${p.name}`} items={[
                      { label: 'Duplicar', title: 'Útil para empezar el año siguiente', onClick: () => duplicate(p.id) },
                      { label: 'Descargar respaldo', onClick: () => downloadBackup([p]) },
                      { label: 'Versiones anteriores', onClick: () => setVersionsId(p.id) },
                      { label: 'Eliminar', danger: true, onClick: () => setConfirmId(p.id) },
                    ]} />
                  </>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {versionsOf && <VersionsPanel key={versionsOf.id} projectId={versionsOf.id} name={versionsOf.name} onClose={() => setVersionsId(null)} />}
      {!inCloud && <p className="small muted">Los horarios se guardan en este navegador. Si borras los datos de navegación se pierden: descarga un respaldo de vez en cuando.</p>}
      <AppFooter />
    </div>
  );
}
