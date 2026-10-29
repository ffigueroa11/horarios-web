import { useCurrent, useProjects } from '../store/projects';
import type { ElectiveBlock, Project } from '../domain/types';
import { newId } from '../domain/types';
import { hours, longestRun } from '../domain/validate';
import { ConfirmButton, PageHead, TextInput } from '../ui/common';
import { BlocksInput } from '../ui/BlocksInput';

/** Quita una franja y los bloques fijados de sus opciones. */
function removeElective(d: Project, id: string) {
  d.electives = d.electives.filter((e) => e.id !== id);
  for (const k of Object.keys(d.locks)) if (k.startsWith(`${id}:`)) delete d.locks[k];
}

export function ElectivosPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const maxRun = longestRun(p);
  const setE = (id: string, fn: (e: ElectiveBlock) => void) => update((d) => fn(d.electives.find((x) => x.id === id)!));

  const add = () => update((d) => {
    const level = d.courses[0]?.level;
    d.electives.push({
      id: newId(),
      name: `Electivos ${d.electives.length + 1}`,
      courseIds: d.courses.filter((c) => c.level === level).map((c) => c.id),
      options: [],
      blocks: [2, 2],
    });
  });

  return (
    <>
      <PageHead title="Electivos" actions={<button type="button" className="btn primary" onClick={add} disabled={p.courses.length === 0}>Agregar franja</button>}>
        Una <b>franja de electivos</b> reúne a los alumnos de varios cursos (ej. 3° y 4° Medio) y los reparte en
        opciones que van <b>a la misma hora</b>: cada alumno toma una. Cada opción tiene su asignatura y su profesor,
        y todas ocupan los mismos bloques de la semana.
      </PageHead>

      {p.electives.length === 0 && (
        <div className="empty">
          Sin franjas de electivos. Si los electivos son solo de un curso, también puedes usar una división del curso (en “Cursos”).
        </div>
      )}

      {p.electives.map((e) => {
        const teachers = e.options.map((o) => o.teacherId).filter(Boolean);
        const dupTeacher = (id: string | null) => !!id && teachers.filter((t) => t === id).length > 1;
        return (
          <section key={e.id} className="card">
            <div className="row">
              <TextInput className="input strong" ariaLabel="Nombre de la franja" value={e.name}
                onChange={(v) => setE(e.id, (x) => { x.name = v.trim() || x.name; })} />
              <label className="row small" style={{ gap: 6 }}>
                Bloques <BlocksInput blocks={e.blocks} maxRun={maxRun} onChange={(b) => setE(e.id, (x) => { x.blocks = b; })} />
              </label>
              <span className="badge">{hours(e.blocks)} h semanales</span>
              <span className="spacer" />
              <ConfirmButton label="Eliminar" confirmLabel="Eliminar franja" onConfirm={() => update((d) => removeElective(d, e.id))} />
            </div>

            <h3>Cursos que participan</h3>
            <div className="row">
              {p.courses.map((c) => (
                <label key={c.id} className="check small" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={e.courseIds.includes(c.id)} onChange={(ev) => setE(e.id, (x) => {
                    x.courseIds = ev.target.checked ? [...x.courseIds, c.id] : x.courseIds.filter((id) => id !== c.id);
                  })} />
                  {c.name}
                </label>
              ))}
            </div>

            <h3>Opciones</h3>
            {e.options.length === 0 && <p className="small muted">Agrega al menos dos opciones (ej. Biología celular, Filosofía política, Artes visuales).</p>}
            {e.options.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Asignatura</th><th>Profesor</th><th /></tr></thead>
                  <tbody>
                    {e.options.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <select className="input" value={o.subjectId} aria-label="Asignatura"
                            onChange={(ev) => setE(e.id, (x) => { x.options.find((y) => y.id === o.id)!.subjectId = ev.target.value; })}>
                            {p.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="input" value={o.teacherId ?? ''} aria-label="Profesor"
                            style={{ borderColor: dupTeacher(o.teacherId) ? 'var(--bad)' : undefined }}
                            title={dupTeacher(o.teacherId) ? 'Este profesor dicta otra opción de la misma franja, que va a la misma hora' : undefined}
                            onChange={(ev) => setE(e.id, (x) => { x.options.find((y) => y.id === o.id)!.teacherId = ev.target.value || null; })}>
                            <option value="">Sin profesor</option>
                            {p.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <button type="button" className="icon-btn" aria-label="Quitar opción" onClick={() => update((d) => {
                            const x = d.electives.find((y) => y.id === e.id)!;
                            x.options = x.options.filter((y) => y.id !== o.id);
                            for (const k of Object.keys(d.locks)) if (k.startsWith(`${e.id}:${o.id}#`)) delete d.locks[k];
                          })}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn small" disabled={p.subjects.length === 0}
                onClick={() => setE(e.id, (x) => {
                  const used = new Set(x.options.map((o) => o.subjectId));
                  const subject = p.subjects.find((s) => !used.has(s.id)) ?? p.subjects[0];
                  x.options.push({ id: newId(), subjectId: subject.id, teacherId: null });
                })}>Agregar opción</button>
              {p.subjects.length === 0 && <span className="small muted">Primero crea las asignaturas en “Asignaturas y salas”.</span>}
            </div>
          </section>
        );
      })}
    </>
  );
}
