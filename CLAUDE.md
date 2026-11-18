# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Generador de horarios escolares para colegios chilenos que corre completo en el navegador: React + zustand, con el
motor de FET 7.12 compilado a WebAssembly en un Web Worker. No hay servidor de cálculo. La cuenta con Firebase es
opcional. El código, los comentarios, los commits y todos los textos de la interfaz están en español.

Antes de cambios de fondo, lee [docs/arquitectura.md](docs/arquitectura.md). Ahí están las reglas que hay que mantener
en persistencia, sincronización y ajuste manual, y la receta paso a paso para agregar una regla.
[docs/mejoras.md](docs/mejoras.md) tiene los errores y propuestas con identificadores (E6, F1, T5…). Cuando corrijas uno,
márcalo ahí.

## Comandos

```bash
npm run dev                 # http://localhost:5173
npm run check               # lint + pruebas + build (lo mismo que el primer trabajo de CI)
npm test                    # vitest run: dominio + generación real con el motor en Node
npx vitest run src/domain/manual.integration.test.ts   # un archivo
npx vitest run -t "texto del test"                     # por nombre
npm run lint                # oxlint src
npm run typecheck           # tsc -b
npm run build && npm run e2e:chromium                  # e2e corre sobre dist/, no sobre el servidor de desarrollo
npx playwright test --project=chromium -g "nombre"     # un e2e
LARGE=1 npx vitest run src/domain/large.test.ts        # medición: colegio sintético y dos reales anonimizados
PERF=1 npx playwright test e2e/rendimiento.spec.ts --project=chromium   # ajuste manual en el navegador (tras build)
bash engine/build-engine.sh # recompilar el motor (Qt 6.11.3 wasm + Emscripten 4.0.7, ~15 min)
```

- Las pruebas de integración se saltan solas si falta `public/engine/fet-cl.wasm`.
- Las pruebas e2e **siempre usan `dist/`**: vuelve a hacer el build después de cada cambio. Vite preview corre en el puerto 4173.
- CI (`.github/workflows/ci.yml`) corre lint, pruebas y build, y después Playwright en chromium, firefox, webkit y movil.
  Vercel publica `main` solo si pasan esos trabajos, y los identifica **por nombre**: si renombras uno en `ci.yml`, hay
  que actualizar los Deployment Checks en el panel de Vercel.

## Arquitectura

```
pages/, ui/ (React) ──> store/ (zustand + IndexedDB) ──> engine/ (Worker) ──> public/engine/fet-cl.wasm
        └────────────> domain/ (lógica pura) <─┘   └──> cloud/ (sincronización) ──> Firebase (opcional)
```

- **`src/domain/` no importa React** y se prueba en Node. Toda la lógica va ahí: modelo y migración (`types.ts`),
  revisión previa (`validate.ts`), proyecto → `.fet` (`fetExport.ts`), salida de FET → horario (`fetResult.ts`),
  `.fet` → proyecto (`fetImport.ts`), ajuste manual sin motor (`manual.ts`) y respaldos (`backup.ts`).
- **Unidades** (`units.ts`): la carga académica y las opciones de electivos se unifican como `Unit`. Una franja de
  electivos es una *división sintética* del curso. Para razonar sobre alumnos usa `effectiveDivisions` y
  `courseStudentSets`, nunca `course.divisions` directamente.
- **Claves**: tramo `${día}:${idTramo}`, actividad `${idUnidad}#${índiceBloque}`. Los fijados (`locks`) y las
  ubicaciones se guardan por clave de actividad.
- **FET usa nombres como identificadores.** `exportFet` genera nombres únicos y devuelve los mapas de vuelta, que solo
  valen para esa exportación. "Obligatoria" = peso 100 % y "preferible" = 95 %. No todas las restricciones admiten
  menos de 100 %: compruébalo con el motor antes de ofrecer "preferible".
- **Generación**: un Worker por generación ("Detener" lo termina). El estado vive en `store/generation.ts`, fuera de
  las pantallas. El motor es una caja negra: los parches a FET (`engine/`) se limitan a la línea de progreso y a
  ajustes de compilación.
- **Navegación por hash** en `App.tsx`. Hay una página por paso en `src/pages/`.

### Invariantes que es fácil romper

- Toda edición del proyecto pasa por `update()` en `store/projects.ts`, que trabaja sobre una copia, ejecuta
  `migrateProject` y guarda. Usa `touch: false` en lo que no cambia los datos del colegio (fijar, mover, liberar), para
  no marcar el horario como desactualizado.
- `migrateProject` limpia lo huérfano, también los fijados (`locks`) de bloques o lugares que ya no existen. Lo que sigue
  existiendo pero cambia de sentido (duración de los bloques, grupo de una fila) lo libera la pantalla que lo cambia.
- Al agregar un campo al modelo: pon su valor por defecto en `migrateProject` y su revisión en `checkProject`
  (`backup.ts`). Si hay que transformar datos, sube `version` en `projects.ts` y `BACKUP_VERSION`.
- Un proyecto del almacén nunca se modifica en su lugar: `projectHash` (sincronización) lo guarda por objeto, y
  deshacer (`undo`) guarda los objetos anterior y nuevo de cada `update()`. Lo que cambia fuera de `update()` no se deshace.
- La CSP está en `vercel.json` (una para la página y otra para `/engine/`), y `vite preview` la replica. Al agregar un
  dominio externo, agrégalo ahí. Si cambias la política, avisa que hay que probar a mano el inicio de sesión con Firebase.
- `src/domain/fixtures/` tiene colegios reales anonimizados. No agregues nombres reales de personas ni de colegios.
- Sincronización (`cloud/engine.ts`, sin Firebase ni React, probada con una nube en memoria): nada se sube antes de
  conocer la nube confirmada por el servidor, no se sincroniza si falló la lectura local, los eliminados quedan con
  `data: null` y solo una pestaña sincroniza (`navigator.locks`). `cloud/firebase.ts` es el único archivo que toca
  Firebase, y el SDK se carga con `import()` dinámico.
- La seguridad está en `firestore.rules`, que no tiene pruebas automáticas (los emuladores necesitan Java). Si cambias
  las reglas o `firebase.ts`, avisa que hay que repetir a mano el flujo con dos navegadores.
- Los mensajes al usuario deben indicar qué hacer y no usar términos de FET. Las expresiones que leen la salida del
  motor deben aceptar inglés y español.

### Pruebas e2e

- Fijan `Math.random` para que la semilla, y por lo tanto el horario, sea siempre la misma.
- Si no encuentran lo que buscan, deben fallar, no saltarse la comprobación.
- La grilla interactiva se selecciona con `.card td.lesson`, porque la página también tiene una copia oculta para imprimir.
- `count()` no espera: antes de contar, espera a que aparezca el primer elemento.

## Otros

- Firebase: proyecto `horarios-web-ff`, Firestore en `southamerica-west1`, plan Spark (no usar Cloud Storage). Si la
  base no existe, `firebase deploy --only firestore:rules` la crea en Estados Unidos.
- Sin las variables `VITE_FIREBASE_*` (ver `.env.example`), la app funciona solo en el navegador y no ofrece cuenta.
- Licencia AGPL-3.0, igual que FET.
- Al agregar una regla, actualiza la tabla "Cómo se traduce a FET" del README.
