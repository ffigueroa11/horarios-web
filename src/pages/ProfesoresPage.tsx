import { useState } from 'react';
import { useCurrent, useProjects } from '../store/projects';
import { newId, slotKey } from '../domain/types';
import { hours, openSlots, teacherLoad, teacherSlotsPerDay } from '../domain/validate';
import { units } from '../domain/units';
import { ConfirmButton, NullableNumber, PageHead, TextInput, WeekGrid } from '../ui/common';

export function ProfesoresPage() {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const [selId, setSelId] = useState<string | null>(p.teachers[0]?.id ?? null);
  const t = p.teachers.find((x) => x.id === selId) ?? null;
  const slots = openSlots(p);

  const add = () => {
    const id = newId();
    update((d) => { d.teachers.push({ id, name: `Profesor(a) ${d.teachers.length + 1}`, maxHours: null, maxDays: null, unavailable: [] }); });
    setSelId(id);
  };
  const setT = (fn: (x: NonNullable<typeof t>) => void) => update((d) => fn(d.teachers.find((x) => x.id === selId)!));

  const avail = t ? teacherSlotsPerDay(p, t).reduce((a, b) => a + b, 0) : 0;
  const load = t ? teacherLoad(p, t.id) : 0;

  return (
    <>
      <PageHead title="Profesores" actions={<button type="button" className="btn primary" onClick={add}>Agregar profesor</button>}>
        Registra a cada docente y marca cuándo no puede hacer clases. La carga horaria se asigna en el paso “Carga académica”.
      </PageHead>

      {p.teachers.length === 0 ? <div className="empty">Aún no hay profesores.</div> : (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' }}>
          <section className="card" style={{ alignContent: 'start' }}>
            <table className="data">
              <thead><tr><th>Profesor</th><th>Horas</th></tr></thead>
              <tbody>
                {p.teachers.map((x) => {
                  const l = teacherLoad(p, x.id);
                  const over = x.maxHours != null && l > x.maxHours;
                  return (
                    <tr key={x.id} onClick={() => setSelId(x.id)} style={{ cursor: 'pointer', background: x.id === selId ? 'var(--accent-soft)' : undefined }}>
                      <td><button type="button" className="btn ghost small" style={{ padding: 0 }} onClick={() => setSelId(x.id)}>{x.name}</button></td>
                      <td><span className={`badge ${over ? 'warn' : ''}`}>{l}{x.maxHours != null ? ` / ${x.maxHours}` : ''}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {t && (
            <section className="card">
              <div className="row">
                <label className="field" style={{ flex: '1 1 220px' }}><span>Nombre</span>
                  <TextInput value={t.name} onChange={(v) => setT((x) => { x.name = v; })} /></label>
                <label className="field"><span>Horas de contrato</span>
                  <NullableNumber value={t.maxHours} max={60} placeholder="—" onChange={(v) => setT((x) => { x.maxHours = v; })} /></label>
                <label className="field"><span>Máx. días por semana</span>
                  <NullableNumber value={t.maxDays} min={1} max={p.school.days.length} placeholder="—" onChange={(v) => setT((x) => { x.maxDays = v; })} /></label>
              </div>
              <div className="row small">
                <span className="badge">{load} horas asignadas</span>
                <span className={`badge ${load > avail ? 'bad' : 'ok'}`}>Disponible en {avail} bloques</span>
                <span className="spacer" />
                <ConfirmButton label="Eliminar profesor" confirmLabel="Sí, eliminar" onConfirm={() => {
                  update((d) => {
                    d.teachers = d.teachers.filter((x) => x.id !== t.id);
                    d.assignments.forEach((a) => { if (a.teacherId === t.id) a.teacherId = null; });
                  });
                  setSelId(null);
                }} />
              </div>

              <h3>Disponibilidad</h3>
              <p className="small muted">Haz clic en los bloques en que <b>no</b> puede hacer clases. Clic en el nombre del día para marcar o desmarcar el día completo.</p>
              <WeekGrid school={p.school}
                dayHeader={(d) => (
                  <button type="button" className="btn ghost small" onClick={() => setT((x) => {
                    const keys = slots[d].map((pid) => slotKey(d, pid));
                    const allOff = keys.every((k) => x.unavailable.includes(k));
                    x.unavailable = allOff ? x.unavailable.filter((k) => !keys.includes(k)) : [...new Set([...x.unavailable, ...keys])];
                  })}>{p.school.days[d]}</button>
                )}
                cell={(d, per) => {
                  const k = slotKey(d, per.id);
                  if (p.school.closed.includes(k)) return { className: 'closed' };
                  if (p.rules.teacherMeetingSlots.includes(k)) return { className: 'toggle off', title: 'Consejo de profesores (se configura en Preferencias)', content: <span className="small">Consejo</span> };
                  const off = t.unavailable.includes(k);
                  return {
                    className: `toggle ${off ? 'off' : ''}`,
                    title: off ? 'No disponible (clic para habilitar)' : 'Disponible (clic para bloquear)',
                    onClick: () => setT((x) => { x.unavailable = off ? x.unavailable.filter((y) => y !== k) : [...x.unavailable, k]; }),
                  };
                }} />

              <h3>Clases asignadas</h3>
              {(() => {
                const mine = units(p).filter((u) => u.teacherId === t.id);
                if (mine.length === 0) return <p className="small muted">Sin clases en la carga académica ni en electivos.</p>;
                return (
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {mine.map((u) => (
                      <li key={u.id}>
                        {p.subjects.find((s) => s.id === u.subjectId)?.name} · {u.kind === 'electivo'
                          ? `electivo (${p.electives.find((e) => e.id === u.electiveId)?.name})`
                          : p.courses.find((c) => c.id === u.audience[0].courseId)?.name} · {hours(u.blocks)} h
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </section>
          )}
        </div>
      )}
    </>
  );
}
