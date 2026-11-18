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
  // La semilla del motor sale de Math.random: fijarla da siempre el mismo horario, y las pruebas no dependen del azar.
  await page.addInitScript(() => { Math.random = () => 0.5; });
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

/** Selecciona el primer bloque para el que existe `selector` (ej. un destino válido). Falla si ninguno lo tiene. */
async function selectLessonWith(page: Page, selector: string) {
  const lessons = page.locator('.card td.lesson'); // .card: la grilla interactiva, no la copia para imprimir
  await expect(lessons.first()).toBeVisible(); // count() no espera: justo tras cambiar de pantalla daría 0.
  const n = await lessons.count();
  for (let i = 0; i < n; i++) {
    await lessons.nth(i).click();
    await expect(page.locator('.selbar')).toBeVisible();
    if (await page.locator(selector).count()) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.selbar')).toBeHidden();
  }
  throw new Error(`Ningún bloque tiene "${selector}"`);
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
  await selectLessonWith(page, 'td.drop-ok');
  await page.locator('td.drop-ok').first().click();
  await expect(page.locator('.notice.ok')).toContainText(/Movido|Intercambiados/);
  await expect(page.locator('td.lesson.locked, .chip-lesson.locked').first()).toBeVisible();

  // Lugar no válido con un bloque seleccionado: el motivo aparece junto al cursor (el mismo rótulo que al
  // arrastrar) y, al hacer clic en un cuadro vacío no válido, como aviso breve abajo.
  await selectLessonWith(page, 'td.lesson.drop-no');
  const invalid = page.locator('td.lesson.drop-no').first();
  await invalid.hover({ position: { x: 10, y: 10 } });
  await invalid.hover({ position: { x: 14, y: 14 } });
  await expect(page.locator('.drag-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  const emptyInvalid = 'td.drop-no:not(.lesson):not(.multi)';
  await selectLessonWith(page, emptyInvalid);
  await page.locator(emptyInvalid).first().click();
  await expect(page.locator('.toast')).toContainText('No se puede mover aquí');
  await page.keyboard.press('Escape');

  // 2° Medio A: el electivo artístico aparece con sus tres opciones a la misma hora.
  await page.getByLabel('Elegir').selectOption({ label: '2° Medio A' });
  await expect(page.locator('.chip-lesson', { hasText: 'Música' }).first()).toBeVisible();

  // Los datos sobreviven a recargar la página.
  await page.reload();
  await expect(page.locator('td.lesson').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('arrastrar y soltar: motivo en un lugar no válido y movimiento en uno válido', async ({ page }, info) => {
  // Los eventos de arrastre enviados directamente solo son fieles en Chromium; en Firefox y Safari se prueba a mano.
  test.skip(info.project.name !== 'chromium', 'arrastre simulado solo en Chromium');
  const errors = watchErrors(page);
  await openExample(page);
  await generate(page);
  await page.getByRole('button', { name: 'Ver horario' }).click();
  const source = page.locator('.card td.lesson.selected');
  const center = async (selector: string) => {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    return { target, at: { clientX: Math.round(box.x + box.width / 2), clientY: Math.round(box.y + box.height / 2) } };
  };

  await selectLessonWith(page, 'td.lesson.drop-no');
  const invalid = await center('td.lesson.drop-no');
  let dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await invalid.target.dispatchEvent('dragover', { dataTransfer, ...invalid.at });
  await expect(page.locator('.drag-hint')).toBeVisible();
  await source.dispatchEvent('dragend', { dataTransfer, ...invalid.at });
  await expect(page.locator('.toast')).toContainText('No se puede mover aquí');
  await expect(page.locator('.drag-hint')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await selectLessonWith(page, 'td.drop-ok');
  const valid = await center('td.drop-ok');
  dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await valid.target.dispatchEvent('dragover', { dataTransfer, ...valid.at });
  await valid.target.dispatchEvent('drop', { dataTransfer, ...valid.at });
  await expect(page.locator('.notice.ok')).toContainText(/Movido|Intercambiados/);
  await expect(page.locator('td.lesson.locked, .chip-lesson.locked').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('eliminar un curso o una asignatura pide confirmar y dice cuánta carga se pierde', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'igual que en escritorio');
  await openExample(page);
  await page.locator('a[href="#cursos"]').click();
  await page.getByRole('button', { name: 'Eliminar 1° Medio A' }).click();
  await expect(page.getByLabel('Nombre del curso').first()).toHaveValue('1° Medio A');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByLabel('Nombre del curso').first()).toHaveValue('1° Medio A');
  await page.getByRole('button', { name: 'Eliminar 1° Medio A' }).click();
  await page.getByRole('button', { name: /Sí, eliminar con \d+ clases de la carga/ }).click();
  await expect(page.getByLabel('Nombre del curso').first()).not.toHaveValue('1° Medio A');

  await page.locator('a[href="#asignaturas"]').click();
  await expect(page.getByLabel('Sigla').first()).toBeVisible(); // count() no espera a que se dibuje la pantalla.
  const before = await page.getByLabel('Sigla').count();
  await page.getByRole('button', { name: /^Eliminar / }).first().click();
  await expect(page.getByLabel('Sigla')).toHaveCount(before);
  await page.getByRole('button', { name: /^Sí, eliminar/ }).click();
  await expect(page.getByLabel('Sigla')).toHaveCount(before - 1);
});

test('un horario guardado con datos dañados no deja la app atascada', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'igual que en escritorio');
  await openExample(page);
  // Espera a que esté guardado y lo daña directamente en IndexedDB: validate falla con un fijado vacío.
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('keyval-store');
    open.onsuccess = () => {
      const read = open.result.transaction('keyval').objectStore('keyval').get('horarios-web');
      read.onsuccess = () => { open.result.close(); resolve(!!read.result); };
    };
  }))).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
      const read = store.get('horarios-web');
      read.onsuccess = () => {
        const data = JSON.parse(read.result);
        const project = data.state.projects[data.state.currentId];
        project.locks[`${project.assignments[0].id}#0`] = null;
        const write = store.put(JSON.stringify(data), 'horarios-web');
        write.onsuccess = () => { open.result.close(); resolve(); };
      };
    };
  }));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();
  await page.goto('./#generar');
  await expect(page.locator('.issues')).toContainText('No se pudieron revisar los datos');
  await expect(page.getByRole('button', { name: 'Generar horario' })).toBeDisabled();
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page.locator('.project')).toHaveCount(1);
});

