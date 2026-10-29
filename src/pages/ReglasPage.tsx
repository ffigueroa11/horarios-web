import { useCurrent, useProjects } from '../store/projects';
import type { Strength } from '../domain/types';
import { newId, slotKey } from '../domain/types';
import { NullableNumber, PageHead, WeekGrid } from '../ui/common';

function StrengthSelect({ value, onChange, label }: { value: Strength; onChange: (v: Strength) => void; label: string }) {
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as Strength)}>
      <option value="obligatoria">Obligatoria</option>
      <option value="preferible">Preferible</option>
    </select>
  );
}

export function ReglasPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const r = p.rules;
  const classPeriods = p.school.periods.filter((x) => x.kind === 'clase');
  const setR = (fn: (rules: typeof r) => void) => update((d) => fn(d.rules));

  return (
    <>
      <PageHead title="Preferencias">
        Reglas que el horario debe cumplir. Las <b>obligatorias</b> siempre se respetan; si no se pueden cumplir, no habrá horario. Las <b>preferibles</b> se cumplen siempre que sea posible.
      </PageHead>

      <section className="card">
        <h2>Cursos</h2>
        <label className="check"><input type="checkbox" checked={r.coursesNoGaps} onChange={(e) => setR((x) => { x.coursesNoGaps = e.target.checked; })} />
          <span><b>Sin horas libres entre clases</b><br /><span className="small muted">Los cursos no tienen “ventanas”: las clases del día son seguidas (sin contar recreos).</span></span></label>
        <label className="check"><input type="checkbox" checked={r.coursesStartFirstBlock} onChange={(e) => setR((x) => { x.coursesStartFirstBlock = e.target.checked; })} />
          <span><b>Todos los días empiezan en el primer bloque</b><br /><span className="small muted">Si un curso tiene menos horas que bloques, las horas libres quedan al final del día.</span></span></label>
        <div className="row">
          <label className="check" style={{ flex: '1 1 320px' }}><input type="checkbox" checked={r.spreadSubjectDays} onChange={(e) => setR((x) => { x.spreadSubjectDays = e.target.checked; })} />
            <span><b>Repartir cada asignatura en días distintos</b><br /><span className="small muted">Ej.: Matemática 2+2+2 queda en tres días diferentes, no dos bloques el mismo día.</span></span></label>
          {r.spreadSubjectDays && <StrengthSelect label="Fuerza de la regla" value={r.spreadStrength} onChange={(v) => setR((x) => { x.spreadStrength = v; })} />}
        </div>
        <label className="field"><span>Máximo de horas de clase por día</span>
          <NullableNumber value={r.courseMaxHoursDaily} max={16} placeholder="Sin límite" className="input" onChange={(v) => setR((x) => { x.courseMaxHoursDaily = v; })} /></label>
      </section>

      <section className="card">
        <h2>Profesores</h2>
        <p className="small muted">Una “ventana” es una hora libre entre dos clases del mismo día. Deja el campo vacío para no limitar.</p>
        <div className="row">
          <label className="field"><span>Máximo de ventanas por día</span>
            <NullableNumber value={r.teacherMaxGapsPerDay} max={10} placeholder="Sin límite" className="input" onChange={(v) => setR((x) => { x.teacherMaxGapsPerDay = v; })} /></label>
          <label className="field"><span>Máximo de ventanas por semana</span>
            <NullableNumber value={r.teacherMaxGapsPerWeek} max={50} placeholder="Sin límite" className="input" onChange={(v) => setR((x) => { x.teacherMaxGapsPerWeek = v; })} /></label>
          <label className="field"><span>Máximo de horas de clase por día</span>
            <NullableNumber value={r.teacherMaxHoursDaily} max={16} placeholder="Sin límite" className="input" onChange={(v) => setR((x) => { x.teacherMaxHoursDaily = v; })} /></label>
        </div>
        <p className="small muted">La disponibilidad y el máximo de días de cada profesor se configuran en “Profesores”. Limitar mucho las ventanas hace más difícil encontrar un horario.</p>
      </section>

      <section className="card">
        <h2>Consejo de profesores</h2>
        <p className="small muted">Bloques reservados en que ningún profesor hace clases (consejo, reunión de departamento, orientación). Haz clic para marcar o desmarcar.</p>
        <WeekGrid school={p.school} cell={(d, per) => {
          const k = slotKey(d, per.id);
          if (p.school.closed.includes(k)) return { className: 'closed' };
          const on = r.teacherMeetingSlots.includes(k);
          return {
            className: `toggle ${on ? 'off' : ''}`,
            title: on ? 'Reservado para el consejo (clic para liberar)' : 'Libre (clic para reservar)',
            content: on ? <span className="small">Consejo</span> : null,
            onClick: () => setR((x) => { x.teacherMeetingSlots = on ? x.teacherMeetingSlots.filter((y) => y !== k) : [...x.teacherMeetingSlots, k]; }),
          };
        }} />
      </section>

      <section className="card">
        <div className="row"><h2>Bloques permitidos por asignatura</h2><span className="spacer" />
          <button type="button" className="btn small" disabled={p.subjects.length === 0} onClick={() => setR((x) => {
            x.subjectWindows.push({ id: newId(), subjectId: p.subjects[0].id, strength: 'obligatoria', periodIds: classPeriods.slice(0, Math.ceil(classPeriods.length / 2)).map((c) => c.id) });
          })}>Agregar regla</button></div>
        <p className="small muted">Por ejemplo: “Educación Física no después del almuerzo” o “Matemática solo en la mañana”. Marca los bloques en que sí puede ir.</p>
        {r.subjectWindows.length === 0 && <div className="empty">Sin reglas por asignatura.</div>}
        {r.subjectWindows.map((w) => (
          <div key={w.id} className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="row">
              <select className="input" value={w.subjectId} aria-label="Asignatura"
                onChange={(e) => setR((x) => { x.subjectWindows.find((y) => y.id === w.id)!.subjectId = e.target.value; })}>
                {p.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="muted">solo en estos bloques:</span>
              <StrengthSelect label="Fuerza" value={w.strength} onChange={(v) => setR((x) => { x.subjectWindows.find((y) => y.id === w.id)!.strength = v; })} />
              <span className="spacer" />
              <button type="button" className="icon-btn" aria-label="Eliminar regla" onClick={() => setR((x) => { x.subjectWindows = x.subjectWindows.filter((y) => y.id !== w.id); })}>✕</button>
            </div>
            <div className="row">
              {classPeriods.map((c) => (
                <label key={c.id} className="check small" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={w.periodIds.includes(c.id)} onChange={(e) => setR((x) => {
                    const win = x.subjectWindows.find((y) => y.id === w.id)!;
                    win.periodIds = e.target.checked ? [...win.periodIds, c.id] : win.periodIds.filter((id) => id !== c.id);
                  })} />
                  {c.label} <span className="muted">{c.start}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
