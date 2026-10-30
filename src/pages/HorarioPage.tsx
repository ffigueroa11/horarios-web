import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { isStale, useCurrent, useProjects } from '../store/projects';
import type { ActivityKey, Period, Project } from '../domain/types';
import { slotKey } from '../domain/types';
import { exportFet } from '../domain/fetExport';
import { applyMove, applySwap, checkPlace, companions, lessons, type Lesson, type PlaceCheck } from '../domain/manual';
import { findEffectiveGroup } from '../domain/units';
import { describeActivity } from '../domain/fetResult';
import type { Route } from '../App';
import { PageHead, WeekGrid, type CellSpec } from '../ui/common';
import { downloadText, fileSafe } from '../ui/download';
import { exportTimetableXlsx } from '../ui/exportXlsx';

type Mode = 'curso' | 'profesor' | 'sala';

interface Hit { lesson: Lesson; start: boolean }

/**
 * Índice: para cada curso/profesor/sala, qué clases ocupan cada tramo. Un tramo de un curso puede tener
 * varias clases a la vez cuando el curso está dividido en grupos o tiene una franja de electivos.
 */
function buildIndex(p: Project, all: Lesson[]) {
  const byOwner = new Map<string, Map<string, Hit[]>>();
  const put = (owner: string, k: string, v: Hit) => {
    if (!byOwner.has(owner)) byOwner.set(owner, new Map());
    const m = byOwner.get(owner)!;
    m.set(k, [...(m.get(k) ?? []), v]);
  };
  for (const lesson of all) {
    const { pl, unit, dur, startIdx } = lesson;
    for (let k = 0; k < dur; k++) {
      const period = p.school.periods[startIdx + k];
      if (!period) break;
      const v = { lesson, start: k === 0 };
      const sk = slotKey(pl.day, period.id);
      for (const courseId of new Set(unit.audience.map((a) => a.courseId))) put(`curso:${courseId}`, sk, v);
      if (unit.teacherId) put(`profesor:${unit.teacherId}`, sk, v);
      if (pl.roomId) put(`sala:${pl.roomId}`, sk, v);
    }
  }
  return byOwner;
}

function countGaps(p: Project, slots: Map<string, unknown> | undefined) {
  if (!slots) return 0;
  let gaps = 0;
  p.school.days.forEach((_, d) => {
    const busy = p.school.periods.filter((x) => x.kind === 'clase').map((x) => slots.has(slotKey(d, x.id)));
    const first = busy.indexOf(true), last = busy.lastIndexOf(true);
    if (first >= 0) for (let i = first; i <= last; i++) if (!busy[i]) gaps++;
  });
  return gaps;
}

/** Nombre del grupo (o franja de electivos) con que una clase llega a un curso. */
function groupLabel(p: Project, l: Lesson, courseId: string): string | undefined {
  if (l.unit.kind === 'electivo') return p.electives.find((e) => e.id === l.unit.electiveId)?.name || 'Electivo';
  const a = l.unit.audience.find((x) => x.courseId === courseId);
  return a ? findEffectiveGroup(p, p.courses.find((c) => c.id === courseId), a.groupId)?.group.name : undefined;
}

const DRAG_TYPE = 'text/x-horario-bloque';

