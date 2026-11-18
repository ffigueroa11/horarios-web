import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { isStale, useCurrent, useProjects } from '../store/projects';
import type { ActivityKey, Period, Project } from '../domain/types';
import { slotKey } from '../domain/types';
import { exportFet } from '../domain/fetExport';
import { applyMove, applySwap, checkPlace, companions, continueWith, lessonIndex, lessons, placeTargets, type Lesson, type LessonHit, type PlaceCheck } from '../domain/manual';
import { findEffectiveGroup } from '../domain/units';
import { describeUnit } from '../domain/fetResult';
import type { Route } from '../App';
import { PageHead, WeekGrid, type CellSpec } from '../ui/common';
import { UnmetPreferencesReport } from '../ui/UnmetPreferencesReport';
import { downloadText, fileSafe } from '../ui/download';
import { exportTimetableXlsx } from '../ui/exportXlsx';

type Mode = 'curso' | 'profesor' | 'sala';

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

interface HintApi { show: (text: string, x: number, y: number, swap: boolean) => void; hide: () => void }

/**
 * Motivo junto al cursor. Tiene su propio estado: mover el mouse no vuelve a dibujar la grilla, solo este cuadro
 * (con 500 bloques, cada movimiento redibujaba la página entera).
 */
function DragHint({ handle }: { handle: RefObject<HintApi | null> }) {
  const [hint, setHint] = useState<{ text: string; x: number; y: number; swap: boolean } | null>(null);
  useImperativeHandle(handle, () => ({
    show: (text, x, y, swap) => setHint((h) => (h && h.text === text && Math.abs(h.x - x) + Math.abs(h.y - y) <= 6 ? h : { text, x, y, swap })),
    hide: () => setHint((h) => (h ? null : h)),
  }), []);
  if (!hint) return null;
  return (
    <div className="drag-hint" style={{ left: Math.min(hint.x + 22, innerWidth - 300), top: hint.y + 22 }} aria-hidden="true">
      {hint.swap ? '⇄' : '🚫'} {hint.text}
    </div>
  );
}

/** Día y horas que ocuparía un bloque de `dur` tramos que empieza en `startIdx`: "jueves de 09:45 a 11:15". */
function when(p: Project, day: number, startIdx: number, dur: number) {
  const first = p.school.periods[startIdx], last = p.school.periods[startIdx + dur - 1] ?? first;
  return `${p.school.days[day]?.toLowerCase() ?? ''} de ${first?.start ?? ''} a ${last?.end ?? ''}`;
}

type Status = { text: string; kind: 'ok' | 'swap' | 'no' | 'info' } | null;
interface StatusApi { set: (s: Status) => void }

/**
 * Qué pasa si se hace clic donde está el mouse (o el foco): mover, intercambiar o el motivo por el que no se puede.
 * Vive en la barra de selección, con su propio estado, para no volver a dibujar la grilla en cada movimiento.
 */
function SelectionStatus({ handle, idle }: { handle: RefObject<StatusApi | null>; idle: string }) {
  const [status, setStatus] = useState<Status>(null);
  useImperativeHandle(handle, () => ({
    set: (next) => setStatus((cur) => (cur?.text === next?.text ? cur : next)),
  }), []);
  const icon = { ok: '→ ', swap: '⇄ ', no: '🚫 ', info: '' }[status?.kind ?? 'info'];
  return <span className={`sel-status${status?.kind === 'no' ? ' no' : ''}`} aria-live="polite">{status ? icon + status.text : idle}</span>;
}

/** Lo que la grilla pide a la página. Va en un ref para que la grilla memorizada no dependa de funciones nuevas. */
interface GridActions {
  tryMove: (keys: ActivityKey[], day: number, period: Period) => void;
  select: (l: Lesson) => void;
  startDrag: (l: Lesson) => void;
  /** El motivo por el que no se puede, en la barra de selección (al hacer clic o al soltar en un lugar no válido). */
  refuse: (reason: string) => void;
  hint: RefObject<HintApi | null>;
  status: RefObject<StatusApi | null>;
  lastInvalid: RefObject<string | null>;
}

interface GridProps {
  p: Project;
  all: Lesson[];
  index: ReturnType<typeof lessonIndex>;
  m: Mode;
  id: string;
  interactive: boolean;
  selected: ActivityKey[] | null;
  targets: Map<string, PlaceCheck>;
  act: RefObject<GridActions | null>;
}

/**
 * Grilla semanal de un curso, profesor o sala. Memorizada: solo se vuelve a dibujar si cambian el horario, la
 * selección o los destinos, no con los mensajes ni con el aviso junto al cursor.
 */
const NO_TARGETS = new Map<string, PlaceCheck>();

