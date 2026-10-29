import { PageHead } from '../ui/common';
import { AppFooter } from '../ui/AppFooter';
import { useHealth } from '../store/health';

export function AcercaPage({ back }: { back: () => void }) {
  const persisted = useHealth((s) => s.persisted);
  return (
    <div className="welcome">
      <PageHead title="Acerca de Horarios Web" actions={<button type="button" className="btn" onClick={back}>Volver</button>} />
      <section className="card">
        <h2>Qué es</h2>
        <p>Horarios Web arma el horario de un colegio a partir de su jornada, cursos, profesores, carga académica y preferencias.
          El cálculo lo hace el motor de <a href="https://lalescu.ro/liviu/fet/" target="_blank" rel="noreferrer">FET</a> (Liviu Lalescu y Volker Dirr),
          compilado para funcionar dentro del navegador. Es gratuito y de código abierto.</p>
      </section>
      <section className="card">
        <h2>Privacidad</h2>
        <ul>
          <li>Los datos (nombres de profesores, cursos, horarios) se guardan <b>solo en este navegador</b>. No hay cuentas ni servidor que los reciba.</li>
          <li>El horario se calcula en tu computador; la página no envía los datos a ningún lado.</li>
          <li>La app no usa cookies, publicidad ni herramientas de seguimiento.</li>
          <li>Si borras los datos de navegación del sitio, los horarios se pierden. Descarga un respaldo (.json) de vez en cuando; sirve también para pasar el trabajo a otro computador.</li>
          {persisted === false && <li>Este navegador no confirmó el guardado permanente: si se queda sin espacio podría borrar los datos del sitio. Un respaldo te protege.</li>}
        </ul>
      </section>
      <section className="card">
        <h2>Licencia</h2>
        <p>Horarios Web se distribuye bajo la licencia GNU AGPL v3 o posterior, la misma de FET. Puedes usarlo, estudiarlo, modificarlo y compartirlo;
          si publicas una versión modificada, debes ofrecer su código fuente a quienes la usen.</p>
      </section>
      <AppFooter />
    </div>
  );
}
