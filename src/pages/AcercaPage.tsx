import { PageHead } from '../ui/common';
import { AppFooter } from '../ui/AppFooter';
import { useHealth } from '../store/health';
import { cloudEnabled } from '../cloud/config';

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
          {cloudEnabled ? <>
            <li><b>Sin cuenta</b>, los datos (nombres de profesores, cursos, horarios) se guardan solo en este navegador, y la app no se conecta a ningún servidor para guardarlos.</li>
            <li><b>Con una cuenta, que es opcional</b>, tu correo y tus horarios se guardan en Firebase, un servicio de Google, para respaldarlos y abrirlos en otros equipos. Los datos de las cuentas se procesan en Estados Unidos. Los horarios no se cifran con una clave tuya: quien administra este sitio podría acceder a ellos desde la consola de Firebase.</li>
            <li>Si cargas datos de otras personas, como los nombres de los profesores, usa una cuenta solo si tu colegio lo autoriza.</li>
            <li>Puedes eliminar tu cuenta y tus horarios en la nube cuando quieras desde la pantalla de inicio. Google los borra de sus sistemas dentro de los plazos que indica en su documentación.</li>
            <li>El horario siempre se calcula en tu computador.</li>
            <li>La app no usa publicidad ni herramientas de seguimiento. Solo con una cuenta, Firebase guarda en el navegador los datos de la sesión.</li>
          </> : <>
            <li>Los datos (nombres de profesores, cursos, horarios) se guardan <b>solo en este navegador</b>. No hay cuentas ni servidor que los reciba.</li>
            <li>El horario se calcula en tu computador; la página no envía los datos a ningún lado.</li>
            <li>La app no usa cookies, publicidad ni herramientas de seguimiento.</li>
          </>}
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
