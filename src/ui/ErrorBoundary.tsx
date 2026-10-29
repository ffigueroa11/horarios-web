import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useProjects } from '../store/projects';
import { downloadBackup } from './backup';

/** Si una pantalla falla, muestra qué hacer en vez de dejar la página en blanco, y permite descargar un respaldo. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Horarios Web:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const projects = Object.values(useProjects.getState().projects);
    return (
      <div className="welcome">
        <section className="card" role="alert">
          <h1>Algo salió mal en esta pantalla</h1>
          <p>Tus horarios siguen guardados en este navegador. Puedes volver a intentar, ir al inicio o descargar un respaldo por si acaso.</p>
          <pre className="log">{error.message}</pre>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>Volver a intentar</button>
            <button type="button" className="btn" onClick={() => { location.hash = 'proyectos'; this.setState({ error: null }); }}>Ir al inicio</button>
            {projects.length > 0 && <button type="button" className="btn" onClick={() => downloadBackup(projects)}>Descargar respaldo de todo</button>}
            <button type="button" className="btn ghost" onClick={() => location.reload()}>Recargar la página</button>
          </div>
          {__SOURCE_URL__ && <p className="small muted">Si se repite, puedes avisar en <a href={`${__SOURCE_URL__}/issues`} target="_blank" rel="noreferrer">el repositorio del proyecto</a> describiendo qué estabas haciendo.</p>}
        </section>
      </div>
    );
  }
}
