# MI COMICOTECA — Arquitectura canónica

Fecha: 2026-11-02

## Fuente de verdad

- **Código, scripts, migraciones y Maestro:** GitHub (`ramsesluque-ai/mi-comicoteca`).
- **Rama estable:** `production-ready`.
- **Integración cloud en curso:** `integration/supabase-master-2026-11-02`.
- **Base de datos/Auth/Storage:** Supabase. Supabase almacena datos de ejecución; la definición reproducible del esquema y migraciones vive en GitHub.
- **Lovable:** fuera de la arquitectura. No es fuente de código, datos ni despliegue.

## Separación de datos

1. `master_series` / `master_comics`: catálogo global compartido.
2. `user_comics` / `cover_history`: datos personales por usuario, protegidos por RLS.
3. La carga del Maestro nunca debe borrar, sustituir ni migrar automáticamente `user_comics`, portadas personales, IndexedDB o localStorage.
4. La migración de colección local a cloud será explícita, verificable y no destructiva.

## Identidad del Maestro

Una serie se identifica por:

`Editorial + Cabecera + Volumen + Etapa + Año de inicio`

El exportador `scripts/export_master_supabase.py` usa UUIDv5 deterministas para permitir cargas idempotentes.

## Puerta de promoción a production-ready

No fusionar esta rama hasta verificar:

- conteo y unicidad del Maestro;
- regresión Forum/Spider-Man;
- regresión Novaro/Batman y Serie Águila;
- autenticación;
- aislamiento RLS entre usuarios;
- alta/copia Maestro → colección;
- persistencia logout/login y segundo dispositivo;
- conservación de portadas y datos locales existentes;
- smoke test del despliegue.

## Regla de operación

No se mantienen versiones funcionales paralelas en constructores externos. GitHub es la única fuente de verdad del producto.
