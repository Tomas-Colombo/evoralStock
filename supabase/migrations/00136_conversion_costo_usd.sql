-- 00136_conversion_costo_usd.sql
-- Conversión en carga de productos, ingresos y remitos + revaluación (Slice 4).
-- Check constraints en costo_producto e ingreso_mercaderia_detalle.
-- Actualización de sp_set_costo_producto y sp_importar_remito con metadatos USD.
-- Nueva función sp_revaluar_costos_usd_vigentes(p_ip inet).
--
-- DOWN:
-- drop function if exists sp_revaluar_costos_usd_vigentes(inet);
-- drop function if exists sp_importar_remito(uuid, text, jsonb, inet, numeric, date);
-- create or replace function sp_importar_remito(
--   p_id_ingreso uuid,
--   p_moneda     text default 'ARS',
--   p_lineas     jsonb default '[]',
--   p_ip         inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant      uuid := auth_tenant_id();
--   v_actor       uuid := auth.uid();
--   v_linea       jsonb;
--   v_parte       jsonb;
--   v_es_nuevo    boolean;
--   v_id_producto uuid;
--   v_id_categoria uuid;
--   v_nombre      text;
--   v_sku         text;
--   v_costo       numeric;
--   v_talle       text;
--   v_cant        integer;
--   v_id_detalle  uuid;
--   v_creados     integer := 0;
--   v_vinculados  integer := 0;
--   v_detalles    jsonb := '[]'::jsonb;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from ingreso_mercaderia
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   ) then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
--   loop
--     v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false);
--     v_nombre   := trim(v_linea->>'nombre');
--     v_costo    := coalesce((v_linea->>'costoUnitario')::numeric, 0);
--     if v_nombre is null or v_nombre = '' then
--       raise exception 'linea-sin-nombre' using errcode = '22023';
--     end if;
--     if v_es_nuevo then
--       v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
--       if v_id_categoria is null then
--         raise exception 'falta-categoria: %', v_nombre using errcode = '22023';
--       end if;
--       v_sku := sp_gen_sku(v_id_categoria);
--       insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo)
--       values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true)
--       returning id_producto into v_id_producto;
--       insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--       values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear',
--               jsonb_build_object('nombre', v_nombre, 'sku', v_sku,
--                                  'id_categoria', v_id_categoria,
--                                  'origen', 'import-remito'),
--               p_ip);
--       if v_costo > 0 then
--         insert into costo_producto(id_tenant, id_producto, costo, moneda, id_usuario_alta, motivo)
--         values (v_tenant, v_id_producto, v_costo, coalesce(p_moneda, 'ARS'), v_actor,
--                 'costo inicial (import remito)');
--         insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--         values (v_tenant, v_actor, 'costo_producto', v_id_producto::text, 'crear',
--                 jsonb_build_object('costo_nuevo', v_costo, 'moneda', coalesce(p_moneda, 'ARS'),
--                                    'motivo', 'costo inicial (import remito)'),
--                 p_ip);
--       end if;
--       v_creados := v_creados + 1;
--     else
--       v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
--       if v_id_producto is null then
--         raise exception 'falta-producto: %', v_nombre using errcode = '22023';
--       end if;
--       if not exists (
--         select 1 from producto where id_producto = v_id_producto and id_tenant = v_tenant
--       ) then
--         raise exception 'producto-not-found: %', v_nombre using errcode = '42704';
--       end if;
--       v_vinculados := v_vinculados + 1;
--     end if;
--     for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb))
--     loop
--       v_talle := nullif(trim(v_parte->>'talle'), '');
--       v_cant  := coalesce((v_parte->>'cantidad')::integer, 0);
--       if v_cant <= 0 then
--         continue;
--       end if;
--       insert into ingreso_mercaderia_detalle(id_tenant, id_ingreso, id_producto,
--                                              cantidad, costo_unitario, talle)
--       values (v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle)
--       returning id_detalle into v_id_detalle;
--       v_detalles := v_detalles || jsonb_build_object(
--         'id_detalle', v_id_detalle,
--         'id_producto', v_id_producto,
--         'nombre', v_nombre,
--         'cantidad', v_cant,
--         'costo_unitario', v_costo,
--         'talle', v_talle
--       );
--     end loop;
--   end loop;
--   return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
-- end $$;
-- drop function if exists sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date);
-- create or replace function sp_set_costo_producto(
--   p_id_producto uuid,
--   p_costo       numeric,
--   p_moneda      text default 'ARS',
--   p_motivo      text default null,
--   p_ip          inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id       uuid;
--   v_previous numeric;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   update costo_producto
--      set vigente_hasta = now()
--    where id_producto = p_id_producto
--      and vigente_hasta is null
--   returning costo into v_previous;
--   insert into costo_producto(id_tenant, id_producto, costo, moneda,
--                              id_usuario_alta, motivo)
--   values (v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
--           v_actor, p_motivo)
--   returning id_costo into v_id;
--   perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
--           jsonb_build_object('id_producto', p_id_producto,
--                              'costo_anterior', v_previous,
--                              'costo_nuevo', p_costo,
--                              'moneda', coalesce(p_moneda, 'ARS'),
--                              'motivo', p_motivo),
--           p_ip);
--   return v_id;
-- end $$;
-- alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_detalle_moneda_metadatos_check;
-- alter table costo_producto drop constraint if exists costo_producto_moneda_metadatos_check;

