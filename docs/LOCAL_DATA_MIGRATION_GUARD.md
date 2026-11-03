# MI COMICOTECA — Guardia de migración local → Supabase

## Objetivo
Preservar íntegramente la colección que el usuario mantiene actualmente en IndexedDB (`mi-comicoteca-v3`) durante la transición a persistencia multi-dispositivo en Supabase.

## Reglas obligatorias
1. La primera sincronización es **local → cloud**. Nunca cloud vacío → local.
2. Antes de escribir en `user_comics`, generar/exportar una copia completa JSON de los stores locales relevantes.
3. No ejecutar `clear()` sobre `comics`, `purchases`, `settings` ni almacenes de portadas durante migración.
4. Un `coverUrl`/portada local existente prevalece sobre un valor cloud vacío o nulo.
5. La carga cloud debe ser idempotente: reintentar no puede duplicar cómics.
6. No marcar la migración como completada hasta verificar recuentos y muestras de portadas.
7. Tras la migración, IndexedDB continúa como caché/offline hasta superar las pruebas multi-dispositivo.
8. Un fallo de autenticación, red o Supabase no puede borrar ni reinicializar datos locales.

## Puerta de validación
Antes de activar sincronización bidireccional:
- export local creado correctamente;
- número de registros locales contabilizado;
- número de registros cloud verificado;
- coincidencia de IDs/identidad comprobada;
- portadas existentes verificadas por muestra;
- logout/login conserva datos;
- segundo dispositivo recupera la colección;
- aislamiento entre dos usuarios validado.

## Prohibición
No se promocionará a `production-ready` ninguna implementación que pueda interpretar una tabla cloud vacía como instrucción para vaciar IndexedDB.
