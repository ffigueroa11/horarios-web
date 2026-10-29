import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Falla la prueba si la página registra errores (salvo los esperables del motor al cerrar). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function openExample(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Probar con un liceo de ejemplo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();
}

async function generate(page: Page) {
  await page.locator('a[href="#generar"]').click();
  await page.getByRole('button', { name: /^Generar (horario|de nuevo)$/ }).last().click();
  await expect(page.locator('.notice.ok, .notice.bad').first()).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('.notice.ok')).toContainText('Horario generado');
}

test('flujo completo: ejemplo, generar, mover un bloque y recargar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'el flujo con el mouse se prueba en escritorio');
  const errors = watchErrors(page);
  await openExample(page);
  for (const step of ['cursos', 'asignaturas', 'profesores', 'carga', 'electivos', 'reglas']) {
    await page.locator(`a[href="#${step}"]`).click();
    await expect(page.locator('main h1')).toBeVisible();
  }
  await page.locator('a[href="#electivos"]').click();
  await expect(page.getByLabel('Nombre de la franja')).toHaveValue('Electivo artístico');
  await generate(page);

  await page.getByRole('button', { name: 'Ver horario' }).click();
  await expect(page.locator('td.lesson').first()).toBeVisible();

  // Seleccionar un bloque y moverlo a un lugar válido: queda fijado.
  await page.locator('td.lesson').first().click();
  await expect(page.locator('.selbar')).toBeVisible();
  const target = page.locator('td.drop-ok').first();
  if (await target.count()) {
    await target.click();
    await expect(page.locator('.notice.ok')).toContainText('Movido');
    await expect(page.locator('td.lesson.locked, .chip-lesson.locked').first()).toBeVisible();
  }

  // Arrastrar a un lugar no válido: el motivo aparece junto al cursor y, al soltar, como aviso breve.
  const source = page.locator('td.lesson').first();
  await source.click();
  const invalid = page.locator('td.lesson.drop-no').first();
  if (await invalid.count()) {
    const a = (await source.boundingBox())!, b = (await invalid.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 3, { steps: 2 });
    if (info.project.name === 'chromium') await expect(page.locator('.drag-hint')).toBeVisible();
    await page.mouse.up();
    if (info.project.name === 'chromium') await expect(page.locator('.toast')).toContainText('No se puede mover aquí');
  }
  await page.keyboard.press('Escape');

  // 2° Medio A: el electivo artístico aparece con sus tres opciones a la misma hora.
  await page.getByLabel('Elegir').selectOption({ label: '2° Medio A' });
  await expect(page.locator('.chip-lesson', { hasText: 'Música' }).first()).toBeVisible();

  // Los datos sobreviven a recargar la página.
  await page.reload();
  await expect(page.locator('td.lesson').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('respaldo: descargar e importar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'igual que en escritorio');
  await openExample(page);
  await page.getByRole('button', { name: 'Cambiar de horario' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Respaldo', exact: true }).click()]);
  const file = await download.path();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.app).toBe('horarios-web');
  expect(data.project.electives).toHaveLength(1);

  await page.getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.locator('.project')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();

  // Un archivo que no es respaldo muestra un error claro.
  await page.getByRole('button', { name: 'Cambiar de horario' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'otro.json', mimeType: 'application/json', buffer: Buffer.from('{"hola": 1}') });
  await expect(page.getByRole('alert')).toContainText('No se pudo importar');
});

test('en el celular la página no se desplaza hacia el lado', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo móvil');
  await openExample(page);
  for (const step of ['jornada', 'carga', 'electivos', 'generar']) {
    await page.goto(`./#${step}`);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), step).toBe(true);
  }
});

test('funciona sin conexión después de la primera visita', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium', 'el service worker se prueba en Chromium');
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Espera a que el service worker controle la página y termine de guardar el motor.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) if (await (await caches.open(k)).match('engine/fet-cl.wasm')) return true;
    return false;
  }), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Probar con un liceo de ejemplo' }).click();
  await generate(page);
  await context.setOffline(false);
});
