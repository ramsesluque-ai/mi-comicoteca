# MI COMICTECA — única versión oficial y política de cambios

**Decisión ratificada por el propietario el 20 de noviembre de 2026.**

## Fuente única de verdad

- **ÚNICA URL comercial oficial y de validación del usuario:** https://micomicteca.es
- **ÚNICO repositorio de código de MI COMICTECA:** `ramsesluque-ai/mi-comicoteca`.
- **ÚNICA rama autorizada para los cambios comerciales:** `commercial-published`.
- Los entornos `.workers.dev` son, como máximo, endpoints técnicos de infraestructura; no deben presentarse como versiones paralelas ni como destino definitivo de las pruebas.
- No desarrollar, probar para aceptación o anunciar entregas desde clones, demos, ramas antiguas, proyectos alternativos o URLs `.dev`. No confundir con LUQUE ONE.
- Antes de dar un trabajo como terminado, verificar que **el código exacto del commit se sirve realmente en https://micomicteca.es**, y comprobar la funcionalidad allí. Un commit en GitHub no acredita por sí solo el despliegue.
- Si no es posible comprobar el dominio en vivo, informar del bloqueo con honestidad; no declarar que está desplegado o validado.

## Prioridad absoluta: sincronización multidispositivo

La plataforma es de pago y la sincronización es **irrenunciable**. Requisito funcional definitivo:

1. Cada usuario tiene una colección central privada en **Supabase**; su copia local en IndexedDB es un caché de trabajo, **no una colección independiente**.
2. Al pulsar **Guardar** en móvil u ordenador, guardar en local y enviar automáticamente el cambio a Supabase; sin conexión, conservar una cola pendiente fiable y reintentar después.
3. Al abrir otro dispositivo, **la sincronización debe ejecutarse automáticamente**, recuperando cambios de Supabase sin pulsar ningún botón. **Sincronizar ahora** permanece como comprobación o reintento manual y tampoco requiere ninguna acción en el dispositivo de origen.
4. Sincronizar **fichas y portadas**. Imágenes privadas por UID en Storage; comprobar integridad de los bytes (SHA-256) y no confundir enlaces con binarios ya almacenados.
5. Resolver conflictos con versión/baseline; nunca sobrescribir silenciosamente cambios simultáneos, ni borrar por ausencia en una página. Bajas mediante tombstones validados.
6. Garantizar aislamiento estricto entre cuentas y cumplimiento de políticas RLS; no mezclar registros, cubiertas ni datos locales de dos usuarios.
7. Probar con **dos cuentas independientes y dos dispositivos/sesiones**, desde ambos sentidos, con desconexión, reconexión, conflictos y portada.
8. Antes de ejecutar migraciones, guardados o limpiezas que afecten a los **16.523** cómics ya archivados o portadas existentes, usar respaldos verificables; evitar migraciones destructivas y escrituras masivas sin pruebas.

## Estado técnico de referencia (20 noviembre 2026)

- Supabase MI COMICTECA `uihlavjgdqavhmpilimq`: 16.523 fichas bajo la cuenta propietaria; **no alterar ese catálogo masivamente**.
- Storage privado `user-covers`: solo 28 objetos verificados; faltan todavía cubiertas locales por proteger en nube.
- Rama `commercial-published`: recuperación aditiva de fichas desde cloud en `catalog-cloud-rehydrate.js`.
- Motor nuevo `sync-v3-core.js` y RPC servidor `mc_sync_comic_v3` con versionado optimista. **No confundir código disponible con integración validada**.
- Botón público `manual-sync-v2-button.js`: **comparación solamente** hasta que el transporte seguro y las pruebas E2E permitan activarlo.
- No iniciar nuevas funcionalidades no prioritarias mientras no esté cerrada la sincronización.

## Regla para cada entrega

1. Implementar en `commercial-published`, evitando módulos paralelos innecesarios.
2. Confirmar pruebas automatizadas y prueba real de negocio.
3. Confirmar que el commit exacto está desplegado en **micomicteca.es**.
4. Documentar commit, escenario probado, datos preservados, bloqueos y estado del botón.
5. **Nunca** decir «listo en producción» si solo se ha hecho commit o simulación.

Esta política debe mantenerse para los próximos trabajos aunque se retome la conversación desde otro chat o tarea automática.
## Nueva arquitectura aprobada por el usuario (20 noviembre 2026)

- **Guardar = guardar localmente + encolar automáticamente + subir por API a Supabase.** La confirmación de nube solo se muestra tras respuesta correcta y verificada.
- **Abrir o recuperar conexión = descargar y reconciliar automáticamente desde Supabase.** No se exige sincronizar manualmente en origen ni destino.
- **Botón «Sincronizar ahora» = reintentar/verificar**, sin ser necesario para el funcionamiento normal.
- **16.523 registros originales son intocables mediante sobrescritura masiva.** Respetar baselines, versión de servidor y conflictos. Preservar portadas por UID y SHA-256 antes de reconocer éxito.
- Código incorporado: `app1.js` DBV2 con `sync_outbox` y `sync_baseline`, `sync-auto-v4.js`, `sync-auto-covers-v4.js`, `sync-auto-runtime-v4.js`, `vault.js` cache privada. **La activación automática permanece BLOQUEADA por `RELEASE_APPROVED=false` hasta completar las pruebas E2E.** No afirmar que ya está sincronizando en producción.
- Fechas objetivo: 23/11 primera integración verificada; 25/11 altas y modificaciones automáticas; 27/11 portadas/conflictos; 30/11 E2E y despliegue final condicionado a pruebas. Son objetivos, no garantía de entrega.
