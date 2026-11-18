# Revisión de arquitectura

Revisión del commit `08ba37b` (15 de noviembre de 2026). Complementa a [arquitectura.md](arquitectura.md), que explica
cómo funciona el código, y a [mejoras.md](mejoras.md), que lleva el registro de errores y propuestas con sus
identificadores (E6, F5, T4…).

**Cómo se hizo.** Solo por lectura del código y de la documentación. No se ejecutaron pruebas ni se midió nada nuevo:
las cifras citadas son las de [mejoras.md](mejoras.md). Las referencias a líneas corresponden al commit revisado.

## Mapa de la arquitectura

```
Navegador (sitio estático en Vercel, sin servidor de cálculo)
│
├─ App.tsx ── ruta por hash; ejecuta validate() en cada cambio del proyecto
│   ├─ pages/ (10 pantallas, todas en el bundle inicial de 401 KB)
│   └─ ui/    (grilla, cuenta, Excel con import() dinámico)
│
├─ store/ (zustand)
│   ├─ projects.ts   ── update(): clona → recipe → migrateProject → guarda
│   │                   persistencia: UN JSON {projects, currentId} en IndexedDB
│   │                   pestañas: BroadcastChannel → rehydrate completo
│   ├─ generation.ts ── estado de la generación; escribe el horario con setState directo
│   ├─ account.ts    ── sesión, espacio por uid, navigator.locks (una pestaña sincroniza)
│   └─ health.ts, sw.ts
│
├─ domain/ (puro, probado en Node)
│   ├─ types.ts + units.ts ── modelo, Unit, divisiones sintéticas
│   ├─ validate.ts → fetExport.ts → [motor] → fetResult.ts
│   ├─ manual.ts   ── ajuste sin motor (checkPlace, ruleProblem)
│   └─ fetImport.ts, importCarga.ts, backup.ts, preferences.ts
│
├─ engine/ ── runFet.ts: 1 Worker por generación
│   └─ public/engine/: fet-cl.wasm (7,4 MB) + fet_es.qm (3,3 MB) + fet-worker.js
│
├─ cloud/ (opcional)
│   ├─ engine.ts   ── SyncEngine: hash del contenido, revisión +1, copia en conflicto
│   └─ firebase.ts ── único punto de contacto; chunk de 574 KB bajo demanda
│       └─ Firestore users/{uid}/projects/{id} = proyecto entero como texto (límite 1 MiB)
│
└─ sw.js ── caché por versión; guarda index.html, lo que enlaza y el motor

CI: lint + vitest + build → Playwright ×4 → Vercel publica main (checks por nombre)
```

## Cuellos de botella

### 1. Persistencia y sincronización por bloque completo

