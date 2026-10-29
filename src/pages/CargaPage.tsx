import { useState } from 'react';
import { useCurrent, useProjects } from '../store/projects';
import type { Project } from '../domain/types';
import { findGroup, newId } from '../domain/types';
import { courseLoad, hours, longestRun, openSlots } from '../domain/validate';
import { PageHead } from '../ui/common';
import { BlocksInput } from '../ui/BlocksInput';
import { ImportCarga } from '../ui/ImportCarga';

/**
 * Copia la carga de un curso a otro: agrega lo que falte, con el mismo profesor y bloques.
 * Las asignaturas de un grupo se copian al grupo con el mismo nombre (y división) del curso destino;
 * si no existe, se copian para todo el curso.
 */
function copyLoad(d: Project, fromId: string, toId: string) {
  const from = d.courses.find((c) => c.id === fromId);
  const to = d.courses.find((c) => c.id === toId);
  const mapGroup = (gid: string | null) => {
    const src = findGroup(from, gid);
    if (!src || !to) return null;
    const dv = to.divisions.find((x) => x.name === src.division.name);
    return dv?.groups.find((g) => g.name === src.group.name)?.id ?? null;
  };
  const have = new Set(d.assignments.filter((a) => a.courseId === toId).map((a) => `${a.groupId ?? ''}|${a.subjectId}`));
  for (const a of d.assignments.filter((x) => x.courseId === fromId)) {
    const groupId = mapGroup(a.groupId);
    if (!have.has(`${groupId ?? ''}|${a.subjectId}`))
      d.assignments.push({ id: newId(), courseId: toId, groupId, subjectId: a.subjectId, teacherId: a.teacherId, blocks: [...a.blocks] });
  }
}

export function CargaPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const [courseId, setCourseId] = useState(p.courses[0]?.id ?? '');
  const course = p.courses.find((c) => c.id === courseId) ?? p.courses[0];
  const weekSlots = openSlots(p).reduce((s, d) => s + d.length, 0);
  const maxRun = longestRun(p);
  const [importing, setImporting] = useState(false);
  const importButton = <button type="button" className="btn" onClick={() => setImporting(true)}>Importar desde Excel</button>;

  if (p.courses.length === 0 || p.subjects.length === 0)
    return (
      <>
        <PageHead title="Carga académica" actions={importButton} />
        {importing && <ImportCarga onClose={() => setImporting(false)} />}
        <div className="empty">Agrega cursos y asignaturas, o importa la carga completa desde una planilla Excel: los cursos, asignaturas y profesores se crean solos.</div>
      </>
    );

  const rows = p.assignments.filter((a) => a.courseId === course.id);
  const load = courseLoad(p, course.id);
  const setA = (id: string, fn: (a: Project['assignments'][number]) => void) => update((d) => fn(d.assignments.find((x) => x.id === id)!));
  const usedSubjects = new Set(rows.map((a) => a.subjectId));

  return (
    <>
      <PageHead title="Carga académica" actions={importButton}>
        Para cada curso: qué asignaturas tiene, quién las dicta y en qué bloques se reparten las horas semanales. Escribe los bloques como “2+2+2” (6 horas en tres bloques de 2) o “1” para una hora suelta.
      </PageHead>

      {importing && <ImportCarga onClose={() => setImporting(false)} />}

      <div className="tabs" role="group" aria-label="Curso">
        {p.courses.map((c) => {
          const l = courseLoad(p, c.id);
          return (
            <button key={c.id} type="button" aria-pressed={c.id === course.id} onClick={() => setCourseId(c.id)}>
              {c.name}<span className={`badge ${l > weekSlots ? 'bad' : l === 0 ? 'warn' : ''}`}>{l} h</span>
            </button>
          );
        })}
      </div>

      <section className="card">
        <div className="row">
          <h2>{course.name}</h2>
          <span className={`badge ${load > weekSlots ? 'bad' : 'ok'}`}>{load} de {weekSlots} bloques de la semana{course.divisions.length > 0 ? ' (por alumno)' : ''}</span>
          <span className="spacer" />
          {p.courses.length > 1 && (
            <select className="input" value="" aria-label="Copiar carga desde otro curso"
              onChange={(e) => { const from = e.target.value; if (from) update((d) => copyLoad(d, from, course.id)); }}>
              <option value="">Copiar carga desde…</option>
              {p.courses.filter((c) => c.id !== course.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="empty">Este curso aún no tiene asignaturas. Agrégalas una a una o copia la carga de otro curso del mismo nivel.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Asignatura</th>{course.divisions.length > 0 && <th>Para</th>}<th>Profesor</th><th>Bloques</th><th>Horas</th><th /></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const subj = p.subjects.find((s) => s.id === a.subjectId);
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="dot" style={{ background: subj?.color }} />
                          <select className="input" value={a.subjectId} aria-label="Asignatura"
                            onChange={(e) => setA(a.id, (x) => { x.subjectId = e.target.value; })}>
                            {p.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      </td>
                      {course.divisions.length > 0 && (
                        <td>
                          <select className="input" value={a.groupId ?? ''} aria-label="Para"
                            onChange={(e) => update((d) => {
                              d.assignments.find((x) => x.id === a.id)!.groupId = e.target.value || null;
                              for (const k of Object.keys(d.locks)) if (k.startsWith(`${a.id}#`)) delete d.locks[k];
                            })}>
                            <option value="">Todo el curso</option>
                            {course.divisions.map((dv) => (
                              <optgroup key={dv.id} label={dv.name}>
                                {dv.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        <select className="input" value={a.teacherId ?? ''} aria-label="Profesor"
                          style={{ borderColor: a.teacherId ? undefined : 'var(--warn)' }}
                          onChange={(e) => setA(a.id, (x) => { x.teacherId = e.target.value || null; })}>
                          <option value="">Sin profesor</option>
                          {p.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td><BlocksInput blocks={a.blocks} maxRun={maxRun} onChange={(b) => update((d) => {
                        d.assignments.find((x) => x.id === a.id)!.blocks = b;
                        for (const k of Object.keys(d.locks)) if (k.startsWith(`${a.id}#`)) delete d.locks[k];
                      })} /></td>
                      <td><span className="badge">{hours(a.blocks)}</span></td>
                      <td><button type="button" className="icon-btn" aria-label="Quitar asignatura" onClick={() => update((d) => {
                        d.assignments = d.assignments.filter((x) => x.id !== a.id);
                        for (const k of Object.keys(d.locks)) if (k.startsWith(`${a.id}#`)) delete d.locks[k];
                      })}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => update((d) => {
            const s = d.subjects.find((x) => !usedSubjects.has(x.id)) ?? d.subjects[0];
            d.assignments.push({ id: newId(), courseId: course.id, groupId: null, subjectId: s.id, teacherId: null, blocks: [2] });
          })}>Agregar asignatura al curso</button>
          {p.teachers.length === 0 && <span className="small muted">Agrega profesores para poder asignarlos.</span>}
        </div>
      </section>
    </>
  );
}
