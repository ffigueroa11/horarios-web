// Medición del ajuste manual en el navegador con el colegio de referencia (492 bloques). No es una prueba de CI: se
// corre a mano, sobre dist/, para comparar antes y después de un cambio.
//   npm run build && PERF=1 npx playwright test e2e/rendimiento.spec.ts --project=chromium
//
// Mide el trabajo del hilo principal (TaskDuration de Chrome) con la CPU 4 veces más lenta, para parecerse a un
// computador de colegio. El tiempo hasta el cuadro siguiente no sirve: en un equipo rápido siempre son 2 cuadros.
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.skip(!process.env.PERF, 'solo con PERF=1');

test('ajuste manual con el colegio de referencia', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'se mide en Chromium');
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../src/domain/fixtures/referencia-generada.json', import.meta.url)));
  await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();
  await page.goto('./#horario');
  await expect(page.locator('.card td.lesson').first()).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Trabajo acumulado del hilo principal, en ms: total, JavaScript, y estilos más diseño de la página.
  const busy = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const v = (name: string) => metrics.find((m) => m.name === name)!.value * 1000;
    return { total: v('TaskDuration'), js: v('ScriptDuration'), layout: v('LayoutDuration') + v('RecalcStyleDuration') };
  };
  const per = (a: Awaited<ReturnType<typeof busy>>, b: Awaited<ReturnType<typeof busy>>, n: number) =>
    `${((b.total - a.total) / n).toFixed(1)} ms (JavaScript ${((b.js - a.js) / n).toFixed(1)}, estilos y diseño ${((b.layout - a.layout) / n).toFixed(1)})`;

  // Seleccionar un bloque y soltarlo (dos clics), doce veces.
  const selections = 12;
  let t = await busy();
  await page.evaluate(async (n) => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    for (let i = 0; i < n; i++) {
      const list = document.querySelectorAll<HTMLElement>('.card td.lesson');
      const el = list[i % list.length];
      el.click();
      await frame();
      if (!document.querySelector('.selbar')) throw new Error('el clic no seleccionó el bloque');
      el.click(); // un segundo clic lo suelta
      await frame();
      if (document.querySelector('.selbar')) throw new Error('el segundo clic no soltó el bloque');
    }
  }, selections);
  const perSelection = per(t, await busy(), selections);

  // Mover el mouse sobre la grilla con un bloque seleccionado (muestra el motivo junto al cursor).
  await page.evaluate(async () => {
    document.querySelector<HTMLElement>('.card td.lesson')!.click();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    if (!document.querySelector('.selbar')) throw new Error('no quedó un bloque seleccionado');
  });
  const moves = 80;
  t = await busy();
  const cells = await page.evaluate(async (n) => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const cells = [...document.querySelectorAll<HTMLElement>('.card td.drop-ok, .card td.drop-no')];
    for (let i = 0; i < n; i++) {
      const el = cells[(i * 7) % cells.length];
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 3 + (i % 5) * 4, clientY: r.top + 3 }));
      await frame();
    }
    return cells.length;
  }, moves);
  const perMove = per(t, await busy(), moves);

  console.log(`CPU x4 — seleccionar y soltar un bloque: ${perSelection}; mover el mouse: ${perMove} por movimiento`);
  expect(cells).toBeGreaterThan(0);
});
