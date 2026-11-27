// Diagnóstico de la generación: por qué no hay horario y qué cambio lo haría posible.
// Los hallazgos vienen de domain/diagnose.ts; las alternativas se evalúan con store/relax.ts y solo se aplican al
// proyecto cuando el usuario lo confirma.
import { useState } from 'react';
import type { Project } from '../domain/types';
import type { Diagnosis, Finding } from '../domain/diagnose';
import { relaxPlan, type Change } from '../domain/relax';
import { RELAX_MAX_VARIANTS, RELAX_SECONDS, useRelax, type ItemStatus, type RelaxItem } from '../store/relax';
import { STEP_LABEL } from './steps';

const STATUS: Record<ItemStatus, { label: string; badge: string; text: (x: RelaxItem) => string }> = {
  funciona: { label: 'Funciona', badge: 'ok', text: (x) => `El motor encontró un horario completo en ${x.seconds.toFixed(1)} s.` },
  'no-basta': { label: 'No basta', badge: 'bad', text: () => 'El motor concluyó que con este cambio tampoco hay horario.' },
  'sin-resolver': { label: 'Sin resolver', badge: 'warn', text: (x) => `Se agotó el tiempo (${x.budget} s)${x.placedMax != null ? ` con ${x.placedMax} de ${x.total} bloques ubicados` : ''}. No se sabe si este cambio basta: puede faltar tiempo.` },
  rechazada: { label: 'Datos rechazados', badge: 'bad', text: () => 'Con este cambio el motor rechaza los datos antes de buscar.' },
  fallo: { label: 'Falló', badge: 'bad', text: () => 'El motor falló al evaluar este cambio.' },
  cancelada: { label: 'Detenida', badge: '', text: () => 'Se detuvo antes de terminar.' },
  pendiente: { label: 'Sin evaluar', badge: '', text: () => 'Aún no se evalúa.' },
  evaluando: { label: 'Evaluando…', badge: 'warn', text: (x) => `Hasta ${x.budget} s.` },
};

const TIMES = [15, 30, 60];

function Entities({ p, f }: { p: Project; f: Finding }) {
  const names = <T extends { id: string; name: string }>(list: T[], ids: string[]) => ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean).join(', ');
  const parts = [
    ['Profesores', names(p.teachers, f.entities.teachers)],
    ['Cursos', names(p.courses, f.entities.courses)],
    ['Asignaturas', names(p.subjects, f.entities.subjects)],
    ['Salas', names(p.rooms, f.entities.rooms)],
  ].filter(([, v]) => v);
  if (parts.length === 0) return null;
  return <span className="small muted">{parts.map(([k, v]) => <span key={k}><b>{k}:</b> {v}. </span>)}</span>;
}

