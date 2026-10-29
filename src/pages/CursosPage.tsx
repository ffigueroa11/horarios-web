import { Fragment, useState } from 'react';
import { useCurrent, useProjects } from '../store/projects';
import type { Course, Division, Project } from '../domain/types';
import { newId } from '../domain/types';
import { courseLoad, openSlots } from '../domain/validate';
import { ConfirmButton, PageHead, TextInput } from '../ui/common';

const LEVELS = [
  '1° Básico', '2° Básico', '3° Básico', '4° Básico', '5° Básico', '6° Básico', '7° Básico', '8° Básico',
  '1° Medio', '2° Medio', '3° Medio', '4° Medio',
];

const PRESETS: { label: string; name: string; groups: string[]; parallel: boolean }[] = [
  { label: 'Inglés por nivel', name: 'Inglés por nivel', groups: ['Básico', 'Avanzado'], parallel: true },
  { label: 'Curso en dos grupos', name: 'Grupos', groups: ['Grupo 1', 'Grupo 2'], parallel: false },
  { label: 'Electivos', name: 'Electivos', groups: ['Electivo A', 'Electivo B', 'Electivo C'], parallel: true },
];

/** Quita grupos (y su carga) que ya no existen y limpia los bloques fijados de esa carga. */
function dropAssignments(d: Project, pred: (a: Project['assignments'][number]) => boolean) {
  const gone = new Set(d.assignments.filter(pred).map((a) => a.id));
  d.assignments = d.assignments.filter((a) => !gone.has(a.id));
  for (const k of Object.keys(d.locks)) if (gone.has(k.split('#')[0])) delete d.locks[k];
}

function DivisionsEditor({ course }: { course: Course }) {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const setC = (fn: (c: Course, d: Project) => void) => update((d) => fn(d.courses.find((x) => x.id === course.id)!, d));
  const setDiv = (id: string, fn: (v: Division) => void) => setC((c) => fn(c.divisions.find((x) => x.id === id)!));
  const sameLevel = p.courses.filter((c) => c.id !== course.id && c.level === course.level);
  const groupLoad = (gid: string) => p.assignments.filter((a) => a.groupId === gid).reduce((s, a) => s + a.blocks.reduce((x, y) => x + y, 0), 0);

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <p className="small muted">
        Una división separa a los alumnos del curso para algunas asignaturas; por ejemplo, Inglés por nivel. Cada alumno queda en un grupo de cada división.
        Luego, en “Carga académica”, cada asignatura se asigna a todo el curso o a un grupo.
      </p>
      {course.divisions.map((dv) => (
        <div key={dv.id} className="card">
          <div className="row">
            <label className="field" style={{ flex: '1 1 220px' }}><span>Nombre de la división</span>
              <TextInput value={dv.name} onChange={(v) => setDiv(dv.id, (x) => { x.name = v || 'División'; })} /></label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={dv.parallel} onChange={(e) => setDiv(dv.id, (x) => { x.parallel = e.target.checked; })} />
              <span>Clases de los grupos en paralelo<br /><span className="small muted">A la misma hora, emparejadas en el orden de la carga</span></span>
            </label>
            <span className="spacer" />
            <ConfirmButton label="Eliminar división" confirmLabel="Eliminar división y su carga"
              onConfirm={() => setC((c, d) => {
                const ids = new Set(dv.groups.map((g) => g.id));
                dropAssignments(d, (a) => !!a.groupId && ids.has(a.groupId));
                c.divisions = c.divisions.filter((x) => x.id !== dv.id);
              })} />
          </div>
          <div className="row">
            {dv.groups.map((g) => (
              <span key={g.id} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <TextInput value={g.name} ariaLabel="Nombre del grupo" className="input" onChange={(v) => setDiv(dv.id, (x) => { x.groups.find((y) => y.id === g.id)!.name = v || 'Grupo'; })} />
                <span className="badge">{groupLoad(g.id)} h</span>
                <button type="button" className="icon-btn" aria-label={`Quitar grupo ${g.name}`} disabled={dv.groups.length <= 2 && groupLoad(g.id) > 0}
                  onClick={() => update((d) => {
                    dropAssignments(d, (a) => a.groupId === g.id);
                    const x = d.courses.find((c) => c.id === course.id)!.divisions.find((y) => y.id === dv.id)!;
                    x.groups = x.groups.filter((y) => y.id !== g.id);
                  })}>✕</button>
              </span>
            ))}
            <button type="button" className="btn small" onClick={() => setDiv(dv.id, (x) => { x.groups.push({ id: newId(), name: `Grupo ${x.groups.length + 1}` }); })}>Agregar grupo</button>
          </div>
        </div>
      ))}
      <div className="row">
        <select className="input" value="" aria-label="Agregar división" onChange={(e) => {
          const pr = PRESETS[Number(e.target.value)];
          if (pr) setC((c) => { c.divisions.push({ id: newId(), name: pr.name, parallel: pr.parallel, groups: pr.groups.map((name) => ({ id: newId(), name })) }); });
        }}>
          <option value="">Agregar división…</option>
          {PRESETS.map((pr, i) => <option key={pr.label} value={i}>{pr.label} ({pr.groups.join(', ')})</option>)}
        </select>
        {course.divisions.length > 0 && sameLevel.length > 0 && (
          <button type="button" className="btn small" title="Copia la estructura de grupos, sin la carga"
            onClick={() => update((d) => {
              for (const other of d.courses.filter((c) => sameLevel.some((s) => s.id === c.id)))
                for (const dv of course.divisions)
                  if (!other.divisions.some((x) => x.name === dv.name))
                    other.divisions.push({ ...dv, id: newId(), groups: dv.groups.map((g) => ({ id: newId(), name: g.name })) });
            })}>Copiar divisiones a {sameLevel.map((c) => c.name).join(', ')}</button>
        )}
      </div>
    </div>
  );
}