export function HorarioPage({ go }: { go: (r: Route) => void }) {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const [mode, setMode] = useState<Mode>('curso');
  const [ownerId, setOwnerId] = useState<string>('');
  const [printAll, setPrintAll] = useState(false);
  const [selected, setSelected] = useState<ActivityKey[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  // Motivo por el que no se puede soltar un bloque: junto al cursor mientras se arrastra, y como aviso breve
  // abajo de la pantalla si se suelta igual o se hace clic en un lugar no válido.
  const [hint, setHint] = useState<{ text: string; x: number; y: number; swap?: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastInvalid = useRef<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const all = useMemo(() => lessons(p), [p]);
  const index = useMemo(() => buildIndex(p, all), [p, all]);
  // Lugares válidos para lo seleccionado: se calcula una vez por selección (no en cada celda de cada vista).
  const targets = useMemo(() => {
    const m = new Map<string, PlaceCheck>();
    if (!selected) return m;
    p.school.days.forEach((_, d) => p.school.periods.forEach((per) => {
      if (per.kind === 'clase') m.set(slotKey(d, per.id), checkPlace(p, selected, d, per.id, all));
    }));
    return m;
  }, [p, all, selected]);

  // Escape suelta la selección.
  useEffect(() => {
    if (!selected) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [selected]);

  if (!p.timetable)
    return (
      <>
        <PageHead title="Ver y ajustar" />
        <div className="empty">Todavía no hay un horario generado.<button type="button" className="btn primary" onClick={() => go('generar')}>Ir a generar</button></div>
      </>
    );

  const owners = mode === 'curso' ? p.courses : mode === 'profesor' ? p.teachers : p.rooms;
  const owner = owners.find((o) => o.id === ownerId) ?? owners[0];
  const subject = (id: string) => p.subjects.find((s) => s.id === id);
  const teacher = (id: string | null) => p.teachers.find((t) => t.id === id);
  const courseName = (id: string) => p.courses.find((c) => c.id === id)?.name ?? '';

  const selectedSet = new Set(selected ?? []);
  const isLocked = (key: ActivityKey) => !!p.locks[key];

  const select = (l: Lesson) => {
    const keys = companions(p, l.pl.key);
    if (selected && keys.every((k) => selectedSet.has(k))) { setSelected(null); return; }
    setSelected(keys);
    setMessage(null);
  };

  const toggleLock = (keys: ActivityKey[]) => update((d) => {
    const lock = !keys.every((k) => d.locks[k]);
    for (const k of keys) {
      const pl = d.timetable?.placements.find((x) => x.key === k);
      if (!lock) delete d.locks[k];
      else if (pl) d.locks[k] = { day: pl.day, periodId: pl.periodId };
    }
  }, { touch: false });

  const subjectOfKey = (k: ActivityKey) => subject(all.find((l) => l.pl.key === k)?.unit.subjectId ?? '')?.name ?? 'el bloque';

  const tryMove = (keys: ActivityKey[], day: number, period: Period) => {
    const check = checkPlace(p, keys, day, period.id, all);
    if (!check.ok) { setToast(check.reason); return; }
    const swap = check.swapWith;
    if (swap) update((d) => applySwap(d, keys, swap), { touch: false });
    else update((d) => applyMove(d, keys, day, period.id), { touch: false });
    setSelected(null);
    setHint(null);
    setMessage({ kind: 'ok', text: swap
      ? `Intercambiados: ${subjectOfKey(keys[0])} ↔ ${subjectOfKey(swap[0])}. Ambos quedaron fijados 📌.`
      : `Movido al ${p.school.days[day]}, ${period.label} (${period.start}). Quedó fijado 📌.` });
  };

  const grid = (m: Mode, id: string, interactive: boolean) => {
    const slots = index.get(`${m}:${id}`);
    // Una clase ocupa una sola celda alta (rowSpan) si en todos sus tramos es la única clase.
    const alone = (l: Lesson) => Array.from({ length: l.dur }, (_, k) => p.school.periods[l.startIdx + k])
      .every((per) => per && (slots?.get(slotKey(l.pl.day, per.id))?.length ?? 0) === 1);
    const describe = (l: Lesson) => {
      const s = subject(l.unit.subjectId);
      const room = p.rooms.find((r) => r.id === l.pl.roomId)?.name;
      const locked = isLocked(l.pl.key);
      const t = teacher(l.unit.teacherId)?.name;
      const courses = [...new Set(l.unit.audience.map((a) => a.courseId))];
      const audience = courses.map((c) => {
        const g = l.unit.kind === 'carga' ? groupLabel(p, l, c) : undefined;
        return `${courseName(c)}${g ? ` (${g})` : ''}`;
      }).join(', ');
      const franja = l.unit.kind === 'electivo' ? groupLabel(p, l, courses[0]) : undefined;
      const help = !interactive ? '' : selectedSet.has(l.pl.key) ? 'Seleccionado: elige un lugar libre (en verde) o haz clic de nuevo para soltar' : 'Clic para seleccionar y mover o fijar; también se puede arrastrar';
      const title = `${s?.name}${franja ? ` · ${franja}` : ''} · ${audience} · ${t ?? 'sin profesor'}${room ? ' · ' + room : ''}${locked ? ' · fijado' : ''}\n${help}`;
      const g = m === 'curso' ? groupLabel(p, l, id) : undefined;
      const main = m === 'curso' ? `${s?.name}${g && l.unit.kind === 'carga' ? ` · ${g}` : ''}` : `${s?.short || s?.name} · ${audience}`;
      const sub = m === 'curso' ? `${l.unit.kind === 'electivo' ? `${g} · ` : ''}${t ?? 'Sin profesor'}${room ? ` · ${room}` : ''}` : room ?? '';
      return { s, locked, title, main, sub, sel: selectedSet.has(l.pl.key) };
    };
    const dragProps = (l: Lesson) => interactive ? {
      draggable: true,
      onDragEnd: (e: DragEvent) => {
        // Se soltó sobre un lugar no válido (algunos navegadores no informan la posición: se usa el último motivo).
        const unknownPos = e.clientX === 0 && e.clientY === 0;
        const overInvalid = unknownPos || !!document.elementFromPoint(e.clientX, e.clientY)?.closest('td.drop-no');
        if (lastInvalid.current && overInvalid) setToast(lastInvalid.current);
        lastInvalid.current = null;
        setHint(null);
      },
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, l.pl.key);
        e.dataTransfer.effectAllowed = 'move';
        setSelected(companions(p, l.pl.key));
        setMessage(null);
      },
    } : {};
    return (
      <WeekGrid school={p.school} cell={(d, per): CellSpec => {
        const k = slotKey(d, per.id);
        const target = interactive && selected ? targets.get(k) : undefined;
        // Motivo junto al cursor: al arrastrar sobre un lugar no válido, o al pasar el mouse con un bloque seleccionado.
        const showReason = (x: number, y: number) => {
          const text = !target ? null : target.ok ? (target.swapWith ? `Soltar para intercambiar con ${subjectOfKey(target.swapWith[0])}` : null) : target.reason;
          if (!text) { if (hint) setHint(null); return; }
          if (!hint || hint.text !== text || Math.abs(hint.x - x) + Math.abs(hint.y - y) > 6)
            setHint({ text, x, y, swap: !!target?.ok });
        };
        const drop = target ? {
          onMouseMove: (e: MouseEvent) => showReason(e.clientX, e.clientY),
          onMouseLeave: () => setHint(null),
          onDragOver: (e: DragEvent) => {
            if (target.ok) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              lastInvalid.current = null;
            } else lastInvalid.current = target.reason;
            showReason(e.clientX, e.clientY);
          },
          onDrop: (e: DragEvent) => { e.preventDefault(); if (selected) tryMove(selected, d, per); },
        } : {};
        const targetClass = target ? (target.ok ? (target.swapWith ? ' drop-ok drop-swap' : ' drop-ok') : ' drop-no') : '';
        const targetTitle = target?.ok ? (target.swapWith ? `Intercambiar con ${subjectOfKey(target.swapWith[0])}` : 'Mover aquí') : undefined;
        if (p.school.closed.includes(k)) return { className: 'closed', title: 'Sin clases' };
        const hits = slots?.get(k) ?? [];
        if (hits.length === 0) {
          if (!target) return {};
          return {
            className: targetClass.trim(),
            title: target.ok ? targetTitle : target.reason,
            onClick: () => (target.ok ? tryMove(selected!, d, per) : setToast(target.reason)),
            ...drop,
          };
        }
        if (hits.length === 1 && alone(hits[0].lesson)) {
          if (!hits[0].start) return { skip: true };
          const l = hits[0].lesson;
          const x = describe(l);
          return {
            className: `lesson${x.locked ? ' locked' : ''}${x.sel ? ' selected' : ''}${x.sel ? '' : targetClass}`,
            rowSpan: l.dur,
            title: target && !x.sel ? (target.ok ? `${targetTitle}\n\n${x.title}` : `${target.reason}\n\n${x.title}`) : x.title,
            onClick: interactive ? () => (target?.ok && !x.sel ? tryMove(selected!, d, per) : select(l)) : undefined,
            ...dragProps(l),
            ...drop,
            content: (
              <div style={{ position: 'absolute', inset: 0, padding: '4px 6px', background: x.s?.color ?? '#777', borderRadius: 5 }}>
                <span className="s">{x.main}</span>
                <span className="w">{x.sub}</span>
                {x.locked && <span className="lock" aria-label="Fijado">📌</span>}
              </div>
            ),
          };
        }
        // Clases en paralelo que empiezan y terminan juntas: una sola celda alta con una ficha por clase.
        const keysAt = (sk: string) => (slots?.get(sk) ?? []).map((h) => h.lesson.pl.key).sort().join(',');
        const block = (hs: Hit[]) => {
          const l0 = hs[0].lesson;
          if (!hs.every((h) => h.lesson.dur === l0.dur && h.lesson.startIdx === l0.startIdx && h.lesson.pl.day === l0.pl.day)) return false;
          const keys = keysAt(slotKey(l0.pl.day, p.school.periods[l0.startIdx].id));
          return Array.from({ length: l0.dur }, (_, i) => p.school.periods[l0.startIdx + i]).every((x) => x && keysAt(slotKey(l0.pl.day, x.id)) === keys);
        };
        const together = block(hits);
        if (together && !hits[0].start) return { skip: true };
        const anySel = hits.some((h) => selectedSet.has(h.lesson.pl.key));
        return {
          className: `multi${anySel ? '' : targetClass}`,
          rowSpan: together ? hits[0].lesson.dur : undefined,
          title: target && !anySel && !target.ok ? target.reason : undefined,
          ...drop,
          content: hits.map(({ lesson: l, start }) => {
            const x = describe(l);
            return (
              <button key={l.pl.key} type="button" className={`chip-lesson${x.locked ? ' locked' : ''}${x.sel ? ' selected' : ''}`} title={x.title}
                style={{ background: x.s?.color ?? '#777' }} disabled={!interactive}
                draggable={interactive || undefined}
                onDragStart={dragProps(l).onDragStart}
                onDragEnd={dragProps(l).onDragEnd}
                onClick={(e) => { e.stopPropagation(); if (target?.ok && !anySel) tryMove(selected!, d, per); else select(l); }}>
                <span className="s">{x.main}{start || together ? '' : ' (cont.)'}</span>
                {(start || together) && <span className="w">{x.sub}</span>}
                {x.locked && start && <span className="lock" aria-label="Fijado"> 📌</span>}
              </button>
            );
          }),
        };
      }} />
    );
  };

  const rows = () => {
    const out: string[][] = [];
    for (const l of all) {
      const end = p.school.periods[l.startIdx + l.dur - 1] ?? p.school.periods[l.startIdx];
      for (const courseId of new Set(l.unit.audience.map((a) => a.courseId)))
        out.push([courseName(courseId), groupLabel(p, l, courseId) ?? '', p.school.days[l.pl.day], p.school.periods[l.startIdx].start, end.end,
          subject(l.unit.subjectId)?.name ?? '', teacher(l.unit.teacherId)?.name ?? '', p.rooms.find((r) => r.id === l.pl.roomId)?.name ?? '']);
    }
    out.sort((x, y) => x[0].localeCompare(y[0]) || p.school.days.indexOf(x[2]) - p.school.days.indexOf(y[2]) || x[3].localeCompare(y[3]) || x[1].localeCompare(y[1]));
    return out;
  };
  const header = ['Curso', 'Grupo', 'Día', 'Inicio', 'Término', 'Asignatura', 'Profesor', 'Sala'];

  const exportCsv = () => {
    const csv = '﻿' + [header, ...rows()].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadText(`horario-${fileSafe(p.name)}.csv`, csv, 'text/csv');
  };
  const exportXlsx = () => {
    exportTimetableXlsx(p, all, header, rows()).catch((e: Error) => setMessage({ kind: 'bad', text: `No se pudo crear el Excel: ${e.message}` }));
  };

  const doPrint = (all: boolean) => { setPrintAll(all); setTimeout(() => window.print(), 50); };
  const nLocks = Object.keys(p.locks).length;
  const ownerSlots = owner ? index.get(`${mode}:${owner.id}`) : undefined;
  const ownerHours = ownerSlots?.size ?? 0;
  const selLocked = selected ? selected.every(isLocked) : false;

  return (
    <>
      <PageHead title="Ver y ajustar" actions={
        <div className="row no-print">
          <button type="button" className="btn" onClick={() => doPrint(false)}>Imprimir</button>
          <button type="button" className="btn" onClick={() => doPrint(true)}>Imprimir todos</button>
          <button type="button" className="btn" onClick={exportXlsx}>Excel</button>
          <button type="button" className="btn ghost" onClick={exportCsv}>CSV</button>
          <button type="button" className="btn ghost" onClick={() => downloadText(`${fileSafe(p.name)}.fet`, exportFet(p).xml, 'application/xml')} title="Abre los datos en FET de escritorio">Archivo .fet</button>
        </div>
      }>
        Haz clic en un bloque para <b>seleccionarlo</b>: puedes moverlo a un lugar libre (en verde), soltarlo sobre otro bloque
        con borde verde para <b>intercambiarlos</b>, o <b>fijarlo</b> 📌. También se puede arrastrar.
        Al generar de nuevo, los bloques fijados se mantienen y el resto se reorganiza.
      </PageHead>

      {isStale(p) && (
        <div className="notice warn no-print">
          <b>Los datos cambiaron después de generar este horario.</b>
          <span>Puede no reflejar la carga o las reglas actuales. <a href="#generar">Generar de nuevo</a></span>
        </div>
      )}

      <section className="card no-print">
        <div className="row">
          <div className="tabs" role="group" aria-label="Ver por">
            {(['curso', 'profesor', 'sala'] as Mode[]).filter((m) => m !== 'sala' || p.rooms.length > 0).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setOwnerId(''); }}>
                {m === 'curso' ? 'Cursos' : m === 'profesor' ? 'Profesores' : 'Salas'}</button>
            ))}
          </div>
          <select className="input" value={owner?.id ?? ''} aria-label="Elegir" onChange={(e) => setOwnerId(e.target.value)}>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="spacer" />
          <span className="badge">{ownerHours} horas</span>
          {mode === 'profesor' && <span className="badge">{countGaps(p, ownerSlots)} ventanas en la semana</span>}
          <span className="badge">{nLocks} fijados</span>
          {nLocks > 0 && <button type="button" className="btn small ghost" onClick={() => update((d) => { d.locks = {}; }, { touch: false })}>Liberar todos</button>}
          <button type="button" className="btn small primary" onClick={() => go('generar')}>Generar de nuevo</button>
        </div>

        {selected && (
          <div className="notice selbar" role="status">
            <span>
              <b>{describeActivity(p, selected[0])}</b>
              {selected.length > 1 && <> y {selected.length - 1} clase{selected.length > 2 ? 's' : ''} en paralelo (se mueven juntas)</>}.
              {' '}{[...targets.values()].some((t) => t.ok)
                ? 'Elige un lugar en verde o arrástralo.'
                : 'No hay otro lugar donde quepa sin choques; puedes fijarlo y generar de nuevo para que el resto se reorganice.'}
            </span>
            <span className="row">
              <button type="button" className="btn small" onClick={() => toggleLock(selected)}>{selLocked ? 'Liberar' : 'Fijar aquí 📌'}</button>
              <button type="button" className="btn small ghost" onClick={() => setSelected(null)}>Cancelar</button>
            </span>
          </div>
        )}
        {message && <div className={`notice ${message.kind === 'ok' ? 'ok' : 'bad'}`} role="status">{message.text}</div>}
        {hint && selected && (
          <div className="drag-hint" style={{ left: Math.min(hint.x + 22, innerWidth - 300), top: hint.y + 22 }} aria-hidden="true">
            {hint.swap ? '⇄' : '🚫'} {hint.text}
          </div>
        )}
        <div className="toast-zone" role="status" aria-live="polite">
          {toast && <div className="toast" onClick={() => setToast(null)}>No se puede mover aquí: {toast}</div>}
        </div>
        {owner ? grid(mode, owner.id, true) : <div className="empty">No hay elementos para mostrar.</div>}
        {selected && <p className="small muted">Al mover o intercambiar se revisan los choques, recreos, la disponibilidad de profesores y todas las reglas obligatorias de Preferencias. Las reglas preferibles no se revisan. Las preferencias (ventanas, repartir en días) no se revisan.</p>}
      </section>

      <div className="print-only">
        {(printAll ? owners : owner ? [owner] : []).map((o) => (
          <section key={o.id} className="print-page">
            <h2>{o.name} — {p.school.name || p.name} {p.year}</h2>
            {grid(mode, o.id, false)}
          </section>
        ))}
      </div>
    </>
  );
}
