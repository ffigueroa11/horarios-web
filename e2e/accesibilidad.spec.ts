// Auditoría automática de accesibilidad (WCAG 2.1 A y AA) en todas las pantallas, con axe. Falla con los problemas
// graves o críticos; los menores se informan en la salida. No reemplaza probar con teclado y lector de pantalla.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const minor = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  if (minor.length) console.log(`${where}: ${minor.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`);
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${where}: ${v.id} — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`accesibilidad de todas las pantallas (${scheme === 'light' ? 'modo claro' : 'modo oscuro'})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'axe da el mismo resultado en todos los navegadores');
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(() => { Math.random = () => 0.5; });
    const found: string[] = [];
    await page.goto('./');
    found.push(...await audit(page, 'Inicio'));
    await page.getByRole('button', { name: 'Probar con un liceo de ejemplo' }).click();
    for (const step of ['jornada', 'cursos', 'asignaturas', 'profesores', 'carga', 'electivos', 'reglas', 'generar']) {
      await page.locator(`.side .steps a[href="#${step}"]`).click();
      await expect(page.locator('main h1')).toBeVisible();
      found.push(...await audit(page, step));
    }
    await page.getByRole('button', { name: /^Generar (horario|de nuevo)$/ }).last().click();
    await expect(page.locator('.notice.ok', { hasText: 'Horario generado' })).toBeVisible({ timeout: 200_000 });
    found.push(...await audit(page, 'generar (resultado)'));
    await page.getByRole('button', { name: 'Ver horario' }).click();
    await expect(page.locator('.card td.lesson').first()).toBeVisible();
    found.push(...await audit(page, 'horario'));
    await page.locator('.card td.lesson').first().click();
    await expect(page.locator('.selbar')).toBeVisible();
    found.push(...await audit(page, 'horario con un bloque seleccionado'));
    expect(found).toEqual([]);
  });
}