export function CursosPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const [level, setLevel] = useState('1° Medio');
  const [letters, setLetters] = useState('A, B');
  const [open, setOpen] = useState<string | null>(null);
  const weekSlots = openSlots(p).reduce((s, d) => s + d.length, 0);

  const addMany = () => update((d) => {
    const ls = letters.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    for (const l of ls.length ? ls : ['']) {
      const name = `${level} ${l}`.trim();
      if (!d.courses.some((c) => c.name.toLowerCase() === name.toLowerCase())) d.courses.push({ id: newId(), name, level, divisions: [] });
    }
  });
  const removeCourse = (id: string) => update((d) => {
    dropAssignments(d, (a) => a.courseId === id);
    d.courses = d.courses.filter((c) => c.id !== id);
  });

  return (
    <>
      <PageHead title="Cursos">Cada curso tiene su propio horario. Agrega varios de una vez indicando el nivel y las letras.</PageHead>

      <section className="card">
        <h2>Agregar cursos</h2>
        <div className="row">
          <label className="field"><span>Nivel</span>
            <input className="input" list="levels" value={level} onChange={(e) => setLevel(e.target.value)} />
            <datalist id="levels">{LEVELS.map((l) => <option key={l} value={l} />)}</datalist></label>
          <label className="field"><span>Letras</span>
            <input className="input" value={letters} onChange={(e) => setLetters(e.target.value)} placeholder="A, B, C" /></label>
          <button type="button" className="btn primary" style={{ alignSelf: 'end' }} onClick={addMany}>Agregar</button>
        </div>
      </section>

      <section className="card">
        <h2>Cursos ({p.courses.length})</h2>
        {p.courses.length === 0 ? (
          <div className="empty">Aún no hay cursos. Agrega, por ejemplo, nivel “1° Medio” con letras “A, B”.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Curso</th><th>Nivel</th><th>Horas por alumno</th><th>Divisiones</th><th /></tr></thead>
              <tbody>
                {p.courses.map((c) => {
                  const load = courseLoad(p, c.id);
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td><TextInput value={c.name} ariaLabel="Nombre del curso" onChange={(v) => update((d) => { d.courses.find((x) => x.id === c.id)!.name = v; })} /></td>
                        <td><TextInput value={c.level} ariaLabel="Nivel" onChange={(v) => update((d) => { d.courses.find((x) => x.id === c.id)!.level = v; })} /></td>
                        <td><span className={`badge ${load > weekSlots ? 'bad' : load === 0 ? '' : 'ok'}`}>{load} de {weekSlots}</span></td>
                        <td>
                          <button type="button" className="btn small ghost" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                            {c.divisions.length ? c.divisions.map((d) => `${d.name} (${d.groups.length})`).join(', ') : 'Sin divisiones'} ▾
                          </button>
                        </td>
                        <td><button type="button" className="icon-btn" aria-label={`Eliminar ${c.name}`} onClick={() => removeCourse(c.id)}>✕</button></td>
                      </tr>
                      {open === c.id && (
                        <tr><td colSpan={5}><DivisionsEditor course={c} /></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
