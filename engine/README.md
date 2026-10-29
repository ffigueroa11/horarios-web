# Motor de generación (FET en WebAssembly)

La aplicación usa el motor de **FET 7.12.0** (Liviu Lalescu y Volker Dirr, https://lalescu.ro/liviu/fet/),
compilado a WebAssembly. Corre en un Web Worker dentro del navegador.

| Archivo | Qué es |
|---|---|
| `public/engine/fet-cl.wasm` | Motor compilado (~7,4 MB; ~1,6 MB comprimido con gzip) |
| `public/engine/fet-cl.js` | Código de arranque generado por Emscripten |
| `public/engine/fet-worker.js` | Web Worker que ejecuta el motor y devuelve los resultados |
| `public/engine/fet_es.qm` | Traducción oficial de FET al español (mensajes de error del motor) |
| `engine/fet-web-progress.patch` | Cambio a FET: línea de progreso para la barra de la app |
| `engine/split-randomswap.py` | Parte la función central de búsqueda en funciones más pequeñas |
| `engine/build-engine.sh` | Script para recompilar el motor desde cero |

## Recompilar

```bash
bash engine/build-engine.sh
```

Versiones: Qt 6.11.3 (wasm_singlethread) y Emscripten 4.0.7. Toma ~15 minutos y ~2,5 GB de RAM.

## Memoria en el navegador

Chrome y Edge optimizan en segundo plano las funciones WebAssembly que más se usan (compilador TurboFan).
La memoria que necesita esa optimización crece mucho más rápido que el tamaño de la función, y FET tenía
funciones enormes. Medido en Chromium generando un horario de 439 actividades:

| | Pico de memoria del proceso | Generación | Tamaño (gzip) |
|---|---|---|---|
| Compilación directa de FET | ~600 MB | ~6,4 s | 2,1 MB |
| Con los tres ajustes | **~220 MB** | **~5,0 s** | **1,6 MB** |

Los tres ajustes:

1. **`split-randomswap.py`**: `Generate::randomSwap` (~30.000 líneas, 409 KB compilada) es una secuencia de
   secciones, una por tipo de restricción. Cada sección grande pasa a una lambda `noinline` que captura todo
   por referencia; su `goto impossibleX` se vuelve `return`. Optimizarla costaba ~460 MB y ~5 s.
2. **`-fno-inline-functions` fuera de `generate.cpp`**: leer el archivo, preparar las restricciones y
   escribir los resultados corre una sola vez, pero el compilador fusionaba decenas de funciones en una
   (`writeGenerationResultsCommandLine` llegaba a 924 KB).
3. **Binaryen con `--one-caller-inline-max-function-size=300`**: por defecto, el optimizador de WebAssembly
   fusiona toda función llamada desde un solo lugar, sin límite de tamaño.

## Verificación

Ninguno de los cambios altera el algoritmo. Con las mismas semillas, la versión modificada produjo
exactamente el mismo horario (archivo de actividades idéntico byte a byte) que FET original en los
110 ejemplos oficiales de FET que se resuelven en menos de 5 segundos. La app incluye además pruebas que
generan horarios reales con el motor (`npm test`).

## Licencia

FET se distribuye bajo GNU AGPL v3 o posterior. Como esta aplicación incluye y distribuye el motor,
todo el proyecto se publica bajo la misma licencia (ver `LICENSE` en la raíz).
