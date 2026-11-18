import type { Project } from '../domain/types';
import { stepsDone } from '../domain/validate';

const STEPS = [
  { id: 'jornada', label: 'Jornada', hint: 'días, bloques, recreos y almuerzo' },
  { id: 'cursos', label: 'Cursos', hint: 'agrega varios de una vez: nivel y letras' },
  { id: 'asignaturas', label: 'Asignaturas', hint: 'puedes partir con las asignaturas comunes' },
  { id: 'profesores', label: 'Profesores', hint: 'y cuándo no pueden hacer clases' },
  { id: 'carga', label: 'Carga académica', hint: 'qué asignaturas tiene cada curso, quién las dicta y cuántas horas' },
] as const;

/** Lista de primeros pasos, mientras falte algo de lo necesario para generar. Se muestra en la Jornada. */
export function FirstSteps({ project }: { project: Project }) {
  const done = stepsDone(project);
  if (STEPS.every((st) => done[st.id])) return null;
  return (
    <section className="card first-steps no-print" aria-labelledby="first-steps-title">
      <h2 id="first-steps-title">Primeros pasos</h2>
      <p className="small muted">Para generar el horario hace falta completar estos datos. Electivos y Preferencias son opcionales.</p>
      <ol>
        {STEPS.map((st) => (
          <li key={st.id} className={done[st.id] ? 'done' : ''}>
            <a href={`#${st.id}`}>{st.label}</a> <span className="small muted">— {st.hint}</span>
            {done[st.id] && <span className="sr-only"> (listo)</span>}
          </li>
        ))}
      </ol>
      <p className="small muted">¿Ya tienes los datos? La carga académica se puede importar desde Excel, y un archivo de FET desde el inicio.</p>
    </section>
  );
}
