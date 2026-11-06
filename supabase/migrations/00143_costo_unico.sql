-- 00143_costo_unico.sql
-- UP: Unificación de costo vigente y costo por unidad (change openspec/changes/costo-unico).
--
--     D1: sp_aplicar_ultimo_costo (INVOKER, interna, sin grant a authenticated)
--     D2: sp_confirmar_ingreso llama a D1 por cada producto; en consignación actualiza
--         el costo vigente sin sincronizar unidades en stock.
--     D3: sp_importar_remito y sp_confirmar_ingreso rechazan con 'costos-distintos-mismo-producto'
--         si hay líneas del mismo producto con costos diferentes.
--     D4: sp_crear_stock_directo usa D1 cuando p_costo > 0.
--     D5: sp_set_costo_producto y sp_revaluar_costos_usd_vigentes delegan en D1 para sincronizar stock.
--
-- DOWN: al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- D1: sp_aplicar_ultimo_costo
-- ─────────────────────────────────────────────────────────────────

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
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_vigente      record;
  v_id           uuid;
  v_es_igual     boolean := false;
begin
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
    update item_producto
       set costo_ingreso = p_costo
     where id_tenant = v_tenant
       and id_producto = p_id_producto
       and tipo_ingreso = 'compra'
       and estado_item in ('disponible', 'reservado', 'en_revendedora');
  end if;

  perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);

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

-- ─────────────────────────────────────────────────────────────────
-- D2: sp_confirmar_ingreso
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_confirmar_ingreso(
  p_id_ingreso uuid,
  p_ip         inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant    uuid := auth_tenant_id();
  v_actor     uuid := auth.uid();
  v_confirmado boolean;
  v_tipo      tipo_ingreso;
  v_count     integer := 0;
  v_detalle   record;
  v_i         integer;
  v_qr        text;
  v_new_item  uuid;
  v_prod      record;
begin
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

  -- D3: si dos líneas del mismo producto traen costos distintos, rechazar
  if exists (
    select 1
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
     group by id_producto
    having count(distinct costo_unitario) > 1
  ) then
    raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
  end if;

  for v_detalle in
    select id_detalle, id_producto, cantidad, costo_unitario, talle
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  loop
    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_detalle.costo_unitario, v_tipo, v_detalle.talle)
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

  -- D2: llamar a D1 una vez por producto del ingreso.
  -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
  for v_prod in
    select id_producto,
           costo_unitario,
           costo_original_usd,
           cotizacion_aplicada,
           cotizacion_fecha_valor,
           case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
      from (
        select distinct on (id_producto)
               id_producto,
               costo_unitario,
               costo_original_usd,
               cotizacion_aplicada,
               cotizacion_fecha_valor
          from ingreso_mercaderia_detalle
         where id_ingreso = p_id_ingreso and id_tenant = v_tenant
         order by id_producto, id_detalle
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

  update ingreso_mercaderia
     set confirmado = true
   where id_ingreso = p_id_ingreso;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar',
          jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo),
          p_ip);

  return v_count;
end;
$$;

grant execute on function sp_confirmar_ingreso(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- D3: sp_importar_remito
-- ─────────────────────────────────────────────────────────────────

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

  -- D3: Validar que no existan costos distintos para el mismo producto en p_lineas
  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
    v_nombre   := trim(v_linea->>'nombre');
    v_costo    := coalesce((v_linea->>'costoUnitario')::numeric, 0);

    if p_moneda = 'USD' then
      v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
      if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
        v_costo := round(v_costo * p_cotizacion_aplicada, 2);
      end if;
    end if;

    -- Comparar contra otras líneas de p_lineas
    if exists (
      select 1
        from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) other
       where (
         (v_id_producto is not null and nullif(other->>'idProducto', '')::uuid = v_id_producto)
         or (v_id_producto is null and trim(other->>'nombre') = v_nombre)
       )
       and (
         case when p_moneda = 'USD' and nullif(other->>'costoOriginalUsd', '') is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0
              then round(coalesce((other->>'costoUnitario')::numeric, 0) * p_cotizacion_aplicada, 2)
              else coalesce((other->>'costoUnitario')::numeric, 0)
         end
       ) <> v_costo
    ) then
      raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
    end if;
  end loop;

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
        perform sp_aplicar_ultimo_costo(
          v_id_producto,
          v_costo,
          coalesce(p_moneda, 'ARS'),
          case when p_moneda = 'USD' then v_costo_original_usd else null end,
          case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
          case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end,
          'costo inicial (import remito)',
          p_ip,
          true
        );
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