const ScheduleGrid = memo(function ScheduleGrid({ p, all, index, m, id, interactive, selected, targets, act }: GridProps) {
  const subject = (sid: string) => p.subjects.find((s) => s.id === sid);
  const teacher = (tid: string | null) => p.teachers.find((t) => t.id === tid);
  const courseName = (cid: string) => p.courses.find((c) => c.id === cid)?.name ?? '';
  const subjectOfKey = (k: ActivityKey) => subject(all.find((l) => l.pl.key === k)?.unit.subjectId ?? '')?.name ?? 'el bloque';
  const selectedSet = new Set(selected ?? []);
  const isLocked = (key: ActivityKey) => !!p.locks[key];
  const slots = index.get(`${m}:${id}`);
  const moving = selected ? all.find((l) => l.pl.key === selected[0]) : undefined;
  const onSelected: Partial<CellSpec> = {
    onMouseMove: () => act.current!.status.current?.set({ kind: 'info', text: 'Es el bloque seleccionado: haz clic de nuevo para soltarlo.' }),
  };
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
    // Sin título mientras hay un bloque seleccionado: el navegador lo mostraría encima de la explicación de la barra.
    const title = selected ? undefined : `${s?.name}${franja ? ` · ${franja}` : ''} · ${audience} · ${t ?? 'sin profesor'}${room ? ' · ' + room : ''}${locked ? ' · fijado' : ''}`;
    const g = m === 'curso' ? groupLabel(p, l, id) : undefined;
    const main = m === 'curso' ? `${s?.name}${g && l.unit.kind === 'carga' ? ` · ${g}` : ''}` : `${s?.short || s?.name} · ${audience}`;
    const sub = m === 'curso' ? `${l.unit.kind === 'electivo' ? `${g} · ` : ''}${t ?? 'Sin profesor'}${room ? ` · ${room}` : ''}` : room ?? '';
    return { s, locked, title, main, sub, sel: interactive && selectedSet.has(l.pl.key) };
  };
  const dragProps = (l: Lesson) => interactive ? {
    draggable: true,
    onDragEnd: (e: DragEvent) => {
      // Se soltó sobre un lugar no válido (algunos navegadores no informan la posición: se usa el último motivo).
      const unknownPos = e.clientX === 0 && e.clientY === 0;
      const overInvalid = unknownPos || !!document.elementFromPoint(e.clientX, e.clientY)?.closest('td.drop-no');
      if (act.current!.lastInvalid.current && overInvalid) act.current!.refuse(act.current!.lastInvalid.current);
      act.current!.lastInvalid.current = null;
      act.current!.hint.current?.hide();
    },
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(DRAG_TYPE, l.pl.key);
      e.dataTransfer.effectAllowed = 'move';
      act.current!.startDrag(l);
    },
  } : {};
  return (
    <div onMouseLeave={interactive && selected ? () => act.current!.status.current?.set(null) : undefined}>
    <WeekGrid school={p.school} cell={(d, per): CellSpec => {
      const k = slotKey(d, per.id);
      const target = interactive && selected ? targets.get(k) : undefined;
      // Con clic: qué pasaría, en la barra de selección. Al arrastrar: junto al cursor, que es donde se está mirando.
      const describeTarget = (): Status => {
        if (!target) return null;
        if (!target.ok) return { kind: 'no', text: `No se puede: ${continueWith(target.reason)}` };
        if (target.swapWith) {
          const other = all.find((l) => l.pl.key === target.swapWith![0]);
          const there = moving ? `, que pasa al ${when(p, moving.pl.day, moving.startIdx, moving.dur)}` : '';
          return { kind: 'swap', text: `Clic para intercambiar con ${subjectOfKey(target.swapWith[0])}${other ? there : ''}. Los dos quedan fijados 📌.` };
        }
        const start = p.school.periods.findIndex((x) => x.id === per.id);
        return { kind: 'ok', text: `Clic para mover al ${when(p, d, start, moving?.dur ?? 1)}. Queda fijado 📌.` };
      };
      const showStatus = () => act.current!.status.current?.set(describeTarget());
      const showDragHint = (x: number, y: number) => {
        const text = !target ? null : target.ok ? (target.swapWith ? `Suelta para intercambiar con ${subjectOfKey(target.swapWith[0])}` : null) : target.reason;
        if (text) act.current!.hint.current?.show(text, x, y, !!target?.ok);
        else act.current!.hint.current?.hide();
      };
      const drop = target ? {
        onMouseMove: showStatus,
        onFocus: showStatus,
        onDragOver: (e: DragEvent) => {
          if (target.ok) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            act.current!.lastInvalid.current = null;
          } else act.current!.lastInvalid.current = target.reason;
          showDragHint(e.clientX, e.clientY);
        },
        onDrop: (e: DragEvent) => { e.preventDefault(); if (selected) act.current!.tryMove(selected, d, per); },
      } : {};
      const targetClass = target ? (target.ok ? (target.swapWith ? ' drop-ok drop-swap' : ' drop-ok') : ' drop-no') : '';
      if (p.school.closed.includes(k))
        return { className: 'closed', title: selected ? undefined : 'Sin clases', onMouseMove: selected ? () => act.current!.status.current?.set(null) : undefined };
      const hits = slots?.get(k) ?? [];
      if (hits.length === 0) {
        if (!target) return {};
        return {
          className: targetClass.trim(),
          onClick: () => (target.ok ? act.current!.tryMove(selected!, d, per) : act.current!.refuse(target.reason)),
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
          title: x.title,
          onClick: interactive ? () => (target?.ok && !x.sel ? act.current!.tryMove(selected!, d, per) : act.current!.select(l)) : undefined,
          ...dragProps(l),
          ...drop,
          ...(x.sel ? onSelected : {}),
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
      const block = (hs: LessonHit[]) => {
        const l0 = hs[0].lesson;
        if (!hs.every((h) => h.lesson.dur === l0.dur && h.lesson.startIdx === l0.startIdx && h.lesson.pl.day === l0.pl.day)) return false;
        const keys = keysAt(slotKey(l0.pl.day, p.school.periods[l0.startIdx].id));
        return Array.from({ length: l0.dur }, (_, i) => p.school.periods[l0.startIdx + i]).every((x) => x && keysAt(slotKey(l0.pl.day, x.id)) === keys);
      };
      const together = block(hits);
      if (together && !hits[0].start) return { skip: true };
      const anySel = interactive && hits.some((h) => selectedSet.has(h.lesson.pl.key));
      return {
        className: `multi${anySel ? '' : targetClass}`,
        rowSpan: together ? hits[0].lesson.dur : undefined,
        ...drop,
        ...(anySel ? onSelected : {}),
        content: hits.map(({ lesson: l, start }) => {
          const x = describe(l);
          return (
            <button key={l.pl.key} type="button" className={`chip-lesson${x.locked ? ' locked' : ''}${x.sel ? ' selected' : ''}`} title={x.title}
              style={{ background: x.s?.color ?? '#777' }} disabled={!interactive}
              draggable={interactive || undefined}
              onDragStart={dragProps(l).onDragStart}
              onDragEnd={dragProps(l).onDragEnd}
              onClick={(e) => { e.stopPropagation(); if (target?.ok && !anySel) act.current!.tryMove(selected!, d, per); else act.current!.select(l); }}>
              <span className="s">{x.main}{start || together ? '' : ' (cont.)'}</span>
              {(start || together) && <span className="w">{x.sub}</span>}
              {x.locked && start && <span className="lock" aria-label="Fijado"> 📌</span>}
            </button>
          );
        }),
      };
    }} />
    </div>
  );
});

