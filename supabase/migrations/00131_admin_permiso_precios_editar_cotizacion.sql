-- 00131_admin_permiso_precios_editar_cotizacion.sql
-- Agrega el nuevo permiso 'editar_cotizacion' al módulo 'precios' en los roles
-- Administrador existentes (patrón 00128). Idempotente (no duplica si ya está).
-- Los tenants nuevos ya lo reciben al provisionarse a través del catálogo actualizado.
--
-- DOWN:
-- update rol set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') - 'editar_cotizacion') where (permisos -> 'precios') ? 'editar_cotizacion';

update rol
   set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') || '["editar_cotizacion"]'::jsonb)
 where nombre = 'Administrador'
   and jsonb_typeof(permisos -> 'precios') = 'array'
   and not (permisos -> 'precios') ? 'editar_cotizacion';
