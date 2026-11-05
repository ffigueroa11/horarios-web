import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { parsePartial } from './fetResult';
import { hasPreferences, unmetPreferences } from './preferences';
import type { Placement, Project } from './types';

/** Ejemplo con un horario armado a mano: solo los bloques de la primera fila de la carga. */
function withTimetable(places: [day: number, period: number][]) {
  const p = exampleProject();
  p.rules.subjectWindows = [];
  const a = p.assignments[0];
  a.blocks = places.map(() => 1);
  const classes = p.school.periods.filter((x) => x.kind === 'clase');
  const placements: Placement[] = places.map(([day, per], i) => ({ key: `${a.id}#${i}`, day, periodId: classes[per].id, roomId: null }));
  p.timetable = { generatedAt: '2026-01-01T00:00:00.000Z', seconds: 1, placements };
  return { p, a, classes };
}
const preferSpread = (p: Project) => { p.rules.spreadSubjectDays = true; p.rules.spreadStrength = 'preferible'; };

describe('preferencias no cumplidas', () => {
  it('informa los días con más de un bloque de una misma clase', () => {
    const { p, a } = withTimetable([[1, 0], [1, 1], [3, 0], [3, 1], [4, 0]]);
    preferSpread(p);
    const { spread } = unmetPreferences(p);
    expect(spread.map((x) => [x.unit.id, x.days])).toEqual([[a.id, [1, 3]]]);
  });

  it('no informa nada si los bloques quedaron en días distintos', () => {
    const { p } = withTimetable([[0, 0], [1, 0], [2, 0]]);
    preferSpread(p);
    expect(unmetPreferences(p)).toEqual({ spread: [], windows: [] });
  });

  it('un repartir obligatorio o inactivo no es una preferencia', () => {
    const { p } = withTimetable([[1, 0], [1, 1]]);
    p.rules.spreadSubjectDays = true;
    p.rules.spreadStrength = 'obligatoria';
    expect(hasPreferences(p)).toBe(false);
    expect(unmetPreferences(p).spread).toEqual([]);
    preferSpread(p);
    p.rules.spreadSubjectDays = false;
    expect(hasPreferences(p)).toBe(false);
    expect(unmetPreferences(p).spread).toEqual([]);
  });

  it('informa los bloques fuera de los permitidos, con su día y hora', () => {
    const { p, a, classes } = withTimetable([[0, 0], [2, 3]]);
    p.rules.spreadSubjectDays = false;
    p.rules.subjectWindows = [{ subjectId: a.subjectId, periodIds: [classes[0].id], strength: 'preferible' }];
    expect(hasPreferences(p)).toBe(true);
    expect(unmetPreferences(p).windows).toEqual([{ key: `${a.id}#1`, day: 2, start: classes[3].start }]);
  });

  it('un bloque largo cumple solo si todas sus horas están permitidas', () => {
    const { p, a, classes } = withTimetable([[0, 0]]);
    p.rules.spreadSubjectDays = false;
    a.blocks = [2];
    p.rules.subjectWindows = [{ subjectId: a.subjectId, periodIds: [classes[0].id], strength: 'preferible' }];
    expect(unmetPreferences(p).windows).toHaveLength(1);
    // Dos horas seguidas dentro de lo permitido (el segundo tramo es el que sigue en la jornada).
    const next = p.school.periods[p.school.periods.findIndex((x) => x.id === classes[0].id) + 1];
    p.rules.subjectWindows[0].periodIds.push(next.id);
    expect(unmetPreferences(p).windows).toHaveLength(0);
  });

  it('una ventana obligatoria no se informa como preferencia', () => {
    const { p, a, classes } = withTimetable([[0, 3]]);
    p.rules.spreadSubjectDays = false;
    p.rules.subjectWindows = [{ subjectId: a.subjectId, periodIds: [classes[0].id], strength: 'obligatoria' }];
    expect(unmetPreferences(p).windows).toEqual([]);
  });

  it('incluye lo que la exportación omite: dos bloques fijados el mismo día', () => {
    const { p, a, classes } = withTimetable([[1, 0], [1, 1]]);
    preferSpread(p);
    p.locks[`${a.id}#0`] = { day: 1, periodId: classes[0].id };
    p.locks[`${a.id}#1`] = { day: 1, periodId: classes[1].id };
    expect(exportFet(p).xml).not.toMatch(new RegExp(`<ConstraintMinDaysBetweenActivities>(?:(?!</ConstraintMinDaysBetweenActivities>)[\\s\\S])*<Number_of_Activities>2</Number_of_Activities>\\s*<Activity_Id>1</Activity_Id>`));
    expect(unmetPreferences(p).spread).toHaveLength(1);
  });

  it('refleja los movimientos manuales', () => {
    const { p, classes } = withTimetable([[0, 0], [1, 0]]);
    preferSpread(p);
    expect(unmetPreferences(p).spread).toEqual([]);
    p.timetable!.placements[1].day = 0;
    p.timetable!.placements[1].periodId = classes[1].id;
    expect(unmetPreferences(p).spread).toHaveLength(1);
  });
});

describe('horario parcial', () => {
  const activity = (id: number, day = '', hour = '') =>
    `<Activity><Id>${id}</Id><Day>${day}</Day><Hour>${hour}</Hour><Room></Room></Activity>`;

  it('usa el mejor intento, no el último, y lista lo que faltó', () => {
    const p = exampleProject();
    const ex = exportFet(p);
    const hour = [...ex.periodByName.keys()][0];
    const [k1, k2] = [ex.activityById.get(1)!, ex.activityById.get(2)!];
    const partial = parsePartial({
      'timetables/horario-current/horario_activities.xml': `<A>${activity(1, ex.dayNames[0], hour)}</A>`,
      'timetables/horario-highest/horario_activities.xml': `<A>${activity(1, ex.dayNames[0], hour)}${activity(2, ex.dayNames[1], hour)}${activity(3)}</A>`,
    }, ex)!;
    expect(partial.placements.map((x) => x.key)).toEqual([k1, k2]);
    expect(partial.missing).toHaveLength(ex.activityById.size - 2);
    expect(partial.missing).not.toContain(k1);
    expect(partial.missing).toContain(ex.activityById.get(3));
  });

  it('sin mejor intento, o sin bloques ubicados, no hay nada que mostrar', () => {
    const ex = exportFet(exampleProject());
    expect(parsePartial({ 'timetables/horario/horario_activities.xml': activity(1, ex.dayNames[0], [...ex.periodByName.keys()][0]) }, ex)).toBeNull();
    expect(parsePartial({ 'timetables/horario-highest/horario_activities.xml': activity(1) }, ex)).toBeNull();
  });
});
