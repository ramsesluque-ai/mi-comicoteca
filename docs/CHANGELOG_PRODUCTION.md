# Production hardening changelog

## 2026-11-01
- Auditada configuración RLS y permisos de perfil.
- Confirmado aislamiento de `user_comics` por `auth.uid()`.
- Confirmado que entitlement y rol no son editables por el usuario autenticado.
- Preparada migración de integridad del Maestro.
- Añadido contrato de importación y casos de regresión.
- Añadido checklist de go-live y validación SQL post-import.