-- 1. Constraints de invariante en costo_producto e ingreso_mercaderia_detalle
alter table costo_producto
  add constraint costo_producto_moneda_metadatos_check
  check (
    (
      moneda = 'USD'
      and costo_original_usd is not null
      and cotizacion_aplicada is not null
      and cotizacion_fecha_valor is not null
      and costo = round(costo_original_usd * cotizacion_aplicada, 2)
    )
    or
    (
      moneda = 'ARS'
      and costo_original_usd is null
      and cotizacion_aplicada is null
      and cotizacion_fecha_valor is null
    )
  ) not valid;

alter table ingreso_mercaderia_detalle
  add constraint ingreso_detalle_moneda_metadatos_check
  check (
    (
      costo_original_usd is not null
      and cotizacion_aplicada is not null
      and cotizacion_fecha_valor is not null
      and costo_unitario = round(costo_original_usd * cotizacion_aplicada, 2)
    )
    or
    (
      costo_original_usd is null
      and cotizacion_aplicada is null
      and cotizacion_fecha_valor is null
    )
  ) not valid;

-- 2. sp_set_costo_producto (ampliado con metadatos de cotización)
drop function if exists sp_set_costo_producto(uuid, numeric, text, text, inet);

create or replace function sp_set_costo_producto(
  p_id_producto            uuid,
  p_costo                  numeric,
  p_moneda                 text default 'ARS',
  p_motivo                 text default null,
  p_ip                     inet default null,
  p_costo_original_usd     numeric default null,
  p_cotizacion_aplicada    numeric default null,
  p_cotizacion_fecha_valor date default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_previous numeric;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  update costo_producto
     set vigente_hasta = now()
   where id_producto = p_id_producto
     and vigente_hasta is null
  returning costo into v_previous;

  insert into costo_producto(
    id_tenant, id_producto, costo, moneda,
    id_usuario_alta, motivo,
    costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
  )
  values (
    v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
    v_actor, p_motivo,
    p_costo_original_usd, p_cotizacion_aplicada, p_cotizacion_fecha_valor
  )
  returning id_costo into v_id;

  perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
          jsonb_build_object('id_producto', p_id_producto,
                             'costo_anterior', v_previous,
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

revoke all on function sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date) from public, anon;
grant execute on function sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date) to authenticated;

-- 3. sp_importar_remito (ampliado con metadatos de cotización)
drop function if exists sp_importar_remito(uuid, text, jsonb, inet);

create or replace function sp_importar_remito(
  p_id_ingreso            uuid,
  p_moneda                text default 'ARS',
  p_lineas                jsonb default '[]',
  p_ip                    inet default null,
  p_cotizacion_aplicada    numeric default null,
  p_cotizacion_fecha_valor date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant             uuid := auth_tenant_id();
  v_actor              uuid := auth.uid();
  v_linea              jsonb;
  v_parte              jsonb;
  v_es_nuevo           boolean;
  v_id_producto        uuid;
  v_id_categoria       uuid;
  v_nombre             text;
  v_sku                text;
  v_costo              numeric;
  v_costo_original_usd numeric;
  v_talle              text;
  v_cant               integer;
  v_id_detalle         uuid;
  v_creados            integer := 0;
  v_vinculados         integer := 0;
  v_detalles           jsonb := '[]'::jsonb;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from ingreso_mercaderia
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  ) then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false);
    v_nombre   := trim(v_linea->>'nombre');
    v_costo    := coalesce((v_linea->>'costoUnitario')::numeric, 0);

    if v_nombre is null or v_nombre = '' then
      raise exception 'linea-sin-nombre' using errcode = '22023';
    end if;

    if p_moneda = 'USD' then
      v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
      if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
        -- Si la línea trajo el monto en USD en costoUnitario sin convertir
        v_costo_original_usd := v_costo;
        v_costo := round(v_costo * p_cotizacion_aplicada, 2);
      end if;
    else
      v_costo_original_usd := null;
    end if;

    if v_es_nuevo then
      v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
      if v_id_categoria is null then
        raise exception 'falta-categoria: %', v_nombre using errcode = '22023';
      end if;

      v_sku := sp_gen_sku(v_id_categoria);

      insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo)
      values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true)
      returning id_producto into v_id_producto;

      insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
      values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear',
              jsonb_build_object('nombre', v_nombre, 'sku', v_sku,
                                 'id_categoria', v_id_categoria,
                                 'origen', 'import-remito'),
              p_ip);

      if v_costo > 0 then
        insert into costo_producto(
          id_tenant, id_producto, costo, moneda, id_usuario_alta, motivo,
          costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
        )
        values (
          v_tenant, v_id_producto, v_costo, coalesce(p_moneda, 'ARS'), v_actor,
          'costo inicial (import remito)',
          case when p_moneda = 'USD' then v_costo_original_usd else null end,
          case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
          case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
        );

        insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
        values (v_tenant, v_actor, 'costo_producto', v_id_producto::text, 'crear',
                jsonb_build_object('costo_nuevo', v_costo, 'moneda', coalesce(p_moneda, 'ARS'),
                                   'motivo', 'costo inicial (import remito)',
                                   'costo_original_usd', v_costo_original_usd,
                                   'cotizacion_aplicada', p_cotizacion_aplicada,
                                   'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
                p_ip);
      end if;

      v_creados := v_creados + 1;
    else
      v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
      if v_id_producto is null then
        raise exception 'falta-producto: %', v_nombre using errcode = '22023';
      end if;
      if not exists (
        select 1 from producto where id_producto = v_id_producto and id_tenant = v_tenant
      ) then
        raise exception 'producto-not-found: %', v_nombre using errcode = '42704';
      end if;
      v_vinculados := v_vinculados + 1;
    end if;

    for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb))
    loop
      v_talle := nullif(trim(v_parte->>'talle'), '');
      v_cant  := coalesce((v_parte->>'cantidad')::integer, 0);
      if v_cant <= 0 then
        continue;
      end if;

      insert into ingreso_mercaderia_detalle(
        id_tenant, id_ingreso, id_producto,
        cantidad, costo_unitario, talle,
        costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
      )
      values (
        v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle,
        case when p_moneda = 'USD' then v_costo_original_usd else null end,
        case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
        case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
      )
      returning id_detalle into v_id_detalle;

      v_detalles := v_detalles || jsonb_build_object(
        'id_detalle', v_id_detalle,
        'id_producto', v_id_producto,
        'nombre', v_nombre,
        'cantidad', v_cant,
        'costo_unitario', v_costo,
        'talle', v_talle,
        'costo_original_usd', v_costo_original_usd
      );
    end loop;
  end loop;

  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
