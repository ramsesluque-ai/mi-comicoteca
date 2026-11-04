# Activación comercial: intervenciones necesarias (sin compartir secretos por chat)

## 1. Importación del Maestro
Repositorio: https://github.com/ramsesluque-ai/mi-comicoteca

En **Settings → Secrets and variables → Actions → New repository secret**, crear:
- `COMICOTECA_SUPABASE_URL`: URL del proyecto MI COMICOTECA (no LUQUE ONE).
- `COMICOTECA_SUPABASE_SERVICE_ROLE_KEY`: clave privada service_role del proyecto MI COMICOTECA, obtenida dentro de Supabase (Project Settings → API Keys). **Nunca introducirla en el código, mensajes o frontend.**

Después: **Actions → Import commercial master into Supabase → Run workflow**. El proceso usa las 337 editoriales del snapshot y no modifica las colecciones personales. Revisar logs, conteos y errores antes de anunciar disponibilidad.

## 2. Hosting comercial
Conservar GitHub como repositorio. Para el SaaS de pago, usar **Cloudflare Pages** enlazado al mismo repositorio; raíz del sitio comercial: directorio `comercial` (si se configura como directorio de salida estática, copiar además los recursos compartidos de imagen y CSS o crear un directorio de distribución que los incluya). GitHub Pages permanece únicamente como entorno personal/no comercial. Verificar condiciones vigentes y límites del proveedor.

## 3. Stripe real
Autorizar acceso al entorno real de Stripe de LUQUE AI ANALYTICS. Crear o verificar en ese entorno producto MI COMICOTECA y precio recurrente EUR 9,99/mes; no reutilizar IDs de test. En Supabase configurar `STRIPE_SECRET_KEY` real y `STRIPE_WEBHOOK_SECRET` del endpoint de producción, sin exponerlos. Configurar URL de retorno comercial y webhooks, verificar firmas y eventos antes de activar Checkout.

## 4. Validación antes de abrir
- Prueba de registro y correo confirmado; RLS de dos usuarios.
- Catálogo completo, portada manual persistente, colección y wishlist.
- Checkout de prueba y suscripción real controlada solo con autorización expresa.
- Cancelación, impago, renovación, idempotencia de webhooks.
- Condiciones de contratación, privacidad y facturación.

**Estado:** ningún cobro real se ha habilitado. No publicar como comercialmente operativa hasta completar lo anterior.
