# Arquitectura

Para quien va a modificar el código. El [README](../README.md) cubre la instalación, los comandos y la publicación; este
documento explica cómo funciona por dentro y qué hay que cuidar.

## Principios

- **Sin servidor propio.** El sitio es estático y el cálculo ocurre en el navegador. Sin cuenta, los datos del colegio
  no salen de él y Firebase ni siquiera se carga.
- **Primero lo local.** Con cuenta, la app sigue editando en IndexedDB y la nube se sincroniza en segundo plano.
- **El dominio no conoce la interfaz.** `src/domain/` no importa React y se prueba en Node.
- **El motor es una caja negra.** Se le entrega un `.fet` y se leen sus archivos de salida. Los cambios a FET se limitan
  a la línea de progreso y a ajustes de compilación que no alteran el algoritmo ([detalle](../engine/README.md)).
- **Todo mensaje debe ser accionable y estar en el idioma del colegio**, sin términos de FET.

## Capas

```mermaid
flowchart TD
  pages["pages/ y ui/<br/>React"] --> store["store/<br/>zustand"]
  pages --> domain["domain/<br/>lógica pura"]
  store --> domain
  store --> engine["engine/<br/>argumentos y Worker"]
  store --> idb[("IndexedDB")]
  store --> cloud["cloud/<br/>sincronización"]
  cloud --> firebase[("Firebase<br/>opcional")]
  engine --> worker["public/engine/fet-worker.js"]
  worker --> wasm["fet-cl.wasm"]
```

| Carpeta | Responsabilidad |
|---|---|
| [`src/domain/`](../src/domain/) | Modelo, validación, conversión a FET y desde FET, ajuste manual, respaldos |
| [`src/engine/`](../src/engine/) | Argumentos de `fet-cl` y comunicación con el Worker |
| [`src/cloud/`](../src/cloud/) | Motor de sincronización sin dependencias de Firebase, y el adaptador que sí lo usa |
| [`src/store/`](../src/store/) | Proyectos guardados, cuenta, generación en curso, salud del almacenamiento, service worker |
| [`src/pages/`](../src/pages/) | Una pantalla por paso, elegida por el hash de la URL ([`App.tsx`](../src/App.tsx)) |
| [`src/ui/`](../src/ui/) | Componentes compartidos, exportación a Excel, descargas |
| [`public/engine/`](../public/engine/) | Motor compilado, Worker y traducción al español |
| [`engine/`](../engine/) | Parche de FET y script para recompilar |

## Modelo de datos

Definido en [`types.ts`](../src/domain/types.ts). Un `Project` es un horario completo:

| Campo | Contenido |
|---|---|
| `school` | Días, tramos (`clase`, `recreo`, `almuerzo`) y tramos cerrados |
| `courses` | Cursos, con sus `divisions` y los grupos de cada una |
| `subjects`, `rooms` | Asignaturas, cada una con sala especial opcional, y salas |
| `teachers` | Disponibilidad, horas de contrato y máximo de días |
| `assignments` | Carga: curso o grupo × asignatura → profesor y bloques |
| `electives` | Franjas que juntan varios cursos, con sus opciones |
| `rules` | Preferencias globales |
| `locks` | Bloques fijados |
| `timetable` | Último horario generado, o `null` |

### Unidades

[`units.ts`](../src/domain/units.ts) unifica carga y electivos en una sola forma, `Unit`. La exportación, la validación,
las vistas y el ajuste manual trabajan con unidades y no distinguen el origen.

Una franja de electivos se trata como una **división sintética** del curso, con un grupo por opción. Por eso hay dos
variantes de cada función: `effectiveDivisions` y `courseStudentSets` incluyen las franjas, mientras que
`course.divisions` no. Para razonar sobre alumnos, usa siempre las primeras.

`courseStudentSets` devuelve las combinaciones de grupos de un curso, es decir, los distintos horarios que puede tener un
alumno. Su número crece como el producto de los grupos de cada división.

### Claves

| Clave | Formato | Ejemplo |
|---|---|---|
| Tramo | `${día}:${idDelTramo}` | `2:ab12cd34` |
| Unidad de carga | `${idAsignación}` | `9f8e7d6c` |
| Unidad de electivo | `${idFranja}:${idOpción}` | `11aa22bb:33cc44dd` |
| Actividad | `${idUnidad}#${índiceDelBloque}` | `9f8e7d6c#1` |

