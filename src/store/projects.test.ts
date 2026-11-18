import { beforeEach, describe, expect, it } from 'vitest';
import { exampleProject } from '../domain/defaults';
import { activityKey } from '../domain/types';
import { HISTORY_LIMIT, isStale, undoState, useProjects } from './projects';

/** Un proyecto con un horario generado después de su última edición: no está desactualizado. */
function generated() {
  const p = exampleProject();
  p.updatedAt = '2026-03-01T10:00:00.000Z';
  p.timetable = { generatedAt: '2026-03-01T11:00:00.000Z', seconds: 1, placements: [] };
  return p;
}
const state = () => useProjects.getState();

describe('horario desactualizado', () => {
  beforeEach(() => useProjects.setState({ projects: {}, currentId: null }));

  it('un horario restaurado de un respaldo sigue vigente', () => {
    const id = state().importProjects([generated()])!;
    expect(isStale(state().projects[id])).toBe(false);
    expect(state().projects[id].backupAt).toBeTruthy();
  });
  it('un horario que ya estaba desactualizado lo sigue estando al restaurarlo', () => {
    const p = generated();
    p.updatedAt = '2026-03-02T10:00:00.000Z';
    const id = state().importProjects([p])!;
    expect(isStale(state().projects[id])).toBe(true);
  });
  it('un horario duplicado sigue vigente', () => {
    const id = state().importProjects([generated()])!;
    const copy = state().duplicate(id);
    expect(copy).not.toBe(id);
    expect(isStale(state().projects[copy])).toBe(false);
  });
  it('editar los datos lo deja desactualizado, pero fijar bloques no', () => {
    state().importProjects([generated()]);
    const current = () => state().projects[state().currentId!];
    state().update((d) => { d.locks[activityKey(d.assignments[0].id, 0)] = { day: 0, periodId: d.school.periods[0].id }; }, { touch: false });
    expect(Object.keys(current().locks)).toHaveLength(1);
    expect(isStale(current())).toBe(false);
    state().update((d) => { d.name = 'Otro nombre'; });
    expect(isStale(current())).toBe(true);
  });
});

describe('guardar un horario generado', () => {
  beforeEach(() => useProjects.setState({ projects: {}, currentId: null }));
  const p0 = () => state().projects[state().currentId!];
  /** Un horario con el primer bloque de la carga en `periodIdx` del lunes. */
  const timetable = (periodIdx: number) => {
    const p = p0();
    return { generatedAt: new Date().toISOString(), seconds: 1, seed: 42, placements: [
      { key: activityKey(p.assignments[0].id, 0), day: 0, periodId: p.school.periods[periodIdx].id, roomId: null },
    ] };
  };

  it('guarda la semilla y queda vigente si respeta los fijados', () => {
    const id = state().importProjects([generated()])!;
    state().update((d) => { d.locks[activityKey(d.assignments[0].id, 0)] = { day: 0, periodId: d.school.periods[0].id }; }, { touch: false });
    state().saveTimetable(id, timetable(0));
    expect(state().projects[id].timetable?.seed).toBe(42);
    expect(isStale(state().projects[id])).toBe(false);
  });
  it('queda desactualizado si mientras se calculaba se fijó un bloque en otro lugar', () => {
    const id = state().importProjects([generated()])!;
    state().update((d) => { d.locks[activityKey(d.assignments[0].id, 0)] = { day: 0, periodId: d.school.periods[1].id }; }, { touch: false });
    state().saveTimetable(id, timetable(0));
    expect(isStale(state().projects[id])).toBe(true);
  });
  it('se guarda en el proyecto generado aunque el usuario haya abierto otro', () => {
    const id = state().importProjects([generated()])!;
    const tt = timetable(0);
    const other = state().create('vacio');
    state().saveTimetable(id, tt);
    expect(state().currentId).toBe(other);
    expect(state().projects[id].timetable).toEqual(tt);
    expect(state().projects[other].timetable).toBeNull();
  });
});

describe('deshacer y rehacer', () => {
  beforeEach(() => useProjects.setState({ projects: {}, currentId: null, history: {}, lastRemoved: null }));
  const current = () => state().projects[state().currentId!];

  it('deshace y rehace una edición, con su fecha', () => {
    state().importProjects([generated()]);
    const before = current();
    state().update((d) => { d.courses = d.courses.slice(1); });
    expect(isStale(current())).toBe(true);
    expect(state().undo()).toBe(true);
    expect(current()).toBe(before);
    expect(isStale(current())).toBe(false);
    expect(state().redo()).toBe(true);
    expect(current().courses).toHaveLength(before.courses.length - 1);
    expect(state().redo()).toBe(false);
  });
  it('deshacer un movimiento o un fijado no cambia la fecha de edición', () => {
    state().importProjects([generated()]);
    const updatedAt = current().updatedAt;
    state().update((d) => { d.locks[activityKey(d.assignments[0].id, 0)] = { day: 0, periodId: d.school.periods[0].id }; }, { touch: false });
    state().undo();
    expect(current().locks).toEqual({});
    expect(current().updatedAt).toBe(updatedAt);
  });
  it('un cambio nuevo descarta lo que se podía rehacer', () => {
    state().importProjects([generated()]);
    state().update((d) => { d.name = 'Uno'; });
    state().undo();
    expect(undoState(state()).canRedo).toBe(true);
    state().update((d) => { d.name = 'Dos'; });
    expect(undoState(state()).canRedo).toBe(false);
  });
  it('si el horario cambió por otra vía (generar, la nube, otra pestaña), no se deshace', () => {
    const id = state().importProjects([generated()])!;
    state().update((d) => { d.name = 'Editado'; });
    state().saveTimetable(id, { generatedAt: new Date().toISOString(), seconds: 1, placements: [] });
    expect(undoState(state()).canUndo).toBe(false);
    expect(state().undo()).toBe(false);
    expect(current().name).toBe('Editado');
  });
  it('cada horario tiene su propio historial, con un límite', () => {
    const a = state().importProjects([generated()])!;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) state().update((d) => { d.name = `Nombre ${i}`; });
    expect(state().history[a].past).toHaveLength(HISTORY_LIMIT);
    state().create('vacio');
    expect(undoState(state()).canUndo).toBe(false);
    state().select(a);
    expect(undoState(state()).canUndo).toBe(true);
  });
  it('recupera un horario eliminado', () => {
    const id = state().importProjects([generated()])!;
    const p = current();
    state().remove(id);
    expect(state().projects[id]).toBeUndefined();
    state().restoreRemoved();
    expect(state().projects[id]).toBe(p);
    expect(state().lastRemoved).toBeNull();
  });
});
