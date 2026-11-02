# Seguridad de datos locales antes de la migración cloud

## Estado confirmado

La versión `production-ready` guarda la colección personal en IndexedDB, base `mi-comicoteca-v3`, con stores `comics`, `purchases`, `master` y `settings`.

Las portadas manuales forman parte de los registros de `comics` mediante `coverUrl`. Por tanto, cualquier migración a Supabase debe tratar IndexedDB como origen de datos personales hasta que la sincronización cloud haya sido validada.

## Regla de protección

1. No borrar, reinicializar ni sustituir IndexedDB durante la integración.
2. No ejecutar `resetAll()` durante pruebas de migración.
3. Antes de migrar datos personales, generar una copia JSON con `exportBackup()` y verificar que contiene `comics`, `purchases` y `master`.
4. La primera sincronización cloud será **local -> cloud** y no cloud -> local.
5. Un catálogo Maestro vacío en Supabase nunca puede provocar el vaciado del Maestro local ni de la colección.
6. Las portadas existentes deben conservar `coverUrl` y, cuando se implemente Storage, migrarse de forma aditiva, manteniendo el valor original hasta confirmar la copia remota.
7. Tras la primera sincronización, comparar recuentos local/cloud antes de activar lectura cloud como fuente principal.

## Gate de migración personal

No activar sincronización personal en producción hasta validar:

- exportación/restauración JSON local;
- usuario autenticado y RLS;
- carga local -> `user_comics` sin pérdida;
- conservación de `coverUrl`;
- cierre/reapertura de sesión;
- segundo dispositivo;
- aislamiento entre dos usuarios;
- rollback a la copia local.

## Nota

La carga del catálogo Maestro a `master_series` / `master_comics` es independiente de la colección personal y puede prepararse sin tocar IndexedDB del usuario.