Los nuevos identificadores se generan con 128 bits aleatorios (32 caracteres hexadecimales); se conservan los IDs anteriores de 32 bits. `parseActivityKey` interpreta ambos formatos y las unidades de electivos sin depender del largo de sus IDs.

Los fijados y las ubicaciones se guardan por clave de actividad. Si cambia la lista de bloques de una unidad, las claves
existentes pueden quedar apuntando a un bloque de otra duración o a uno que ya no existe.
[`lockProblems`](../src/domain/manual.ts#L217) detecta los fijados que ya no se pueden respetar.

### Reglas que hay que mantener

- **Toda edición pasa por `update()`** en [`projects.ts`](../src/store/projects.ts): trabaja sobre una copia, ejecuta
  `migrateProject` y guarda.
- **`touch: false`** se usa en lo que no cambia los datos del colegio (fijar, mover, liberar), para no marcar el horario
  como desactualizado.
- **Horario desactualizado** significa `updatedAt > timetable.generatedAt`. `generatedAt` es la hora de *inicio* de la
  generación, para que una edición hecha durante el cálculo lo marque.
- **Las referencias huérfanas las limpia `migrateProject`:** carga y electivos que apuntan a algo eliminado, tramos
  (cerrados, disponibilidad, consejo) de días o bloques que ya no existen, y fijados de bloques que ya no existen o de
  lugares fuera de la jornada. Lo que sigue existiendo pero cambió de sentido lo libera la pantalla que hace el cambio:
  la duración de los bloques de una fila o de una franja, o el grupo de una fila.

## Generación

```mermaid
sequenceDiagram
  participant UI as GenerarPage
  participant G as store/generation
  participant W as Web Worker
  participant F as fet-cl.wasm
  UI->>G: start(proyecto, tiempo)
  G->>G: exportFet → XML y mapas de ids
  G->>W: xml, argumentos, archivos a conservar
  W->>F: callMain(args)
  F-->>W: líneas FETPROGRESS
  W-->>G: progress, log
  F-->>W: archivos en el sistema virtual
  W-->>G: done (files)
  G->>G: parseResult y parseActivitiesXml
  G->>G: guarda el horario en el proyecto
```

- **Un Worker por generación.** "Detener" lo termina de inmediato y así se libera la memoria
  ([`runFet.ts`](../src/engine/runFet.ts)).
- **El estado vive fuera de las pantallas** ([`generation.ts`](../src/store/generation.ts)), de modo que el cálculo sigue
  al navegar. Solo hay una generación a la vez.
- **Identidad.** FET usa nombres como identificadores. [`exportFet`](../src/domain/fetExport.ts) genera nombres únicos y
  devuelve los mapas de vuelta (`activityById`, `periodByName`, `roomByName`). Esos mapas solo valen para esa exportación.
- **Semilla.** Es aleatoria en cada generación y se guarda en `timetable.seed`. Con los mismos datos y la misma semilla,
  el resultado es el mismo.
- **Guardar el resultado** pasa por `saveTimetable` en [`projects.ts`](../src/store/projects.ts), en el proyecto que se
  generó aunque el usuario haya abierto otro. Si durante el cálculo se fijó un bloque en un lugar que el horario nuevo
  no respeta, el horario queda desactualizado.

### Mensajes del Worker

| Dirección | Mensaje | Contenido |
|---|---|---|
| App → Worker | (único) | `xml`, `inputPath`, `outputDir`, `args`, `keep` |
| Worker → App | `started` | `loadMs` |
| Worker → App | `progress` | `placed`, `best`, `total` |
| Worker → App | `log` | `line` |
| Worker → App | `done` | `files`, `lines`, `loadMs`, `genMs` |
| Worker → App | `error` | `message`, `lines` |

### Archivos de salida

Todos son relativos a `/work/out`. "Se conserva" significa que coincide con
[`KEEP_OUTPUT`](../src/engine/args.ts#L42) y vuelve a la app.

| Archivo | Cuándo aparece | ¿Se conserva? | ¿Se usa? |
|---|---|---|---|
| `logs/result.txt` | Siempre | Sí | Sí |
| `logs/errors.txt` | Datos rechazados | Sí | Sí |
| `logs/warnings.txt` | Hay advertencias | Sí | No |
| `logs/difficult_activities.txt` | Se agota el tiempo | Sí | Sí: bloque problemático y cuántos se ubicaron |
| `logs/max_placed_activities.txt` | En todas las ejecuciones medidas | No | No |
| `timetables/horario/horario_activities.xml` | Éxito | Sí | Sí |
| `timetables/horario-highest/horario_activities.xml` | Se agota el tiempo | Sí | Sí: horario parcial, con los bloques sin ubicar sin día ni hora |
| `timetables/horario-current/horario_activities.xml` | Se agota el tiempo | Sí | No |
| `timetables/horario/horario_soft_conflicts.txt` | Con `--writetimetableconflicts=true` | No | Solo en una prueba, para contrastar [`preferences.ts`](../src/domain/preferences.ts) |

### Resultados

[`parseResult`](../src/domain/fetResult.ts#L43) devuelve uno de estos valores:

| `kind` | Significado | Señal |
|---|---|---|
| `ok` | Horario completo | `Generation successful` en `result.txt` |
| `impossible` | FET concluyó que no hay solución | `Impossible` |
| `timeout` | Se acabó el tiempo o se interrumpió | `Time exceeded` o `Generation interrupted` |
| `invalid` | Datos rechazados antes de buscar | Cualquier otro caso; los detalles vienen de `errors.txt` |

Las palabras clave de `result.txt` no se traducen, pero las explicaciones de FET sí. Por eso las expresiones regulares
aceptan inglés y español. El bloque problemático se busca en `result.txt` y en `difficult_activities.txt`, porque al
agotarse el tiempo solo el segundo lo indica.

El horario parcial ([`parsePartial`](../src/domain/fetResult.ts)) y las preferencias no cumplidas
([`unmetPreferences`](../src/domain/preferences.ts)) no cambian el modelo de datos: el primero vive solo en
`store/generation.ts` y las segundas se calculan desde el horario guardado. Se calculan en vez de leer
`horario_soft_conflicts.txt` porque así siguen siendo ciertas tras un ajuste manual, no dependen de un texto traducido e
incluyen lo que la exportación omite (repartir en días cuando dos bloques fijados ya caen el mismo día).

### Pesos en FET

"Obligatoria" se exporta con 100 % y "preferible" con 95 %. No todas las restricciones admiten menos de 100 %: el motor
rechaza las ventanas de profesores, las horas libres de alumnos y el inicio en el primer bloque
([medición](mejoras.md#e7-textos-que-no-coinciden-con-el-comportamiento)). Hoy solo "repartir en días" y "bloques
permitidos" permiten elegir.

## Ajuste manual

[`manual.ts`](../src/domain/manual.ts) responde si un bloque puede ir a un lugar, sin llamar al motor:

| Función | Revisa |
|---|---|
| `slotProblem` | El lugar en sí: recreos, tramos cerrados, fin del día, disponibilidad, consejo, bloques permitidos obligatorios |
| `checkMove` | Choques con otras clases, máximo de días, horas diarias |
| `ruleProblem` | Reglas del día completo: repartir, horas libres, primer bloque, ventanas |
| `checkSwap` | Lo anterior, para dos bloques que se intercambian |
| `checkPlace` | Punto de entrada: intenta mover y, si no se puede, intercambiar |
| `lockProblems` | Fijados que ya no se pueden respetar (lo usa `validate`) |

`placeTargets` revisa todos los lugares de la semana para lo seleccionado, que es lo que pinta la grilla. Las clases se
indexan por clave, día, profesor, unidad y lugar de inicio (`viewOf`, guardado por arreglo de clases), y un movimiento
hipotético es una vista que reemplaza solo los bloques movidos (`movedView`), sin copiar el horario. Las listas conservan
el orden original, así que los mensajes son los mismos que sin índices.

Tres decisiones de diseño:

- `ruleProblem` compara el horario **antes y después** y solo rechaza lo que el cambio empeora. Un horario que ya
  incumplía algo no impide moverse.
- Las reglas preferibles no se revisan.
- Mover o intercambiar fija el bloque, para que se mantenga al regenerar. `companions` asegura que las clases en
  paralelo se muevan juntas.

## Persistencia

- [`projects.ts`](../src/store/projects.ts) guarda `{ projects, currentId }` como un JSON en IndexedDB, clave
  `horarios-web`, versión 3.
- **Protección de datos:** si la lectura inicial falla, se bloquea la escritura para no sobrescribir lo guardado con un
  estado vacío ([`health.ts`](../src/store/health.ts)).
- **Varias pestañas:** un `BroadcastChannel` avisa de cada guardado, y las demás pestañas recargan los datos conservando
  su horario abierto. Si dos pestañas editan a la vez, gana la última que guarda.
- **Respaldos:** [`backup.ts`](../src/domain/backup.ts) usa un formato propio, versión 2, que no se mueve junto con la
  versión del almacén. Un archivo de una versión más nueva se rechaza. `checkProject` rechaza lo que haría fallar a la
  app y repara lo prescindible, como un horario guardado mal formado. **Al agregar un campo al modelo, agrega también su
  revisión ahí.**
- **Datos dañados:** `App` captura los errores de `validate` y los muestra como un problema por corregir, porque esa
  revisión corre antes de elegir la pantalla y el horario actual queda guardado. "Ir al inicio" de la pantalla de error
  también cierra el horario actual.
- **Deshacer y rehacer** (`undo`, `redo`): cada `update()` guarda el proyecto anterior y el nuevo (los mismos objetos,
  sin copiar), hasta 50 pasos por horario y solo mientras la pestaña está abierta. Deshacer devuelve el objeto anterior
  tal cual, con su `updatedAt`, así que respeta `touch`. Un paso solo se aplica si el horario sigue siendo el que dejó:
  lo que cambia fuera de `update()` (generar, la nube, otra pestaña) no se deshace y deja sin efecto el historial.
  Eliminar un horario se recupera aparte (`lastRemoved`), desde el inicio.
- **Versiones anteriores** ([`store/versions.ts`](../src/store/versions.ts)): copias en IndexedDB, en una clave aparte
  (`<clave del almacén>:versiones`) que no se sincroniza ni entra en los respaldos. Se guarda una al generar y, al editar,
  el estado anterior al cambio si la última copia tiene más de 30 minutos. Se conservan 15 por horario y 120 en total
  ([`domain/versions.ts`](../src/domain/versions.ts)). Restaurar crea una copia: nunca reemplaza el horario.
- **Cambiar la forma de los datos:** agrega el valor por defecto en `migrateProject`. Si el cambio requiere transformar
  datos, sube `version` en `projects.ts` y, si corresponde, `BACKUP_VERSION`.

## Cuenta y sincronización

Es opcional. Sin las variables `VITE_FIREBASE_*`, `cloudEnabled` es falso y nada de esto aparece. El SDK se carga con un
`import()` solo al iniciar sesión o si hay una sesión guardada.

Se entra con Google o con correo y contraseña. Google ya entrega el correo confirmado, así que esas cuentas sincronizan de
inmediato. Eliminar una cuenta exige volver a autenticarse: con la contraseña si la tiene y, si no, con la ventana de
Google. La ventana solo funciona en los dominios autorizados en Firebase.

### Espacios de datos

- Cada cuenta usa su propia clave en IndexedDB, `horarios-web:<uid>`, y sin cuenta se usa `horarios-web`. Así, en un
  computador compartido una cuenta no ve los horarios de otra.
- La clave se decide al cargar [`projects.ts`](../src/store/projects.ts), según `horarios-web-cuenta` en `localStorage`.
  Por eso iniciar y cerrar sesión **recargan la página**, y las demás pestañas también lo hacen con el evento `storage`.
- Cerrar sesión borra la copia local de esa cuenta, y antes avisa si hay cambios sin subir.
- Al entrar, los horarios creados sin cuenta no se mezclan por sí solos: la app ofrece traspasarlos.

### Documentos

`users/{uid}/projects/{projectId}`, con estos campos:

| Campo | Contenido |
|---|---|
| `revision` | Entero que sube de uno en uno |
| `schema` | `BACKUP_VERSION` con que se escribió |
| `data` | El proyecto en JSON, sin `backupAt`, o `null` si se eliminó |
| `updatedAt` | Hora del servidor |

El proyecto se guarda como texto y no como campos de Firestore: siempre se lee y se escribe completo, y así pasa por la
misma validación que un respaldo. Los horarios reales medidos ocupan unos 113 KB, frente al límite de 1 MiB. **No se usa
`.fet`** porque no conserva el horario generado, las horas de contrato ni todas las restricciones.

### Algoritmo

[`SyncEngine`](../src/cloud/engine.ts) no conoce Firebase ni React, y se prueba con una nube en memoria. Compara un hash
del contenido con el último sincronizado en vez de usar `updatedAt`, porque `touch: false` no lo cambia y mover bloques o
generar también debe subirse. El hash se guarda por objeto de proyecto (`projectHash`): tras una edición solo se
recalcula el editado. **Por eso un proyecto del almacén nunca se modifica en su lugar**: `update()` trabaja sobre una
copia.

| Situación | Resultado |
|---|---|
| Solo cambió lo local | Se sube cuando el usuario hace una pausa (5 s, máximo 60 s), y también al salir de la pestaña |
| Solo cambió la nube | Reemplaza la copia local, conservando su `backupAt` |
| Cambiaron los dos | La versión local queda como copia nueva "(conflicto fecha)" y el usuario sigue en ella; la de la nube conserva el id |
| Eliminado aquí y editado en otro equipo | Se recupera la versión editada |
| Eliminado en otro equipo y editado aquí | La versión local queda como copia |
| Sin horarios locales al abrir, pero con registro de haberlos tenido | Se vuelven a descargar: nunca se interpreta como eliminarlos |
| Documento dañado o de una versión más nueva | Se avisa, no se aplica y ese horario no se sube |

Reglas que hay que mantener:

- **Nada se sube antes de conocer lo que hay en la nube.** Se espera una respuesta confirmada por el servidor, no por el
  caché de Firestore.
- **No se sincroniza si falló la lectura local** (`readFailed`), porque todo parecería eliminado.
- **Primero se guardan los horarios y luego el registro de lo sincronizado** (`storeFlushed`). En el orden inverso, un
  cierre a medio camino haría que la versión antigua se suba como si fuera un cambio.
- **Los horarios eliminados quedan con `data: null`** para que la eliminación llegue a los demás equipos.
- **Solo una pestaña sincroniza** (`navigator.locks`). Las demás reciben los cambios y el estado por `BroadcastChannel`.
- **"Guardado" significa confirmado por la nube.** La hora que se muestra sale del evento `saved` del motor, nunca de
  una escritura rechazada o sin conexión.
- **La seguridad está en [`firestore.rules`](../firestore.rules).** La configuración web es pública. Las reglas exigen
  correo confirmado y la revisión exactamente siguiente.
- **Al cambiar la forma de los datos,** sube `BACKUP_VERSION`: un equipo con una versión anterior no debe interpretar lo
  que no conoce.

## Service worker

[`sw.js`](../public/sw.js) recibe la versión en la URL de registro y usa un caché por versión.

| Recurso | Estrategia |
|---|---|
| Navegación | Primero la red; sin conexión, la copia guardada |
| Otros archivos | Primero el caché; si falta, la red, y se guarda |
| Instalación | Guarda `./`, todo lo que lista `precache.json` y los cuatro archivos del motor. Si falta uno, la instalación falla y sigue la versión anterior |

`precache.json` lo escribe el build ([`vite.config.ts`](../vite.config.ts)) con todo lo que produce, incluidos los
módulos que se cargan bajo demanda (Excel, Firebase) y las fuentes. Lo que `index.html` enlaza desde `public/` (íconos,
manifiesto) se guarda si se puede. Las búsquedas en el caché usan `ignoreVary`, porque lo guardado al instalar se pidió
sin el encabezado `Origin` que llevan los módulos de la página.

La nueva versión espera a que el usuario acepte "Actualizar ahora".

## Seguridad del sitio

[`vercel.json`](../vercel.json) define dos políticas de seguridad de contenido (CSP), en rutas que no se cruzan:

| Ruta | Permite | Por qué |
|---|---|---|
| Todo menos `/engine/` | Scripts propios y `apis.google.com`; conexiones a `*.googleapis.com` y `*.firebaseapp.com`; marcos de `*.firebaseapp.com` y `accounts.google.com`; estilos en línea | Firebase (Firestore e inicio de sesión con Google) y los `style` de React |
| `/engine/` | `'wasm-unsafe-eval'` y `'unsafe-eval'` | El Worker toma la política de su propio archivo. El motor compila WebAssembly, y el código de Emscripten crea funciones con `new Function` |

`'unsafe-eval'` queda solo en el Worker, que no tiene acceso a la página. `vite preview` envía las mismas cabeceras
([`vite.config.ts`](../vite.config.ts)), así que todas las pruebas de navegador corren con la política, y una de ellas
falla si algo se bloquea al generar o exportar. **Al agregar un dominio externo, agrégalo a la política.** El inicio de
sesión con Firebase no tiene prueba automática: al cambiar la política, pruébalo a mano en un despliegue.
`public/_headers` (Cloudflare Pages, Netlify) no tiene la política.

## Pruebas

| Dónde | Qué cubre | Cómo correrlo |
|---|---|---|
| [`domain.test.ts`](../src/domain/domain.test.ts) | Jornada, validación, exportación, divisiones, electivos, mensajes de FET y fijados | `npm test` |
| [`backup.test.ts`](../src/domain/backup.test.ts), [`importCarga.test.ts`](../src/domain/importCarga.test.ts), [`fetImport.test.ts`](../src/domain/fetImport.test.ts) | Importaciones y respaldos | `npm test` |
| [`fet.integration.test.ts`](../src/domain/fet.integration.test.ts), [`manual.integration.test.ts`](../src/domain/manual.integration.test.ts) | Generación real con el motor en Node, y sus resultados verificados | `npm test` |
| [`projects.test.ts`](../src/store/projects.test.ts) | Cuándo un horario queda desactualizado al importar, duplicar y editar | `npm test` |
| [`engine.test.ts`](../src/cloud/engine.test.ts), [`account.test.ts`](../src/store/account.test.ts) | Sincronización con una nube en memoria, y espacios de datos por cuenta | `npm test` |
| [`large.test.ts`](../src/domain/large.test.ts) | Que las referencias se lean sin errores; con `LARGE=1`, tiempos en un colegio sintético y en dos reales anonimizados ([`fixtures/`](../src/domain/fixtures/)) | `LARGE=1 npx vitest run src/domain/large.test.ts` |
| [`e2e/rendimiento.spec.ts`](../e2e/rendimiento.spec.ts) | Trabajo del navegador al seleccionar y mover bloques, con la CPU ×4 | `npm run build`, luego `PERF=1 npx playwright test e2e/rendimiento.spec.ts --project=chromium` |
| [`e2e/app.spec.ts`](../e2e/app.spec.ts) | Flujos en navegadores reales | `npm run build`, luego `npm run e2e` |

Las pruebas de integración corren el motor en Node con [`nodeEngine.testutil.ts`](../src/domain/nodeEngine.testutil.ts)
y se omiten solas si falta. `ui/` y `pages/` no tienen pruebas unitarias. El adaptador
[`firebase.ts`](../src/cloud/firebase.ts) y las reglas no tienen pruebas automáticas, porque requieren los emuladores de
Firebase, que necesitan Java. Se comprobaron una vez contra el proyecto real, con cuentas desechables: **al cambiar las
reglas o el adaptador, repite a mano el flujo con dos navegadores.**

Las pruebas de navegador fijan `Math.random` para que la semilla, y por lo tanto el horario, sea siempre la misma. Sus
pasos deben fallar si no encuentran lo que buscan, no saltarse la comprobación. La grilla interactiva se selecciona con
`.card td.lesson`, porque la página también contiene una copia oculta para imprimir.

## Cómo agregar una regla

1. **[`types.ts`](../src/domain/types.ts):** agrega el campo a `Rules` y su valor por defecto en `migrateProject`.
2. **[`defaults.ts`](../src/domain/defaults.ts):** agrégalo a los proyectos nuevos.
3. **[`ReglasPage.tsx`](../src/pages/ReglasPage.tsx):** agrega el control con una explicación sin términos de FET.
4. **[`fetExport.ts`](../src/domain/fetExport.ts):** escribe la restricción. **Comprueba con el motor qué pesos admite**
   antes de ofrecer "preferible".
5. **[`validate.ts`](../src/domain/validate.ts):** detecta los casos imposibles antes de generar, con un mensaje que
   indique qué corregir.
6. **[`manual.ts`](../src/domain/manual.ts):** si es obligatoria, respétala al mover bloques (`slotProblem` si depende
   solo del lugar, `checkMove` o `ruleProblem` si depende del resto de la semana).
7. **[`fetImport.ts`](../src/domain/fetImport.ts):** traduce la restricción al importar y sácala del informe de lo perdido.
8. **Pruebas:** agrega una generación real en
   [`fet.integration.test.ts`](../src/domain/fet.integration.test.ts) que verifique el resultado, y el caso de movimiento.
9. **[README](../README.md):** agrega la fila a la tabla "Cómo se traduce a FET".

## Limitaciones conocidas

- Una clase tiene un solo profesor, y no hay actividades sin curso.
- Las salas son solo las especiales, una por asignatura y sin disponibilidad propia.
- Las ventanas y las horas diarias son iguales para todos los profesores.
- Sin cuenta, los datos viven en un solo navegador.
- Con cuenta, cada horario pertenece a una sola persona: no se comparte entre usuarios.

El análisis de hallazgos está en [mejoras.md](mejoras.md) y las mediciones en [revision-arquitectura.md](revision-arquitectura.md).
La planificación vigente está en [plan-implementacion.md](plan-implementacion.md).
