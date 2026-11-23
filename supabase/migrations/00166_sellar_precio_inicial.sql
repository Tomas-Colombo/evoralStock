-- 00166_sellar_precio_inicial.sql
-- Sella el precio de venta inicial cuando un producto tiene costo vigente y
-- todavía no tiene precio_venta (precio_venta is null), aplicando la regla de
-- margen ganadora según resolver_regla_margen.

-- DOWN:
-- revoke all on function fn_sellar_precio_inicial(uuid) from authenticated;
-- drop function if exists fn_sellar_precio_inicial(uuid);
--
-- NOTE: Restaura sp_recalcular_precio_venta (00155_cpc_policies_y_herencia.sql:1772)
-- create or replace function sp_recalcular_precio_venta(
--   p_id_producto uuid,
--   p_ip inet default null
-- ) returns numeric language plpgsql as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_costo        numeric;
--   v_regla        regla_precio;
--   v_precio_ant   numeric;
--   v_precio_nuevo numeric;
-- begin
--   if not (
--     (select auth_tiene_permiso('precios', 'editar'))
--     and (select auth_tiene_permiso('inventario', 'ver_costos'))
--     and (select auth_tiene_permiso('precios', 'ver_margenes'))
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select costo into v_costo
--     from costo_producto
--    where id_producto = p_id_producto and vigente_hasta is null;
--
--   if v_costo is null then
--     update producto
--        set precio_venta = null,
--            id_regla_margen_aplicada = null,
--            precio_venta_resuelto_at = now(),
--            precio_venta_desactualizado = true
--      where id_producto = p_id_producto and id_tenant = v_tenant;
--     return null;
--   end if;
--
--   select * into v_regla from resolver_regla_margen(p_id_producto);
--
--   select precio_venta into v_precio_ant
--     from producto where id_producto = p_id_producto;
--
--   if v_regla.id_regla is null then
--     v_precio_nuevo := v_costo;
--   elsif v_regla.tipo_valor = 'porcentaje' then
--     v_precio_nuevo := v_costo * (1 + v_regla.valor);
--   else
--     v_precio_nuevo := v_costo + v_regla.valor;
--   end if;
--
--   update producto
--      set precio_venta = v_precio_nuevo,
--          id_regla_margen_aplicada = v_regla.id_regla,
--          precio_venta_resuelto_at = now(),
--          precio_venta_desactualizado = false
--    where id_producto = p_id_producto and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'producto', p_id_producto::text, 'recalcular_precio',
--           jsonb_build_object(
--             'precio_anterior', v_precio_ant,
--             'precio_nuevo', v_precio_nuevo,
--             'costo', v_costo,
--             'id_regla_margen', v_regla.id_regla,
--             'tipo_valor', v_regla.tipo_valor,
--             'valor', v_regla.valor
--           ),
--           p_ip);
--
--   return v_precio_nuevo;
-- end $$;
--
-- NOTE: Restaura sp_aplicar_ultimo_costo (00156_cpc_item_venta_devolucion_costo.sql:3027)
-- create or replace function sp_aplicar_ultimo_costo(
--   p_id_producto            uuid,
--   p_costo                  numeric,
--   p_moneda                 text default 'ARS',
--   p_costo_original_usd     numeric default null,
--   p_cotizacion_aplicada    numeric default null,
--   p_cotizacion_fecha_valor date default null,
--   p_motivo                 text default null,
--   p_ip                     inet default null,
--   p_sincronizar_unidades   boolean default true
-- ) returns uuid
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_vigente  record;
--   v_id       uuid;
--   v_es_igual boolean := false;
-- begin
--   if not (
--     (select auth_tiene_permiso('inventario', 'cargar_costos'))
--     or (
--       (select auth_tiene_permiso('precios', 'editar_cotizacion'))
--       and (select auth_tiene_permiso('inventario', 'ver_costos'))
--     )
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_costo is null or p_costo <= 0 then
--     return null;
--   end if;
--
--   select id_costo, costo, moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--     into v_vigente
--     from costo_producto
--    where id_tenant = v_tenant
--      and id_producto = p_id_producto
--      and vigente_hasta is null
--    for update;
--
--   if v_vigente.id_costo is not null then
--     if v_vigente.costo = p_costo then
--       v_es_igual := true;
--     end if;
--   end if;
--
--   if v_es_igual then
--     return v_vigente.id_costo;
--   end if;
--
--   if v_vigente.id_costo is not null then
--     update costo_producto
--        set vigente_hasta = now()
--      where id_costo = v_vigente.id_costo;
--   end if;
--
--   insert into costo_producto(
--     id_tenant, id_producto, costo, moneda,
--     id_usuario_alta, motivo,
--     costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--   )
--   values (
--     v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
--     v_actor, p_motivo,
--     case when p_moneda = 'USD' then p_costo_original_usd else null end,
--     case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--     case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
--   )
--   returning id_costo into v_id;
--
--   if coalesce(p_sincronizar_unidades, true) then
--     insert into item_costo(id_item, id_tenant, costo_ingreso)
--     select ip.id_item, v_tenant, p_costo
--       from item_producto ip
--      where ip.id_tenant = v_tenant
--        and ip.id_producto = p_id_producto
--        and ip.tipo_ingreso = 'compra'
--        and ip.estado_item in ('disponible', 'reservado', 'en_revendedora')
--     on conflict (id_item) do update
--       set costo_ingreso = excluded.costo_ingreso,
--           updated_at = now();
--   end if;
--
--   perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
--           jsonb_build_object('id_producto', p_id_producto,
--                              'costo_anterior', v_vigente.costo,
--                              'costo_nuevo', p_costo,
--                              'moneda', coalesce(p_moneda, 'ARS'),
--                              'motivo', p_motivo,
--                              'costo_original_usd', p_costo_original_usd,
--                              'cotizacion_aplicada', p_cotizacion_aplicada,
--                              'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
--           p_ip);
--
--   return v_id;
-- end;
-- $$;
--
-- NOTE: Restaura sp_confirmar_ingreso (00157_cpc_ingreso_costo.sql:1112)
-- create or replace function sp_confirmar_ingreso(
--   p_id_ingreso uuid,
--   p_ip         inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_confirmado boolean;
--   v_tipo       tipo_ingreso;
--   v_count      integer := 0;
--   v_detalle    record;
--   v_i          integer;
--   v_qr         text;
--   v_new_item   uuid;
--   v_prod       record;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select confirmado, tipo_ingreso into v_confirmado, v_tipo
--     from ingreso_mercaderia
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--    for update;
--
--   if v_confirmado is null then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--
--   if v_confirmado then
--     return 0;  -- idempotente
--   end if;
--
--   for v_detalle in
--     select id_detalle, id_producto, cantidad, talle
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   loop
--     for v_i in 1 .. v_detalle.cantidad loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, tipo_ingreso, talle)
--       values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
--               v_qr, 'disponible', v_tipo, v_detalle.talle)
--       returning id_item into v_new_item;
--
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id, id_usuario)
--       values (v_tenant, v_new_item, 'alta',
--               null, 'disponible',
--               'ingreso', p_id_ingreso, v_actor);
--
--       v_count := v_count + 1;
--     end loop;
--   end loop;
--
--   perform fn_sellar_costo_ingreso(p_id_ingreso);
--
--   if (select auth_tiene_permiso('inventario', 'cargar_costos')) then
--     for v_prod in
--       select id_producto,
--              costo_unitario,
--              costo_original_usd,
--              cotizacion_aplicada,
--              cotizacion_fecha_valor,
--              case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
--         from (
--           select distinct on (d.id_producto)
--                  d.id_producto,
--                  c.costo_unitario,
--                  c.costo_original_usd,
--                  c.cotizacion_aplicada,
--                  c.cotizacion_fecha_valor
--             from ingreso_mercaderia_detalle d
--             join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
--            where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
--            order by d.id_producto, d.id_detalle
--         ) s
--     loop
--       if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
--         perform sp_aplicar_ultimo_costo(
--           v_prod.id_producto,
--           v_prod.costo_unitario,
--           v_prod.moneda,
--           v_prod.costo_original_usd,
--           v_prod.cotizacion_aplicada,
--           v_prod.cotizacion_fecha_valor,
--           'ingreso mercaderia',
--           p_ip,
--           v_tipo <> 'consignacion'
--         );
--       end if;
--     end loop;
--   end if;
--
--   update ingreso_mercaderia
--      set confirmado = true
--    where id_ingreso = p_id_ingreso;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar',
--           jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo),
--           p_ip);
--
--   return v_count;
-- end;
-- $$;
--
-- drop function if exists fn_calcular_precio_con_margen(numeric, tipo_valor_regla, numeric);

