# Asistencia con IA a costo cero

> Propuesta técnica histórica, no implementada. El orden vigente de trabajo está en el [plan de implementación](plan-implementacion.md).

Propuesta del 17 de noviembre de 2026 para agregar IA a la app sin servidores ni costos de API, ni para el proyecto ni
para los colegios. Complementa a [arquitectura.md](arquitectura.md), que explica cómo funciona el código, y a
[mejoras.md](mejoras.md), que lleva el registro de errores y propuestas.

**Cómo se hizo.** Solo por lectura del código ([manual.ts](../src/domain/manual.ts),
[fetResult.ts](../src/domain/fetResult.ts), [importCarga.ts](../src/domain/importCarga.ts),
[types.ts](../src/domain/types.ts), [sw.js](../public/sw.js), [vercel.json](../vercel.json),
[generation.ts](../src/store/generation.ts), [fetExport.ts](../src/domain/fetExport.ts)). No se implementó nada; lo
único que se comprobó fuera del código fue la petición previa de CORS de cada proveedor. Las cifras de hardware, límites gratuitos y APIs de los navegadores son las conocidas a mediados de 2026 y
cambian seguido: hay que confirmarlas antes de cada fase.

**Regla de oro.** La IA nunca reemplaza al motor ni escribe el archivo `.fet`. Vive en `src/ai/` como capa opcional
alrededor de `src/domain/`, y solo devuelve **operaciones** con un formato cerrado (un parche o una receta para leer una
planilla). Esas operaciones las ejecuta y revisa código puro de `domain/`, con pruebas.

## Resumen

1. **Dos de los cuatro casos (diagnóstico y ajuste manual) se resuelven mejor sin IA.** El diagnóstico y la búsqueda de
   movimientos se calculan en `src/domain/` con lo que ya existe. La IA solo explica en lenguaje simple o entiende un
   pedido escrito en español. Por eso conviene hacer primero la parte determinista: sirve a todos los colegios, no
   cuesta nada y no tiene riesgos de privacidad.
2. **Orden de las vías: Puente (C), después clave propia (B), y modelo local (A) al final como experimento.** El Puente
   funciona en cualquier computador, incluso pasando por el celular del jefe de UTP. La clave propia (Gemini o Groq) le
   quita el paso de copiar y pegar a quien la quiera. Un modelo local hoy no corre en el computador típico de un
   colegio.
3. **La IA nunca devuelve el proyecto ni datos del colegio**, y todo lo que sale del navegador va anonimizado.

## Las tres vías

| | **A · Local** (Chrome con Gemini Nano, o WebLLM) | **B · Clave propia** (Gemini o Groq gratis) | **C · Puente** (copiar y pegar) |
|---|---|---|---|
| Hardware | Nano: equipo de escritorio con unos 22 GB libres y GPU de más de 4 GB, o 16 GB de RAM. WebLLM: WebGPU y 1 a 2 GB de VRAM. La mayoría de los PC de colegio y los Chromebook no Plus no califican | Cualquiera | Cualquiera, incluso un celular aparte |
| Privacidad | Nada sale del equipo | Sale al proveedor. El nivel gratis de Gemini puede usar lo enviado para entrenar y lo pueden leer revisores, así que anonimizar es obligatorio | Sale a la cuenta del propio usuario (ChatGPT gratis entrena por defecto). Anonimizar es obligatorio |
| Sin conexión | Sí, después de descargar el modelo (de 1 a varios GB) | No | La app sí; el chat no |
| JSON estructurado | Nano y WebLLM fuerzan la forma del JSON: sale bien formado, pero el contenido es poco confiable con modelos de 1 a 3 mil millones de parámetros en español | Bueno: Gemini acepta un esquema de respuesta y Groq tiene modo JSON | Bueno con modelos grandes, pero llega con texto o bloques de código alrededor: hay que extraer el JSON y tolerar errores |
| Fricción | Ninguna si el equipo es compatible; una descarga grande si no lo es | Media: crear la clave toma unos 2 minutos, y Workspace for Education puede tener AI Studio bloqueado por el administrador | Copiar, pegar, esperar, copiar y pegar de vuelta |
| Límites | No hay | Cambian sin aviso: Google recortó el nivel gratis en 2025, y OpenRouter `:free` permite unas 50 consultas al día sin crédito. Anthropic y OpenAI no tienen nivel gratis | Los del plan gratis de cada chat |

