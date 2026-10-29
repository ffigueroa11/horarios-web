import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { needsBackup, useCurrent, useProjects } from './store/projects';
import { validate, type Step } from './domain/validate';
import { ProyectosPage } from './pages/ProyectosPage';
import { JornadaPage } from './pages/JornadaPage';
import { CursosPage } from './pages/CursosPage';
import { AsignaturasPage } from './pages/AsignaturasPage';
import { ProfesoresPage } from './pages/ProfesoresPage';
import { CargaPage } from './pages/CargaPage';
import { ElectivosPage } from './pages/ElectivosPage';
import { ReglasPage } from './pages/ReglasPage';
import { GenerarPage } from './pages/GenerarPage';
import { HorarioPage } from './pages/HorarioPage';
import { AcercaPage } from './pages/AcercaPage';
import { HealthNotices } from './ui/HealthNotices';
import { AppFooter } from './ui/AppFooter';
import { downloadBackup } from './ui/backup';

export type Route = Step | 'generar' | 'horario' | 'proyectos' | 'acerca';

const STEPS: { phase: string; items: { id: Route; label: string }[] }[] = [
  { phase: 'Datos del colegio', items: [
    { id: 'jornada', label: 'Jornada' },
    { id: 'cursos', label: 'Cursos' },
    { id: 'asignaturas', label: 'Asignaturas y salas' },
    { id: 'profesores', label: 'Profesores' },
    { id: 'carga', label: 'Carga académica' },
    { id: 'electivos', label: 'Electivos' },
  ] },
  { phase: 'Reglas', items: [{ id: 'reglas', label: 'Preferencias' }] },
  { phase: 'Horario', items: [{ id: 'generar', label: 'Generar' }, { id: 'horario', label: 'Ver y ajustar' }] },
];
const ALL = STEPS.flatMap((s) => s.items.map((i) => i.id));

function useHashRoute(): [Route, (r: Route) => void] {
  const read = () => {
    const h = location.hash.slice(1) as Route;
    return ALL.includes(h) || h === 'proyectos' || h === 'acerca' || h === 'salas' ? h : 'jornada';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { location.hash = r; }];
}

export default function App() {
  const hydrated = useProjects((s) => s.hydrated);
  const project = useCurrent();
  const select = useProjects((s) => s.select);
  const [route, go] = useHashRoute();
  const issues = useMemo(() => (project ? validate(project) : []), [project]);

  useEffect(() => { window.scrollTo(0, 0); }, [route]);

  if (!hydrated) return <div className="welcome"><p className="muted">Cargando…</p></div>;
  if (route === 'acerca') return <><HealthNotices /><AcercaPage back={() => history.length > 1 ? history.back() : go(project ? 'jornada' : 'proyectos')} /></>;
  if (!project || route === 'proyectos') return <><HealthNotices /><ProyectosPage onOpen={() => go('jornada')} /></>;

  const count = (step: Route) => issues.filter((i) => i.step === step);
  const badge = (step: Route): ReactNode => {
    const list = count(step);
    if (list.some((i) => i.level === 'error')) return <span className="badge bad">{list.filter((i) => i.level === 'error').length}</span>;
    if (list.length) return <span className="badge warn">{list.length}</span>;
    if (step === 'cursos') return <span className="badge">{project.courses.length}</span>;
    if (step === 'profesores') return <span className="badge">{project.teachers.length}</span>;
    if (step === 'horario' && project.timetable) return <span className="badge ok">✓</span>;
    return null;
  };

  let page: ReactNode;
  switch (route) {
    case 'jornada': page = <JornadaPage />; break;
    case 'cursos': page = <CursosPage />; break;
    case 'asignaturas': case 'salas': page = <AsignaturasPage />; break;
    case 'profesores': page = <ProfesoresPage />; break;
    case 'carga': page = <CargaPage />; break;
    case 'electivos': page = <ElectivosPage />; break;
    case 'reglas': page = <ReglasPage />; break;
    case 'generar': page = <GenerarPage issues={issues} go={go} />; break;
    case 'horario': page = <HorarioPage go={go} />; break;
  }

  let n = 0;
  return (
    <div className="app">
      <aside className="side no-print">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />Horarios Web</div>
        <div className="project-switch">
          <span className="small muted">Horario {project.year}</span>
          <span className="name">{project.name}</span>
          <button type="button" onClick={() => { select(null); go('proyectos'); }}>Cambiar de horario</button>
        </div>
        <nav aria-label="Pasos">
          <ul className="steps">
            {STEPS.map((ph) => [
              <li key={ph.phase} className="phase">{ph.phase}</li>,
              ...ph.items.map((it) => (
                <li key={it.id}>
                  <a href={`#${it.id}`} aria-current={route === it.id || (route === 'salas' && it.id === 'asignaturas') ? 'page' : undefined}>
                    <span className="num">{++n}</span>{it.label}{badge(it.id === 'asignaturas' ? 'asignaturas' : it.id)}
                  </a>
                </li>
              )),
            ])}
          </ul>
        </nav>
        <div className="foot">
          <p>Los datos se guardan solo en este navegador.</p>
          <button type="button" className={`btn small ${needsBackup(project) ? 'warn' : 'ghost'}`} onClick={() => downloadBackup([project])}
            title={project.backupAt ? `Último respaldo: ${new Date(project.backupAt).toLocaleString('es-CL')}` : 'Aún no hay respaldos de este horario'}>
            {needsBackup(project) ? 'Descargar respaldo (pendiente)' : 'Descargar respaldo'}
          </button>
          <AppFooter compact />
        </div>
      </aside>
      <main className="main"><HealthNotices />{page}</main>
    </div>
  );
}