test('deshacer: eliminar un curso, mover un bloque y recuperar un horario eliminado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'igual que en escritorio');
  const errors = watchErrors(page);
  await openExample(page);
  const undo = page.getByRole('button', { name: '↶ Deshacer' });
  const redo = page.getByRole('button', { name: '↷ Rehacer' });
  await expect(undo).toBeDisabled();

  // Eliminar un curso y deshacerlo con el teclado (fuera de un campo de texto).
  await page.locator('a[href="#cursos"]').click();
  await page.getByRole('button', { name: 'Eliminar 1° Medio A' }).click();
  await page.getByRole('button', { name: /Sí, eliminar con \d+ clases de la carga/ }).click();
  await expect(page.getByLabel('Nombre del curso').first()).not.toHaveValue('1° Medio A');
  await page.locator('main h1').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByLabel('Nombre del curso').first()).toHaveValue('1° Medio A');
  await expect(page.locator('.toast')).toContainText('Se deshizo');
  await redo.click();
  await expect(page.getByLabel('Nombre del curso').first()).not.toHaveValue('1° Medio A');
  await undo.click();
  await expect(page.getByLabel('Nombre del curso').first()).toHaveValue('1° Medio A');

  // Mover un bloque lo fija; deshacerlo lo devuelve a su lugar y lo libera.
  await generate(page);
  await expect(undo).toBeDisabled(); // el horario nuevo no se deshace
  await page.getByRole('button', { name: 'Ver horario' }).click();
  await selectLessonWith(page, '.card td.drop-ok');
  await page.locator('.card td.drop-ok').first().click();
  await expect(page.locator('.notice.ok')).toContainText(/Movido|Intercambiados/);
  await expect(page.locator('.badge', { hasText: /^[1-9]\d* fijados$/ })).toBeVisible();
  await undo.click();
  await expect(page.locator('.badge', { hasText: /^0 fijados$/ })).toBeVisible();
  await expect(page.locator('.notice.warn', { hasText: 'Los datos cambiaron' })).toHaveCount(0);

  // Un horario eliminado se puede recuperar desde el inicio.
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.locator('.project')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.project')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('desde el menú se vuelve al inicio con "Inicio" o con el logo', async ({ page }) => {
  await openExample(page);
  for (const name of ['Inicio', 'Horarios Web']) {
    await page.getByRole('link', { name, exact: true }).click();
    // exact: con cuenta configurada también aparece "Guarda tus horarios en una cuenta".
    await expect(page.getByRole('heading', { level: 2, name: 'Tus horarios', exact: true })).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(0);
    await page.getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Jornada' })).toBeVisible();
  }
});

