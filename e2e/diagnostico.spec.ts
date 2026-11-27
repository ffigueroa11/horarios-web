// Diagnóstico y alternativas en la pantalla de generación, con un colegio en que una franja de electivos no tiene
// ningún bloque en que todos sus profesores estén libres a la vez: la revisión previa no lo detecta y el motor solo
// agotaría el tiempo, pero el diagnóstico lo demuestra antes de generar.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeBackup } from '../src/domain/backup';
import { electiveWithoutCommonTime } from '../src/domain/cases.testutil';

const backup = () => ({ name: 'franja-sin-horario.json', mimeType: 'application/json', buffer: Buffer.from(makeBackup([electiveWithoutCommonTime()])) });

async function openGenerar(page: Page) {
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles(backup());
  await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();
  const toggle = page.locator('.menu-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('.side .steps a[href="#generar"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Generar horario' })).toBeVisible();
}

const panel = (page: Page) => page.getByTestId('diagnostico');
const finding = (page: Page) => panel(page).locator('.finding.demostrado', { hasText: 'Electivo artístico' });

test('diagnóstico demostrado antes de generar, alternativa evaluada y cambio aplicado solo al confirmar', async ({ page }) => {
  await openGenerar(page);
  // Lo demostrado se presenta como tal, sin impedir generar (la revisión previa no tiene errores).
  await expect(panel(page).getByRole('heading', { name: 'Imposible con estos datos' })).toBeVisible();
  await expect(finding(page)).toContainText('Demostrado');
  await expect(finding(page)).toContainText('Constanza Pizarro');
  await expect(panel(page)).toContainText('Más tiempo de cálculo no lo resuelve');
  await expect(page.getByRole('button', { name: 'Generar horario' })).toBeEnabled();

  await panel(page).getByRole('button', { name: 'Evaluar alternativas' }).click();
  await expect(page.getByRole('button', { name: 'Generar horario' })).toBeDisabled();
  const works = page.getByTestId('alternativas').locator('.finding', { hasText: 'Funciona' }).first();
  await expect(works).toBeVisible({ timeout: 120_000 });
  await expect(works).toContainText('Suponer que Constanza Pizarro está disponible en todos los bloques');
  await expect(panel(page)).toContainText('Evaluación terminada.');
  // Evaluar no cambió los datos: el hallazgo sigue ahí y el horario no se generó.
  await expect(finding(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generar horario' })).toBeEnabled();

  // Cancelar la confirmación no cambia nada.
  await works.getByRole('button', { name: 'Aplicar este cambio…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Confirmar el cambio' });
  await expect(dialog).toContainText('¿Aplicar este cambio a tus datos?');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(finding(page)).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).include('[data-testid="diagnostico"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // Confirmado, se aplica y se genera con la misma semilla: el horario sale completo.
  await works.getByRole('button', { name: 'Aplicar este cambio…' }).click();
  await dialog.getByRole('button', { name: 'Sí, aplicar y generar' }).click();
  await expect(page.locator('.notice.ok', { hasText: 'Cambio aplicado' })).toBeVisible();
  await expect(page.locator('.notice.ok', { hasText: 'Horario generado' })).toBeVisible({ timeout: 120_000 });
  await expect(panel(page)).toHaveCount(0);
});

test('detener la evaluación libera el motor y no cambia los datos', async ({ browser }, info) => {
  // El motor se demora a propósito para detenerlo a mitad de camino. Las rutas de red alcanzan al Worker del motor solo
  // en Chromium, y sin service worker (que respondería desde su caché).
  test.skip(info.project.name !== 'chromium', 'demora del motor simulada solo en Chromium');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await context.route('**/engine/fet-cl.wasm', async (route) => { await new Promise((r) => setTimeout(r, 5_000)); await route.continue(); });
  await openGenerar(page);
  await panel(page).getByRole('button', { name: 'Evaluar alternativas' }).click();
  await expect(panel(page)).toContainText('Evaluando 1 de');
  await panel(page).getByRole('button', { name: 'Detener' }).click();
  await expect(panel(page)).toContainText('Evaluación detenida.');
  const list = page.getByTestId('alternativas');
  await expect(list.locator('.finding').first()).toContainText('Detenida');
  await expect(list).not.toContainText('Funciona');
  await expect(panel(page).getByRole('button', { name: 'Probar las demás' })).toBeVisible();
  await expect(finding(page)).toBeVisible();
  // El motor quedó libre: se puede generar de inmediato.
  await expect(page.getByRole('button', { name: 'Generar horario' })).toBeEnabled();
  await context.close();
});
