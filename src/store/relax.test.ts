// Evaluación de alternativas con un motor simulado: orden, cancelación, tiempo y que nada se guarde.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleProject } from '../domain/defaults';
import type { EngineFiles, EngineRunner } from '../domain/relax';
import { RELAX_SEED, useRelax } from './relax';
import { useGeneration } from './generation';
import { useProjects } from './projects';
import { engineLock } from './engineLock';

const RESULT = { ok: 'Generation successful', timeout: 'Time exceeded', impossible: 'Impossible' } as const;
type Answer = keyof typeof RESULT;

/** Motor simulado: cada ejecución queda pendiente hasta que la prueba la responde. */
function fakeEngine() {
  const runs: { xml: string; seconds: number; seed: number; answer: (a: Answer) => void; cancelled: boolean }[] = [];
  const runner: EngineRunner = (xml, seconds, seed) => {
    let resolve!: (f: EngineFiles) => void;
    const promise = new Promise<EngineFiles>((res) => { resolve = res; });
    const run = { xml, seconds, seed, cancelled: false, answer: (a: Answer) => resolve({ files: { 'logs/result.txt': RESULT[a] }, lines: [] }) };
    runs.push(run);
    return { promise, cancel: () => { run.cancelled = true; } };
  };
  /** Espera a que se pida la ejecución n (las variantes van una tras otra). */
  const nth = async (n: number) => { await vi.waitFor(() => expect(runs.length).toBeGreaterThan(n)); return runs[n]; };
  return { runs, runner, nth };
}

const relax = () => useRelax.getState();
const statuses = () => relax().items.map((x) => x.status);
const CHANGES = [{ kind: 'courses-start-first-off' }, { kind: 'courses-no-gaps-off' }, { kind: 'teacher-gaps-day', value: 3 }] as const;

describe('evaluación de alternativas', () => {
  beforeEach(() => relax().reset());
  afterEach(() => { relax().reset(); useGeneration.getState().reset(); });

  it('evalúa una a la vez con la misma semilla y se detiene en la primera que funciona', async () => {
    const engine = fakeEngine();
    const p = exampleProject();
    expect(relax().start(p, [...CHANGES], { runner: engine.runner, seconds: 5 })).toBe(true);
    expect(engineLock.owner()).toBe('alternativas');
    (await engine.nth(0)).answer('impossible');
    (await engine.nth(1)).answer('ok');
    await vi.waitFor(() => expect(relax().phase).toBe('done'));
    expect(statuses()).toEqual(['no-basta', 'funciona', 'pendiente']);
    expect(engine.runs.map((r) => [r.seconds, r.seed])).toEqual([[5, RELAX_SEED], [5, RELAX_SEED]]);
    expect(engineLock.owner()).toBe(null);

    // "Probar las demás" sigue con las pendientes, sin repetir las ya evaluadas.
    expect(relax().continueRest()).toBe(true);
    (await engine.nth(2)).answer('timeout');
    await vi.waitFor(() => expect(relax().phase).toBe('done'));
    expect(statuses()).toEqual(['no-basta', 'funciona', 'sin-resolver']);
  });

  it('cada variante cambia una sola regla de una copia: el proyecto y el almacén no cambian', async () => {
    const engine = fakeEngine();
    const p = exampleProject();
    useProjects.setState({ projects: { [p.id]: p }, currentId: p.id });
    const store = useProjects.getState().projects;
    const before = JSON.stringify(p);
    relax().start(p, [...CHANGES], { runner: engine.runner, stopAtFirst: false });
    // Editar el proyecto a mitad de camino no cambia lo que se evalúa: se usa una copia tomada al empezar.
    p.rules.coursesNoGaps = false;
    for (let i = 0; i < 3; i++) (await engine.nth(i)).answer('ok');
    await vi.waitFor(() => expect(relax().phase).toBe('done'));
    p.rules.coursesNoGaps = true;
    expect(JSON.stringify(p)).toBe(before);
    expect(useProjects.getState().projects).toBe(store);
    expect(p.timetable).toBe(null);
    // Las variantes difieren entre sí solo en la regla que cambian.
    expect(engine.runs[0].xml).toContain('ConstraintStudentsMaxGapsPerWeek');
    expect(engine.runs[0].xml).not.toContain('ConstraintStudentsEarlyMaxBeginningsAtSecondHour');
    expect(engine.runs[1].xml).not.toContain('ConstraintStudentsMaxGapsPerWeek');
    expect(engine.runs[1].xml).toContain('ConstraintStudentsEarlyMaxBeginningsAtSecondHour');
  });

  it('detener termina el motor, ignora su respuesta tardía y libera el motor', async () => {
    const engine = fakeEngine();
    relax().start(exampleProject(), [...CHANGES], { runner: engine.runner });
    const first = await engine.nth(0);
    relax().cancel();
    expect(first.cancelled).toBe(true);
    expect(relax().phase).toBe('cancelled');
    expect(statuses()).toEqual(['cancelada', 'pendiente', 'pendiente']);
    expect(engineLock.owner()).toBe(null);
    first.answer('ok');
    await new Promise((r) => setTimeout(r, 10));
    expect(statuses()).toEqual(['cancelada', 'pendiente', 'pendiente']);
    expect(engine.runs).toHaveLength(1);
  });

  it('no genera mientras evalúa, ni evalúa mientras genera', async () => {
    const engine = fakeEngine();
    const p = exampleProject();
    relax().start(p, [...CHANGES], { runner: engine.runner });
    useGeneration.getState().start(p, 10);
    expect(useGeneration.getState().status).toBe('idle');
    expect(relax().start(p, [...CHANGES], { runner: engine.runner })).toBe(false);
    relax().cancel();

    engineLock.take('generacion'); // como si hubiera una generación en curso
    expect(relax().start(p, [...CHANGES], { runner: engine.runner })).toBe(false);
    engineLock.release('generacion');
  });

  it('sin resolver no es lo mismo que no basta: se puede reintentar con más tiempo', async () => {
    const engine = fakeEngine();
    relax().start(exampleProject(), [...CHANGES].slice(0, 1), { runner: engine.runner, seconds: 15, baseline: true });
    expect(relax().items.map((x) => x.title)[0]).toBe('Sin cambios');
    (await engine.nth(0)).answer('timeout');
    (await engine.nth(1)).answer('timeout');
    await vi.waitFor(() => expect(relax().phase).toBe('done'));
    expect(statuses()).toEqual(['sin-resolver', 'sin-resolver']);
    expect(relax().retryLonger()).toBe(true);
    const longer = await engine.nth(2);
    expect(longer.seconds).toBe(60);
    longer.answer('ok');
    await vi.waitFor(() => expect(relax().phase).toBe('done'));
    // Se detiene en la primera que funciona: la otra sigue esperando su turno con más tiempo.
    expect(statuses()).toEqual(['funciona', 'pendiente']);
  });
});
