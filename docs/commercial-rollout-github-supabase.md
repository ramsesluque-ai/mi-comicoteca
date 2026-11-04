# MI COMICOTECA — Plan de puesta en producción (GitHub Pages + Supabase + Stripe)

## Arquitectura aprobada
- Código y despliegue estático: GitHub `ramsesluque-ai/mi-comicoteca` mediante `.github/workflows/pages.yml`.
- Identidad y datos privados: proyecto Supabase **MI COMICOTECA** (`uihlavjgdqavhmpilimq`), separado de LUQUE ONE.
- Cobros: Stripe, producto MI COMICOTECA, 9,99 EUR/mes. Checkout y webhooks solo desde backend con secretos; no publicar claves privadas.
- No usar Vercel. GitHub Pages publica archivos estáticos, pero **no ejecuta webhooks ni funciones servidor**: para Stripe usar Supabase Edge Functions.

## Estado observado el 4 de noviembre de 2026
- Ya existen las tablas `profiles`, `master_series`, `master_comics`, `user_comics`, `cover_history`, `subscriptions` y `billing_events`, todas con RLS.
- Buckets privados `master-covers` y `user-covers`.
- `profiles` limita UPDATE de authenticated a `display_name` y `last_seen_at`; no permitir que el cliente modifique `role`, `membership_active` ni `membership_valid_until`.
- `docs/commercial-schema.sql` es un borrador alternativo **no aplicado**. NO ejecutarlo directamente: duplicaría entidades ya existentes con nombres `mc_*`. Adaptar código a las tablas existentes.
- La aplicación actual utiliza `sync.js` y `bridge-client.js` con credenciales GitHub en localStorage; **solo para uso personal**. Nunca solicitar token GitHub a clientes ni reutilizar la rama `sync-data` como almacenamiento comercial.
- El catálogo en Supabase no se ha validado como completo. El índice estático del repositorio y la base de datos no son equivalentes.

## Implementación segura (orden)
1. **Congelar y respaldar** la versión personal y su colección/portadas antes de modificar código de producción. Mantener su sincronización existente aislada.
2. Crear entrada comercial independiente (por ejemplo `/comercial/`) que reutilice CSS/componentes visuales, pero no cargue `sync.js`, `setup.js` ni `bridge-client.js` con credenciales GitHub.
3. Integrar Supabase Auth y sesión. En frontend usar solo clave publicable; no `service_role`.
4. Leer `master_series`/`master_comics` como catálogo común y `user_comics` filtrado por sesión con RLS; al registrar usuario, colección y wishlist vacías. Importar maestro completo en lotes con validación de conteos y claves de colección editorial+cabecera+volumen/etapa+año.
5. Persistir portadas en Storage: maestro controlado por importador privilegiado; particulares en ruta `<uid>/...` con políticas de lectura/escritura por propietario. Respetar `cover_locked` para no sobrescribir elecciones manuales.
6. Implementar Checkout, portal y webhook Stripe en Edge Functions; verificar firma del webhook, idempotencia con `billing_events.provider_event_id`, reconciliación y estado `subscriptions`. El frontend nunca decide si hay suscripción activa.
7. Probar registro, inicio/cierre de sesión, dos usuarios aislados, carga de portadas, catálogo y wishlist, compras de prueba, renovación, impago y cancelación al fin del periodo.
8. Publicar versión comercial en GitHub Pages solo tras pruebas; confirmar URL real y resultado del workflow. No activar cobros reales antes de fiscalidad, condiciones, privacidad y prueba integral.

## Criterios de aceptación
- Ningún cliente necesita ni ve token GitHub.
- Dos clientes no pueden leer, modificar ni borrar cómics/portadas del otro.
- Un usuario nuevo tiene 0 cómics propios y puede incorporar del maestro a colección o wishlist.
- La colección personal preexistente permanece intacta.
- Las portadas fijadas se mantienen entre dispositivos.
- Cancelar conserva acceso hasta fecha pagada, sin prometerlo solo por estado de Stripe.
- La plataforma no cobra ni se presenta como lista para vender hasta validar la integración real.

## Nota de costes
GitHub Pages puede alojar la web estática, sujeto a sus términos y límites. Supabase, Stripe y eventuales funciones/almacenamiento tienen límites y costes propios; «sin Vercel» no equivale a coste total garantizado de 0 EUR.
