# Horarios Web

Generador de horarios escolares que funciona completamente en el navegador. El usuario ingresa la jornada,
los cursos, las asignaturas, los profesores y la carga académica; el horario se calcula en su propio computador
con el motor de [FET](https://lalescu.ro/liviu/fet/) compilado a WebAssembly. No hay servidor de cálculo. Sin
cuenta, los datos del colegio no salen del navegador; con una cuenta opcional, se respaldan en la nube.

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
   profesores, bloques permitidos por asignatura. Repartir en días y bloques permitidos pueden ser obligatorios o
   preferibles; las demás reglas son siempre obligatorias.
6. **Generar**: revisión previa con errores y avisos claros, cálculo con progreso, y explicación del problema
   (con los mensajes de FET en español) cuando el horario no es posible.
7. **Ver y ajustar**: vistas por curso, profesor y sala; mover bloques (clic o arrastrar) sin crear choques;
   fijar bloques y regenerar el resto; imprimir; exportar a Excel, CSV y `.fet` (para FET de escritorio).
8. **Respaldos**: descarga e importación de `.json`, con recordatorio si hay cambios sin respaldar.
9. **Partir desde FET**: importa un archivo `.fet` de FET de escritorio (versión 5 en adelante) y muestra un informe
   de lo que se traspasó y lo que no.
10. **Cuenta opcional**: con correo y contraseña, los horarios se sincronizan entre equipos y sobreviven a borrar los
    datos del navegador.

## Documentación

- [Guía de uso](docs/guia-de-uso.md): para quienes arman el horario de un colegio.
- [Arquitectura](docs/arquitectura.md): cómo funciona por dentro, para quien modifica el código.
- [Análisis de mejoras](docs/mejoras.md): errores detectados, propuestas y hoja de ruta.
- [Motor de generación](engine/README.md): cómo se compila FET a WebAssembly.

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
    fetImport.ts     XML .fet → Project, con informe de lo que no se pudo traspasar
  engine/            Argumentos de fet-cl y Web Worker
  cloud/             Sincronización con la nube (engine.ts) y único contacto con Firebase (firebase.ts)
  store/             Estado (zustand) guardado en IndexedDB, cuenta, salud del almacenamiento, service worker
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

### Importar desde FET

En "Importar respaldo o archivo FET…": se crea un horario nuevo con la jornada, los cursos, los grupos, las
asignaturas, los profesores, su disponibilidad, las salas, la carga y las reglas que tienen equivalente en la app.

- Las actividades fijadas al 100 % en FET quedan como bloques fijados; el resto lo ubica el motor al generar.
- Si el archivo no declara recreos (`ConstraintBreakTimes`), se deducen de los horarios de las horas: un hueco de
  5 minutos o más es un recreo y uno de 30 o más, almuerzo, salvo que un bloque fijado lo cruce. Las horas deben llevar su horario en el nombre o el nombre largo.
- La app no tiene actividades sin curso ni clases con varios profesores: si están fijadas, ocupan al profesor como
  "no disponible" (la clase queda con el primero); si no están fijadas, las sin curso se omiten.
- Las restricciones sin equivalente (actividades seguidas, fin del día, sala por curso y otras) no se traspasan.
  El informe, que se puede descargar, las cuenta por tipo.

## Publicar gratis

El resultado de `npm run build` es un sitio estático (`dist/`). Los horarios se calculan en el navegador de
cada colegio, así que el hosting solo entrega archivos: aunque la app se use en muchos colegios, no hay costo
de servidor.

### Vercel

El proyecto ya está conectado a este repositorio: cada `push` a `main` publica en producción y cada rama genera una
vista previa. Vercel detecta Vite solo y [`vercel.json`](vercel.json) define el caché. Su plan Hobby es solo para uso
personal y no comercial.

### Cuentas con Firebase (opcional)

Sin esta configuración, la app funciona solo en el navegador y no muestra la opción de cuenta. El sitio oficial usa el
proyecto `horarios-web-ff`. Para activarla en otro proyecto:

1. **Crear la app web:** `npx firebase-tools apps:create WEB horarios-web --project <id>`. Copia lo que entrega
   `apps:sdkconfig` a las variables de [`.env.example`](.env.example), en Vercel o en `.env.local`, y vuelve a publicar.
2. **Crear la base de datos:**
   `npx firebase-tools firestore:databases:create "(default)" --location southamerica-west1 --project <id>`. **Hazlo
   antes del paso siguiente:** si no existe, publicar las reglas la crea en Estados Unidos, y la ubicación no se puede
   cambiar después.
3. **Publicar las reglas y activar el acceso con correo:**
   `npx firebase-tools deploy --only firestore:rules,auth --project <id>`. Sin las reglas, nadie puede sincronizar.

Mantén el proyecto en el plan **Spark**: al agotarse la cuota gratuita, las operaciones se rechazan en vez de generar
cobros, y la app sigue guardando en el navegador. No uses Cloud Storage, que exige el plan de pago. Las cuentas usan
contraseña y no enlace por correo porque el plan Spark solo permite 5 de esos correos al día en todo el proyecto.

### Cloudflare Pages (alternativa, sin límite de ancho de banda)

Conecta el repositorio en Cloudflare Pages con: comando `npm run build`, carpeta `dist`, variable
`NODE_VERSION=22`. El pie de página enlaza al repositorio indicado en `package.json`; si publicas una copia
modificada, define `VITE_SOURCE_URL=https://github.com/<usuario>/<repositorio>` para que enlace a tu código. El archivo
`public/_headers` ya define el caché.

## Datos y privacidad

Todo se guarda en IndexedDB del navegador; la app pide al navegador guardarlo de forma persistente. No usa
cookies ni analítica. Desde "Cambiar de horario" se descarga un respaldo `.json` (uno o todos los
horarios) que se puede importar en otro equipo. Si la app está abierta en dos pestañas, la segunda se
actualiza con los cambios de la primera.

**Sin cuenta**, la app no carga Firebase ni envía los datos a ningún servidor. **Con una cuenta**, el correo y los
horarios, con los nombres de los profesores, se guardan en Firebase (Google). Firebase Authentication procesa sus datos
en Estados Unidos, y quien administra el proyecto de Firebase puede leer los horarios desde la consola. Quien publique
una instancia con cuentas es responsable de cumplir la normativa de datos personales que le aplique, como la Ley 21.719
en Chile.

## Licencia

GNU AGPL v3 o posterior, la misma de FET, cuyo motor se incluye en `public/engine/`. Ver `LICENSE` y
`engine/README.md`. Si publicas una versión modificada, debes ofrecer su código fuente a quienes la usen: el pie
de la app enlaza automáticamente a `VITE_SOURCE_URL` o, si no está definida, al repositorio de `package.json`.
