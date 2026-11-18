import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { useDraft } from './useDraft';
import type { Period, School } from '../domain/types';

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head no-print">
      <div className="row"><h1>{title}</h1><span className="spacer" />{actions}</div>
      {children && <p>{children}</p>}
    </header>
  );
}

/** Número opcional: vacío = null. Se confirma al salir del campo para no perder lo que se está escribiendo. */
export function NullableNumber({ value, onChange, min = 0, max, placeholder, id, className = 'input narrow' }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; placeholder?: string; id?: string; className?: string;
}) {
  const [text, setText] = useDraft(value == null ? '' : String(value));
  const commit = () => {
    if (text.trim() === '') return onChange(null);
    const n = Math.round(Number(text));
    if (Number.isFinite(n)) onChange(Math.max(min, max != null ? Math.min(max, n) : n));
    else setText(value == null ? '' : String(value));
  };
  return (
    <input id={id} className={className} inputMode="numeric" value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  );
}

/**
 * Número con "Sin límite" como opción explícita. Antes, "Sin límite" era el texto de ejemplo de un campo vacío y parecía
 * un valor ya escrito. Desmarcar la casilla pone `fallback`; vaciar el número vuelve a "Sin límite".
 */
export function LimitField({ label, value, onChange, max, fallback }: {
  label: string; value: number | null; onChange: (v: number | null) => void; max: number; fallback: number;
}) {
  return (
    <div className="field limit-field" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="row">
        <NullableNumber value={value} max={max} placeholder="—" onChange={onChange} />
        <label className="check small"><input type="checkbox" checked={value == null}
          onChange={(e) => onChange(e.target.checked ? null : fallback)} />Sin límite</label>
      </div>
    </div>
  );
}

/** Texto que se guarda al salir del campo (evita guardar en IndexedDB a cada tecla). */
export function TextInput({ value, onChange, placeholder, id, className = 'input', ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder?: string; id?: string; className?: string; ariaLabel?: string;
}) {
  const [text, setText] = useDraft(value);
  return (
    <input id={id} className={className} value={text} placeholder={placeholder} aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

export interface CellSpec {
  className?: string;
  content?: ReactNode;
  title?: string;
  onClick?: () => void;
  rowSpan?: number;
  /** La celda está cubierta por un bloque que empezó arriba (rowSpan). */
  skip?: boolean;
  /** Arrastrar y soltar (ajuste manual del horario). */
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onMouseMove?: (e: MouseEvent) => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onDrop?: (e: DragEvent) => void;
}

/** Grilla semanal: días en columnas, tramos de la jornada en filas; recreos como franjas delgadas. */
export function WeekGrid({ school, cell, dayHeader, days }: {
  school: School;
  cell: (day: number, period: Period) => CellSpec;
  dayHeader?: (day: number) => ReactNode;
  /** Qué días mostrar (índices). Por defecto, todos. En el teléfono se muestra uno a la vez. */
  days?: number[];
}) {
  const shown = days ?? school.days.map((_, i) => i);
  return (
    <div className="table-wrap">
      <table className={`week${shown.length === 1 ? ' single' : ''}`}>
        <thead>
          <tr>
            <th className="time" />
            {/* En pantallas angostas, el día abreviado: los nombres completos se montaban. */}
            {shown.map((i) => <th key={i}>{dayHeader ? dayHeader(i) : <><span className="day-full">{school.days[i]}</span><span className="day-short" aria-hidden="true">{school.days[i].slice(0, 3)}</span></>}</th>)}
          </tr>
        </thead>
        <tbody>
          {school.periods.map((p) =>
            p.kind !== 'clase' ? (
              <tr key={p.id} className="break">
                <th className="time small">{p.start}</th>
                <td colSpan={shown.length}>{p.label}</td>
              </tr>
            ) : (
              <tr key={p.id}>
                <th className="time"><b>{p.label}</b>{p.start}–{p.end}</th>
                {shown.map((d) => {
                  const c = cell(d, p);
                  if (c.skip) return null;
                  return (
                    <td key={d} className={c.className} title={c.title} rowSpan={c.rowSpan}
                      onClick={c.onClick} tabIndex={c.onClick ? 0 : undefined}
                      draggable={c.draggable || undefined} onDragStart={c.onDragStart} onDragEnd={c.onDragEnd}
                      onDragOver={c.onDragOver} onDragLeave={c.onDragLeave} onDrop={c.onDrop}
                      onMouseMove={c.onMouseMove} onMouseLeave={c.onMouseLeave} onFocus={c.onFocus}
                      onKeyDown={c.onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), c.onClick!()) : undefined}>
                      {c.content}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Menú desplegable con acciones. Se cierra al elegir una opción, al hacer clic fuera o con Esc. */
export function MenuButton({ label, items, ariaLabel, summaryClass = 'btn' }: {
  label: ReactNode;
  items: { label: string; onClick: () => void; title?: string; danger?: boolean }[];
  ariaLabel?: string;
  summaryClass?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node)) d.open = false;
    };
    addEventListener('click', close);
    addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className={summaryClass} aria-label={ariaLabel}>{label}{summaryClass === 'btn' && <> <span aria-hidden="true">▾</span></>}</summary>
      <div className="menu-list" role="menu">
        {items.map((it) => (
          <button key={it.label} type="button" role="menuitem" title={it.title} className={it.danger ? 'danger' : undefined}
            onClick={() => { if (ref.current) ref.current.open = false; it.onClick(); }}>{it.label}</button>
        ))}
      </div>
    </details>
  );
}

/** Confirmación dentro de la página (sin diálogos del navegador). */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn small danger', ariaLabel }: {
  label: string; confirmLabel: string; onConfirm: () => void; className?: string; ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} aria-label={ariaLabel} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="row">
      <button type="button" className="btn small danger" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="btn small ghost" onClick={() => setAsking(false)}>Cancelar</button>
    </span>
  );
}
