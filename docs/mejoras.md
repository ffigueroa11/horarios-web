# Análisis de mejoras

Revisión del commit `be2f6ec` (noviembre de 2026), pensada para decidir qué hacer a continuación.

> **Estado:** la fase 0 de la [hoja de ruta](#hoja-de-ruta-sugerida) ya se aplicó: E1 a E5, E7 a E11, T1, T2 y T5. El
> detalle de esos hallazgos se conserva como registro de qué se corrigió y por qué. De la fase 1 ya están F1 y F2. Las
> referencias a líneas de código corresponden al commit revisado y pueden haber cambiado. Después de esta revisión se
> agregaron cuentas opcionales con sincronización ([arquitectura](arquitectura.md#cuenta-y-sincronización)), que cubren
> parte del riesgo de F6. La [revisión de arquitectura](revision-arquitectura.md) del 15 de noviembre de 2026 agrega los
> cuellos de botella, las mejoras R1 a R6 y un plan de acción que reordena lo pendiente.

**Cómo se hizo.** Se leyó el dominio, el estado, el motor, las pantallas principales y los flujos de CI. Se ejecutaron
`npm run lint`, `npm test`, `npm run build`, `npm audit` y `npm outdated`, y se corrieron pruebas temporales contra el
motor real (no quedaron en el repositorio).

**Resultado de las herramientas.** Lint sin observaciones, 48 pruebas aprobadas y 1 omitida (la de colegio grande, que
requiere `LARGE=1`), build correcto, 0 vulnerabilidades y solo actualizaciones menores pendientes. **No se ejecutaron**
las pruebas de navegador (`npm run e2e`).

**Evidencia.** Cada hallazgo indica cómo se comprobó:

- **Medido:** se reprodujo ejecutando el código.
- **Lectura:** se deduce del código, pero no se reprodujo en un navegador.

Los esfuerzos son estimaciones: **S** (menos de un día), **M** (varios días), **L** (semanas).

## Resumen

La base es sólida: el dominio está separado de la interfaz, el motor se prueba de punta a punta y la app ya se protege
bien contra la pérdida de datos. Con las fases 0 y 1 aplicadas, y F5, T6 y T7 de la fase 2, lo más valioso que queda
es el historial automático de versiones (F6) y la auditoría de accesibilidad (T9).

E6, la semilla, T7, T8 y parte de E12 se aplicaron con la fase A de la
[revisión de arquitectura](revision-arquitectura.md#plan-de-acción), T4 con la fase B
([resultados](revision-arquitectura.md#resultados-de-la-fase-b)), y F5 y T6 con la fase C.

## Errores confirmados

| Id | Problema | Impacto | Evidencia | Esfuerzo | Estado |
|---|---|---|---|---|---|
| E1 | Al agotarse el tiempo no se identifica el bloque problemático | Alto | Medido | S | Corregido |
| E2 | "Repartir en días" obligatorio con más bloques que días solo genera un aviso, y el motor rechaza los datos | Medio | Medido | S | Corregido |
| E3 | El máximo diario de un curso rechaza movimientos válidos si hay electivos o grupos | Medio | Medido | S | Corregido |
| E4 | Un horario restaurado o duplicado aparece como desactualizado sin serlo | Medio | Medido | S | Corregido |
| E5 | Un respaldo con datos mal formados puede dejar la app atascada en la pantalla de error | Medio | Medido | S–M | Corregido |
| E6 | Importar y exportar Excel no están disponibles sin conexión tras instalar la app | Medio | Lectura y build | S–M | Corregido |
| E7 | Textos que prometen más de lo que hacen las reglas | Medio | Medido | S | Corregido |
| E8 | Sin el enlace al código fuente en builds fuera de GitHub Actions (AGPL) | Medio | Medido | S | Corregido |
| E9 | Un carácter de control en un nombre produce un error incomprensible | Bajo | Medido | S | Corregido |
| E10 | La app no arranca en HTTP fuera de `localhost` | Bajo | Lectura | S | Corregido |
| E11 | Eliminar un curso o una asignatura borra su carga sin confirmar | Medio | Lectura | S | Corregido |
| E12 | Inconsistencias menores (ver detalle) | Bajo | Lectura | S | Corregido |

### E1. Diagnóstico perdido al agotarse el tiempo

[`parseResult`](../src/domain/fetResult.ts#L47-L50) busca la actividad problemática en `logs/result.txt`, pero en ese
caso el archivo solo dice `Time exceeded`. La información está en `logs/difficult_activities.txt`, que
[`KEEP_OUTPUT`](../src/engine/args.ts#L42) no conserva:

```
FET logró programar correctamente las primeras 181 actividades más difíciles. [...]
Esta actividad se muestra a continuación:

Id: 109 (2/4 - Javier Contreras 1 - Educación Física y Salud - 1° Medio B 2)
```

El resultado medido es `{"kind":"timeout","activity":null,"placedMax":null}`, así que
[la pantalla](../src/pages/GenerarPage.tsx#L121-L123) nunca muestra el bloque ni cuántos se ubicaron. Las expresiones
regulares actuales ya reconocen este texto en español.

**Solución:** agregar el archivo a `KEEP_OUTPUT` y pasar su contenido a `parseResult` desde
[`generation.ts`](../src/store/generation.ts#L47-L50). Agregar una prueba con un caso que agote el tiempo: la actual
["detecta un horario imposible"](../src/domain/fet.integration.test.ts#L222-L233) solo exige que el resultado no sea
`ok`, y por eso no lo detectó. En la medición, ese mismo caso terminó en `timeout`, no en `impossible`.

### E2. Repartir en días obligatorio

Con 6 bloques en 5 días, [`validate`](../src/domain/validate.ts#L111-L112) dice "algunos quedarán el mismo día" y permite
generar. Con la regla **obligatoria**, el motor rechaza los datos (`invalid`). Con **preferible**, genera sin problema.

**Solución:** que sea error cuando la regla es obligatoria y aviso cuando es preferible. Revisar también las franjas de
electivos: la exportación les aplica la regla, pero este control solo recorre `p.assignments`.

### E3. Máximo diario de un curso

[`checkMove`](../src/domain/manual.ts#L122-L126) suma las horas de todas las clases que comparten alumnos, aunque sean
opciones simultáneas. Caso medido: un electivo de 2 horas con 3 opciones y un máximo de 6 horas diarias. Mover 1 hora a
ese día deja 3 horas reales, pero la app cuenta 3 × 2 + 1 = 7 y responde "Los alumnos quedarían con más de 6 horas ese
día".

**Solución:** contar los tramos ocupados de cada combinación de alumnos con `courseStudentSets`, como ya hace
[`ruleProblem`](../src/domain/manual.ts#L169-L188) con las horas libres.

### E4. Horario desactualizado por error

[`importProjects`](../src/store/projects.ts#L80) y [`duplicate`](../src/store/projects.ts#L69) ponen `updatedAt` en la
fecha actual, e [`isStale`](../src/store/projects.ts#L137) lo compara con la fecha de generación. Medido: `isStale` pasa
de `false` a `true` solo por importar o duplicar. Cada restauración muestra "Los datos cambiaron después de generar este
horario".

**Solución:** conservar el `updatedAt` original en ambos casos. `backupAt` puede seguir usando la fecha actual.

### E5. Respaldo mal formado

[`checkProject`](../src/domain/backup.ts#L32-L67) acepta archivos que después hacen fallar a `validate` o a `exportFet`.
Medido con `locks: {"x#0": null}`, `divisions: "x"` y `unavailable: [1, 2]`.

Por lectura del código, la falla se vuelve permanente: `validate` corre en [`App`](../src/App.tsx#L55) antes de decidir
la ruta y el proyecto actual queda guardado. Entonces "Ir al inicio" y "Recargar" vuelven a fallar, y la pantalla de
error solo permite descargar el respaldo. Cualquier error futuro de `validate` tendría el mismo efecto.

**Solución:**

- Validar en `checkProject` la forma de `locks`, `divisions`, `unavailable`, `rules` y `electives[].blocks`.
- Capturar los errores de `validate` en `App`.
- Hacer que "Ir al inicio" también ejecute `select(null)`.

### E6. Sin conexión incompleto

El [service worker](../public/sw.js#L14-L17) guarda solo lo que `index.html` enlaza más el motor. Los módulos de Excel
se cargan bajo demanda y no aparecen en esa lista: el build produce `browser-*.js` y `universal-*.js`, que `index.html`
no menciona. Las fuentes tampoco están en la lista, aunque ahí el efecto es solo visual.

Además, el `.catch(() => undefined)` deja la instalación como correcta aunque falle la descarga de `fet-cl.wasm`, y sin
conexión el error aparecería recién al generar. La [prueba sin conexión](../e2e/app.spec.ts#L132-L150) solo cubre la
generación.

**Solución:** generar la lista de archivos durante el build y hacer que falle la instalación si falta alguna parte del
motor.

**Corregido:** `vite.config.ts` escribe `precache.json` con todo lo que produce el build, y el service worker lo guarda
junto con el motor; si falla una descarga, la instalación falla y sigue la versión anterior. Al probarlo apareció otro
problema: lo guardado al instalar no coincidía con los módulos de la página cuando el servidor responde con
`Vary: Origin`, así que ahora se busca con `ignoreVary`. La prueba sin conexión exporta un Excel y lo vuelve a leer.

### E7. Textos que no coinciden con el comportamiento

La medición consistió en cambiar el peso de cada restricción a 95 % y entregarla al motor:

| Regla | ¿Admite peso bajo 100 %? | En la app |
|---|---|---|
| Repartir en días, bloques permitidos | Sí | Se puede elegir la fuerza |
| Máximo de horas diarias (profesores y cursos) | Sí | Siempre obligatoria |
| Ventanas de profesores (por día y por semana) | **No, el motor la rechaza** | Siempre obligatoria |
| Cursos sin horas libres | **No, el motor la rechaza** | Siempre obligatoria |
| Empezar en el primer bloque | **No, el motor la rechaza** | Siempre obligatoria |

- El README decía "Cada regla puede ser obligatoria o preferible".
- [`GenerarPage`](../src/pages/GenerarPage.tsx#L129) sugería pasar reglas a "preferible", algo posible en solo dos de
  ellas.
- [`HorarioPage`](../src/pages/HorarioPage.tsx#L378) decía que se revisan todas las reglas obligatorias y, en la misma
  frase de ayuda, que "las preferencias (ventanas, repartir en días) no se revisan".

### E8. Enlace al código fuente

`package.json` no tiene `repository`, y [`vite.config.ts`](../vite.config.ts#L13-L16) depende de ese campo o de variables
de entorno. Un build en Cloudflare Pages sin `VITE_SOURCE_URL` publica la app sin el enlace que el
[pie de página](../src/ui/AppFooter.tsx#L6) muestra para cumplir la AGPL.

**Solución:** agregar `"repository"` a `package.json`, apuntando a `https://github.com/ffigueroa11/horarios-web`.

### E9. Carácter de control en un nombre

[`esc`](../src/domain/fetExport.ts#L19-L20) no elimina caracteres no válidos en XML. Con `\u000b` en el nombre de un
curso, el motor responde `XML parse error at line 58`, sin indicar qué dato corregir. Es un riesgo sobre todo con datos
pegados desde otras aplicaciones.

**Solución:** quitarlos al exportar y, de preferencia, también al importar.

### E10. HTTP fuera de `localhost`

[`newId`](../src/domain/types.ts#L222) usa `crypto.randomUUID`, que los navegadores solo ofrecen en contextos seguros, y
[`projects.ts`](../src/store/projects.ts#L13) lo llama al cargarse. Publicada por HTTP en la red de un colegio, la app
fallaría antes de mostrar la pantalla de error. [`missingFeatures`](../src/store/health.ts#L41-L48) no lo revisa.

**Solución:** usar `crypto.getRandomValues`, disponible también por HTTP.

### E11. Eliminación sin confirmar

Los botones ✕ de [Cursos](../src/pages/CursosPage.tsx#L154) y [Asignaturas](../src/pages/AsignaturasPage.tsx#L60)
eliminan al instante la carga asociada. Eliminar una franja o un profesor sí pide confirmación.

**Solución:** usar `ConfirmButton` indicando cuántas filas de carga se pierden. A futuro lo cubre F5.

### E12. Inconsistencias menores

Corregidas las cuatro primeras: `migrateProject` limpia los fijados y tramos huérfanos, cambiar los bloques de una
franja libera sus fijados, un horario generado queda desactualizado si contradice un bloque fijado durante el cálculo, y
"Imprimir todos" deja de dibujar las grillas al terminar de imprimir. Después se quitó `studentSets` y la revisión previa
avisa tramos que terminan antes de empezar o se cruzan con el anterior (aviso, porque el motor no usa las horas).

- Cambiar los bloques de una franja [no libera sus fijados](../src/pages/ElectivosPage.tsx#L54), aunque
  [la carga sí lo hace](../src/pages/CargaPage.tsx#L133-L136). Los fijados huérfanos inflan el contador de
  [`GenerarPage`](../src/pages/GenerarPage.tsx#L35).
- Pasar de 6 a 5 días [no limpia `teacherMeetingSlots`](../src/pages/JornadaPage.tsx#L37-L43).
- Mover un bloque durante una generación deja un fijado que el nuevo horario puede contradecir, sin marcarlo como
  desactualizado, porque esos cambios usan `touch: false`.
- `printAll` nunca vuelve a `false`: tras "Imprimir todos", todas las grillas siguen renderizándose
  ([`HorarioPage`](../src/pages/HorarioPage.tsx#L305)).
- [`studentSets`](../src/domain/types.ts#L182) no se usa.
- `validate` no revisa que los tramos tengan inicio anterior al término ni que estén en orden.

## Pruebas, CI y seguridad

| Id | Situación | Propuesta | Esfuerzo | Estado |
|---|---|---|---|---|
| T1 | La prueba principal usaba `if (await target.count())` en tres pasos: podía aprobar sin mover ningún bloque | Semilla fija en e2e y pasos que fallan si no encuentran el lugar | S | Corregido |
| T2 | No había prueba de arrastrar y soltar: se retiró en `b028558` | Recuperada, con eventos enviados directamente y solo en Chromium | S | Corregido |
| T3 | `ui/` y `pages/` no tienen pruebas unitarias, y de `store/` solo hay un archivo | [`projects.test.ts`](../src/store/projects.test.ts) cubre migraciones, recarga desde otra pestaña, lo que se guarda, deshacer y el horario generado. `ui/` y `pages/` se prueban con e2e | S–M | Corregido |
| T4 | [`large.test.ts`](../src/domain/large.test.ts) no medía un caso difícil: 24 cursos y 84 profesores se resuelven en 0,2–0,6 s | Dos colegios reales anonimizados en [`fixtures/`](../src/domain/fixtures/): uno con horario generado para el ajuste manual y uno que agota el tiempo para el motor ([resultados](revision-arquitectura.md#resultados-de-la-fase-b)) | M | Corregido |
| T5 | La publicación no esperaba a CI | Vercel retiene cada publicación de `main` hasta que pasan los cinco trabajos de CI (Deployment Checks). Comprobado con un cambio que CI aprobó; no se ha probado con un CI que falle | S | Corregido |
| T6 | No había política de seguridad de contenido (CSP) | CSP en [`vercel.json`](../vercel.json): una para la página y otra para el motor, que necesita `'unsafe-eval'` además de `'wasm-unsafe-eval'` ([arquitectura](arquitectura.md#seguridad-del-sitio)). `vite preview` envía las mismas cabeceras, así que todas las pruebas de navegador corren con ella. El inicio de sesión con Firebase no tiene prueba automática; se probó a mano en producción | S–M | Corregido |
| T7 | La compilación del motor no verificaba el origen: [`build-engine.sh`](../engine/build-engine.sh) no comprobaba el `.tar.xz`, y `emsdk` y `aqtinstall` no estaban fijados | La fuente se comprueba por SHA-256 (firma del autor verificada al registrarla), `emsdk` y `aqtinstall` están fijados, y [`engine.sha256`](../engine/engine.sha256) registra el motor publicado, que una prueba revisa. El script no se volvió a ejecutar completo | S | Corregido |
| T8 | Las acciones de GitHub usaban etiquetas, no commits fijos | Fijadas por SHA, con la versión en un comentario para Dependabot | S | Corregido |
| T9 | No se ha hecho una auditoría de accesibilidad | [`accesibilidad.spec.ts`](../e2e/accesibilidad.spec.ts) audita con axe (WCAG 2.1 AA) todas las pantallas en modo claro y oscuro, y falla con problemas graves. Lo que encontró, contraste, se corrigió: colores de estado más oscuros en modo claro, texto de cada clase elegido según su color (`lessonColors`) y bloques atenuados sin transparencia. Falta probar a mano con teclado y lector de pantalla | S | Corregido |

### Mediciones con archivos reales

Se probaron localmente 16 archivos `.fet` reales de un colegio, con 24 cursos, 36 a 41 profesores y 492 a 517 bloques,
además de un archivo de prueba sin datos. No están en el repositorio porque contienen nombres de personas.

| Resultado (límite de 40 s) | Archivos |
|---|---|
| Genera en menos de 1 s | 13 |
| Se agota el tiempo; identifica el bloque (507 de 517 ubicados, también comprobado en navegador) | 1 |
| La revisión previa y el motor rechazan los datos | 2 |

- **Rendimiento de la interfaz:** revisar los destinos de un bloque tomó de 11 a 44 ms, medido en Node.
- **Un límite de esta muestra:** 12 de los 13 que generan tienen entre 279 y 509 bloques fijados, lo que facilita la
  búsqueda. El único sin fijados, de 492 bloques, generó en 0,3 s. No se comparó con el horario original.
- **Sin conclusión:** `horario2017.fet` y `horario2018.fet` son los dos rechazados (47 y 104 errores, como cursos con 42
  horas en una semana de 40 bloques). Vienen de un respaldo antiguo y no se sabe si eran horarios finales o pruebas, así
  que no cuentan como evidencia de un error de importación.

### Refactorización

Conviene hacerla solo al tocar cada zona:

- **[`HorarioPage`](../src/pages/HorarioPage.tsx):** la función `grid` mide unas 130 líneas y mezcla celdas, arrastre y
  textos. Separar el cálculo de cada celda en una función pura facilitaría probarla.
- **Agregar una regla toca hasta seis archivos** (ver la [receta](arquitectura.md#cómo-agregar-una-regla)). Conviene
  revisar si un catálogo central se justifica cuando lleguen F7 y F8, no antes.
- **[`migrateProject`](../src/domain/types.ts#L197)** mezcla migración de versiones con limpieza de referencias, y corre
  en cada edición. Separarlas aclara la intención.
- **`key.split('#')`** se repite en varios archivos. Basta una función `parseActivityKey`.

## Funciones nuevas

Ordenadas por valor frente a esfuerzo. El valor para los colegios es una hipótesis: conviene validarlo con usuarios.

### Aprovechar lo que el motor ya entrega

| Id | Función | Por qué | Base técnica | Esfuerzo |
|---|---|---|---|---|
| F1 | **Horario parcial al agotarse el tiempo** (aplicada) | Ver qué alcanzó a ubicarse orienta mejor que un mensaje de error | Lee `horario-highest/horario_activities.xml`; en un archivo real, 507 de 517 bloques, igual al máximo que informa FET | S–M |
| F2 | **Informe de preferencias no cumplidas** (aplicada) | El mensaje de éxito no decía cuáles fallaron | Se calcula desde el horario, no desde `horario_soft_conflicts.txt` (ver [arquitectura](arquitectura.md#resultados)); una prueba contrasta ambos | S–M |
| F3 | **Asistente "¿qué regla lo impide?"** | Responde la pregunta real cuando no hay horario | Volver a generar quitando una regla a la vez, con tiempo acotado y en otro Worker | M |
| F4 | **Elegir entre varios horarios** | FET se detiene en el primero válido, no en el mejor | Generar varios con distintas semillas y comparar ventanas y preferencias. Depende de F2 | M |

La semilla ya se guarda en `Timetable` (`seed`): con los mismos datos y la misma semilla, el motor repite el horario.

### Seguridad de los datos

| Id | Función | Por qué | Base técnica | Esfuerzo |
|---|---|---|---|---|
| F5 | **Deshacer y rehacer** (aplicada) | No había forma de revertir una eliminación o un movimiento | Todo pasa por `update()`, un buen lugar para guardar copias. Un colegio de 480 bloques ocupa 74 KB | M |
| F6 | **Historial automático de versiones** (aplicada) | Los datos viven en un solo navegador; un error de manejo puede ser costoso | Copias locales al generar, con un límite, y opción de restaurar | M |

### Modelo del colegio

Estas funciones cubren lo que hoy el [importador de FET](../src/domain/fetImport.ts) informa como no traspasado.

| Id | Función | Por qué | Base técnica | Esfuerzo |
|---|---|---|---|---|
| F7 | **Varios profesores por clase** | Codocencia y apoyo, por ejemplo del Programa de Integración Escolar (PIE) | FET lo permite. Cambia `teacherId` por `teacherIds`; toca todo el dominio y requiere migración v4 | L |
| F8 | **Reglas por profesor y por curso** | Hoy las ventanas y las horas diarias son iguales para todos | FET tiene variantes individuales (`ConstraintTeacherMaxGapsPerWeek`, etc.) | M |
| F9 | **Actividades sin curso** | Reuniones de departamento y horas no lectivas | FET admite actividades sin alumnos | M |
| F10 | **Salas más completas** | Hoy solo hay salas especiales, sin disponibilidad ni alternativas | FET tiene `ConstraintRoomNotAvailableTimes`, sala por curso y salas preferidas | M–L |
| F11 | **Bloques seguidos o al final del día** | Restricciones habituales que se pierden al importar | `ConstraintTwoActivitiesConsecutive`, `ConstraintActivitiesEndStudentsDay` | M |
| F12 | **Emparejar explícitamente las clases en paralelo** | [`parallelRows`](../src/domain/units.ts#L80-L90) empareja según el orden de la carga, y eliminar una fila cambia las parejas sin avisar | Un campo de pareja en `Assignment` | M |

### Uso diario

| Id | Función | Por qué | Base técnica | Esfuerzo |
|---|---|---|---|---|
| F13 | **"¿Quién está libre?"** para reemplazos | Es un uso diario, no solo una vez al año | Consulta sobre los datos existentes, sin el motor | S–M |
| F14 | **Compartir sin servidor** | Entregar el horario a cada profesor | Un PDF por profesor, o un `.ics` por persona | S–M |
| F15 | **Plantillas de plan de estudios por nivel** | Acelera la configuración inicial | Usa `Course.level`. Requiere confirmar los planes vigentes del Mineduc | M |
| F16 | **Horas lectivas y no lectivas** | `maxHours` solo avisa sobrecarga | Requiere confirmar con colegios la normativa vigente y cómo se calcula | M |

### Ajuste manual: experiencia de uso

Revisión de "Ver y ajustar" del 18 de noviembre de 2026, a partir de capturas de uso real.

| Id | Problema | Propuesta | Esfuerzo | Estado |
|---|---|---|---|---|
| U1 | Dos avisos para lo mismo al pasar el mouse: el propio y el título del navegador, que además decía "Clic para seleccionar" cuando el clic intercambiaba | Sin título durante la selección; la explicación va en la barra de selección | S | Corregido |
| U2 | El aviso junto al cursor y el aviso breve eran ilegibles en modo oscuro (texto blanco sobre fondo claro) | Usan los colores del tema invertidos | S | Corregido |
| U3 | Decía "Soltar para intercambiar" sin estar arrastrando | Con clic, la barra dice "Clic para…"; al arrastrar, "Suelta para…" junto al cursor | S | Corregido |
| U4 | La barra no decía dónde está el bloque ni qué pasaría al hacer clic | Muestra día y horas del bloque, y para cada lugar qué pasaría: mover, intercambiar (y adónde pasa el otro bloque) o el motivo. Va fija abajo, para que su texto no desplace la grilla bajo el cursor; también reemplaza el aviso breve | S–M | Corregido |
| U5 | Los motivos encadenados pasaban nombres a minúscula ("javier Contreras") | `continueWith` solo cambia artículos y palabras comunes | S | Corregido |
| U6 | Mover, intercambiar y seleccionado se distinguen poco (verde casi en todo, naranja en seleccionado y en fijado) | Lugar libre en verde, intercambio con borde punteado y ⇄, no posible atenuado; seleccionado con el color del texto, distinto del naranja de fijado. La barra trae la leyenda | M | Corregido |
| U7 | Se ofrecen intercambios que no cambian nada: otro bloque de la misma asignatura, curso y profesor | `checkPlace` no los propone y explica por qué | S | Corregido |

### Experiencia de uso general

Revisión de todas las pantallas del 18 de noviembre de 2026, en escritorio y teléfono, con el liceo de ejemplo.

| Id | Problema | Propuesta | Esfuerzo | Estado |
|---|---|---|---|---|
| D1 | En el teléfono, el horario mostraba 5 columnas en 400 px y cortaba todos los nombres | Un día a la vez, con pestañas Lun–Vie (bajo 700 px) | S–M | Corregido |
| D2 | En el teléfono, el menú completo ocupaba la primera pantalla | Barra superior con el paso actual ("5/9 · Carga académica"); los pasos se despliegan con el botón | S | Corregido |
| D3 | En pantallas táctiles, los textos decían "clic" y "pasa el mouse", y un toque accidental movía un bloque | Textos con "toca"; el primer toque en un lugar explica qué pasaría y el segundo lo hace | S | Corregido |
| D4 | Cinco botones de exportación sueltos en Ver y ajustar | "Imprimir" y un menú "Exportar" (imprimir todos, Excel, CSV, .fet) | S | Corregido |
| D5 | Etiquetas de unos 11 px | 13 px | S | Corregido. El cero con raya es propio de Atkinson Hyperlegible, elegida por legibilidad: se mantiene |
| D6 | Botones secundarios que parecían texto y botones de ícono de 16 px con colores distintos | Secundarios con borde suave; íconos de 32 px, y quitar o eliminar se marcan en rojo al pasar el mouse en todas las pantallas | S | Corregido |
| D7 | El menú no dice qué pasos están completos | El número del paso pasa a ✓ cuando el paso tiene lo necesario y a rojo si tiene errores; Electivos y Preferencias son opcionales | S–M | Corregido |
| D8 | No hay "siguiente paso" al final de cada pantalla | Botón "Siguiente: …" al final de cada paso (en Generar lo ofrece el resultado) | S | Corregido |
| D9 | Tablas con todos los campos enmarcados, y en el teléfono se cortan hacia el lado | Borde solo al pasar el mouse o editar; en el teléfono, filas apiladas y días abreviados en las grillas | M | Corregido |
| D10 | "2+2+2" es un formato que hay que aprender | Al editar, el campo dice cómo lo entendió ("7 h: 3 bloques de 2 h y 1 de 1 h"), y en rojo lo que no entiende o no cabe entre recreos | S | Corregido |
| D11 | Sin buscador de profesores ni leyenda en las grillas de disponibilidad | Buscador (con más de 6 profesores, sin distinguir tildes) y leyenda bajo la grilla | S | Corregido |
| D12 | En Inicio, cuatro botones por horario | Tarjeta completa clicable, menú ⋯ (Duplicar, Descargar respaldo, Eliminar con confirmación) y "Horario desactualizado" | S | Corregido |
| D13 | "Nuevo horario" no guía | Lista de primeros pasos en la Jornada mientras falte algo para generar (`stepsDone`, compartido con el menú) | S–M | Corregido |
| D14 | Preferencias con anchos y textos de ejemplo confusos ("Sin límite" parece un valor) | "Sin límite" como casilla (`LimitField`): desmarcarla pone un valor sugerido; anchos uniformes. Ya estaba agrupada por cursos y profesores | M | Corregido |
| D15 | En Generar, el tiempo máximo antes que la acción | Botón grande primero; el tiempo máximo en un desplegable que muestra el valor elegido | S | Corregido |

## Lo que no conviene priorizar

Se evaluó y por ahora no se justifica:

- **Optimizar el rendimiento de la interfaz.** Medido en Node con 480 bloques: `validate` 8,7 ms, clonar y migrar 1,6 ms,
  revisar los destinos de un bloque 26,5 ms. Falta confirmarlo en un navegador, pero no hay señales de problema.
- **Guardar cada proyecto por separado en IndexedDB.** Un proyecto ocupa 74 KB y serializarlo sin horario toma 0,2 ms.
- **Limitar las combinaciones de grupos.** Crecen exponencialmente, pero el motor resolvió 4.096 combinaciones por curso
  en 1 s, con un XML de 8 MB. La prueba solo tenía electivos, así que basta un aviso si aparece un caso real.
- **Permitir "preferible" en ventanas, horas libres o primer bloque.** El motor lo rechaza (ver E7).
- **Generar en paralelo con varios Workers.** Podría ayudar en casos difíciles, pero no hay evidencia: en el caso fácil la
  diferencia entre semillas fue de 0,2 a 0,6 s, y en el difícil ninguna terminó en 30 s, sin saber si tenía solución.
  Además, cada Worker consume unos 220 MB. Medido después de T4: en la referencia difícil, las semillas 1 a 5 llegaron
  todas a 507 de 517 bloques en 30 s, así que la semilla no cambia el resultado en ese caso.

## Hoja de ruta histórica

La planificación operativa vigente está en el [plan de implementación](plan-implementacion.md). Esta tabla conserva
el contexto y las decisiones de la revisión original.

| Fase | Contenido | Estimación |
|---|---|---|
| **0. Correcciones** (aplicada) | E1 a E5, E7 a E11, T1, T2, T5 | 3–5 días |
| **1. Mejor diagnóstico** (aplicada) | F1, F2, semilla, E6, T4 | 1–2 semanas |
| **2. Confianza** (aplicada) | F5, F6, T3, T6, T7, T9 | 1–2 semanas |
| **3. Uso diario** | F3, F13, F14 | 2–3 semanas |
| **4. Modelo más rico** | F7 a F12, según lo que pidan los colegios | Semanas por función |

Las fases 0 a 2 no cambian el modelo de datos. La fase 4 sí, así que conviene tener antes F5, F6 y T4.

## Preguntas abiertas

1. ¿Hay colegios usando la app hoy? De eso depende cuán urgentes son los cambios de datos y si conviene sumar analítica
   opcional o un canal de comentarios.
2. ¿Qué pesa más para los colegios: codocencia (F7), reglas individuales (F8) o salas (F10)? Son las funciones más caras.
