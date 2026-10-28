# Spec — logo-tenant-storage / administración

**Change**: `logo-tenant-storage` · **Requisitos**: `REQ-LOGO-01…04`

## Problema

`d5e79c4` guarda el logo como data URL base64 en `tenant.logo_url`:

- Una imagen de 2 MB son ~2,7 MB de texto: supera el `bodySizeLimit` de 1 MB
  de Server Actions y la action ni se ejecuta (`Body exceeded 1 MB limit`).
- El data URL viaja en `sp_session_context` → `session.marca` en cada render
  del shell, y se copia entero en `auditoria.cambios` en cada cambio.
- `tenant_update_own` (00114) deja que cualquier sesión del tenant haga
  `update tenant set <cualquier columna>` por PostgREST (subdominio, nombre…).

## Decisión

- El navegador rasteriza el archivo (PNG/JPG/WebP/SVG) a un WebP (PNG si el
  navegador no exporta WebP) de 512×200 como máximo. Queda en decenas de KB.
- La action recibe `FormData` y valida tamaño (≤ 512 KB) y tipo; el DAL
  verifica los magic bytes y sube a Storage, bucket `tenant-logos`, carpeta
  `<id_tenant>/`, con el cliente del usuario. `logo_url` guarda la URL pública.
- Policies de `storage.objects` por tenant (`auth_tenant_id()`), sin service
  role, alineadas con el invariante de RLS. SVG no se acepta en el bucket:
  servido desde el origen de Storage ejecuta script si se abre directo.
- `sp_set_tenant_logo` acepta solo `null` o una URL del bucket en la carpeta
  del propio tenant (`logo-invalido` si no).
- `authenticated` solo puede actualizar `tenant.logo_url` y `updated_at`.
- Storage se habilita en `supabase/config.toml` (local y CI).

## Requisitos

### REQ-LOGO-01 — subir logo
- **Feliz**: operador con `administracion.editar` elige una imagen → se sube a
  `tenant-logos/<tenant>/logo-<uuid>.<ext>` y el shell la muestra.
- **N1**: sin permiso → `no-permission`.
- **N2**: archivo > 512 KB → `logo-muy-grande`; tipo fuera de PNG/JPG/WebP o
  bytes que no coinciden → `logo-formato-invalido`.
- **N3**: falla Storage → `logo-no-subido`.

### REQ-LOGO-02 — `sp_set_tenant_logo`
- **N1**: data URL → `logo-invalido`. **N2**: URL de la carpeta de otro tenant
  → `logo-invalido`. Acepta `null` y la URL propia.

### REQ-LOGO-03 — columnas de `tenant`
- **N1**: `update tenant set subdominio = …` como `authenticated` → permiso denegado.

### REQ-LOGO-04 — quitar logo
- `logo_url = null` y se borran (best-effort) los objetos de la carpeta.

## Fuera de alcance

Los tenants que ya tienen un data URL en `logo_url` quedan como están (el shell
lo sigue mostrando); al volver a subir el logo pasa a Storage.