La app no debe tener estas cifras escritas en el código: debe detectar lo disponible con
`LanguageModel.availability()` y `navigator.gpu`, y recuperarse cuando el proveedor responde 429 (límite alcanzado).

## Arquitectura

Todas las vías quedan detrás de una misma interfaz:

```ts
// src/ai/provider.ts
export type ProviderId = 'nano' | 'webllm' | 'gemini' | 'groq' | 'openrouter' | 'anthropic' | 'openai' | 'puente';

export interface AIRequest<T> {
  task: 'explicarDiagnostico' | 'recetaCarga' | 'parche' | 'objetivo';
  system: string;          // instrucciones en español, sin términos de FET
  user: string;            // el contexto ya anonimizado
  schema: ZodType<T>;      // para validar
  jsonSchema: object;      // z.toJSONSchema(schema), para los proveedores que lo aceptan
}
export type AIResult<T> = { ok: true; value: T; raw: string } | { ok: false; error: string; raw?: string };

export interface AIProvider {
  id: ProviderId;
  local: boolean;
  disponible(): Promise<'si' | 'descargable' | 'no'>;
  generar<T>(req: AIRequest<T>, signal?: AbortSignal): Promise<AIResult<T>>;
}
```

- **El Puente cumple la misma interfaz.** Su `generar()` abre un diálogo con el prompt en un `<textarea>` y un botón
  "Copiar". Luego espera a que el usuario pegue la respuesta y la procesa con el mismo `parseRespuesta()` que usan los
  demás. Así las tareas no distinguen entre vías.
- **Proveedores que se llaman directo desde el navegador.** Se comprobó la petición previa de CORS (`OPTIONS`) desde un
  origen externo el 17 de noviembre de 2026: OpenAI, Gemini, Groq, OpenRouter y Anthropic la aceptan. Anthropic exige
  además el encabezado `anthropic-dangerous-direct-browser-access: true` en la petición real. Groq, OpenRouter y OpenAI
  usan el mismo formato y comparten `openaiCompat.ts` (solo cambia la URL base). Gemini y Anthropic tienen su propio
  adaptador. OpenAI y Anthropic no tienen nivel gratis: la interfaz los muestra como "requiere una cuenta con saldo". La
  fase 2 debe probar una llamada real por proveedor desde la app publicada.
- **Proveedor por defecto:** el que configuró el usuario; si no hay uno, Nano si responde `'si'`; si no, el Puente.
  WebLLM nunca se activa solo, porque son gigabytes de descarga.
- **Todas las respuestas pasan por el mismo camino:** extraer el JSON, validarlo con zod y rehidratarlo (devolver los
  nombres reales en lugar de los identificadores opacos). Después lo revisa `domain/` (`checkPlace`, `checkProject`,
  etc.) y se muestra una tarjeta de confirmación con los cambios. Solo entonces se llama a `update()`. Con las vías A y
  B se reintenta una sola vez, enviando el error de validación. Con el Puente se muestra un mensaje que dice qué hacer,
  por ejemplo: "Falta el campo X. Pega este texto en el chat para que lo corrija".

### Puntos del código actual que hay que cuidar

- **[sw.js](../public/sw.js) borra en `activate` todos los cachés con prefijo `horarios-web-` que no sean la versión
  actual.** Si los pesos de un modelo quedaran ahí, se volverían a descargar en cada versión de la app. WebLLM y Chrome
  usan sus propios cachés y el handler `fetch` ignora pedidos a otros dominios, así que hoy no hay problema, pero debe
  quedar como invariante.
- **El build genera `precache.json`** con todos los módulos, incluidos los de carga diferida. El service worker los
  precarga al instalarse. Si se incorpora IA, revisar el tamaño de los módulos y mantener los pesos de los modelos
  fuera de este precaché; no descargarlos sin autorización.
- **Ya existe CSP en Vercel.** Antes de activar proveedores externos, ampliar de forma mínima `connect-src` en
  [vercel.json](../vercel.json), revisar la política del despliegue alternativo y probar Firebase. La CSP reduce vías
  de exfiltración, pero no protege por sí sola una clave accesible al código de la página; priorizar claves de sesión,
  autorización explícita y dominios permitidos por el proveedor.
