// Preferencias que el horario no cumple. Se calculan desde el horario, no desde el informe de FET: así siguen
// siendo ciertas después de mover bloques a mano e incluyen lo que la exportación omite a propósito (repartir en
// días cuando dos bloques fijados ya caen el mismo día).
import type { ActivityKey, Project } from './types';
import { lessons } from './manual';
import type { Unit } from './units';

export interface UnmetPreferences {
  /** Unidades con más de un bloque el mismo día, y qué días. */
  spread: { unit: Unit; days: number[] }[];
  /** Bloques con alguna hora fuera de los bloques permitidos de su asignatura. */
  windows: { key: ActivityKey; day: number; start: string }[];
}

/** ¿Hay alguna regla preferible activa? Sin ellas no hay nada que informar. */
export const hasPreferences = (p: Project) =>
  (p.rules.spreadSubjectDays && p.rules.spreadStrength === 'preferible')
  || p.rules.subjectWindows.some((w) => w.strength === 'preferible');

export function unmetPreferences(p: Project): UnmetPreferences {
  const all = lessons(p);
  const out: UnmetPreferences = { spread: [], windows: [] };

  if (p.rules.spreadSubjectDays && p.rules.spreadStrength === 'preferible') {
    const daysByUnit = new Map<string, { unit: Unit; days: number[] }>();
    for (const l of all) {
      const entry = daysByUnit.get(l.unit.id) ?? { unit: l.unit, days: [] };
      entry.days.push(l.pl.day);
      daysByUnit.set(l.unit.id, entry);
    }
    for (const { unit, days } of daysByUnit.values()) {
      const repeated = [...new Set(days.filter((d, i) => days.indexOf(d) !== i))].sort((a, b) => a - b);
      if (repeated.length > 0) out.spread.push({ unit, days: repeated });
    }
  }

  const windows = p.rules.subjectWindows.filter((w) => w.strength === 'preferible');
  for (const l of all) {
    const own = windows.filter((w) => w.subjectId === l.unit.subjectId);
    const hours = Array.from({ length: l.dur }, (_, k) => p.school.periods[l.startIdx + k]);
    if (own.some((w) => hours.some((h) => h && !w.periodIds.includes(h.id))))
      out.windows.push({ key: l.pl.key, day: l.pl.day, start: hours[0]?.start ?? '' });
  }
  return out;
}
