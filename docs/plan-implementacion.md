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
| 0 | Saneamiento técnico y documentación | En revisión |
| 1 | Seguridad y persistencia | Pendiente |
| 2 | Diagnóstico avanzado de generación (F3) | Pendiente |
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
- Probar las reglas y el adaptador de Firebase con emuladores; incluir acceso cruzado, correo no verificado, revisiones y eliminación.
- Prevenir sobrescrituras entre pestañas, incluidas las del historial de versiones; probar fallos de escritura y recuperación.
- Homologar la CSP de despliegues alternativos y verificar autenticación y generación.
- Cierre: pruebas de concurrencia, reglas y compatibilidad, CI en verde, revisión de configuración externa.

### Fase 2: diagnóstico avanzado (F3)

- `domain/diagnose.ts`: hallazgos deterministas sobre disponibilidad, carga, restricciones y fijados.
- `domain/relax.ts` y `store/relax.ts`: variantes independientes, cancelables, con presupuesto acotado y semilla fija.
- Mostrar solución encontrada, imposible según FET o intento sin resolver; nunca presentar timeout como demostración de imposibilidad.
- No alterar ni guardar el proyecto original al experimentar. El usuario confirma cualquier cambio.
- Cierre: pruebas unitarias, integración con FET, fixture difícil y E2E.

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
npm run build
npx playwright install
npm run e2e
```

El workflow de CI realiza lint, pruebas, build y Playwright en Chromium, Firefox, WebKit y móvil.
La fase 0 no requiere cambios en el esquema. F4 (múltiples semillas) permanece diferida hasta tener evidencia de beneficio.
Las estimaciones se revisan al comenzar cada fase; no son compromisos de calendario.
