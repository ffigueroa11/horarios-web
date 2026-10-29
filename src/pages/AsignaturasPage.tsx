import { useCurrent, useProjects } from '../store/projects';
import { newId } from '../domain/types';
import { SUBJECT_COLORS } from '../domain/defaults';
import { PageHead, TextInput } from '../ui/common';

const COMMON: [string, string][] = [
  ['Lenguaje y Comunicación', 'LEN'], ['Matemática', 'MAT'], ['Inglés', 'ING'],
  ['Historia, Geografía y Cs. Sociales', 'HIS'], ['Ciencias Naturales', 'CNA'], ['Educación Física y Salud', 'EFI'],
  ['Artes Visuales', 'ART'], ['Música', 'MUS'], ['Tecnología', 'TEC'], ['Orientación', 'ORI'], ['Religión', 'REL'],
];

export function AsignaturasPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);

  const addSubject = (name = 'Nueva asignatura', short = '') => update((d) => {
    if (d.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    d.subjects.push({ id: newId(), name, short: short || name.slice(0, 3).toUpperCase(), color: SUBJECT_COLORS[d.subjects.length % SUBJECT_COLORS.length], roomId: null });
  });
  const removeSubject = (id: string) => update((d) => {
    const gone = new Set(d.assignments.filter((a) => a.subjectId === id).map((a) => a.id));
    d.subjects = d.subjects.filter((s) => s.id !== id);
    d.assignments = d.assignments.filter((a) => a.subjectId !== id);
    d.rules.subjectWindows = d.rules.subjectWindows.filter((w) => w.subjectId !== id);
    for (const k of Object.keys(d.locks)) if (gone.has(k.split('#')[0])) delete d.locks[k];
  });
  const removeRoom = (id: string) => update((d) => {
    d.rooms = d.rooms.filter((r) => r.id !== id);
    d.subjects.forEach((s) => { if (s.roomId === id) s.roomId = null; });
  });

  return (
    <>
      <PageHead title="Asignaturas y salas">
        Las asignaturas se usan en la carga académica. Si una asignatura necesita una sala especial (gimnasio, laboratorio), indícala: el horario evitará que dos cursos la usen al mismo tiempo.
      </PageHead>

      <section className="card">
        <div className="row"><h2>Asignaturas ({p.subjects.length})</h2><span className="spacer" />
          <button type="button" className="btn small" onClick={() => COMMON.forEach(([n, s]) => addSubject(n, s))}>Agregar asignaturas comunes</button>
          <button type="button" className="btn small primary" onClick={() => addSubject()}>Agregar asignatura</button></div>
        {p.subjects.length === 0 ? <div className="empty">Sin asignaturas todavía.</div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Color</th><th>Nombre</th><th>Sigla</th><th>Sala especial</th><th /></tr></thead>
              <tbody>
                {p.subjects.map((s) => (
                  <tr key={s.id}>
                    <td><input type="color" value={s.color} aria-label="Color" style={{ width: 36, height: 28, border: 0, background: 'none' }}
                      onChange={(e) => update((d) => { d.subjects.find((x) => x.id === s.id)!.color = e.target.value; })} /></td>
                    <td><TextInput value={s.name} ariaLabel="Nombre" onChange={(v) => update((d) => { d.subjects.find((x) => x.id === s.id)!.name = v; })} /></td>
                    <td style={{ width: 90 }}><TextInput value={s.short} ariaLabel="Sigla" onChange={(v) => update((d) => { d.subjects.find((x) => x.id === s.id)!.short = v.toUpperCase().slice(0, 5); })} /></td>
                    <td>
                      <select className="input" value={s.roomId ?? ''} aria-label="Sala especial"
                        onChange={(e) => update((d) => { d.subjects.find((x) => x.id === s.id)!.roomId = e.target.value || null; })}>
                        <option value="">Sala del curso</option>
                        {p.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td><button type="button" className="icon-btn" aria-label={`Eliminar ${s.name}`} onClick={() => removeSubject(s.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row"><h2>Salas especiales ({p.rooms.length})</h2><span className="spacer" />
          <button type="button" className="btn small" onClick={() => update((d) => { d.rooms.push({ id: newId(), name: `Sala ${d.rooms.length + 1}` }); })}>Agregar sala</button></div>
        <p className="muted small">Solo las que se comparten entre cursos. Cada curso usa su propia sala para el resto de las asignaturas.</p>
        {p.rooms.length > 0 && (
          <table className="data"><tbody>
            {p.rooms.map((r) => (
              <tr key={r.id}>
                <td><TextInput value={r.name} ariaLabel="Nombre de la sala" onChange={(v) => update((d) => { d.rooms.find((x) => x.id === r.id)!.name = v; })} /></td>
                <td className="small muted">{p.subjects.filter((s) => s.roomId === r.id).map((s) => s.name).join(', ') || 'Ninguna asignatura la usa'}</td>
                <td style={{ width: 40 }}><button type="button" className="icon-btn" aria-label={`Eliminar ${r.name}`} onClick={() => removeRoom(r.id)}>✕</button></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
    </>
  );
}
