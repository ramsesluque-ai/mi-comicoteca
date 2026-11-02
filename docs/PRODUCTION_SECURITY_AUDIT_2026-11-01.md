# Mi Comicoteca — Production security audit

Fecha: 2026-11-01

## Verificado en Supabase
- RLS habilitado en `master_series`, `master_comics`, `user_comics`, `profiles` y `subscriptions`.
- `user_comics` restringe SELECT/INSERT/UPDATE/DELETE a `auth.uid() = user_id` y exige membresía activa (o rol admin).
- `master_series` y `master_comics` son de solo lectura para usuarios autenticados con membresía activa (o admin).
- `profiles` solo permite SELECT/UPDATE de la propia fila.
- El rol `authenticated` solo tiene UPDATE de `display_name` y `last_seen_at` en `profiles`; no puede autoactivarse `membership_active`, cambiar `membership_valid_until`, `membership_source` ni `role`.
- Existe unicidad de serie por `(publisher,title,volume_stage,start_year)`, equivalente funcional a Editorial + Cabecera + Volumen/Etapa + Año de inicio.
- Existe unicidad por usuario/comic en `user_comics (user_id, master_comic_id)`.

## Gate pendiente
- `master_series` y `master_comics` siguen pendientes de carga de catálogo.
- Ejecutar prueba E2E con dos usuarios reales/test para demostrar aislamiento de colecciones.
- Validar Stripe test + webhook + entitlement antes de live.

No activar cobros live hasta completar los gates anteriores.