-- ---------------------------------------------------------------------
-- 1. Helper interno compartido para calcular precio a partir de regla
-- ---------------------------------------------------------------------

create or replace function fn_calcular_precio_con_margen(
  p_costo      numeric,
  p_tipo_valor tipo_valor_regla,
  p_valor      numeric
) returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_tipo_valor = 'porcentaje' then p_costo * (1 + p_valor)
    else p_costo + p_valor
  end;
$$;

-- ---------------------------------------------------------------------
-- 2. Sellador DEFINER fn_sellar_precio_inicial
-- ---------------------------------------------------------------------

create or replace function fn_sellar_precio_inicial(
  p_id_producto uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant        uuid := auth_tenant_id();
  v_actor         uuid := auth.uid();
  v_precio_actual numeric;
  v_costo         numeric;
  v_regla         regla_precio;
  v_precio_nuevo  numeric;
begin
  -- OR de todos los llamadores que llegan vía sp_aplicar_ultimo_costo:
  -- inventario.cargar_costos (sp_confirmar_ingreso, sp_importar_remito,
  -- sp_crear_stock_directo, sp_set_costo_producto, sp_completar_costo_ingreso)
  -- o (precios.editar_cotizacion AND inventario.ver_costos) (sp_revaluar_costos_usd_vigentes).
  if not (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select precio_venta
    into v_precio_actual
    from producto
   where id_producto = p_id_producto
     and id_tenant = v_tenant
   for update;

  if not found or v_precio_actual is not null then
    return;
  end if;

  -- El precio se sella al confirmar el ingreso, cuando el proveedor ya resuelve
  -- (evita sellar una regla global/categoría mientras el ingreso sigue en borrador).
  if exists (
    select 1
      from ingreso_mercaderia_detalle d
      join ingreso_mercaderia im on im.id_ingreso = d.id_ingreso
     where d.id_tenant = v_tenant
       and d.id_producto = p_id_producto
       and im.id_tenant = v_tenant
       and im.confirmado = false
  ) then
    return;
  end if;

  select costo
    into v_costo
    from costo_producto
   where id_tenant = v_tenant
     and id_producto = p_id_producto
     and vigente_hasta is null
   limit 1;

  if v_costo is null or v_costo <= 0 then
    return;
  end if;

  select * into v_regla from resolver_regla_margen(p_id_producto);

  -- Si no resuelve ninguna regla, dejar precio_venta en null para no bloquear
  -- una regla de proveedor que resuelva recién al confirmar el ingreso.
  if v_regla.id_regla is null then
    return;
  end if;

  v_precio_nuevo := fn_calcular_precio_con_margen(v_costo, v_regla.tipo_valor, v_regla.valor);

  update producto
     set precio_venta = v_precio_nuevo,
         id_regla_margen_aplicada = v_regla.id_regla,
         precio_venta_resuelto_at = now(),
         precio_venta_desactualizado = false
   where id_producto = p_id_producto
     and id_tenant = v_tenant
     and precio_venta is null;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', p_id_producto::text, 'sellar_precio_inicial',
          jsonb_build_object(
            'precio_anterior', null,
            'precio_nuevo', v_precio_nuevo,
            'costo', v_costo,
            'id_regla_margen', v_regla.id_regla,
            'tipo_valor', v_regla.tipo_valor,
            'valor', v_regla.valor
          ),
          null);
end;
$$;

revoke all on function fn_sellar_precio_inicial(uuid) from public, anon;
grant execute on function fn_sellar_precio_inicial(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. sp_recalcular_precio_venta usando fn_calcular_precio_con_margen
-- ---------------------------------------------------------------------

create or replace function sp_recalcular_precio_venta(
  p_id_producto uuid,
  p_ip inet default null
) returns numeric language plpgsql as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_costo        numeric;
  v_regla        regla_precio;
  v_precio_ant   numeric;
  v_precio_nuevo numeric;
begin
  if not (
    (select auth_tiene_permiso('precios', 'editar'))
    and (select auth_tiene_permiso('inventario', 'ver_costos'))
    and (select auth_tiene_permiso('precios', 'ver_margenes'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select costo into v_costo
    from costo_producto
   where id_producto = p_id_producto and vigente_hasta is null;

  if v_costo is null then
    -- Sin costo vigente no hay precio calculable — marcar desactualizado y salir.
    update producto
       set precio_venta = null,
           id_regla_margen_aplicada = null,
           precio_venta_resuelto_at = now(),
           precio_venta_desactualizado = true
     where id_producto = p_id_producto and id_tenant = v_tenant;
    return null;
  end if;

  select * into v_regla from resolver_regla_margen(p_id_producto);

  select precio_venta into v_precio_ant
    from producto where id_producto = p_id_producto;

  if v_regla.id_regla is null then
    -- Sin regla de margen: precio = costo (0% margen). Marca desactualizado
    -- FALSE porque respetó la (no)regla; el operador puede definir la regla
    -- después y volver a recalcular.
    v_precio_nuevo := v_costo;
  else
    v_precio_nuevo := fn_calcular_precio_con_margen(v_costo, v_regla.tipo_valor, v_regla.valor);
  end if;

  update producto
     set precio_venta = v_precio_nuevo,
         id_regla_margen_aplicada = v_regla.id_regla,
         precio_venta_resuelto_at = now(),
         precio_venta_desactualizado = false
   where id_producto = p_id_producto and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', p_id_producto::text, 'recalcular_precio',
          jsonb_build_object(
            'precio_anterior', v_precio_ant,
            'precio_nuevo', v_precio_nuevo,
            'costo', v_costo,
            'id_regla_margen', v_regla.id_regla,
            'tipo_valor', v_regla.tipo_valor,
            'valor', v_regla.valor
          ),
          p_ip);

  return v_precio_nuevo;
end $$;

-- ---------------------------------------------------------------------
-- 4. sp_aplicar_ultimo_costo: sella precio inicial antes del early return
--    por costo igual y tras insertar un nuevo costo vigente.
-- ---------------------------------------------------------------------

create or replace function sp_aplicar_ultimo_costo(
  p_id_producto            uuid,
  p_costo                  numeric,
  p_moneda                 text default 'ARS',
  p_costo_original_usd     numeric default null,
  p_cotizacion_aplicada    numeric default null,
  p_cotizacion_fecha_valor date default null,
  p_motivo                 text default null,
  p_ip                     inet default null,
  p_sincronizar_unidades   boolean default true
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_vigente  record;
  v_id       uuid;
  v_es_igual boolean := false;
begin
  -- Permisos: 'inventario.cargar_costos' (implica ver_costos por D-CPC-05)
  -- o 'precios.editar_cotizacion' junto con 'inventario.ver_costos' (evita duplicar vigentes bajo RLS).
  if not (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_costo is null or p_costo <= 0 then
    return null;
  end if;

  select id_costo, costo, moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
    into v_vigente
    from costo_producto
   where id_tenant = v_tenant
     and id_producto = p_id_producto
     and vigente_hasta is null
   for update;

  if v_vigente.id_costo is not null then
    if v_vigente.costo = p_costo then
      v_es_igual := true;
    end if;
  end if;

  if v_es_igual then
    perform fn_sellar_precio_inicial(p_id_producto);
    return v_vigente.id_costo;
  end if;

  if v_vigente.id_costo is not null then
    update costo_producto
       set vigente_hasta = now()
     where id_costo = v_vigente.id_costo;
  end if;

  insert into costo_producto(
    id_tenant, id_producto, costo, moneda,
    id_usuario_alta, motivo,
    costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
  )
  values (
    v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
    v_actor, p_motivo,
    case when p_moneda = 'USD' then p_costo_original_usd else null end,
    case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
    case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
  )
  returning id_costo into v_id;

  if coalesce(p_sincronizar_unidades, true) then
    insert into item_costo(id_item, id_tenant, costo_ingreso)
    select ip.id_item, v_tenant, p_costo
      from item_producto ip
     where ip.id_tenant = v_tenant
       and ip.id_producto = p_id_producto
       and ip.tipo_ingreso = 'compra'
       and ip.estado_item in ('disponible', 'reservado', 'en_revendedora')
    on conflict (id_item) do update
      set costo_ingreso = excluded.costo_ingreso,
          updated_at = now();
  end if;

  perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
  perform fn_sellar_precio_inicial(p_id_producto);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
          jsonb_build_object('id_producto', p_id_producto,
                             'costo_anterior', v_vigente.costo,
                             'costo_nuevo', p_costo,
                             'moneda', coalesce(p_moneda, 'ARS'),
                             'motivo', p_motivo,
                             'costo_original_usd', p_costo_original_usd,
                             'cotizacion_aplicada', p_cotizacion_aplicada,
                             'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
          p_ip);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. sp_confirmar_ingreso: sella precio inicial después de confirmar
-- ---------------------------------------------------------------------

create or replace function sp_confirmar_ingreso(
  p_id_ingreso uuid,
  p_ip         inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_confirmado boolean;
  v_tipo       tipo_ingreso;
  v_count      integer := 0;
  v_detalle    record;
  v_i          integer;
  v_qr         text;
  v_new_item   uuid;
  v_prod       record;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select confirmado, tipo_ingreso into v_confirmado, v_tipo
    from ingreso_mercaderia
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant
   for update;

  if v_confirmado is null then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;

  if v_confirmado then
    return 0;  -- idempotente
  end if;

  for v_detalle in
    select id_detalle, id_producto, cantidad, talle
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  loop
    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_tipo, v_detalle.talle)
      returning id_item into v_new_item;

      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id, id_usuario)
      values (v_tenant, v_new_item, 'alta',
              null, 'disponible',
              'ingreso', p_id_ingreso, v_actor);

      v_count := v_count + 1;
    end loop;
  end loop;

  -- El sellador DEFINER valida D3 y traslada los costos del detalle a item_costo
  -- (o hereda el costo vigente si no tenía costo) sin exponerlos por RLS
  perform fn_sellar_costo_ingreso(p_id_ingreso);

  -- D2: llamar a D1 una vez por producto del ingreso si el usuario tiene cargar_costos.
  -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
  -- Líneas sin costo no llaman a sp_aplicar_ultimo_costo.
  if (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    for v_prod in
      select id_producto,
             costo_unitario,
             costo_original_usd,
             cotizacion_aplicada,
             cotizacion_fecha_valor,
             case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
        from (
          select distinct on (d.id_producto)
                 d.id_producto,
                 c.costo_unitario,
                 c.costo_original_usd,
                 c.cotizacion_aplicada,
                 c.cotizacion_fecha_valor
            from ingreso_mercaderia_detalle d
            join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
           where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
           order by d.id_producto, d.id_detalle
        ) s
    loop
      if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
        perform sp_aplicar_ultimo_costo(
          v_prod.id_producto,
          v_prod.costo_unitario,
          v_prod.moneda,
          v_prod.costo_original_usd,
          v_prod.cotizacion_aplicada,
          v_prod.cotizacion_fecha_valor,
          'ingreso mercaderia',
          p_ip,
          v_tipo <> 'consignacion'
        );
      end if;
    end loop;
  end if;

  update ingreso_mercaderia
     set confirmado = true
   where id_ingreso = p_id_ingreso;

  -- Sellar precio inicial recién después de marcar confirmado = true: el proveedor
  -- ya resuelve y este ingreso ya no figura pendiente. Con la misma condición de
  -- permisos y costo > 0, quien llega aquí ya pasó el gate de sp_aplicar_ultimo_costo.
  if (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    for v_prod in
      select distinct on (d.id_producto)
             d.id_producto,
             c.costo_unitario
        from ingreso_mercaderia_detalle d
        join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
       where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
       order by d.id_producto, d.id_detalle
    loop
      if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
        perform fn_sellar_precio_inicial(v_prod.id_producto);
      end if;
    end loop;
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar',
          jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo),
          p_ip);

  return v_count;
end;
$$;