end;
$$;

revoke all on function sp_importar_remito(uuid, text, jsonb, inet, numeric, date) from public, anon;
grant execute on function sp_importar_remito(uuid, text, jsonb, inet, numeric, date) to authenticated;

-- 4. sp_revaluar_costos_usd_vigentes
create or replace function sp_revaluar_costos_usd_vigentes(
  p_ip inet default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant                 uuid := auth_tenant_id();
  v_actor                  uuid := auth.uid();
  v_cotizacion             jsonb;
  v_valor                  numeric;
  v_fecha_valor            date;
  v_revaluados             integer := 0;
  v_omitidos_sin_original  integer := 0;
  r                        record;
  v_id_costo               uuid;
  v_costo_nuevo            numeric;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  v_cotizacion := sp_get_cotizacion_vigente();
  v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
  v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;

  if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
    raise exception 'sin-cotizacion-dolar' using errcode = '22023';
  end if;

  -- 1. Contar filas vigentes con moneda='USD' pero costo_original_usd nulo (se omiten)
  select count(*)
    into v_omitidos_sin_original
    from costo_producto
   where id_tenant = v_tenant
     and vigente_hasta is null
     and moneda = 'USD'
     and costo_original_usd is null;

  -- 2. Procesar las filas vigentes con moneda='USD' y costo_original_usd no nulo
  for r in
    select id_costo, id_producto, costo, costo_original_usd
      from costo_producto
     where id_tenant = v_tenant
       and vigente_hasta is null
       and moneda = 'USD'
       and costo_original_usd is not null
     for update
  loop
    v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);

    -- Cerrar costo vigente anterior
    update costo_producto
       set vigente_hasta = now()
     where id_costo = r.id_costo;

    -- Insertar nuevo costo vigente con cotización actualizada y el mismo costo_original_usd
    insert into costo_producto (
      id_tenant, id_producto, costo, moneda,
      id_usuario_alta, motivo,
      costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
    ) values (
      v_tenant, r.id_producto, v_costo_nuevo, 'USD',
      v_actor, 'revaluacion masiva usd',
      r.costo_original_usd, v_valor, v_fecha_valor
    )
    returning id_costo into v_id_costo;

    -- Marcar precio desactualizado en producto
    perform sp_marcar_precio_desactualizado_by_producto(r.id_producto);

    -- Auditoría por producto revaluado
    insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
    values (
      v_tenant, v_actor, 'costo_producto', v_id_costo::text, 'revaluar',
      jsonb_build_object(
        'id_producto', r.id_producto,
        'costo_anterior', r.costo,
        'costo_nuevo', v_costo_nuevo,
        'costo_original_usd', r.costo_original_usd,
        'cotizacion_nueva', v_valor,
        'cotizacion_fecha_valor', v_fecha_valor
      ),
      p_ip
    );

    v_revaluados := v_revaluados + 1;
  end loop;

  return jsonb_build_object(
    'revaluados', v_revaluados,
    'omitidos_sin_original', v_omitidos_sin_original
  );
end;
$$;

revoke all on function sp_revaluar_costos_usd_vigentes(inet) from public, anon;
grant execute on function sp_revaluar_costos_usd_vigentes(inet) to authenticated;
