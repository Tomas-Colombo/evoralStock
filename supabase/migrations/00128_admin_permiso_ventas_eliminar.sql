-- 00128_admin_permiso_ventas_eliminar.sql
-- `marcarCuotaIncobrableAction` exige `ventas.eliminar` desde 2026-08-20, pero
-- la acción no estaba en `CATALOGO_PERMISOS`: ningún rol podía tenerla y nadie,
-- ni el Administrador, podía marcar una cuota como incobrable. El catálogo ya
-- la incluye (los tenants nuevos la reciben al provisionarse); acá se agrega a
-- los roles Administrador existentes. El resto de los roles la recibe solo si
-- un admin la tilda en el editor: un vendedor no borra deuda por defecto.
--
-- DOWN:
-- update rol set permisos = jsonb_set(permisos, '{ventas}', (permisos -> 'ventas') - 'eliminar') where (permisos -> 'ventas') ? 'eliminar';

update rol
   set permisos = jsonb_set(permisos, '{ventas}', (permisos -> 'ventas') || '["eliminar"]'::jsonb)
 where nombre = 'Administrador'
   and jsonb_typeof(permisos -> 'ventas') = 'array'
   and not (permisos -> 'ventas') ? 'eliminar';
