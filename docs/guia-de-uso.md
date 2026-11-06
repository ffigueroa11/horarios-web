# Guía de uso

Para quienes arman el horario de un colegio. No necesitas conocimientos técnicos ni instalar nada: basta un navegador
actualizado en un computador.

> **Importante:** sin una cuenta, tus datos se guardan solo en el navegador que estás usando. Si borras los datos de
> navegación o cambias de computador, no estarán ahí. **Descarga un respaldo cada vez que avances bastante**, o usa una
> [cuenta](#cuenta-opcional), si este sitio la ofrece.

## Antes de empezar

Conviene tener a mano:

- El horario de la jornada: bloques, recreos y almuerzo.
- La lista de cursos y sus divisiones, si las hay (por ejemplo, Inglés por nivel).
- Qué profesor dicta cada asignatura en cada curso, y cuántas horas tiene.
- Cuándo no puede venir cada profesor.

Para conocer la aplicación sin ingresar nada, elige **Probar con un liceo de ejemplo**.

## Paso a paso

### 1. Jornada

Define el nombre del horario, el colegio, el año y si hay clases de lunes a viernes o de lunes a sábado.

- **Bloques del día:** cada tramo tiene nombre, horario y tipo (Clase, Recreo o Almuerzo). Una clase de 2 horas nunca
  queda cortada por un recreo.
- **Tramos sin clases:** haz clic en los bloques que no se usan en un día específico, como la tarde del viernes.

### 2. Cursos

Elige el nivel y escribe las letras (`A, B, C`) para crear varios cursos de una vez.

Una **división** separa a los alumnos de un curso para algunas asignaturas. Cada alumno queda en un grupo de cada
división. Si marcas **Clases de los grupos en paralelo**, sus clases van a la misma hora. Se emparejan según el orden de
la carga: la primera asignatura de un grupo con la primera del otro, y así sucesivamente, por lo que deben tener los
mismos bloques.

> Eliminar un curso también elimina su carga, y no se puede deshacer. La app pide confirmar e indica cuántas clases se
> pierden. Descarga un respaldo antes de hacer cambios grandes.

### 3. Asignaturas y salas

**Agregar asignaturas comunes** crea las habituales de una vez. Cada asignatura tiene color y sigla, que se ven en el
horario.

Registra solo las **salas especiales**, las que se comparten entre cursos, como el gimnasio o un laboratorio. Una sala
indicada en una asignatura evita que dos cursos la usen al mismo tiempo.

> Eliminar una asignatura también la quita de la carga de todos los cursos y de los electivos. La app pide confirmar y
> no se puede deshacer.

### 4. Profesores

Para cada docente:

- **Horas de contrato:** solo sirven para avisar sobrecarga; no limitan el horario.
- **Máximo de días por semana:** sí limita el horario.
- **Disponibilidad:** haz clic en los bloques en que **no** puede hacer clases, o en el nombre del día para marcarlo
  completo.

Marca solo lo que de verdad es una restricción: cuanta menos disponibilidad haya, más difícil es encontrar un horario.

### 5. Carga académica

Para cada curso, indica la asignatura, el profesor y los bloques. Los bloques se escriben como sumas:

| Escribes | Significa |
|---|---|
| `2+2+2` | 6 horas en tres clases de 2 horas |
| `3+1` | 4 horas: una clase de 3 y una de 1 |
| `1` | Una hora suelta |

Para ahorrar tiempo:

- **Copiar carga desde…** trae la carga de otro curso del mismo nivel.
- **Importar desde Excel** acepta un `.xlsx`, un `.csv` o celdas pegadas, y hay una plantilla descargable. Las columnas
  son Curso, Asignatura, Profesor, Horas (`6` o `2+2+2`) y Grupo (opcional). Crea lo que falte y muestra los errores por
  fila antes de importar.

### 6. Electivos

Una **franja** reúne alumnos de varios cursos en opciones que se dictan a la misma hora, como el plan diferenciado de
3° y 4° Medio. Elige los cursos, los bloques y las opciones, cada una con su asignatura y su profesor.

Un mismo profesor no puede dictar dos opciones de una franja, porque van a la misma hora. Tampoco pueden usar la misma
sala especial.

Si los electivos son de un solo curso, también puedes usar una división.

### 7. Preferencias

| Regla | ¿Se puede dejar como preferible? |
|---|---|
| Repartir cada asignatura en días distintos | Sí |
| Bloques permitidos por asignatura | Sí |
| Cursos sin horas libres entre clases | No |
| Todos los días empiezan en el primer bloque | No |
| Máximo de horas diarias de cursos y profesores | No |
| Máximo de ventanas de profesores | No |
| Consejo de profesores | No: esos bloques siempre quedan reservados |

- **Obligatoria:** se cumple siempre. Si no se puede cumplir, no habrá horario.
- **Preferible:** se cumple en lo posible.

Una **ventana** es una hora libre de un profesor entre dos clases del mismo día. Limitarlas mucho hace bastante más
difícil encontrar un horario: **empieza con límites holgados y ajústalos después.**

### 8. Generar

La app revisa los datos y separa lo que hay que **corregir**, que impide generar, de los **avisos**, que no lo impiden.
Cada problema incluye un enlace al paso correspondiente.

Elige el tiempo máximo y presiona **Generar horario**. El cálculo se hace en tu computador y puedes seguir navegando
mientras avanza.

Si alguna regla preferible no se cumplió, el resultado lo dice y lista qué clases quedaron con más de un bloque el mismo
día o fuera de los bloques permitidos. El horario es válido igual.

### 9. Ver y ajustar

Mira el horario por curso, profesor o sala.

- **Mover:** haz clic en un bloque y luego en un lugar en verde, o arrástralo.
- **Intercambiar:** suéltalo sobre un bloque con borde verde.
- **Fijar 📌:** el bloque se mantiene en su lugar al generar de nuevo. Todo bloque que mueves queda fijado.
- **Lugar no válido:** al pasar el mouse o hacer clic, la app explica el motivo.

Los movimientos respetan los choques y las reglas obligatorias, pero no impiden incumplir las preferibles: las que no se
cumplen aparecen en un aviso sobre el horario, que se actualiza al mover bloques. Las clases en paralelo se mueven juntas.

**Una buena forma de trabajar:** genera, fija lo que te gusta o lo que debe quedar en un lugar, y genera de nuevo. Los
bloques fijados se mantienen y el resto se reorganiza.

### 10. Imprimir y exportar

| Opción | Resultado |
|---|---|
| **Imprimir** | El horario que estás viendo |
| **Imprimir todos** | Todos los de la vista actual (cursos, profesores o salas) |
| **Excel** | Un listado y una hoja por curso y por profesor |
| **CSV** | El listado, para otras planillas |
| **Archivo .fet** | Los datos para abrir en FET de escritorio |

## Cuando no se puede generar

### "Con estas reglas el horario es imposible" o "No se encontró un horario en el tiempo máximo"

Prueba en este orden, y genera después de cada cambio:

1. **Vuelve a intentar.** Cada intento sigue un camino distinto.
2. **Aumenta el tiempo máximo.**
3. **Libera bloques fijados** que no sean indispensables.
4. **Relaja lo más exigente:** sube el máximo de ventanas o quita temporalmente "sin horas libres" o "empezar en el
   primer bloque".
5. **Revisa a los profesores más cargados:** compara sus horas asignadas con sus bloques disponibles, y revisa su máximo
   de días.
6. **Revisa las salas especiales** muy usadas, los bloques permitidos y las clases largas.
7. **Revisa franjas y clases en paralelo:** todas sus opciones deben caber a la misma hora.

Ayuda quitar reglas una a una para descubrir cuál lo impide, y luego volver a ponerlas. Para probar sin riesgo, usa
**Duplicar** en la lista de horarios.

El mensaje indica qué bloque no se pudo ubicar y cuántos se alcanzaron a ubicar. Empieza revisando ese bloque: su profesor,
su curso y sus reglas.

Debajo aparece **Hasta dónde se llegó**, cuando el motor deja un intento: la lista de bloques sin ubicar y la grilla de
cada curso o profesor con lo que alcanzó a ubicarse. Sirve para ver dónde falta espacio, pero es solo de consulta: no se
guarda ni reemplaza tu horario actual, y desaparece si cambias los datos.

### "El motor encontró un problema en los datos antes de empezar"

El mensaje viene de FET y usa los nombres de tus cursos, profesores y asignaturas. Si menciona un bloque fijado, puedes
liberarlo con un botón.

### "Los datos cambiaron después de generar este horario"

El horario se generó antes de tu último cambio. Genera de nuevo para actualizarlo.

## Respaldos y cambio de computador

Desde **Inicio**, en el menú lateral, puedes descargar un respaldo de un horario o de todos. La app te avisa si llevas más de una
semana con cambios sin respaldar.

**Para pasar a otro computador:** descarga el respaldo, llévalo y usa **Importar respaldo o archivo FET…**.

**Para el año siguiente:** usa **Duplicar**, ajusta los datos y genera de nuevo.

**Trabaja en una sola pestaña.** Si abres la app en dos, la segunda se actualiza con los cambios de la primera, pero
editar en ambas a la vez puede sobrescribir lo último que hiciste.

## Cuenta (opcional)

Con una cuenta, tus horarios se guardan también en la nube: no se pierden si borras los datos del navegador, y los abres
en otro computador con solo iniciar sesión. Sin cuenta, todo sigue funcionando igual.

1. En la pantalla de inicio, elige **Iniciar sesión o crear cuenta** y luego **Continuar con Google**. Si el navegador
   bloquea la ventana de Google, permite las ventanas emergentes de este sitio.
2. Si prefieres no usar Google, escribe tu correo y una contraseña, elige **Crear cuenta** y abre el enlace que te llega
   por correo. Hasta entonces, tus horarios quedan solo en ese navegador.
3. Si ya tenías horarios sin cuenta, elige **Pasarlos a mi cuenta**.

**Cómo saber si está guardado.** Arriba en el menú lateral, bajo el nombre del horario, verás uno de estos estados:

| Estado | Qué significa |
|---|---|
| Guardado en tu cuenta a las 16:32 | Ya está en la nube. La hora es la de la última subida desde este navegador |
| Cambios por subir… / Guardando en tu cuenta… | Está en este navegador y se sube en unos segundos |
| Sin conexión: se subirá al volver | Está en este navegador y se sube cuando vuelva internet |
| No se pudo guardar en tu cuenta | Está en este navegador, pero no en la nube. Deja el cursor encima para ver el motivo y descarga un respaldo |
| Guardado solo en este navegador | No has iniciado sesión |

Cada cambio se guarda de inmediato en el navegador y se sube unos 5 segundos después de que dejas de editar. Los campos
de texto se guardan al salir del campo. Si intentas cerrar la pestaña con cambios por subir, el navegador te avisa.

**Sin internet** puedes seguir trabajando: los cambios se suben al volver la conexión.

**Cerrar sesión** está en el menú lateral, junto a tu correo, y en la tarjeta **Tu cuenta** de la pantalla de inicio.

**Si editas el mismo horario en dos computadores a la vez,** no se pierde nada: se conservan las dos versiones y la tuya
aparece como una copia con la palabra "conflicto" en el nombre. Compáralas y elimina la que no necesites.

**Al cerrar sesión,** tus horarios se borran de ese navegador y siguen en tu cuenta. Hazlo siempre en un computador
compartido.

**Antes de usarla:** tu correo y tus horarios, con los nombres de los profesores, quedan en Firebase, un servicio de
Google. Confirma que tu colegio lo autoriza. Puedes eliminar tu cuenta y sus horarios desde la pantalla de inicio.

## Partir desde FET de escritorio

Con **Importar respaldo o archivo FET…** puedes abrir un `.fet` de la versión 5 en adelante. Se crea un horario nuevo y
un informe, que se puede descargar, indica qué se traspasó y qué no.

Revisa el informe con calma. No todo tiene equivalente:

- Las actividades fijadas al 100 % quedan fijadas; las demás las ubica el motor al generar, por lo que pueden cambiar.
- Las clases con varios profesores quedan con el primero.
- Las actividades sin curso quedan como "no disponible" si estaban fijadas; si no, se omiten.
- Restricciones como actividades seguidas, fin del día o sala por curso no se traspasan.

## Sin conexión

Después de la primera visita, la app abre y genera horarios sin internet. Las funciones de Excel pueden no estar
disponibles sin conexión si no las has usado antes en esa versión; usa CSV o conéctate un momento.

Cuando hay una versión nueva, aparece **Actualizar ahora**.

## ¿Algo no funciona?

Puedes avisar en [el repositorio del proyecto](https://github.com/ffigueroa11/horarios-web/issues), contando qué estabas
haciendo. Los archivos de respaldo contienen los datos de tu colegio y sus profesores, así que no los publiques sin
anonimizarlos.