test('respaldo: descargar e importar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'igual que en escritorio');
  await openExample(page);
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
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
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'otro.json', mimeType: 'application/json', buffer: Buffer.from('{"hola": 1}') });
  await expect(page.getByRole('alert')).toContainText('No se pudo importar');
});

test('informa las preferencias no cumplidas al generar y en el horario', async ({ page }) => {
  const errors = watchErrors(page);
  const hours = ['08:00 - 08:45', '08:45 - 09:30', '09:45 - 10:30'];
  const act = (id: number) => `<Activity><Teacher>Soto</Teacher><Subject>Matemática</Subject><Students>1°A</Students><Duration>1</Duration><Id>${id}</Id><Activity_Group_Id>1</Activity_Group_Id><Active>true</Active></Activity>`;
  // Tres bloques en dos días, con "repartir en días" preferible: uno tiene que repetir día.
  const fet = `<?xml version="1.0" encoding="UTF-8"?><fet version="7.12.0"><Institution_Name>Escuela</Institution_Name>
    <Days_List><Day><Name>Lunes</Name></Day><Day><Name>Martes</Name></Day></Days_List>
    <Hours_List>${hours.map((h) => `<Hour><Name>${h}</Name></Hour>`).join('')}</Hours_List>
    <Students_List><Year><Name>1°A</Name></Year></Students_List>
    <Teachers_List><Teacher><Name>Soto</Name></Teacher></Teachers_List>
    <Subjects_List><Subject><Name>Matemática</Name></Subject></Subjects_List>
    <Activities_List>${act(1)}${act(2)}${act(3)}</Activities_List>
    <Time_Constraints_List><ConstraintMinDaysBetweenActivities><Weight_Percentage>95</Weight_Percentage><Consecutive_If_Same_Day>true</Consecutive_If_Same_Day><Number_of_Activities>3</Number_of_Activities><Activity_Id>1</Activity_Id><Activity_Id>2</Activity_Id><Activity_Id>3</Activity_Id><MinDays>1</MinDays><Active>true</Active></ConstraintMinDaysBetweenActivities></Time_Constraints_List></fet>`;
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({ name: 'preferencias.fet', mimeType: 'application/octet-stream', buffer: Buffer.from(fet) });
  await generate(page);
  const report = page.locator('details.notice.warn');
  await expect(report).toContainText('1 preferencia no se cumplió');
  await report.locator('summary').click();
  await expect(report).toContainText(/Matemática · 1°A · Soto: más de un bloque el (Lunes|Martes)/);

  await page.getByRole('button', { name: 'Ver horario' }).click();
  await expect(page.locator('details.notice.warn')).toContainText('1 preferencia no se cumplió');
  expect(errors).toEqual([]);
});