- Cada cambio de estado, incluido cada carácter tecleado y `select`, serializa y reescribe todos los proyectos
  ([`projects.ts`](../src/store/projects.ts#L47-L61)).
- Cada edición llama `schedule()` → `reportIdle()` → `countPending`, que hace `JSON.stringify` y hash de todos los
  proyectos en el hilo principal ([`engine.ts`](../src/cloud/engine.ts#L68-L72),
  [`account.ts`](../src/store/account.ts#L125)).
- El costo crece con el número de horarios guardados (copias, conflictos), no con el que se edita. Con pocos proyectos
  está medido como despreciable: 0,2 ms por proyecto.
- Entre pestañas gana la última escritura del almacén completo, no la del proyecto.

### 2. Motor de un solo hilo, un solo intento y arranque en frío

- Cada generación crea un Worker y vuelve a instanciar el wasm y la traducción
  ([`fet-worker.js`](../public/engine/fet-worker.js#L35-L38)), con unos 220 MB por Worker.
- Se prueba una sola semilla, que luego se descarta ([`generation.ts`](../src/store/generation.ts#L38)). El caso difícil
  solo termina en `timeout`, sin reanudar ni indicar qué regla lo impide.
- Es el único límite real de capacidad: el archivo real difícil no terminó en 30 a 40 s.

### 3. Ajuste manual: cálculo y dibujo sin granularidad

- Al seleccionar un bloque se ejecuta `checkPlace` para cada tramo de la semana
  ([`HorarioPage.tsx`](../src/pages/HorarioPage.tsx#L58-L65)). Cada llamada filtra todas las clases, busca con `find`
  lineales y recorre `courseStudentSets`, que crece como el producto de los grupos (11 a 44 ms medidos en Node).
- `companions` recalcula `parallelRows` en cada llamada ([`manual.ts`](../src/domain/manual.ts#L63-L68)).
- `hint` es estado de la página: cada `mousemove` o `dragover` reconstruye la grilla entera
  ([`HorarioPage.tsx`](../src/pages/HorarioPage.tsx#L169-L174)).
- Tras "Imprimir todos", `printAll` no vuelve a `false` y quedan todas las grillas montadas
  ([`HorarioPage.tsx`](../src/pages/HorarioPage.tsx#L278)).

## Mejoras detectadas

Las que ya tienen identificador están descritas en [mejoras.md](mejoras.md). Las nuevas llevan el prefijo **R**.

| Id | Mejora | Cuello que ataca | Esfuerzo | Estado |
|---|---|---|---|---|
| E6 | Lista de precarga del service worker generada en el build; la instalación falla si falta el motor | — | S–M | Hecho |
| R1 | Guardar la semilla en `Timetable` | 2 | S | Hecho |
| R2 | Hash sucio por proyecto: `countPending` solo recalcula el proyecto editado | 1 | S | Hecho |
| R3 | Sacar `hint` de la página, memoizar las celdas y restablecer `printAll` (esto último es parte de E12) | 3 | S–M | Hecho |
| R4 | Índices precalculados en `manual.ts` (por día, profesor y curso) y `parallelRows` memoizado | 3 | M | Hecho |
| R5 | Limpieza central de `locks` huérfanos y de `teacherMeetingSlots`, en vez de una por pantalla (cubre parte de E12) | — | S | Hecho |
| F5 | Deshacer y rehacer en `update()` | — | M | Hecho |
| R6 | Guardar la generación con una acción del almacén, e invalidarla si se movieron bloques durante el cálculo (parte de E12) | — | S | Hecho |
| T6 | CSP con `wasm-unsafe-eval` en `vercel.json` | — | S–M | Hecho |
| T7, T8 | Acciones de GitHub fijadas por SHA; versiones y SHA-256 del motor | — | S | Hecho |
| T4 | Colegio real anonimizado como referencia de rendimiento | 2 y 3 | M | Hecho |
| F4 | Varias semillas, en paralelo o una tras otra, eligiendo el mejor resultado | 2 | M | Pendiente |

Otras menores, sin identificador:

- `newId` genera 32 bits. El riesgo de colisión es bajo, pero en claves de actividad sería silencioso.
- Carga diferida de las pantallas, para reducir el bundle inicial.
- Pruebas automáticas de [`firestore.rules`](../firestore.rules), que hoy no tiene.
- Una sola función `parseActivityKey`: hay 10 `split('#')` repetidos.
- Auditoría de accesibilidad (T9).

## Plan de acción

**Estado:** las fases A, B y C están aplicadas (18 de noviembre de 2026). La D sigue pendiente, y la medición de la
fase B no muestra, por ahora, motivo para hacerla (ver [resultados](#resultados-de-la-fase-b)). En la C, el inicio de
sesión con Firebase bajo la nueva CSP se probó a mano en producción y funciona.

| Fase | Contenido | Criterio de cierre | Estimación |
|---|---|---|---|
| **A. Riesgo bajo, sin transformar datos** | E6, R1, R5, R6, T7, T8 | `npm run check` y e2e en verde; la prueba sin conexión cubre Excel; E6, E12, T7 y T8 marcados en `mejoras.md` | 3–4 días |
| **B. Medir antes de optimizar** | T4, luego R2, R3, R4 | Referencia en `large.test.ts`; tiempo de `checkPlace` y de dibujo antes y después, en navegador | 1 semana |
| **C. Confianza** | F5, T6 | Deshacer cubre eliminar, mover y fijar, respetando `touch`; CSP probada generando en los cuatro navegadores | 1–1,5 semanas |
| **D. Motor** | F4 | Solo si la fase B muestra casos donde la semilla cambia el resultado; límite de Workers según la memoria | 1 semana |

Condiciones:

- **Orden obligado.** T4 va antes de R4 y de F4: sin una referencia difícil no hay cómo justificarlas ni verificarlas.
  R1 va antes de F4.
- **Modelo de datos.** R1 agrega un campo: necesita su valor por defecto en `migrateProject` y su revisión en
  `checkProject`. El resto no toca el modelo.
- **Sincronización.** R2 cambia [`cloud/engine.ts`](../src/cloud/engine.ts) y debe mantener las pruebas con la nube en
  memoria. No toca las reglas ni `firebase.ts`, así que no obliga a repetir a mano el flujo con dos navegadores.
- **Fuera del plan.** Guardar cada proyecto por separado en IndexedDB sigue sin justificarse con los tamaños medidos.
  Conviene revisarlo solo si R2 no basta.

## Resultados de la fase B

Referencias (T4) en [`src/domain/fixtures/`](../src/domain/fixtures/): dos colegios reales de 24 cursos, con los
nombres de profesores y del colegio reemplazados y sin el informe de importación. Se comprobó que ninguna palabra de
los nombres originales quedara en los archivos.

| Referencia | Contenido | Uso |
|---|---|---|
| `referencia-generada.json` | 492 bloques, sin fijados, con un horario generado (semilla 7) | Ajuste manual, sin el motor |
| `referencia-dificil.json` | 517 bloques, 293 fijados | El motor agota el tiempo: 507 de 517 ubicados en 30 s |

Mediciones en el mismo equipo. Los tiempos varían entre corridas, así que se dan rangos de varias.

| Qué | Antes | Después | Dónde |
|---|---|---|---|
| Revisar los destinos de un bloque, referencia generada (R4) | 23–25 ms | 5–7 ms | Node, `large.test.ts` |
| Lo mismo, colegio sintético con grupos y electivos (R4) | 22–26 ms | 7 ms | Node, `large.test.ts` |
| JavaScript al seleccionar y soltar un bloque (R3, R4) | 105–144 ms | 63–81 ms | Chromium con CPU ×4, `e2e/rendimiento.spec.ts` |
| JavaScript por movimiento del mouse con un bloque seleccionado (R3) | 8–14 ms | 3 ms | Ídem |
| Horarios pendientes tras cada edición, con 20 horarios guardados (R2) | 31 ms | 2 ms | Node, `large.test.ts` |

- **R4** agrega a [`manual.ts`](../src/domain/manual.ts) un índice de las clases por clave, día, profesor, unidad y
  lugar de inicio, y una vista que mueve bloques sin copiar el horario. `placeTargets` revisa la semana completa y
  reutiliza `parallelRows` durante esa llamada. Una comparación de 10.340 casos (la referencia y el colegio sintético,
  con las reglas apagadas y con todas las obligatorias activas) dio resultados idénticos a la versión anterior.
- **R3:** el aviso junto al cursor tiene su propio estado, la grilla es un componente memorizado y "Imprimir todos"
  deja de dibujar las grillas al terminar de imprimir.
- **R2:** el hash se guarda por objeto de proyecto, así que tras una edición solo se recalcula el editado. Supone que
  un proyecto del almacén nunca se modifica en su lugar, lo que ya garantiza `update()`.
- **Lo que queda en el navegador** es sobre todo estilos, diseño y pintura de la página, no el cálculo.
- **Semillas (para la fase D):** la referencia difícil llegó a 507 de 517 con las semillas 1 a 5, en 30 s cada una. En
  este caso la semilla no cambia el resultado, así que generar con varias semillas (F4) no ayudaría.
