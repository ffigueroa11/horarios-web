---
name: verificar
description: Verifica un cambio de horarios-web igual que CI antes de darlo por terminado - lint, tipos, pruebas con el motor, build y pruebas de navegador. Úsala antes de decir que algo está listo o de hacer commit.
---

# Verificar un cambio

Reproduce los trabajos de CI (`.github/workflows/ci.yml`), de los que depende que Vercel publique `main`.

## Pasos

1. **Lint, pruebas y build:** `npm run check` (oxlint → vitest → `tsc -b && vite build`). Detente en el primer fallo
   y corrígelo antes de seguir.
   - Comprueba en la salida de vitest que las pruebas de `fet.integration.test.ts` y `manual.integration.test.ts`
     **corrieron**: se saltan solas si falta `public/engine/fet-cl.wasm`, y entonces la generación real no se probó.
2. **Navegador:** `npm run e2e:chromium`. Corre sobre el `dist/` que dejó el paso 1, por eso va después.
   - Si cambiaste algo sensible al navegador (arrastrar bloques, impresión, IndexedDB, service worker, diseño móvil),
     corre también `npx playwright test --project=webkit --project=firefox --project=movil`.
   - Un fallo intermitente no se arregla con `retries` ni aumentando timeouts a ciegas: busca la carrera (ver la sección
     de pruebas e2e en `CLAUDE.md`).
3. **Si tocaste rendimiento** del dominio o la exportación: `LARGE=1 npx vitest run src/domain/large.test.ts` y compara
   con la medición anterior.
4. **Si tocaste `firestore.rules` o `src/cloud/firebase.ts`:** no hay prueba automática. Indícalo en el resumen: falta
   la prueba manual con dos navegadores.

## Resumen

Informa qué se corrió y su resultado real (número de pruebas pasadas, saltadas y fallidas). Si algo se saltó o falló,
dilo con la salida; no lo des por verificado.
