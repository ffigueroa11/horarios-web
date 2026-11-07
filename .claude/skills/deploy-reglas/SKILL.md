---
name: deploy-reglas
description: Publica firestore.rules en el proyecto de Firebase horarios-web-ff, validando antes con un dry-run.
disable-model-invocation: true
---

# Publicar las reglas de Firestore

Las reglas son la única barrera de seguridad de la sincronización: la configuración web es pública. Publica solo lo que
ya está en `firestore.rules` y revisado.

## Pasos

1. **Revisa qué cambia.** Muestra `git diff HEAD -- firestore.rules` y, si no hay cambios locales,
   `git log -3 --oneline -- firestore.rules`. Si `firestore.rules` tiene cambios sin commit, avísalo y pregunta si
   seguir.
2. **Confirma la cuenta.** Corre `npx firebase-tools login:list`. Si no hay sesión, ejecuta
   `npx firebase-tools login`: la CLI no recibe stdin aquí, así que entrega el enlace que imprime al usuario y, cuando te
   devuelva el código, ejecuta `npx firebase-tools login <código>`. La cuenta debe ser la dueña de `horarios-web-ff`.
3. **Valida sin publicar:**
   `npx firebase-tools deploy --only firestore:rules --project horarios-web-ff --dry-run`.
   Si falla la compilación de las reglas, detente y muestra el error.
4. **Pide confirmación explícita** al usuario, mostrando el proyecto (`horarios-web-ff`) y el resumen del cambio.
5. **Publica:** `npx firebase-tools deploy --only firestore:rules --project horarios-web-ff`.
6. **Recuerda la prueba manual.** Las reglas no tienen pruebas automáticas (los emuladores necesitan Java): indica que
   hay que repetir el flujo de sincronización con dos navegadores y dos cuentas desechables, incluido que una cuenta no
   pueda leer los horarios de otra.

## Cuidados

- Usa siempre `--project horarios-web-ff` explícito. La cuenta dueña tiene otros proyectos ajenos: nunca publiques ahí.
- En este equipo la red inspecciona TLS: si aparece `SELF_SIGNED_CERT_IN_CHAIN`, antepone `NODE_OPTIONS=--use-system-ca`.
  No desactives la verificación de certificados.
- No uses `--only auth` ni `deploy` sin `--only`: el acceso con Google se configuró aparte para no dejar el correo de
  soporte en el repositorio, y un deploy de `auth` desde `firebase.json` podría desactivarlo.
- Si la base `(default)` no existiera, `deploy` la crearía en Estados Unidos (`nam5`) sin poder cambiarla: debe existir
  en `southamerica-west1` antes de publicar.