grant execute on function sp_importar_remito(uuid, text, jsonb, inet, numeric, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- D4: sp_crear_stock_directo
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_stock_directo(
  p_id_producto  uuid,
  p_costo        numeric default 0,
  p_tipo_ingreso tipo_ingreso default 'compra',
  p_items        jsonb default '[]',
  p_ip           inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_count    integer := 0;
  v_item     jsonb;
  v_talle    text;
  v_cant     integer;
  v_i        integer;
  v_qr       text;
  v_new_item uuid;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from producto where id_producto = p_id_producto and id_tenant = v_tenant
  ) then
    raise exception 'producto-not-found' using errcode = '42704';
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
              v_qr, 'disponible', coalesce(p_costo, 0),
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

  if coalesce(p_costo, 0) > 0 then
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

-- ─────────────────────────────────────────────────────────────────
-- D5: sp_set_costo_producto
-- ─────────────────────────────────────────────────────────────────

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
  v_tenant uuid := auth_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  return sp_aplicar_ultimo_costo(
    p_id_producto,
    p_costo,
    p_moneda,
    p_costo_original_usd,
    p_cotizacion_aplicada,
    p_cotizacion_fecha_valor,
    p_motivo,
    p_ip,
    true
  );
end;
$$;

grant execute on function sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- D5: sp_revaluar_costos_usd_vigentes
-- ─────────────────────────────────────────────────────────────────

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
  v_desactualizada         boolean;
  v_revaluados             integer := 0;
  v_omitidos_sin_original  integer := 0;
  v_sin_cambios            integer := 0;
  r                        record;
  v_costo_nuevo            numeric;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  v_cotizacion := sp_get_cotizacion_vigente();
  v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
  v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;
  v_desactualizada := coalesce((v_cotizacion->>'desactualizada')::boolean, true);

  if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
    raise exception 'sin-cotizacion-dolar' using errcode = '22023';
  end if;

  if v_desactualizada then
    raise exception 'cotizacion-desactualizada' using errcode = '22023';
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
    select id_costo, id_producto, costo, costo_original_usd, cotizacion_aplicada
      from costo_producto
     where id_tenant = v_tenant
       and vigente_hasta is null
       and moneda = 'USD'
       and costo_original_usd is not null
     for update
  loop
    -- Si la cotización aplicada ya es igual a la vigente, omitir sin generar historial
    if r.cotizacion_aplicada is not distinct from v_valor then
      v_sin_cambios := v_sin_cambios + 1;
      continue;
    end if;

    v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);

    perform sp_aplicar_ultimo_costo(
      r.id_producto,
      v_costo_nuevo,
      'USD',
      r.costo_original_usd,
      v_valor,
      v_fecha_valor,
      'revaluacion masiva usd',
      p_ip,
      true
    );

    v_revaluados := v_revaluados + 1;
  end loop;

  return jsonb_build_object(
    'revaluados', v_revaluados,
    'omitidos_sin_original', v_omitidos_sin_original,
    'sin_cambios', v_sin_cambios
  );
end;
$$;

