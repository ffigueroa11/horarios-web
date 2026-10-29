# Horarios Web

Generador de horarios escolares que funciona completamente en el navegador. El usuario ingresa la jornada,
los cursos, las asignaturas, los profesores y la carga académica; el horario se calcula en su propio computador
con el motor de [FET](https://lalescu.ro/liviu/fet/) compilado a WebAssembly. No hay servidor de cálculo ni
cuentas, y los datos del colegio no salen del navegador.

- Gratis y de código abierto (AGPL v3, igual que FET).
- Sin instalación: un sitio estático. Después de la primera visita funciona también sin conexión.
- Pensado para colegios chilenos: cursos con divisiones, electivos entre cursos, jornada con recreos y almuerzo.

## Qué se puede hacer

1. **Jornada**: días, bloques con horario real, recreos, almuerzo y tramos sin clases (ej. viernes corto).
2. **Cursos** con divisiones (Inglés por nivel, curso en dos grupos), **asignaturas y salas**, **profesores**
   con disponibilidad, horas de contrato y máximo de días.
3. **Carga académica**: curso (o grupo) × asignatura → profesor y bloques (`2+2+2`). Se puede importar desde Excel.
4. **Electivos**: franjas que juntan alumnos de varios cursos (ej. 3° y 4° Medio) en opciones a la misma hora.
5. **Preferencias**: sin horas libres para los cursos, empezar en el primer bloque, repartir asignaturas en días
   distintos, ventanas y horas diarias máximas de profesores, horas diarias máximas de cursos, consejo de
   profesores, bloques permitidos por asignatura. Cada regla puede ser obligatoria o preferible.
6. **Generar**: revisión previa con errores y avisos claros, cálculo con progreso, y explicación del problema
   (con los mensajes de FET en español) cuando el horario no es posible.
7. **Ver y ajustar**: vistas por curso, profesor y sala; mover bloques (clic o arrastrar) sin crear choques;
   fijar bloques y regenerar el resto; imprimir; exportar a Excel, CSV y `.fet` (para FET de escritorio).
8. **Respaldos**: descarga e importación de `.json`, con recordatorio si hay cambios sin respaldar.

## Desarrollo

Requisitos: Node.js 20.19+ o 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas de dominio y generación real con el motor (en Node) |
| `npm run lint` | Revisión de código (oxlint) |
| `npm run build` | Revisa tipos y genera `dist/` (sitio estático) |
| `npm run preview` | Sirve `dist/` en http://localhost:4173 |
| `npm run e2e` | Pruebas en navegadores reales (Chromium, Firefox, WebKit y móvil) sobre `dist/` |
| `npm run check` | lint + pruebas + build |

Para las pruebas de navegador hay que instalar los navegadores una vez: `npx playwright install`.
Con `LARGE=1 npx vitest run src/domain/large.test.ts` se mide un colegio grande sintético.

### Cómo está organizado

```
src/
  domain/            Lógica pura, sin React (probada con vitest)
    types.ts         Modelo de datos y migración de versiones anteriores
    units.ts         "Unidades de clase": carga académica y opciones de electivos con la misma forma
    defaults.ts      Proyecto vacío y "Liceo de ejemplo"
    validate.ts      Revisión previa: errores y avisos antes de generar
    fetExport.ts     Proyecto → XML .fet (nombres únicos, restricciones FET)
    fetResult.ts     Salida de FET → ubicaciones; mensajes en español
    manual.ts        Mover bloques a mano sin choques
    backup.ts        Respaldos .json con validación
    importCarga.ts   Importar la carga desde Excel/CSV/texto pegado
  engine/            Argumentos de fet-cl y Web Worker
  store/             Estado (zustand) guardado en IndexedDB, salud del almacenamiento, service worker
  pages/             Una pantalla por paso del flujo
  ui/                Componentes compartidos, exportación a Excel, respaldos
public/engine/       Motor FET en WebAssembly + Worker + traducción al español
public/sw.js         Service worker (uso sin conexión, aviso de versión nueva)
engine/              Parches a FET y script para recompilar el motor (ver engine/README.md)
e2e/                 Pruebas de navegador (Playwright)
```

### Cómo se traduce a FET

| En la app | En FET |
|---|---|
| Curso | Year |
| División del curso / franja de electivos | Groups en cada curso; con dos o más, un Subgroup por combinación |
| Opción de una franja de electivos | Activity con un `<Students>` por cada curso participante |
| División "en paralelo" / opciones de una franja | ConstraintActivitiesSameStartingTime, bloque por bloque |
| Bloque de la carga académica | Activity (las de una misma asignación forman un grupo) |
| Recreo, almuerzo, tramo sin clases | ConstraintBreakTimes |
| No disponible, consejo de profesores / máx. días | ConstraintTeacherNotAvailableTimes / ConstraintTeacherMaxDaysPerWeek |
| Repartir en días distintos | ConstraintMinDaysBetweenActivities |
| Ventanas de profesores | ConstraintTeachersMaxGapsPerDay / PerWeek |
| Horas diarias máximas | ConstraintTeachersMaxHoursDaily / ConstraintStudentsMaxHoursDaily |
| Cursos sin horas libres / empezar en el 1° bloque | ConstraintStudentsMaxGapsPerWeek = 0 / ConstraintStudentsEarlyMaxBeginningsAtSecondHour = 0 |
| Bloques permitidos por asignatura | ConstraintActivitiesPreferredTimeSlots |
| Sala especial | ConstraintSubjectPreferredRoom |
| Bloque fijado o movido a mano | ConstraintActivityPreferredStartingTime |

"Obligatoria" se exporta con peso 100 % y "preferible" con 95 %.

### Importar desde Excel

En "Carga académica" › "Importar desde Excel": archivo `.xlsx`, `.csv` o celdas pegadas. Columnas Curso,
Asignatura, Profesor, Horas (`6` o `2+2+2`) y Grupo (opcional). Crea los cursos, asignaturas y profesores que
falten y muestra los errores por fila antes de importar. Hay una plantilla descargable.

## Publicar gratis

El resultado de `npm run build` es un sitio estático (`dist/`). Los horarios se calculan en el navegador de
cada colegio, así que el hosting solo entrega archivos: aunque la app se use en muchos colegios, no hay costo
de servidor.

### GitHub Pages (incluido)

1. Sube el repositorio a GitHub.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada `push` a `main` corre las pruebas y publica en `https://<usuario>.github.io/<repositorio>/`.

La ruta base se calcula sola a partir del nombre del repositorio. Con un dominio propio, crea la variable de
repositorio `BASE_PATH` con el valor `/` (Settings → Secrets and variables → Actions → Variables).

### Cloudflare Pages (alternativa, sin límite de ancho de banda)

Conecta el repositorio en Cloudflare Pages con: comando `npm run build`, carpeta `dist`, variable
`NODE_VERSION=22`. Para que el pie de página enlace al código fuente, agrega la variable
`VITE_SOURCE_URL=https://github.com/<usuario>/<repositorio>`. El archivo `public/_headers` ya define el caché.

## Datos y privacidad

Todo se guarda en IndexedDB del navegador; la app pide al navegador guardarlo de forma persistente. No usa
cookies, cuentas ni analítica. Desde "Cambiar de horario" se descarga un respaldo `.json` (uno o todos los
horarios) que se puede importar en otro equipo. Si la app está abierta en dos pestañas, la segunda se
actualiza con los cambios de la primera.

## Licencia

GNU AGPL v3 o posterior, la misma de FET, cuyo motor se incluye en `public/engine/`. Ver `LICENSE` y
`engine/README.md`. Si publicas una versión modificada, debes ofrecer su código fuente a quienes la usen: el pie
de la app enlaza al repositorio automáticamente cuando se compila en GitHub Actions.
