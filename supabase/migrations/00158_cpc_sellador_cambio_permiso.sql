-- 00158_cpc_sellador_cambio_permiso.sql
-- Fix forward costos-por-columna:
--   Limitar el sellador fn_sellar_costo_cambio al permiso de su único llamador (sp_registrar_cambio: ventas.crear).
--
-- DOWN:
-- create or replace function fn_sellar_costo_cambio(
--   p_id_detalle_venta uuid
-- ) returns void
-- language plpgsql
-- security definer
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_id_item      uuid;
--   v_precio_venta numeric(14, 2);
--   v_costo        numeric(14, 2);
-- begin
--   if not (
--     (select auth_tiene_permiso('ventas', 'crear'))
--     or (select auth_tiene_permiso('revendedoras', 'crear'))
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
-- 
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
-- 
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
-- 
--   select dv.id_item, dv.precio_venta
--     into v_id_item, v_precio_venta
--     from detalle_venta dv
--    where dv.id_detalle_venta = p_id_detalle_venta
--      and dv.id_tenant = v_tenant;
-- 
--   if v_id_item is null then
--     raise exception 'detalle-venta-not-found' using errcode = '42704';
--   end if;
-- 
--   if exists (select 1 from detalle_venta_costo where id_detalle_venta = p_id_detalle_venta)
--      and exists (select 1 from detalle_venta_rendicion where id_detalle_venta = p_id_detalle_venta) then
--     return;
--   end if;
-- 
--   select ic.costo_ingreso into v_costo
--     from item_costo ic
--    where ic.id_item = v_id_item
--      and ic.id_tenant = v_tenant;
-- 
--   if v_costo is null then
--     raise exception 'item-costo-pendiente' using errcode = 'P0001';
--   end if;
-- 
--   insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
--   values (p_id_detalle_venta, v_tenant, v_costo, v_precio_venta - v_costo)
--   on conflict (id_detalle_venta) do nothing;
-- 
--   insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
--   values (p_id_detalle_venta, v_tenant, 0)
--   on conflict (id_detalle_venta) do nothing;
-- end;
-- $$;
-- 
-- revoke all on function fn_sellar_costo_cambio(uuid) from public, anon;
-- grant execute on function fn_sellar_costo_cambio(uuid) to authenticated;

create or replace function fn_sellar_costo_cambio(
  p_id_detalle_venta uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_id_item      uuid;
  v_precio_venta numeric(14, 2);
  v_costo        numeric(14, 2);
begin
  if not (select auth_tiene_permiso('ventas', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select dv.id_item, dv.precio_venta
    into v_id_item, v_precio_venta
    from detalle_venta dv
   where dv.id_detalle_venta = p_id_detalle_venta
     and dv.id_tenant = v_tenant;

  if v_id_item is null then
    raise exception 'detalle-venta-not-found' using errcode = '42704';
  end if;

  if exists (select 1 from detalle_venta_costo where id_detalle_venta = p_id_detalle_venta)
     and exists (select 1 from detalle_venta_rendicion where id_detalle_venta = p_id_detalle_venta) then
    return;
  end if;

  select ic.costo_ingreso into v_costo
    from item_costo ic
   where ic.id_item = v_id_item
     and ic.id_tenant = v_tenant;

  if v_costo is null then
    raise exception 'item-costo-pendiente' using errcode = 'P0001';
  end if;

  insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
  values (p_id_detalle_venta, v_tenant, v_costo, v_precio_venta - v_costo)
  on conflict (id_detalle_venta) do nothing;

  insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
  values (p_id_detalle_venta, v_tenant, 0)
  on conflict (id_detalle_venta) do nothing;
end;
$$;

revoke all on function fn_sellar_costo_cambio(uuid) from public, anon;
grant execute on function fn_sellar_costo_cambio(uuid) to authenticated;