test('importa un archivo .fet, informa lo perdido y genera con los bloques fijados', async ({ page }) => {
  const errors = watchErrors(page);
  const hours = ['08:00 - 08:45', '08:45 - 09:30', '09:45 - 10:30'];
  const fet = `<?xml version="1.0" encoding="UTF-8"?><fet version="5.37.5"><Institution_Name>Escuela</Institution_Name>
    <Days_List><Day><Name>Lunes</Name></Day><Day><Name>Martes</Name></Day></Days_List>
    <Hours_List>${hours.map((h) => `<Hour><Name>${h}</Name></Hour>`).join('')}</Hours_List>
    <Students_List><Year><Name>1°A</Name></Year></Students_List>
    <Teachers_List><Teacher><Name>Soto</Name></Teacher></Teachers_List>
    <Subjects_List><Subject><Name>Matemática</Name></Subject></Subjects_List>
    <Activities_List><Activity><Teacher>Soto</Teacher><Subject>Matemática</Subject><Students>1°A</Students><Duration>2</Duration><Id>1</Id><Activity_Group_Id>0</Activity_Group_Id><Active>true</Active></Activity></Activities_List>
    <Time_Constraints_List><ConstraintActivityPreferredStartingTime><Weight_Percentage>100</Weight_Percentage><Activity_Id>1</Activity_Id><Preferred_Day>Martes</Preferred_Day><Preferred_Hour>${hours[0]}</Preferred_Hour><Active>true</Active></ConstraintActivityPreferredStartingTime>
    <ConstraintTwoActivitiesConsecutive><Weight_Percentage>100</Weight_Percentage><Active>true</Active></ConstraintTwoActivitiesConsecutive></Time_Constraints_List></fet>`;
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({ name: 'horario2019.fet', mimeType: 'application/octet-stream', buffer: Buffer.from(fet) });
  const report = page.getByRole('status').filter({ hasText: 'quedó importado' }); // También es "status" el indicador de guardado.
  await expect(report).toBeVisible();
  await expect(report).toContainText('1 bloque de clase');
  await expect(report).toContainText('Dos actividades seguidas');
  await generate(page);
  await page.getByRole('button', { name: 'Ver horario' }).click();
  await expect(page.locator('td.lesson').first()).toContainText('Mat');
  expect(errors).toEqual([]);
});

test('la política de seguridad de contenido no bloquea nada al generar ni al exportar', async ({ page }) => {
  // Las mismas cabeceras que Vercel (vercel.json), que vite preview también envía.
  const res = await page.request.get('./');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  expect((await page.request.get('./engine/fet-worker.js')).headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  await page.addInitScript(() => {
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations = [];
    addEventListener('securitypolicyviolation', (e) => w.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors = watchErrors(page);
  await openExample(page);
  await generate(page);
  await page.locator('a[href="#horario"]').click();
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel', exact: true }).click()]);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
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
  // Todo lo que lista precache.json (incluidos los módulos de Excel, que index.html no enlaza) y el motor.
  await expect.poll(() => page.evaluate(async () => {
    const list: string[] = await (await fetch('precache.json')).json();
    const missing = [];
    for (const u of [...list, 'engine/fet-cl.wasm', 'engine/fet-cl.js', 'engine/fet-worker.js', 'engine/fet_es.qm'])
      if (!(await caches.match(u, { ignoreVary: true }))) missing.push(u); // igual que public/sw.js
    return list.some((u) => u.endsWith('.js') && !u.includes('index-')) ? missing : ['precache.json sin módulos bajo demanda'];
  }), { timeout: 30_000 }).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Probar con un liceo de ejemplo' }).click();
  await generate(page);

  // Excel sin conexión: exportar el horario y volver a leer ese archivo en el importador de carga.
  await page.locator('a[href="#horario"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel', exact: true }).click()]);
  const xlsx = readFileSync((await download.path())!);
  await page.locator('a[href="#carga"]').click();
  await page.getByRole('button', { name: 'Importar desde Excel' }).first().click();
  await page.locator('input[type=file]').setInputFiles({ name: 'horario.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  // Si el módulo no cargara, aparecería "No se pudo leer el archivo"; leído, muestra el resumen con el nombre.
  await expect(page.locator('.badge', { hasText: 'horario.xlsx' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await context.setOffline(false);
});
