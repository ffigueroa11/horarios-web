import { useCurrent, useProjects } from '../store/projects';
import type { Period } from '../domain/types';
import { newId, slotKey } from '../domain/types';
import { DEFAULT_DAYS } from '../domain/defaults';
import { NullableNumber, PageHead, TextInput, WeekGrid } from '../ui/common';
import { openSlots } from '../domain/validate';

const addMinutes = (t: string, m: number) => {
  const [h, mm] = t.split(':').map(Number);
  const tot = (h * 60 + mm + m + 24 * 60) % (24 * 60);
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
};

export function JornadaPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const { school } = p;
  const weekSlots = openSlots(p).reduce((s, d) => s + d.length, 0);

  const setPeriod = (id: string, patch: Partial<Period>) =>
    update((d) => { Object.assign(d.school.periods.find((x) => x.id === id)!, patch); });
  const move = (i: number, dir: -1 | 1) => update((d) => {
    const ps = d.school.periods; const j = i + dir;
    if (j < 0 || j >= ps.length) return;
    [ps[i], ps[j]] = [ps[j], ps[i]];
  });
  const removePeriod = (id: string) => update((d) => {
    d.school.periods = d.school.periods.filter((x) => x.id !== id);
    d.school.closed = d.school.closed.filter((k) => !k.endsWith(`:${id}`));
  });
  const addPeriod = () => update((d) => {
    const last = d.school.periods[d.school.periods.length - 1];
    const n = d.school.periods.filter((x) => x.kind === 'clase').length + 1;
    const start = last ? last.end : '08:00';
    d.school.periods.push({ id: newId(), label: `${n}° bloque`, start, end: addMinutes(start, 45), kind: 'clase' });
  });
  const setDays = (n: number) => update((d) => {
    d.school.days = DEFAULT_DAYS.concat(['Sábado']).slice(0, n);
    const keep = (k: string) => Number(k.split(':')[0]) < n;
    d.school.closed = d.school.closed.filter(keep);
    d.teachers.forEach((t) => { t.unavailable = t.unavailable.filter(keep); });
    for (const [k, v] of Object.entries(d.locks)) if (v.day >= n) delete d.locks[k];
  });

  return (
    <>
      <PageHead title="Jornada">
        Define los días y los bloques de clase con su horario real. Los recreos y el almuerzo separan bloques: ninguna clase de 2 horas quedará cortada por un recreo.
      </PageHead>

      <section className="card">
        <div className="grid-2">
          <label className="field"><span>Nombre del horario</span>
            <TextInput value={p.name} onChange={(v) => update((d) => { d.name = v || 'Horario'; })} /></label>
          <label className="field"><span>Colegio</span>
            <TextInput value={school.name} placeholder="Nombre del establecimiento" onChange={(v) => update((d) => { d.school.name = v; })} /></label>
        </div>
        <div className="row">
          <label className="field"><span>Año escolar</span>
            <NullableNumber value={p.year} min={2000} max={2100} onChange={(v) => v && update((d) => { d.year = v; })} /></label>
          <label className="field"><span>Días de clases</span>
            <select className="input" value={school.days.length} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={5}>Lunes a viernes</option>
              <option value={6}>Lunes a sábado</option>
            </select></label>
          <span className="spacer" />
          <span className="badge ok">{weekSlots} bloques de clase a la semana</span>
        </div>
      </section>

      <section className="card">
        <div className="row"><h2>Bloques del día</h2><span className="spacer" />
          <button type="button" className="btn small" onClick={addPeriod}>Agregar tramo</button></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Nombre</th><th>Inicio</th><th>Término</th><th>Tipo</th><th /></tr></thead>
            <tbody>
              {school.periods.map((x, i) => (
                <tr key={x.id}>
                  <td><TextInput value={x.label} ariaLabel="Nombre del tramo" onChange={(v) => setPeriod(x.id, { label: v })} /></td>
                  <td><input className="input time" type="time" value={x.start} onChange={(e) => setPeriod(x.id, { start: e.target.value })} aria-label="Inicio" /></td>
                  <td><input className="input time" type="time" value={x.end} onChange={(e) => setPeriod(x.id, { end: e.target.value })} aria-label="Término" /></td>
                  <td>
                    <select className="input" value={x.kind} aria-label="Tipo" onChange={(e) => setPeriod(x.id, { kind: e.target.value as Period['kind'] })}>
                      <option value="clase">Clase</option><option value="recreo">Recreo</option><option value="almuerzo">Almuerzo</option>
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="icon-btn" aria-label="Subir" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="icon-btn" aria-label="Bajar" onClick={() => move(i, 1)} disabled={i === school.periods.length - 1}>↓</button>
                    <button type="button" className="icon-btn" aria-label="Eliminar tramo" onClick={() => removePeriod(x.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Tramos sin clases</h2>
        <p className="muted small">Marca los bloques que no se usan en un día específico; por ejemplo, la tarde del viernes en una jornada corta. Haz clic para cambiar.</p>
        <WeekGrid school={school} cell={(d, per) => {
          const k = slotKey(d, per.id);
          const closed = school.closed.includes(k);
          return {
            className: `toggle ${closed ? 'closed' : 'allowed'}`,
            content: closed ? <span className="small muted">Sin clases</span> : null,
            title: closed ? 'Sin clases (clic para habilitar)' : 'Con clases (clic para cerrar)',
            onClick: () => update((dr) => {
              dr.school.closed = closed ? dr.school.closed.filter((x) => x !== k) : [...dr.school.closed, k];
            }),
          };
        }} />
      </section>
    </>
  );
}
