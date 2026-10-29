import { useEffect, useState } from 'react';
import { useCurrent } from '../store/projects';
import { useGeneration } from '../store/generation';
import type { Issue } from '../domain/validate';
import { describeActivity } from '../domain/fetResult';
import type { Route } from '../App';
import { PageHead } from '../ui/common';

const STEP_LABEL: Record<string, string> = {
  jornada: 'Jornada', cursos: 'Cursos', asignaturas: 'Asignaturas y salas', salas: 'Asignaturas y salas',
  profesores: 'Profesores', carga: 'Carga académica', reglas: 'Preferencias',
};

function useElapsed(running: boolean, startedAt: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [running]);
  return running ? (now - startedAt) / 1000 : 0;
}

export function GenerarPage({ issues, go }: { issues: Issue[]; go: (r: Route) => void }) {
  const p = useCurrent()!;
  const g = useGeneration();
  const [limit, setLimit] = useState(300);
  const busy = g.status === 'loading' || g.status === 'running';
  const mine = g.projectId === p.id;
  const elapsed = useElapsed(busy, g.startedAt);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'aviso');
  const nLocks = Object.keys(p.locks).length;
  const nActs = p.assignments.reduce((n, a) => n + a.blocks.length, 0);

  const total = g.total || nActs;
  const cells = Math.min(total, 1500);
  const scale = cells / Math.max(total, 1);
  const placed = Math.round((g.progress?.placed ?? 0) * scale);
  const best = Math.round((g.progress?.best ?? 0) * scale);
  const o = g.outcome;

  return (
    <>
      <PageHead title="Generar horario">
        Antes de calcular se revisan los datos. El cálculo se hace en este computador; puede tardar desde segundos hasta varios minutos en colegios grandes.
      </PageHead>

      <section className="card">
        <div className="row"><h2>Revisión</h2><span className="spacer" />
          {errors.length === 0 && warnings.length === 0 && <span className="badge ok">Todo en orden</span>}
          {errors.length > 0 && <span className="badge bad">{errors.length} por corregir</span>}
          {warnings.length > 0 && <span className="badge warn">{warnings.length} avisos</span>}
        </div>
        <div className="row small">
          <span className="badge">{p.courses.length} cursos</span>
          <span className="badge">{p.teachers.length} profesores</span>
          <span className="badge">{nActs} bloques por ubicar</span>
          {nLocks > 0 && <span className="badge">{nLocks} bloques fijados se mantendrán</span>}
        </div>
        {issues.length > 0 && (
          <ul className="issues">
            {[...errors, ...warnings].map((i, k) => (
              <li key={k}>
                <span className={`badge ${i.level === 'error' ? 'bad' : 'warn'}`}>{i.level === 'error' ? 'Corregir' : 'Aviso'}</span>
                <span>{i.message} <a href={`#${i.step}`}>Ir a {STEP_LABEL[i.step]}</a></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row">
          <label className="field"><span>Tiempo máximo</span>
            <select className="input" value={limit} disabled={busy} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={60}>1 minuto</option><option value={300}>5 minutos</option>
              <option value={600}>10 minutos</option><option value={1800}>30 minutos</option>
            </select></label>
          <span className="spacer" />
          {busy && mine
            ? <button type="button" className="btn danger" onClick={g.cancel}>Detener</button>
            : <button type="button" className="btn primary" disabled={errors.length > 0 || busy} onClick={() => g.start(p, limit)}>
                {p.timetable ? 'Generar de nuevo' : 'Generar horario'}</button>}
        </div>
        {busy && !mine && <div className="notice warn">Se está generando otro horario. Espera a que termine.</div>}

        {mine && g.status !== 'idle' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="meter" aria-live="polite">
              <div><b>{g.status === 'loading' ? '…' : `${g.progress?.placed ?? 0}`}</b><span>bloques ubicados ahora</span></div>
              <div><b>{g.progress?.best ?? 0} / {total}</b><span>máximo alcanzado</span></div>
              <div><b>{busy ? elapsed.toFixed(1) : g.seconds.toFixed(1)} s</b><span>{g.status === 'loading' ? 'cargando el motor' : 'tiempo de cálculo'}</span></div>
            </div>
            <div className={`cells ${o?.kind === 'ok' ? 'done' : ''}`} aria-hidden="true">
              {Array.from({ length: cells }, (_, i) => <i key={i} className={i < placed ? 'on' : i < best ? 'best' : ''} />)}
            </div>
          </div>
        )}

        {mine && g.status === 'done' && o?.kind === 'ok' && (
          <div className="notice ok">
            <b>Horario generado en {g.seconds.toFixed(1)} segundos.</b>
            <span>Todos los bloques quedaron ubicados respetando las reglas obligatorias.</span>
            <div><button type="button" className="btn primary" onClick={() => go('horario')}>Ver horario</button></div>
          </div>
        )}
        {mine && g.status === 'done' && o && (o.kind === 'impossible' || o.kind === 'timeout') && (
          <div className="notice bad" role="alert">
            <b>{o.kind === 'impossible' ? 'Con estas reglas el horario es imposible.' : 'No se encontró un horario en el tiempo máximo.'}</b>
            {o.activity
              ? <span>El bloque que no se pudo ubicar es <b>{describeActivity(p, o.activity)}</b>{o.placedMax != null ? ` (se lograron ubicar ${o.placedMax} de ${total})` : ''}.</span>
              : <span>No se pudo identificar un bloque específico.</span>}
            <span>Qué revisar:</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>La disponibilidad y el máximo de días del profesor de ese bloque.</li>
              <li>Si la asignatura tiene una regla de bloques permitidos o una sala especial muy ocupada.</li>
              <li>Si es parte de una franja de electivos o de grupos en paralelo: todas sus opciones deben caber a la misma hora.</li>
              <li>Cambiar alguna regla de “obligatoria” a “preferible”, o subir el máximo de ventanas.</li>
              {o.kind === 'timeout' && <li>Volver a intentar con más tiempo: cada intento sigue un camino distinto.</li>}
            </ul>
          </div>
        )}
        {mine && g.status === 'done' && o?.kind === 'invalid' && (
          <div className="notice bad" role="alert">
            <b>El motor encontró un problema en los datos antes de empezar.</b>
            <span>Mensaje de FET (los nombres son los de tus cursos, profesores y asignaturas):</span>
            <pre className="log wrap">{o.details}</pre>
          </div>
        )}
        {mine && g.status === 'error' && <div className="notice bad" role="alert"><b>El motor falló.</b><span>{g.error}</span></div>}
        {mine && g.status === 'cancelled' && <div className="notice">Generación detenida.</div>}
        {mine && g.log.length > 0 && (
          <details><summary className="small muted">Registro del motor</summary><pre className="log">{g.log.join('\n')}</pre></details>
        )}
      </section>
    </>
  );
}