- **zod no está instalado.** Se propone `zod/mini` (v4), importado solo desde `src/ai/` para que el bundle principal no
  crezca, y `z.toJSONSchema()` para generar los esquemas que piden Gemini y Nano.

### Claves de API (vía B)

- Se guardan con `idb-keyval` en una base aparte (`horarios-web-ia`). Nunca van en `Project`, en el respaldo ni en la
  sincronización.
- Se ofrecen dos opciones: "Recordar en este equipo" o "Solo esta sesión", porque muchos PC de colegio son compartidos.
  También hay un botón "Olvidar clave".
- La interfaz recomienda limitar la clave por dominio, si el proveedor lo permite.

## Privacidad y anonimización

```ts
// src/ai/anonymize.ts
export interface Mapa {
  aOpaco: Map<string, string>;   // teacherId → 'DOC_03'
  aReal:  Map<string, string>;   // 'DOC_03' → teacherId
}
export function anonimizar(p: Project, textoLibre?: string): {
  contexto: ContextoAnon; texto?: string; mapa: Mapa; ambiguos: Ambiguo[]
};
export function rehidratar<T>(valor: T, mapa: Mapa): T;   // falla si aparece un token desconocido
```

- **Qué se reemplaza:** profesores por `DOC_01`, `DOC_02`, … en el orden de `teachers`; salas por `SALA_01`, …;
  `school.name` y el nombre del proyecto se omiten. Además, el buscador de nombres de docentes se aplica a **todo texto
  que sale del navegador**: nombres de cursos, asignaturas, divisiones (`Division.name`), grupos (`CourseGroup.name`),
  franjas de electivos (`ElectiveBlock.name`) y el texto libre del usuario. Las opciones de electivos no tienen nombre
  propio (`subjectId` y `teacherId`).
- **Qué se mantiene:** cursos ("1° Medio A") y asignaturas. No son datos personales, y el modelo los necesita para
  razonar sobre niveles y asignaturas. Los cursos podrían pasar a `CURSO_01`, pero la explicación pierde calidad.
- **Cómo se reemplaza:** en una sola pasada, con una expresión que combina todos los términos ordenados de mayor a menor
  longitud y con límites de palabra Unicode (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, bandera `u`). No se usa `norm()` de
  [importCarga.ts](../src/domain/importCarga.ts), porque cambia el largo del texto; se compara con una versión que
  conserva el largo (NFC, letra base sin tilde, minúscula).
- **Falsos positivos:** el nombre completo se reemplaza siempre. El apellido solo, únicamente si va precedido de un
  tratamiento (Prof., profesor/a, Sr./Sra., don/doña, tío/tía). Un apellido suelto se reemplaza solo en el texto libre
  del usuario (por ejemplo, "el Pérez no viene…"), y solo si corresponde a un único docente y no coincide con un nombre
  de asignatura, curso o división; en otro caso se le pregunta al usuario antes de enviar. Los nombres que no están en
  el proyecto no se detectan, así que siempre se muestra "Ver exactamente lo que se enviará".
- **Al rehidratar** se rechaza cualquier token o identificador que no esté en el mapa. El modelo nunca ve los `id`
  internos.
- **Prueba fija:** recorrer las fixtures y comprobar que ningún `teacher.name` ni `school.name` aparece en el prompt
  generado.
- **Contexto legal:** en Chile, el nombre de un docente junto con su disponibilidad son datos personales, y la Ley
  21.719 endurece las reglas desde diciembre de 2026. Anonimizar por defecto, también en la vía A, simplifica el
  argumento.

## Lectura de respuestas (`src/ai/parse.ts`)