function FindingItem({ p, f }: { p: Project; f: Finding }) {
  return (
    <li className={`finding ${f.certainty}`}>
      <div className="row">
        {f.certainty === 'demostrado'
          ? <span className="badge bad">Demostrado</span>
          : <span className="badge warn">Hipótesis{f.severity === 'alta' ? ' · probable' : ''}</span>}
        {f.related && <span className="badge">Relacionado con lo pendiente</span>}
      </div>
      <b>{f.title}</b>
      {f.evidence.length > 0 && <ul className="small evidence">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <Entities p={p} f={f} />
      <span className="small">Qué hacer: {f.action} <a href={`#${f.step}`}>Ir a {STEP_LABEL[f.step]}</a></span>
    </li>
  );
}

export function DiagnosisPanel({ project: p, dx, busy, onGenerate, onApply }: {
  project: Project;
  dx: Diagnosis;
  /** Hay una generación en curso: no se puede evaluar. */
  busy: boolean;
  /** Genera con la semilla de la evaluación, para repetir el horario que encontró. */
  onGenerate: (seed: number) => void;
  /** Aplica el cambio confirmado al proyecto y genera con la misma semilla. */
  onApply: (change: Change, title: string, seed: number) => void;
}) {
  const r = useRelax();
  const [seconds, setSeconds] = useState(RELAX_SECONDS);
  const [confirming, setConfirming] = useState<string | null>(null);
  const proven = dx.findings.filter((f) => f.certainty === 'demostrado');
  const hyp = dx.findings.filter((f) => f.certainty === 'hipotesis');
  const plan = relaxPlan(p, dx, RELAX_MAX_VARIANTS);

  // Resultados de este horario y de estos mismos datos (un proyecto guardado nunca se modifica en su lugar).
  const mine = r.projectId === p.id;
  const current = mine && r.source === p;
  const running = r.phase === 'running';
  const items = current ? r.items : [];
  const evaluating = items.findIndex((x) => x.status === 'evaluando');
  const done = items.filter((x) => x.status !== 'pendiente' && x.status !== 'evaluando').length;
  const baselineWorks = items.some((x) => x.change == null && x.status === 'funciona');
  const canContinue = !running && items.some((x) => x.status === 'pendiente' || x.status === 'cancelada');
  const canRetry = !running && items.some((x) => x.status === 'sin-resolver' && x.budget < 120);

  const start = () => {
    setConfirming(null);
    r.start(p, plan, { seconds, baseline: dx.proven === 0 });
  };
  const apply = (x: RelaxItem) => {
    if (!x.change) return;
    setConfirming(null);
    const seed = r.seed;
    r.reset();
    onApply(x.change, x.title, seed);
  };

  return (
    <section className="card" aria-labelledby="dx-title" data-testid="diagnostico">
      <div className="row">
        <h2 id="dx-title">Diagnóstico</h2><span className="spacer" />
        {dx.proven > 0 && <span className="badge bad">{dx.proven} {dx.proven === 1 ? 'impedimento demostrado' : 'impedimentos demostrados'}</span>}
        {dx.hypotheses > 0 && <span className="badge warn">{dx.hypotheses} hipótesis</span>}
      </div>
      <p style={{ margin: 0 }}>{dx.summary}</p>

      {dx.pending && dx.pending.total > dx.pending.placed && (
        <div className="notice small">
          <b>{dx.pending.total - dx.pending.placed} de {dx.pending.total} bloques quedaron sin ubicar en el mejor intento.</b>
          <span>Más repetidos entre ellos:{' '}
            {[...dx.pending.teachers, ...dx.pending.courses, ...dx.pending.subjects].length === 0 ? '—'
              : [['profesores', dx.pending.teachers], ['cursos', dx.pending.courses], ['asignaturas', dx.pending.subjects]]
                .filter(([, l]) => (l as unknown[]).length > 0)
                .map(([k, l]) => `${k}: ${(l as { name: string; n: number }[]).map((x) => `${x.name} (${x.n})`).join(', ')}`).join('; ')}.</span>
        </div>
      )}

      {proven.length > 0 && <>
        <h3>Imposible con estos datos</h3>
        <p className="small muted" style={{ margin: 0 }}>Se comprobó contando horas, bloques seguidos y días: ningún horario cumple a la vez estas reglas obligatorias.</p>
        <ul className="findings">{proven.map((f) => <FindingItem key={f.id} p={p} f={f} />)}</ul>
      </>}
      {hyp.length > 0 && (
        <details open={proven.length === 0}>
          <summary><b>Posibles dificultades ({hyp.length})</b> <span className="small muted">· hipótesis, no comprobadas</span></summary>
          <p className="small muted" style={{ margin: '6px 0' }}>Tienen poco margen o combinan reglas estrictas. Pueden explicar el problema, pero no lo demuestran: compruébalo con la evaluación de alternativas.</p>
          <ul className="findings">{hyp.map((f) => <FindingItem key={f.id} p={p} f={f} />)}</ul>
        </details>
      )}
      {dx.findings.length === 0 && <p className="small muted" style={{ margin: 0 }}>No se encontraron condiciones imposibles ni de poco margen al contar horas y bloques.</p>}

      <h3>¿Qué cambio lo haría posible?</h3>
      {mine && !current && r.items.length > 0 && !running && (
        <div className="notice warn small">Los datos cambiaron después de la última evaluación: sus resultados ya no valen.</div>
      )}
      {r.projectId && !mine && running && (
        <div className="notice warn small">Se están evaluando alternativas de otro horario. <button type="button" className="btn small" onClick={r.cancel}>Detener</button></div>
      )}

      {items.length === 0 && plan.length === 0 && <p className="small muted" style={{ margin: 0 }}>No hay reglas que se puedan aflojar ni bloques fijados que liberar.</p>}
      {items.length === 0 && plan.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="small">
            Se prueban con el motor hasta {plan.length} cambios, uno a la vez y con la misma semilla, del más pequeño al más grande{dx.proven === 0 ? ', además de los datos sin cambios para comparar' : ''}. Se detiene en el primero que funciona.
            <b> No cambia tus datos:</b> tú decides si aplicas alguno.
          </span>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || running} onClick={start}>Evaluar alternativas</button>
            <label className="row small">Tiempo por alternativa
              <select className="input" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {TIMES.map((s) => <option key={s} value={s}>{s} segundos</option>)}
              </select></label>
            {busy && <span className="small muted">Espera a que termine la generación.</span>}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="row" aria-live="polite">
            {running
              ? <span className="small"><b>Evaluando {evaluating + 1} de {items.length}…</b> {items[evaluating]?.title}</span>
              : <span className="small">{r.phase === 'cancelled' ? 'Evaluación detenida.' : 'Evaluación terminada.'} {done} de {items.length} evaluadas.</span>}
            <span className="spacer" />
            {running && <button type="button" className="btn danger small" onClick={r.cancel}>Detener</button>}
            {canContinue && <button type="button" className="btn small" disabled={busy} onClick={r.continueRest}>Probar las demás</button>}
            {canRetry && <button type="button" className="btn small" disabled={busy} onClick={r.retryLonger}>Buscar con más tiempo</button>}
            {!running && <button type="button" className="btn small ghost" disabled={busy} onClick={start}>Evaluar de nuevo</button>}
          </div>
          {baselineWorks && (
            <div className="notice ok">
              <b>Sin cambiar nada, con otra semilla, el motor sí encontró un horario.</b>
              <span>No hace falta aflojar reglas: genera de nuevo con esta semilla.</span>
              <div><button type="button" className="btn primary small" disabled={busy} onClick={() => onGenerate(r.seed)}>Generar con esta semilla</button></div>
            </div>
          )}
          <ul className="findings" data-testid="alternativas">
            {items.map((x) => {
              const st = STATUS[x.status];
              return (
                <li key={x.id} className="finding">
                  <div className="row"><span className={`badge ${st.badge}`}>{st.label}</span><b>{x.title}</b></div>
                  <span className="small muted">{x.effect}</span>
                  <span className="small">{st.text(x)}</span>
                  {x.status === 'funciona' && x.change && (confirming === x.id
                    ? (
                      <div className="notice warn" role="alertdialog" aria-label="Confirmar el cambio">
                        <b>¿Aplicar este cambio a tus datos?</b>
                        <span>{x.title}. {x.effect}</span>
                        <span className="small">Después se genera el horario con la misma semilla. Puedes deshacerlo con «Deshacer».</span>
                        <div className="row">
                          <button type="button" className="btn primary small" disabled={busy || running} onClick={() => apply(x)}>Sí, aplicar y generar</button>
                          <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Cancelar</button>
                        </div>
                      </div>)
                    : <div><button type="button" className="btn small" disabled={busy || running} onClick={() => setConfirming(x.id)}>Aplicar este cambio…</button></div>)}
                </li>
              );
            })}
          </ul>
          {r.error && <div className="notice bad small" role="alert">{r.error}</div>}
        </div>
      )}
    </section>
  );
}
