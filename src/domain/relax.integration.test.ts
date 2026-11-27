// Alternativas evaluadas con el motor real en Node. Se omite si falta public/engine/fet-cl.wasm.
import { describe, expect, it } from 'vitest';
import { fetArgs } from '../engine/args';
import { hasEngine, runEngine } from './nodeEngine.testutil';
import { electiveWithoutCommonTime, reference, teacherNamed } from './cases.testutil';
import { diagnose } from './diagnose';
import { exportFet } from './fetExport';
import { parseActivitiesXml } from './fetResult';
import { relaxPlan, runVariant, variantProject, type EngineRunner } from './relax';
import { units } from './units';
import { RELAX_MAX_VARIANTS, RELAX_SEED } from '../store/relax';

const SEED = RELAX_SEED;
const nodeRunner: EngineRunner = (xml, seconds, seed) => ({
  promise: runEngine(xml, fetArgs(seconds, seed)).then((r) => ({
    files: { 'logs/result.txt': r.result, 'logs/errors.txt': r.errors, 'logs/difficult_activities.txt': r.difficult },
    lines: r.lines,
  })),
  cancel: () => undefined,
});

describe.runIf(hasEngine)('alternativas con el motor', () => {
  it('la franja sin horario común: sin cambios se agota el tiempo; con la disponibilidad que propone el diagnóstico, funciona', async () => {
    const p = electiveWithoutCommonTime();
    // Un bloque fijado que no tiene que ver con el problema: toda variante debe respetarlo.
    const len = units(p).find((u) => u.teacherId === teacherNamed(p, 'Carolina Muñoz').id)!;
    const lockKey = `${len.id}#0`;
    p.locks[lockKey] = { day: 2, periodId: p.school.periods[0].id };
    const before = JSON.stringify(p);

    const plan = relaxPlan(p, diagnose(p, { outcome: { kind: 'timeout', activity: null, placedMax: null } }));
    expect(plan[0]).toEqual({ kind: 'teacher-available', teacherId: teacherNamed(p, 'Constanza Pizarro').id });

    const baseline = await runVariant(p, null, nodeRunner, 3, SEED).promise;
    expect(baseline.status).toBe('sin-resolver'); // no "no-basta": agotar el tiempo no demuestra nada
    const fix = await runVariant(p, plan[0], nodeRunner, 20, SEED).promise;
    expect(fix).toMatchObject({ status: 'funciona', placedMax: fix.total });

    // La misma variante, leída completa: respeta el fijado y la regla obligatoria de Ed. Física.
    const variant = variantProject(p, plan[0]);
    const ex = exportFet(variant);
    const out = await runEngine(ex.xml, fetArgs(20, SEED));
    const placed = parseActivitiesXml(out.activities, ex);
    expect(placed).toHaveLength(ex.activityById.size);
    expect(placed.find((x) => x.key === lockKey)).toMatchObject(p.locks[lockKey]);
    const edf = p.rules.subjectWindows[0];
    const edfUnits = new Set(units(p).filter((u) => u.subjectId === edf.subjectId).map((u) => u.id));
    for (const x of placed) if (edfUnits.has(x.key.split('#')[0])) expect(edf.periodIds).toContain(x.periodId);

    expect(JSON.stringify(p)).toBe(before);
  }, 120_000);

  it('el colegio real difícil: sin cambios queda sin resolver; liberar sus fijados, que propone el plan, funciona', async () => {
    const p = reference('dificil');
    const before = JSON.stringify(p);
    const plan = relaxPlan(p, diagnose(p, { outcome: { kind: 'timeout', activity: null, placedMax: null } }), RELAX_MAX_VARIANTS);
    const release = plan.find((c) => c.kind === 'release-locks' && c.scope === 'todos');
    expect(release).toBeDefined();

    const baseline = await runVariant(p, null, nodeRunner, 2, SEED).promise;
    expect(baseline).toMatchObject({ status: 'sin-resolver', total: 517 });
    expect(baseline.placedMax).toBeLessThan(517);
    const r = await runVariant(p, release!, nodeRunner, 20, SEED).promise;
    expect(r).toMatchObject({ status: 'funciona', placedMax: 517 });
    expect(JSON.stringify(p)).toBe(before);
  }, 120_000);
});