1. **Extraer:** si hay un bloque ```` ```json ````, se usa ese; si no, el primer objeto `{…}` balanceado, contando llaves
   fuera de las cadenas.
2. **Intentar `JSON.parse` sin cambios.** Si funciona, no se toca el texto.
3. **Si falla, reparar con un recorrido por estados:** fuera de una cadena, `“` y `”` se tratan como delimitadores y se
   convierten en `"`; dentro de una cadena abierta con `"` se conservan como contenido. Fuera de cadenas también se
   cambian los espacios no separables (U+00A0) por espacios y se quitan las comas antes de `}` o `]`. Nunca se hace un
   reemplazo global.
4. **Validar con zod** siempre. Si hubo reparación, se avisa "La respuesta se corrigió automáticamente".

Si todas las comillas fueron convertidas (al pasar por Word, WhatsApp o el autocorrector del celular), el texto es
ambiguo y no se repara. El mensaje dice qué hacer: "Copia la respuesta con el botón Copiar del chat, no seleccionando el
texto". Las pruebas de `parse.test.ts` usan respuestas reales copiadas de cada chat.

## Casos de uso

### IA1. Diagnóstico cuando no se puede generar

Son dos piezas separadas:

- **`diagnose(p, outcome, partial)`** en `src/domain/diagnose.ts`: es puro e instantáneo. La pantalla de generación lo
  calcula con `useMemo` cuando el resultado es `impossible` o `timeout`, sin agregar estado a
  [generation.ts](../src/store/generation.ts). Parte de la actividad que entrega `FetOutcome` y produce hallazgos, cada
  uno con un `id`:
  - Carga del docente comparada con sus tramos libres (ya existen `teacherSlotsPerDay` y `teacherLoad` en
    [validate.ts](../src/domain/validate.ts)).
  - `maxDays` × tramos por día comparado con su carga.
  - Un bloque de 3 horas sin 3 tramos seguidos disponibles.
  - Una ventana obligatoria de la asignatura con menos tramos que bloques.
  - "Repartir en días distintos" obligatorio cuando la asignatura tiene más bloques que días disponibles.
  - Electivos: la intersección de la disponibilidad de **todos** los profesores de la franja.
  - Conflictos de fijados (`lockProblems`).
- **`relax.ts`**: es la propuesta F3 de [mejoras.md](mejoras.md). Solo corre cuando el usuario presiona "¿Qué cambio lo
  haría posible?". `src/domain/relax.ts` arma las variantes (cada una aplica un cambio sobre una copia) y
  `src/store/relax.ts` las ejecuta.
  - **Orden, del cambio más pequeño al más grande:** primero lo que señalan los hallazgos de `diagnose`; después pasar a
    "preferible" lo que lo admite (`spreadStrength`, `SubjectWindow.strength`); al final, quitar reglas globales de
    `Rules`.
  - **Tres resultados por variante:** *funciona* (el motor generó el horario), *no basta* (el motor respondió
    `impossible`) o *sin resolver* (se agotó el tiempo). "Sin resolver" nunca se presenta como "esta regla no es la
    causa".
  - **Tiempo:** una pasada corta de unos 15 s por variante, que se detiene en la primera que funciona. Después, el
    usuario puede "Probar otras opciones" o "Buscar con más tiempo" en las que quedaron sin resolver. El valor de 15 s
    hay que medirlo con el caso real que agotó 40 s (ver [mejoras.md](mejoras.md#mediciones-con-archivos-reales)).
  - **Ejecución:** `store/relax.ts` llama a `runFet` directamente, con una semilla fija. **No usa
    `useGeneration.start()`**, porque esa función guarda el horario en el proyecto cuando la generación sale bien y pisa
    `outcome` y `partial`. Ninguna variante se guarda nunca. La generación normal y `relax` se excluyen entre sí.

La IA, si se usa, solo redacta la explicación a partir de los hallazgos y de los resultados de `relax`:

```ts
const Explicacion = z.object({
  resumen: z.string().max(400),
  causas: z.array(z.object({ hallazgoId: z.string(), explicacion: z.string() })), // solo ids que vienen de diagnose
  acciones: z.array(z.object({ hallazgoId: z.string(), texto: z.string() })),
});
```

### IA2. Planillas de carga desordenadas

Al modelo se le envía el encabezado y unas 15 filas. Se conservan los números, los cursos y las asignaturas que se
reconocen; cualquier otro texto pasa a `TXT_07`. El modelo devuelve una **receta** para leer la planilla, no los datos.
`src/domain/cargaRecipe.ts` ejecuta la receta en local y el resultado entra al `planImport` existente, con su vista
previa y su validación por fila.

```ts
const RecetaCarga = z.object({
  hoja: z.number().int(), filaEncabezado: z.number().int(), primeraFila: z.number().int(),
  formato: z.enum(['largo', 'matriz']),   // en 'matriz', los cursos van como columnas
  columnas: z.object({ curso: z.number().nullable(), asignatura: z.number(), profesor: z.number().nullable(),
                       horas: z.number().nullable(), grupo: z.number().nullable() }),
  rellenarHaciaAbajo: z.array(z.number()),  // columnas con celdas combinadas
  columnasCurso: z.array(z.number()).optional(),
  ignorarFilasCon: z.array(z.string()).optional(), // "Total", "Subtotal"
});
```

Para un PDF o una planilla imposible, el MVP casi no requiere código: el Puente le pide al chat del propio usuario un
CSV con las columnas de `TEMPLATE_CSV`, y el usuario lo pega en la importación por texto que ya existe.

### IA3. Pedidos en español convertidos en cambios

El modelo devuelve operaciones cerradas. "Preferible" solo aparece donde el motor lo admite (repartir en días distintos
y bloques permitidos por asignatura).

```ts
const Parte = z.union([
  z.object({ parte: z.enum(['mañana', 'tarde', 'todo']) }),
  z.object({ bloques: z.array(z.string()) }),
  z.object({ desdeHora: z.string() }),   // "13:00": tramos cuyo inicio es igual o posterior
]);
const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('noDisponible'), docente: z.string(), dia: z.number(), cuando: Parte, accion: z.enum(['agregar', 'quitar']) }),
  z.object({ op: z.literal('maxDias'), docente: z.string(), valor: z.number().nullable() }),
  z.object({ op: z.literal('ventanaAsignatura'), asignatura: z.string(), cuando: Parte, fuerza: z.enum(['obligatoria', 'preferible']) }),
  z.object({ op: z.literal('repartirDias'), activo: z.boolean(), fuerza: z.enum(['obligatoria', 'preferible']) }),
  z.object({ op: z.literal('maxVentanasDocente'), porDia: z.number().nullable(), porSemana: z.number().nullable() }), // sin fuerza: solo obligatoria
  z.object({ op: z.literal('tramoCerrado'), dia: z.number(), cuando: Parte, accion: z.enum(['agregar', 'quitar']) }),       // School.closed
  z.object({ op: z.literal('consejoProfesores'), dia: z.number(), cuando: Parte, accion: z.enum(['agregar', 'quitar']) }),  // Rules.teacherMeetingSlots
  z.object({ op: z.literal('noSoportado'), texto: z.string(), motivo: z.string() }),
]);
const Parche = z.object({ ops: z.array(PatchOp).max(20), dudas: z.array(z.string()) });
```

- `src/domain/patch.ts` define `applyPatch` y `describePatch` (las líneas de la tarjeta de confirmación). Es puro y
  sirve también para formularios sin IA.
- `spreadSubjectDays` es una regla **global** en `Rules`: no se puede aplicar solo a Matemática de un docente. Ante un
  pedido así, el parche devuelve `repartirDias` con la advertencia "esto afecta a todas las asignaturas", o
  `noSoportado`.
- "Mañana" y "tarde" se resuelven en `domain` según `periods` (por ejemplo, la tarde son los bloques posteriores al
  almuerzo). Esa decisión no se le deja al modelo.
- `applyPatch` hace un solo `update()`, y después se revisa `lockProblems`, porque `migrateProject` elimina fijados huérfanos, pero no todos los que pasan a ser incompatibles con una regla.
- `tramoCerrado` modifica `School.closed` y `consejoProfesores` modifica `Rules.teacherMeetingSlots` (no `School`).
  Ambas usan claves `${día}:${idTramo}` y solo afectan tramos de tipo `clase`. Son cambios a la jornada: la tarjeta
  advierte que afectan a todos los cursos o a todos los docentes, y después se revisan `lockProblems` y `validate`
  (que ya avisa si el consejo ocupa toda la semana).

### IA4. Liberar a un docente en el ajuste manual

`relocate(p, objetivo)` en `src/domain/relocate.ts` toma cada clase del docente en los tramos que se quieren liberar,
junto con sus `companions`, y la prueba con `checkPlace` en todos los tramos. Eso cubre movimientos directos e
intercambios. Luego ordena los resultados por ventanas nuevas y docentes afectados. Son unas 6 clases × 45 tramos, una
cantidad trivial de cálculo.

Un formulario con docente, día y "mañana/tarde" resuelve casi todos los casos sin IA. El texto libre es solo un atajo
opcional, y el modelo solo traduce el objetivo:

```ts
const Objetivo = z.object({
  docente: z.string(), dia: z.number(), cuando: Parte,
  restricciones: z.object({ sinVentanasNuevas: z.boolean(), noTocarDocentes: z.array(z.string()) }),
});
```

## Estructura de carpetas

```
src/domain/                # puro, sin IA, probado en Node
  diagnose.ts              # IA1: diagnóstico determinista
  relax.ts                 # IA1: variantes del proyecto con una regla aflojada
  patch.ts                 # IA3: PatchOp, applyPatch, describePatch
  relocate.ts              # IA4: busca movimientos e intercambios válidos
  cargaRecipe.ts           # IA2: ejecuta una receta de lectura y produce Cell[][]
