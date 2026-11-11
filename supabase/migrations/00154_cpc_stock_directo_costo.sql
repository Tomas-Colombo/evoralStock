-- 00154_cpc_stock_directo_costo.sql
-- Fase 3C.2 de costos-por-columna: sp_crear_stock_directo con costo opcional/pendiente.
-- p_costo default null. Si viene null hereda fn_costo_vigente_producto (o null si no hay vigente).
-- Si viene valor no nulo, exige inventario.cargar_costos antes de escribir.

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: Restaura definicion previa de sp_crear_stock_directo (00145)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_stock_directo(
--   p_id_producto  uuid,
--   p_costo        numeric default 0,
--   p_tipo_ingreso tipo_ingreso default 'compra',
--   p_items        jsonb default '[]',
--   p_ip           inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_count    integer := 0;
--   v_item     jsonb;
--   v_talle    text;
--   v_cant     integer;
--   v_i        integer;
--   v_qr       text;
--   v_new_item uuid;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from producto where id_producto = p_id_producto and id_tenant = v_tenant
--   ) then
--     raise exception 'producto-not-found' using errcode = '42704';
--   end if;
--
--   for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
--   loop
--     v_talle := nullif(trim(v_item->>'talle'), '');
--     v_cant := coalesce((v_item->>'cantidad')::integer, 0);
--     if v_cant <= 0 then
--       continue;
--     end if;
--
--     for v_i in 1 .. v_cant loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
--       values (v_tenant, p_id_producto, null, null,
--               v_qr, 'disponible', coalesce(p_costo, 0),
--               coalesce(p_tipo_ingreso, 'compra'), v_talle)
--       returning id_item into v_new_item;
--
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id, id_usuario)
--       values (v_tenant, v_new_item, 'alta', null, 'disponible',
--               'alta-directa', p_id_producto, v_actor);
--
--       v_count := v_count + 1;
--     end loop;
--   end loop;
--
--   if coalesce(p_costo, 0) > 0 then
--     perform sp_aplicar_ultimo_costo(
--       p_id_producto,
--       p_costo,
--       'ARS',
--       null,
--       null,
--       null,
--       'alta directa stock',
--       p_ip,
--       coalesce(p_tipo_ingreso, 'compra') <> 'consignacion'
--     );
--   end if;
--
--   if v_count > 0 then
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (v_tenant, v_actor, 'item_producto', p_id_producto::text, 'alta-directa',
--             jsonb_build_object('items_generados', v_count, 'costo', p_costo), p_ip);
--   end if;
--
--   return v_count;
-- end;
-- $$;
--
-- grant execute on function sp_crear_stock_directo(uuid, numeric, tipo_ingreso, jsonb, inet) to authenticated;

create or replace function sp_crear_stock_directo(
  p_id_producto  uuid,
  p_costo        numeric default null,
  p_tipo_ingreso tipo_ingreso default 'compra',
  p_items        jsonb default '[]',
  p_ip           inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_count      integer := 0;
  v_costo_item numeric;
  v_item       jsonb;
  v_talle      text;
  v_cant       integer;
  v_i          integer;
  v_qr         text;
  v_new_item   uuid;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Si p_costo no es null, exige cargar_costos
  if p_costo is not null and not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from producto where id_producto = p_id_producto and id_tenant = v_tenant
  ) then
    raise exception 'producto-not-found' using errcode = '42704';
  end if;

  -- Si p_costo es null, hereda fn_costo_vigente_producto o queda null
  if p_costo is null then
    v_costo_item := fn_costo_vigente_producto(p_id_producto);
  else
    v_costo_item := p_costo;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_talle := nullif(trim(v_item->>'talle'), '');
    v_cant := coalesce((v_item->>'cantidad')::integer, 0);
    if v_cant <= 0 then
      continue;
    end if;

    for v_i in 1 .. v_cant loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
      values (v_tenant, p_id_producto, null, null,
              v_qr, 'disponible', v_costo_item,
              coalesce(p_tipo_ingreso, 'compra'), v_talle)
      returning id_item into v_new_item;

      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id, id_usuario)
      values (v_tenant, v_new_item, 'alta', null, 'disponible',
              'alta-directa', p_id_producto, v_actor);

      v_count := v_count + 1;
    end loop;
  end loop;

  if p_costo is not null and p_costo > 0 then
    perform sp_aplicar_ultimo_costo(
      p_id_producto,
      p_costo,
      'ARS',
      null,
      null,
      null,
      'alta directa stock',
      p_ip,
      coalesce(p_tipo_ingreso, 'compra') <> 'consignacion'
    );
  end if;

  if v_count > 0 then
    insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
    values (v_tenant, v_actor, 'item_producto', p_id_producto::text, 'alta-directa',
            jsonb_build_object('items_generados', v_count, 'costo', p_costo), p_ip);
  end if;

  return v_count;
end;
$$;

grant execute on function sp_crear_stock_directo(uuid, numeric, tipo_ingreso, jsonb, inet) to authenticated;
