# Arquitectura

Para quien va a modificar el código. El [README](../README.md) cubre la instalación, los comandos y la publicación; este
documento explica cómo funciona por dentro y qué hay que cuidar.

## Principios

- **Sin servidor.** El sitio es estático y el cálculo ocurre en el navegador. Los datos del colegio no salen de él.
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
  engine --> worker["public/engine/fet-worker.js"]
  worker --> wasm["fet-cl.wasm"]
```

| Carpeta | Responsabilidad |
|---|---|
| [`src/domain/`](../src/domain/) | Modelo, validación, conversión a FET y desde FET, ajuste manual, respaldos |
| [`src/engine/`](../src/engine/) | Argumentos de `fet-cl` y comunicación con el Worker |
| [`src/store/`](../src/store/) | Proyectos guardados, generación en curso, salud del almacenamiento, service worker |
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
- **Al quitar datos, limpia sus fijados.** `migrateProject` limpia referencias en carga y electivos, pero no `locks`:
  cada pantalla lo hace por su cuenta.

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
- **Semilla.** Es aleatoria en cada generación y no se guarda. Con la misma semilla, el resultado es el mismo.

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
| `timetables/horario-highest/horario_activities.xml` | Se agota el tiempo | Sí | No (ver [F1](mejoras.md#aprovechar-lo-que-el-motor-ya-entrega)) |
| `timetables/horario-current/horario_activities.xml` | Se agota el tiempo | Sí | No |
| `timetables/horario/horario_soft_conflicts.txt` | Con `--writetimetableconflicts=true` | No | No (ver [F2](mejoras.md#aprovechar-lo-que-el-motor-ya-entrega)) |

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
- **Cambiar la forma de los datos:** agrega el valor por defecto en `migrateProject`. Si el cambio requiere transformar
  datos, sube `version` en `projects.ts` y, si corresponde, `BACKUP_VERSION`.

## Service worker

[`sw.js`](../public/sw.js) recibe la versión en la URL de registro y usa un caché por versión.

| Recurso | Estrategia |
|---|---|
| Navegación | Primero la red; sin conexión, la copia guardada |
| Otros archivos | Primero el caché; si falta, la red, y se guarda |
| Instalación | Guarda `./`, lo que enlaza `index.html` y los cuatro archivos del motor |

La nueva versión espera a que el usuario acepte "Actualizar ahora". Los módulos que se cargan bajo demanda no se guardan
al instalar ([E6](mejoras.md#e6-sin-conexión-incompleto)).

## Pruebas

| Dónde | Qué cubre | Cómo correrlo |
|---|---|---|
| [`domain.test.ts`](../src/domain/domain.test.ts) | Jornada, validación, exportación, divisiones, electivos, mensajes de FET y fijados | `npm test` |
| [`backup.test.ts`](../src/domain/backup.test.ts), [`importCarga.test.ts`](../src/domain/importCarga.test.ts), [`fetImport.test.ts`](../src/domain/fetImport.test.ts) | Importaciones y respaldos | `npm test` |
| [`fet.integration.test.ts`](../src/domain/fet.integration.test.ts), [`manual.integration.test.ts`](../src/domain/manual.integration.test.ts) | Generación real con el motor en Node, y sus resultados verificados | `npm test` |
| [`projects.test.ts`](../src/store/projects.test.ts) | Cuándo un horario queda desactualizado al importar, duplicar y editar | `npm test` |
| [`large.test.ts`](../src/domain/large.test.ts) | Tiempos en un colegio sintético | `LARGE=1 npx vitest run src/domain/large.test.ts` |
| [`e2e/app.spec.ts`](../e2e/app.spec.ts) | Flujos en navegadores reales | `npm run build`, luego `npm run e2e` |

Las pruebas de integración se omiten solas si falta el motor. `ui/` y `pages/` no tienen pruebas unitarias.

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
- Los datos viven en un solo navegador, sin sincronización.

El análisis completo y las propuestas están en [mejoras.md](mejoras.md).