src/ai/                    # solo se carga con import('./ai/run') desde un botón
  run.ts                   # punto de entrada del chunk
  provider.ts  providers/{nano,webllm,gemini,openaiCompat,anthropic,puente}.ts
  anonymize.ts  parse.ts   # extraer el JSON, zod, rehidratar
  schemas.ts  prompts/*.ts  tasks/*.ts
  keys.ts                  # idb-keyval en una base aparte, "horarios-web-ia"
src/store/ai.ts            # proveedor elegido; nunca en Project, en el respaldo ni en la nube
```

## Hoja de ruta de IA (propuesta histórica)

El [plan de implementación](plan-implementacion.md) determina cuándo ejecutar estas entregas y sus dependencias.

| Fase | Entrega | Riesgo | Cómo probar |
|---|---|---|---|
| **0 · Sin IA** (mayor impacto) | `diagnose.ts` (automático) y `relocate.ts`. `relax.ts` con `store/relax.ts`, solo a pedido (F3 de mejoras.md) | Variantes "sin resolver" por poco tiempo: se muestran como tales, nunca como descartadas. Que una variante se guarde por error: `store/relax.ts` no escribe en el proyecto | Pruebas unitarias en Node e integración con el motor (se saltan sin `.wasm`). Una prueba comprueba que, después de correr `relax`, `timetable` no cambió |
| **1 · Puente** | `src/ai/` mínimo, `anonymize.ts`, Puente para IA1 y el prompt de CSV para IA2 | La respuesta pegada puede traer basura. Fugas de nombres escritos en texto libre | Prueba de "ningún nombre en el prompt". Pruebas de `parse.ts` con respuestas reales sucias. E2E leyendo el `<textarea>`, no el portapapeles, porque Firefox y WebKit no dan permisos de portapapeles en Playwright |
| **2 · Parches y clave propia** | `patch.ts` (pruebas de dominio), IA3 por el Puente, adaptadores de Gemini y Groq, CSP | El modelo inventa reglas que no existen (lo frenan zod y `noSoportado`). Cambios en los límites gratuitos | Un `FakeProvider` con fixtures. CI nunca llama a la red. Un `npm run eval:ia` manual con frases y operaciones esperadas, usando una clave gratis |
| **3 · Planillas** | `cargaRecipe.ts` (formato matriz, celdas combinadas) | Planillas que la receta no cubre: se ofrece el CSV por el Puente como alternativa | Fixtures `.xlsx` anonimizadas en `src/domain/` (los archivos reales no van al repositorio) |
| **4 · Local (experimental)** | Nano con la Prompt API cuando `availability()` responde `'si'`. WebLLM solo si hay demanda medida | La API cambia y hay poco hardware compatible | Solo detrás de una opción "Experimental", sin e2e |

## Invariantes nuevas

Cuando una fase quede lista, hay que llevarlas a [arquitectura.md](arquitectura.md):

- La IA solo produce operaciones; las aplica y revisa `src/domain/`, y el usuario confirma antes de `update()`.
- Todo lo que sale del navegador pasa por `anonymize`.
- Las claves de API no están en `Project`, en el respaldo ni en la sincronización.
- Ningún caché de modelos usa el prefijo `horarios-web-`.
- `src/ai/` se carga solo con `import()` dinámico y no entra al bundle inicial.
