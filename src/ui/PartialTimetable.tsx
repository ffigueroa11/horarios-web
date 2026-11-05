import { useMemo, useState } from 'react';
import type { ActivityKey, Project } from '../domain/types';
import { slotKey } from '../domain/types';
import { describeActivity, type PartialResult } from '../domain/fetResult';
import { lessonIndex, lessons, type Lesson } from '../domain/manual';
import { unitById, unitIdOf } from '../domain/units';
import { WeekGrid, type CellSpec } from './common';

type Mode = 'curso' | 'profesor';

/** Muestra hasta dónde llegó una generación que no terminó. Es solo de consulta: no toca el horario guardado. */
export function PartialTimetable({ project: p, partial, activity }: {
  project: Project;
  partial: PartialResult;
  /** Bloque que FET señala como problemático: se lista primero y su curso se muestra de entrada. */
  activity: ActivityKey | null;
}) {
  const problemCourse = activity ? unitById(p).get(unitIdOf(activity))?.audience[0]?.courseId : undefined;
  const [mode, setMode] = useState<Mode>('curso');
  const [ownerId, setOwnerId] = useState(problemCourse ?? '');
  const all = useMemo(() => lessons({ ...p, timetable: { generatedAt: '', seconds: 0, placements: partial.placements } }), [p, partial]);
  const index = useMemo(() => lessonIndex(p, all), [p, all]);

  const owners = mode === 'curso' ? p.courses : p.teachers;
  const owner = owners.find((o) => o.id === ownerId) ?? owners[0];
  const slots = owner ? index.get(`${mode}:${owner.id}`) : undefined;
  const total = partial.placements.length + partial.missing.length;
  const missing = activity && partial.missing.includes(activity)
    ? [activity, ...partial.missing.filter((k) => k !== activity)]
    : partial.missing;

  const chip = (l: Lesson, start: boolean) => {
    const s = p.subjects.find((x) => x.id === l.unit.subjectId);
    const teacher = p.teachers.find((t) => t.id === l.unit.teacherId)?.name ?? 'Sin profesor';
    const courses = [...new Set(l.unit.audience.map((a) => p.courses.find((c) => c.id === a.courseId)?.name ?? ''))].join(', ');
    return (
      <div key={l.pl.key} className="chip-lesson" style={{ background: s?.color ?? '#777', cursor: 'default' }} title={`${s?.name} · ${courses} · ${teacher}`}>
        <span className="s">{s?.name}{start ? '' : ' (cont.)'}</span>
        {start && <span className="w">{mode === 'curso' ? teacher : courses}</span>}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="horario-parcial">
      <div className="row">
        <h2 style={{ margin: 0 }}>Hasta dónde se llegó</h2>
        <span className="badge">{partial.placements.length} de {total} bloques</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Es el mejor intento y solo sirve de referencia: no se guarda ni reemplaza el horario actual.</p>

      {missing.length > 0 && (
        <details open={missing.length <= 20}>
          <summary><b>Bloques sin ubicar ({missing.length})</b></summary>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {missing.map((k) => <li key={k}>{k === activity ? <b>{describeActivity(p, k)}</b> : describeActivity(p, k)}</li>)}
          </ul>
        </details>
      )}

      <div className="row">
        <div className="tabs" role="group" aria-label="Ver por">
          {(['curso', 'profesor'] as Mode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setOwnerId(''); }}>
              {m === 'curso' ? 'Cursos' : 'Profesores'}</button>
          ))}
        </div>
        <select className="input" value={owner?.id ?? ''} aria-label="Elegir" onChange={(e) => setOwnerId(e.target.value)}>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <WeekGrid school={p.school} cell={(d, per): CellSpec => {
        const k = slotKey(d, per.id);
        if (p.school.closed.includes(k)) return { className: 'closed', title: 'Sin clases' };
        const hits = slots?.get(k) ?? [];
        return hits.length === 0 ? {} : { className: 'multi', content: hits.map((h) => chip(h.lesson, h.start)) };
      }} />
    </div>
  );
}
