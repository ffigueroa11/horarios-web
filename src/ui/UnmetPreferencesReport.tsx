import { useMemo } from 'react';
import type { Project } from '../domain/types';
import { describeActivity, describeUnit } from '../domain/fetResult';
import { unmetPreferences } from '../domain/preferences';

/** Lista las preferencias que el horario actual no cumple. No muestra nada si se cumplen todas. */
export function UnmetPreferencesReport({ project: p }: { project: Project }) {
  const { spread, windows } = useMemo(() => unmetPreferences(p), [p]);
  const n = spread.length + windows.length;
  if (n === 0) return null;
  const dayNames = (days: number[]) => days.map((d) => p.school.days[d]).join(', ');
  return (
    <details className="notice warn">
      <summary><b>{n === 1 ? '1 preferencia no se cumplió' : `${n} preferencias no se cumplieron`}</b></summary>
      <p className="small">El horario es válido: estas reglas son preferibles. Si alguna debe cumplirse, márcala como obligatoria en <a href="#reglas">Preferencias</a> y genera de nuevo.</p>
      {spread.length > 0 && <>
        <b className="small">Repartir en días distintos</b>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {spread.map(({ unit, days }) => <li key={unit.id}>{describeUnit(p, unit)}: más de un bloque el {dayNames(days)}</li>)}
        </ul>
      </>}
      {windows.length > 0 && <>
        <b className="small">Fuera de los bloques permitidos</b>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {windows.map(({ key, day, start }) => <li key={key}>{describeActivity(p, key)}: {p.school.days[day]}, {start}</li>)}
        </ul>
      </>}
    </details>
  );
}
