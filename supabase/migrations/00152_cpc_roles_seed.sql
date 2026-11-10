-- 00152_cpc_roles_seed.sql
-- Fase 3B de costos-por-columna (REQ-CPC-01, REQ-CPC-04, D-CPC-05 y D-CPC-06):
-- Incorpora 'ver_costos' y 'cargar_costos' en el módulo 'inventario', y
-- 'ver_margenes' en 'precios' para los roles 'Administrador' existentes.
-- Idempotente (no duplica si ya están). Los roles limitados (Vendedora-Local, etc.)
-- no reciben nada por defecto (principio de menor privilegio, REQ-CPC §9).
--
-- DOWN:
-- update rol set permisos = jsonb_set(permisos, '{inventario}', (permisos -> 'inventario') - 'ver_costos') where nombre = 'Administrador' and (permisos -> 'inventario') ? 'ver_costos';
-- update rol set permisos = jsonb_set(permisos, '{inventario}', (permisos -> 'inventario') - 'cargar_costos') where nombre = 'Administrador' and (permisos -> 'inventario') ? 'cargar_costos';
-- update rol set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') - 'ver_margenes') where nombre = 'Administrador' and (permisos -> 'precios') ? 'ver_margenes';

update rol
   set permisos = jsonb_set(permisos, '{inventario}', (permisos -> 'inventario') || '["ver_costos"]'::jsonb)
 where nombre = 'Administrador'
   and jsonb_typeof(permisos -> 'inventario') = 'array'
   and not (permisos -> 'inventario') ? 'ver_costos';

update rol
   set permisos = jsonb_set(permisos, '{inventario}', (permisos -> 'inventario') || '["cargar_costos"]'::jsonb)
 where nombre = 'Administrador'
   and jsonb_typeof(permisos -> 'inventario') = 'array'
   and not (permisos -> 'inventario') ? 'cargar_costos';

update rol
   set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') || '["ver_margenes"]'::jsonb)
 where nombre = 'Administrador'
   and jsonb_typeof(permisos -> 'precios') = 'array'
   and not (permisos -> 'precios') ? 'ver_margenes';
