-- 00134_resumen_ventas_y_alerta_reposicion.sql
-- Optimización de consultas analíticas:
-- 1. Función rf_resumen_ventas_periodo (INVOKER, STABLE) para agregación directa en BD.
-- 2. Reescribe v_alerta_reposicion con LATERAL JOIN sobre item_producto_producto_estado_idx.
--
-- DOWN:
-- drop function if exists rf_resumen_ventas_periodo(timestamptz, timestamptz, canal_venta);
-- create or replace view v_alerta_reposicion
-- with (security_invoker = on) as
-- select
--   p.id_tenant,
--   p.id_producto,
--   p.nombre,
--   p.sku,
--   p.stock_minimo,
--   coalesce(cnt.disponibles, 0)::bigint as disponibles,
--   case
--     when coalesce(cnt.disponibles, 0) = 0 then 'sin_stock'
--     else 'bajo_minimo'
--   end as severidad
-- from producto p
-- left join (
--   select id_producto, count(*)::bigint as disponibles
--     from item_producto
--    where estado_item = 'disponible'
--    group by id_producto
-- ) cnt on cnt.id_producto = p.id_producto
-- where p.activo = true
--   and p.stock_minimo > 0
--   and coalesce(cnt.disponibles, 0) < p.stock_minimo;
-- grant select on v_alerta_reposicion to authenticated;

-- 1. Función rf_resumen_ventas_periodo
create or replace function rf_resumen_ventas_periodo(
  p_desde timestamptz default null,
  p_hasta_exclusivo timestamptz default null,
  p_canal canal_venta default null
)
returns table (
  registradas bigint,
  anuladas bigint,
  facturado numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(count(*) filter (where estado_venta = 'registrada'), 0)::bigint as registradas,
    coalesce(count(*) filter (where estado_venta = 'anulada'), 0)::bigint as anuladas,
    coalesce(sum(total) filter (where estado_venta = 'registrada'), 0)::numeric as facturado
  from venta
  where (p_desde is null or fecha >= p_desde)
    and (p_hasta_exclusivo is null or fecha < p_hasta_exclusivo)
    and (p_canal is null or canal = p_canal);
$$;

grant execute on function rf_resumen_ventas_periodo(timestamptz, timestamptz, canal_venta) to authenticated;

-- 2. Vista v_alerta_reposicion optimizada con LATERAL JOIN
create or replace view v_alerta_reposicion
with (security_invoker = on) as
select
  p.id_tenant,
  p.id_producto,
  p.nombre,
  p.sku,
  p.stock_minimo,
  coalesce(cnt.disponibles, 0)::bigint as disponibles,
  case
    when coalesce(cnt.disponibles, 0) = 0 then 'sin_stock'
    else 'bajo_minimo'
  end as severidad
from producto p
left join lateral (
  select count(*)::bigint as disponibles
    from item_producto ip
   where ip.id_producto = p.id_producto
     and ip.estado_item = 'disponible'
) cnt on true
where p.activo = true
  and p.stock_minimo > 0
  and coalesce(cnt.disponibles, 0) < p.stock_minimo;

grant select on v_alerta_reposicion to authenticated;
