import { beforeEach, describe, expect, it } from 'vitest';
import { exampleProject } from '../domain/defaults';
import { isStale, useProjects } from './projects';

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
    state().update((d) => { d.locks.x = { day: 0, periodId: 'y' }; }, { touch: false });
    expect(isStale(current())).toBe(false);
    state().update((d) => { d.name = 'Otro nombre'; });
    expect(isStale(current())).toBe(true);
  });
});
