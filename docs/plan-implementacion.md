# Plan de implementación

Fecha de referencia: 26 de noviembre de 2026. Base: `d7f5b306` (18 de noviembre).
Este archivo centraliza la planificación futura; [mejoras.md](mejoras.md), [revision-arquitectura.md](revision-arquitectura.md)
e [ia.md](ia.md) mantienen sus hallazgos, resultados y diseños históricos.

## Principios

- Mantener FET, WebAssembly, arquitectura local-first, AGPL y funcionamiento sin servidor de cálculo.
- No romper los proyectos existentes ni sus respaldos. Las migraciones se prueban cuando cambia el esquema.
- Validación y operaciones deterministas en el dominio; la IA, si se incorpora, solo interpreta o explica.
- No enviar datos académicos sin autorización explícita. Las pruebas no usan datos reales identificables.
- Una rama y PR por entrega; no integrar si CI falla. Cualquier cambio de configuración externa se revisa por separado.

## Fases

| Fase | Entrega | Estado |
|---|---|---|
| 0 | Saneamiento técnico y documentación | Completada (PR #13) |
| 1 | Seguridad y persistencia | Integrada (PR #14); pendiente la validación en el alojamiento |
| 2 | Diagnóstico avanzado de generación (F3) | Implementada en `fase-2/diagnostico-avanzado`, sin PR; espera el hotfix de Firebase |
| — | Hotfix: Firebase 13.4.0 con dependencias coherentes | Rama `hotfix/firebase-build` publicada; PR por abrir e integrar |
| 3 | Herramientas de uso diario (F13, F14) | Pendiente |
| 4 | Ampliación del modelo académico | Pendiente, según demanda |
| 5 | Asistencia opcional con IA | Pendiente, según resultados |

### Fase 0: saneamiento

- Actualizar documentación de CSP, precaché, deshacer y hoja de ruta.
- Centralizar la interpretación de claves de actividad en `parseActivityKey`.
- Generar nuevos IDs de 128 bits, sin cambiar los antiguos ni la versión del respaldo.
- Cierre: CI completa en verde y revisión del PR.

### Fase 1: seguridad y persistencia

- Configurar protección de main y comprobaciones obligatorias en GitHub.
- Reglas y adaptador de Firebase cubiertos por `npm run test:firestore`, incluido en CI con el emulador local.
- Guardado entre pestañas e historial con transacciones IndexedDB. Las pruebas cubren concurrencia, fallos de
  escritura y recuperación. Playwright abre dos pestañas y comprueba los horarios después de recargar.
- CSP compartida entre Vercel, vista previa y el build alternativo. Playwright verifica la generación.
  Pendiente en el alojamiento de validación: inicio de sesión con Google y correo, y sincronización entre dos navegadores.
- Cierre: pruebas de concurrencia, reglas y compatibilidad, CI en verde, revisión de configuración externa.

Verificación local del 26 de noviembre: lint, tipos y build correctos, 148 pruebas aprobadas en la suite general
y 3 con Auth y Firestore. Playwright pasó 48 casos en los cuatro perfiles. El cierre sigue pendiente de la CI remota,
la revisión de protección de rama y la validación en el alojamiento.

### Fase 2: diagnóstico avanzado (F3)

- `domain/diagnose.ts`: hallazgos deterministas sobre disponibilidad, carga, restricciones y fijados.
- `domain/relax.ts` y `store/relax.ts`: variantes independientes, cancelables, con presupuesto acotado y semilla fija.
- Mostrar solución encontrada, imposible según FET o intento sin resolver; nunca presentar timeout como demostración de imposibilidad.
- No alterar ni guardar el proyecto original al experimentar. El usuario confirma cualquier cambio.
- Cierre: pruebas unitarias, integración con FET, fixture difícil y E2E.

Implementado el 26 de noviembre:

- `domain/diagnose.ts` cuenta horas, bloques seguidos (⌊L/k⌋ por tramo libre), días con máximo de días y fijados,
  repartir en días (condición de Hall por duración), bloques permitidos, salas y el horario común de clases en
  paralelo y electivos. Lo demostrado es una condición necesaria incumplida; lo demás es hipótesis. Las pruebas
  comprueban que no hay hallazgos demostrados en el ejemplo, en el colegio sintético ni en los dos reales anonimizados.
- `domain/relax.ts` define 12 tipos de cambio cerrados; `store/relax.ts` los evalúa uno a la vez con la semilla
  20261126, 15 s por defecto (hasta 120 s al reintentar), máximo 12 variantes, un Worker por variante y `engineLock`
  compartido con la generación. Nada se guarda; aplicar pasa por `update()` tras confirmar y genera con la misma semilla.
- Con el motor: el colegio difícil, que agota el tiempo sin cambios, se resuelve en menos de 2 s al liberar sus 293
  fijados. Una franja sin horario común, que el motor solo agota, se demuestra imposible antes de generar.
- Verificación local: lint, tipos y build correctos; 173 pruebas aprobadas (7 omitidas); Playwright 53 aprobadas en
  los cuatro perfiles. `npm run test:firestore` no se ejecutó en local por falta de Java 21; queda a cargo de CI.

Estado al 26 de noviembre: los cinco commits están en `origin/fase-2/diagnostico-avanzado` (último `eb070c7`) y la
vista previa de Vercel compila. Falta: integrar `main` después del hotfix, volver a verificar, abrir el PR y medir el
tiempo por alternativa con los `.fet` reales.

### Hotfix de Firebase

El PR #12 de Dependabot (firebase 13.2.0 → 13.4.0 y otras ocho actualizaciones) no compila en Vercel:
`"_setTrustedScriptSrc" is not exported by "@firebase/app"`. `main` no está afectado. firebase 13.4.0 fija
`@firebase/app` 0.16.7, pero los demás módulos lo piden como dependencia par `0.x` y npm deja la 0.16.5 en la raíz.

- `hotfix/firebase-build` (desde `main`): firebase `^13.4.0` con `npm dedupe` (una sola `@firebase/app` 0.16.7) y
  `src/cloud/firebaseVersions.test.ts`, que falla si un lockfile vuelve a mezclar versiones.
- Verificación local: lint, tipos y build correctos; 149 pruebas aprobadas (7 omitidas); Playwright 48 aprobadas en los
  cuatro perfiles; `npm audit --omit=dev` sin vulnerabilidades. La vista previa de Vercel de la rama compila.
- Pendiente: abrir el PR, CI completa (incluido `test:firestore`), probar a mano el inicio de sesión y la
  sincronización en la vista previa, integrar y luego llevar `main` a la fase 2. Dependabot debería rehacer el PR #12.

### Fase 3: uso diario

- F13: consulta de profesores libres y búsqueda de movimientos válidos (relocate).
- F14: exportación individual y calendario ICS; definir fechas y zona horaria antes de implementar.
- Revisar navegación por teclado y lector de pantalla, además de axe.
- Cierre: casos reales anonimizados, pruebas de reglas y navegación accesible.

### Fase 4: modelo académico

- F8: reglas individuales; F12: emparejamiento explícito de paralelos.
- F7: codocencia; F9: actividades sin curso; F10: salas avanzadas; F11: continuidad de clases.
- Priorizar según demanda de colegios; cada cambio de esquema requiere migración, respaldos, importación/exportación FET, validación y ajuste manual.
- Cierre por funcionalidad: pruebas de migración, generación, ajuste manual e importación.

### Fase 5: asistencia con IA

- Reutilizar las funciones deterministas de fases 2 y 3.
- Implementar primero Puente con anonimización, vista previa y respuestas estructuradas validadas.
- Luego parches de lenguaje natural y recetas de planillas; evaluar claves propias y modelos locales solo si hay demanda.
- Confirmar condiciones, costos y privacidad de proveedores antes de activarlos; nunca prometer disponibilidad gratuita permanente.
- Cierre: pruebas de anonimización y operaciones, proveedores simulados en CI, consentimiento y funcionamiento sin IA.

## Verificación de cada entrega

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run test:firestore  # requiere Java 21
npm run build
npx playwright install
npm run e2e
```

El workflow de CI realiza lint, pruebas de dominio y persistencia, integración con los emuladores de Auth y Firestore,
build y Playwright en Chromium, Firefox, WebKit y móvil.
La fase 0 no requiere cambios en el esquema. F4 (múltiples semillas) permanece diferida hasta tener evidencia de beneficio.
Las estimaciones se revisan al comenzar cada fase; no son compromisos de calendario.