grant execute on function sp_revaluar_costos_usd_vigentes(inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- DOWN: reversión a definiciones anteriores
-- ─────────────────────────────────────────────────────────────────

-- DOWN:
-- drop function if exists sp_aplicar_ultimo_costo(uuid, numeric, text, numeric, numeric, date, text, inet, boolean);
--
-- create or replace function sp_confirmar_ingreso(
--   p_id_ingreso uuid,
--   p_ip         inet default null
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant    uuid := auth_tenant_id();
--   v_actor     uuid := auth.uid();
--   v_confirmado boolean;
--   v_tipo      tipo_ingreso;
--   v_count     integer := 0;
--   v_detalle   record;
--   v_i         integer;
--   v_qr        text;
--   v_new_item  uuid;
-- begin
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
--     return 0;
--   end if;
--
--   for v_detalle in
--     select id_detalle, id_producto, cantidad, costo_unitario, talle
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   loop
--     for v_i in 1 .. v_detalle.cantidad loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
--       values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
--               v_qr, 'disponible', v_detalle.costo_unitario, v_tipo, v_detalle.talle)
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
-- end $$;
--
-- grant execute on function sp_confirmar_ingreso(uuid, inet) to authenticated;
--
-- create or replace function sp_importar_remito(
--   p_id_ingreso            uuid,
--   p_moneda                text default 'ARS',
--   p_lineas                jsonb default '[]',
--   p_ip                    inet default null,
--   p_cotizacion_aplicada    numeric default null,
--   p_cotizacion_fecha_valor date default null
-- ) returns jsonb
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant             uuid := auth_tenant_id();
--   v_actor              uuid := auth.uid();
--   v_linea              jsonb;
--   v_parte              jsonb;
--   v_es_nuevo           boolean;
--   v_id_producto        uuid;
--   v_id_categoria       uuid;
--   v_nombre             text;
--   v_sku                text;
--   v_costo              numeric;
--   v_costo_original_usd numeric;
--   v_talle              text;
--   v_cant               integer;
--   v_id_detalle         uuid;
--   v_creados            integer := 0;
--   v_vinculados         integer := 0;
--   v_detalles           jsonb := '[]'::jsonb;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from ingreso_mercaderia
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   ) then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
--   loop
--     v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false);
--     v_nombre   := trim(v_linea->>'nombre');
--     v_costo    := coalesce((v_linea->>'costoUnitario')::numeric, 0);
--
--     if v_nombre is null or v_nombre = '' then
--       raise exception 'linea-sin-nombre' using errcode = '22023';
--     end if;
--
--     if p_moneda = 'USD' then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
--         v_costo_original_usd := v_costo;
--         v_costo := round(v_costo * p_cotizacion_aplicada, 2);
--       end if;
--     else
--       v_costo_original_usd := null;
--     end if;
--
--     if v_es_nuevo then
--       v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
--       if v_id_categoria is null then
--         raise exception 'falta-categoria: %', v_nombre using errcode = '22023';
--       end if;
--
--       v_sku := sp_gen_sku(v_id_categoria);
--
--       insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo)
--       values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true)
--       returning id_producto into v_id_producto;
--
--       insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--       values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear',
--               jsonb_build_object('nombre', v_nombre, 'sku', v_sku,
--                                  'id_categoria', v_id_categoria,
--                                  'origen', 'import-remito'),
--               p_ip);
--
--       if v_costo > 0 then
--         insert into costo_producto(
--           id_tenant, id_producto, costo, moneda, id_usuario_alta, motivo,
--           costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--         )
--         values (
--           v_tenant, v_id_producto, v_costo, coalesce(p_moneda, 'ARS'), v_actor,
--           'costo inicial (import remito)',
--           case when p_moneda = 'USD' then v_costo_original_usd else null end,
--           case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--           case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
--         );
--
--         insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--         values (v_tenant, v_actor, 'costo_producto', v_id_producto::text, 'crear',
--                 jsonb_build_object('costo_nuevo', v_costo, 'moneda', coalesce(p_moneda, 'ARS'),
--                                    'motivo', 'costo inicial (import remito)',
--                                    'costo_original_usd', v_costo_original_usd,
--                                    'cotizacion_aplicada', p_cotizacion_aplicada,
--                                    'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
--                 p_ip);
--       end if;
--
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
--
--     for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb))
--     loop
--       v_talle := nullif(trim(v_parte->>'talle'), '');
--       v_cant  := coalesce((v_parte->>'cantidad')::integer, 0);
--       if v_cant <= 0 then
--         continue;
--       end if;
--
--       insert into ingreso_mercaderia_detalle(
--         id_tenant, id_ingreso, id_producto,
--         cantidad, costo_unitario, talle,
--         costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--       )
--       values (
--         v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle,
--         case when p_moneda = 'USD' then v_costo_original_usd else null end,
--         case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--         case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
--       )
--       returning id_detalle into v_id_detalle;
--
--       v_detalles := v_detalles || jsonb_build_object(
--         'id_detalle', v_id_detalle,
--         'id_producto', v_id_producto,
--         'nombre', v_nombre,
--         'cantidad', v_cant,
--         'costo_unitario', v_costo,
--         'talle', v_talle,
--         'costo_original_usd', v_costo_original_usd
--       );
--     end loop;
--   end loop;
--
--   return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
-- end;
-- $$;
--
-- grant execute on function sp_importar_remito(uuid, text, jsonb, inet, numeric, date) to authenticated;
--
-- create or replace function sp_crear_stock_directo(
--   p_id_producto  uuid,
--   p_costo        numeric default 0,
--   p_tipo_ingreso tipo_ingreso default 'compra',
--   p_items        jsonb default '[]',
--   p_ip           inet default null
-- ) returns integer language plpgsql as $$
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
--   if v_count > 0 then
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (v_tenant, v_actor, 'item_producto', p_id_producto::text, 'alta-directa',
--             jsonb_build_object('items_generados', v_count, 'costo', p_costo), p_ip);
--   end if;
--
--   return v_count;
-- end $$;
--
-- grant execute on function sp_crear_stock_directo(uuid, numeric, tipo_ingreso, jsonb, inet) to authenticated;
--
-- create or replace function sp_set_costo_producto(
--   p_id_producto            uuid,
--   p_costo                  numeric,
--   p_moneda                 text default 'ARS',
--   p_motivo                 text default null,
--   p_ip                     inet default null,
--   p_costo_original_usd     numeric default null,
--   p_cotizacion_aplicada    numeric default null,
--   p_cotizacion_fecha_valor date default null
-- ) returns uuid
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id       uuid;
--   v_previous numeric;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   update costo_producto
--      set vigente_hasta = now()
--    where id_producto = p_id_producto
--      and vigente_hasta is null
--   returning costo into v_previous;
--
--   insert into costo_producto(
--     id_tenant, id_producto, costo, moneda,
--     id_usuario_alta, motivo,
--     costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--   )
--   values (
--     v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
--     v_actor, p_motivo,
--     p_costo_original_usd, p_cotizacion_aplicada, p_cotizacion_fecha_valor
--   )
--   returning id_costo into v_id;
--
--   perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
--           jsonb_build_object('id_producto', p_id_producto,
--                              'costo_anterior', v_previous,
--                              'costo_nuevo', p_costo,
--                              'moneda', coalesce(p_moneda, 'ARS'),
--                              'motivo', p_motivo,
--                              'costo_original_usd', p_costo_original_usd,
--                              'cotizacion_aplicada', p_cotizacion_aplicada,
--                              'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
--           p_ip);
--   return v_id;
-- end;
-- $$;
--
-- grant execute on function sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date) to authenticated;
--
-- create or replace function sp_revaluar_costos_usd_vigentes(
--   p_ip inet default null
-- ) returns jsonb
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant                 uuid := auth_tenant_id();
--   v_actor                  uuid := auth.uid();
--   v_cotizacion             jsonb;
--   v_valor                  numeric;
--   v_fecha_valor            date;
--   v_desactualizada         boolean;
--   v_revaluados             integer := 0;
--   v_omitidos_sin_original  integer := 0;
--   v_sin_cambios            integer := 0;
--   r                        record;
--   v_id_costo               uuid;
--   v_costo_nuevo            numeric;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   v_cotizacion := sp_get_cotizacion_vigente();
--   v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
--   v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;
--   v_desactualizada := coalesce((v_cotizacion->>'desactualizada')::boolean, true);
--
--   if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
--     raise exception 'sin-cotizacion-dolar' using errcode = '22023';
--   end if;
--
--   if v_desactualizada then
--     raise exception 'cotizacion-desactualizada' using errcode = '22023';
--   end if;
--
--   select count(*)
--     into v_omitidos_sin_original
--     from costo_producto
--    where id_tenant = v_tenant
--      and vigente_hasta is null
--      and moneda = 'USD'
--      and costo_original_usd is null;
--
--   for r in
--     select id_costo, id_producto, costo, costo_original_usd, cotizacion_aplicada
--       from costo_producto
--      where id_tenant = v_tenant
--        and vigente_hasta is null
--        and moneda = 'USD'
--        and costo_original_usd is not null
--      for update
--   loop
--     if r.cotizacion_aplicada is not distinct from v_valor then
--       v_sin_cambios := v_sin_cambios + 1;
--       continue;
--     end if;
--
--     v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);
--
--     update costo_producto
--        set vigente_hasta = now()
--      where id_costo = r.id_costo;
--
--     insert into costo_producto (
--       id_tenant, id_producto, costo, moneda,
--       id_usuario_alta, motivo,
--       costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--     ) values (
--       v_tenant, r.id_producto, v_costo_nuevo, 'USD',
--       v_actor, 'revaluacion masiva usd',
--       r.costo_original_usd, v_valor, v_fecha_valor
--     )
--     returning id_costo into v_id_costo;
--
--     perform sp_marcar_precio_desactualizado_by_producto(r.id_producto);
--
--     insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (
--       v_tenant, v_actor, 'costo_producto', v_id_costo::text, 'revaluar',
--       jsonb_build_object(
--         'id_producto', r.id_producto,
--         'costo_anterior', r.costo,
--         'costo_nuevo', v_costo_nuevo,
--         'costo_original_usd', r.costo_original_usd,
--         'cotizacion_anterior', r.cotizacion_aplicada,
--         'cotizacion_nueva', v_valor,
--         'cotizacion_fecha_valor', v_fecha_valor
--       ),
--       p_ip
--     );
--
--     v_revaluados := v_revaluados + 1;
--   end loop;
--
--   return jsonb_build_object(
--     'revaluados', v_revaluados,
--     'omitidos_sin_original', v_omitidos_sin_original,
--     'sin_cambios', v_sin_cambios
--   );
-- end;
-- $$;
--
-- grant execute on function sp_revaluar_costos_usd_vigentes(inet) to authenticated;