export function HorarioPage({ go }: { go: (r: Route) => void }) {
  const p = useCurrent()!;
  if (!p.timetable)
    return (
      <>
        <PageHead title="Ver y ajustar" />
        <div className="empty">Todavía no hay un horario generado.<button type="button" className="btn primary" onClick={() => go('generar')}>Ir a generar</button></div>
      </>
    );
  return <AdjustView go={go} />;
}

function AdjustView({ go }: { go: (r: Route) => void }) {
  const p = useCurrent()!;
  const update = useProjects((s) => s.update);
  const [mode, setMode] = useState<Mode>('curso');
  const [ownerId, setOwnerId] = useState<string>('');
  const [printAll, setPrintAll] = useState(false);
  const [selected, setSelected] = useState<ActivityKey[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  // Qué pasaría en cada lugar: en la barra de selección (SelectionStatus) y, mientras se arrastra, junto al cursor
  // (DragHint), que es donde se está mirando.
  const hintRef = useRef<HintApi>(null);
  const statusRef = useRef<StatusApi>(null);
  const lastInvalid = useRef<string | null>(null);
  const refuse = (reason: string) => statusRef.current?.set({ kind: 'no', text: `No se puede: ${continueWith(reason)}` });
  const all = useMemo(() => lessons(p), [p]);
  const index = useMemo(() => lessonIndex(p, all), [p, all]);
  // Lugares válidos para lo seleccionado: se calcula una vez por selección (no en cada celda de cada vista).
  const targets = useMemo(() => (selected ? placeTargets(p, selected, all) : new Map<string, never>()), [p, all, selected]);

  // Escape suelta la selección.
  useEffect(() => {
    if (!selected) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [selected]);

  // Tras imprimir, se deja de dibujar la copia de todas las grillas.
  useEffect(() => {
    const done = () => setPrintAll(false);
    addEventListener('afterprint', done);
    return () => removeEventListener('afterprint', done);
  }, []);

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
    if (!check.ok) { refuse(check.reason); return; }
    const swap = check.swapWith;
    if (swap) update((d) => applySwap(d, keys, swap), { touch: false });
    else update((d) => applyMove(d, keys, day, period.id), { touch: false });
    setSelected(null);
    hintRef.current?.hide();
    statusRef.current?.set(null);
    setMessage({ kind: 'ok', text: swap
      ? `Intercambiados: ${subjectOfKey(keys[0])} ↔ ${subjectOfKey(swap[0])}. Ambos quedaron fijados 📌.`
      : `Movido al ${p.school.days[day]}, ${period.label} (${period.start}). Quedó fijado 📌.` });
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

  // Se actualiza después de cada dibujo: la grilla solo lo usa en eventos, que ocurren después.
  const startDrag = (l: Lesson) => { setSelected(companions(p, l.pl.key)); setMessage(null); };
  const act = useRef<GridActions>(null);
  useLayoutEffect(() => { act.current = { tryMove, select, startDrag, refuse, hint: hintRef, status: statusRef, lastInvalid }; });
  const grid = (id: string, interactive: boolean) => (
    <ScheduleGrid p={p} all={all} index={index} m={mode} id={id} interactive={interactive}
      selected={interactive ? selected : null} targets={interactive ? targets : NO_TARGETS} act={act} />
  );

  const doPrint = (all: boolean) => { setPrintAll(all); setTimeout(() => window.print(), 50); };
  const nLocks = Object.keys(p.locks).length;
  const ownerSlots = owner ? index.get(`${mode}:${owner.id}`) : undefined;
  const ownerHours = ownerSlots?.size ?? 0;
  const selLocked = selected ? selected.every(isLocked) : false;
  const selLesson = selected ? all.find((l) => l.pl.key === selected[0]) : undefined;

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
        Haz clic en un bloque para <b>seleccionarlo</b> y pasa el mouse por la grilla: la barra de abajo dice qué pasaría en
        cada lugar. Haz clic donde quieras <b>moverlo</b> o <b>intercambiarlo</b>, o arrástralo. Lo que mueves queda <b>fijo</b> 📌:
        al generar de nuevo se mantiene y el resto se reorganiza.
      </PageHead>

      {isStale(p) && (
        <div className="notice warn no-print">
          <b>Los datos cambiaron después de generar este horario.</b>
          <span>Puede no reflejar la carga o las reglas actuales. <a href="#generar">Generar de nuevo</a></span>
        </div>
      )}

      <div className="no-print"><UnmetPreferencesReport project={p} /></div>

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

        {message && <div className={`notice ${message.kind === 'ok' ? 'ok' : 'bad'}`} role="status">{message.text}</div>}
        {selected && <DragHint handle={hintRef} />}
        {owner ? grid(owner.id, true) : <div className="empty">No hay elementos para mostrar.</div>}
        {selected && <p className="small muted">Al mover o intercambiar se revisan los choques, recreos, la disponibilidad de profesores y todas las reglas obligatorias de Preferencias. Las reglas preferibles no se revisan.</p>}
        {selected && (
          <div className="notice selbar">
            <span>
              {selLesson && <><b>{describeUnit(p, selLesson.unit)}</b>, el {when(p, selLesson.pl.day, selLesson.startIdx, selLesson.dur)}</>}
              {selected.length > 1 && <> y {selected.length - 1} clase{selected.length > 2 ? 's' : ''} en paralelo, que se mueven juntas</>}.
              <SelectionStatus handle={statusRef} idle={[...targets.values()].some((t) => t.ok)
                ? 'Verde: se puede mover ahí. ⇄: se puede intercambiar. Atenuado: no se puede. Pasa el mouse para ver el detalle.'
                : 'No hay otro lugar donde quepa sin choques. Puedes dejarlo fijo y generar de nuevo para que el resto se reorganice.'} />
            </span>
            <span className="row">
              <button type="button" className="btn small" onClick={() => toggleLock(selected)}>{selLocked ? 'Liberar' : 'Dejar fijo aquí 📌'}</button>
              <button type="button" className="btn small ghost" onClick={() => setSelected(null)}>Cancelar</button>
            </span>
          </div>
        )}
      </section>

      <div className="print-only">
        {(printAll ? owners : owner ? [owner] : []).map((o) => (
          <section key={o.id} className="print-page">
            <h2>{o.name} — {p.school.name || p.name} {p.year}</h2>
            {grid(o.id, false)}
          </section>
        ))}
      </div>
    </>
  );
}
