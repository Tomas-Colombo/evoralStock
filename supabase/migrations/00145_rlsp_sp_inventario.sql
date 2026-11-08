-- 00145_rlsp_sp_inventario.sql
-- Fase 5b-M2 de rls-por-permiso: chequeo de permiso en los 10 sp_* de Inventario.
--
-- UP:
--   1. sp_create_producto: inventario.crear
--   2. sp_crear_stock_directo: inventario.crear
--   3. sp_set_costo_producto: inventario.crear
--   4. sp_importar_remito: inventario.crear
--   5. sp_confirmar_ingreso: inventario.crear
--   6. sp_asignar_talles_a_producto: inventario.editar
--   7. sp_cancelar_ingreso: inventario.eliminar OR inventario.crear (rollback de crearIngresoCompletoAction)
--   8. sp_aplicar_ultimo_costo: inventario.crear OR precios.editar_cotizacion
--   9. sp_marcar_precio_desactualizado_by_producto: inventario.crear OR precios.editar_cotizacion
--   10. sp_transicion_item_producto: ventas.crear OR ventas.editar OR inventario.editar OR consignaciones.editar OR consignaciones.eliminar OR revendedoras.crear OR revendedoras.editar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_create_producto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_create_producto(
  p_id_categoria uuid,
  p_nombre       text,
  p_sku          text default null,
  p_stock_minimo integer default 0,
  p_descripcion  text default null,
  p_ip           inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
  v_sku    text;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- SKU explícito (si vino) o autogenerado.
  v_sku := nullif(trim(p_sku), '');
  if v_sku is null then
    v_sku := sp_gen_sku(p_id_categoria);
  end if;

  insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, descripcion)
  values (v_tenant, p_id_categoria, p_nombre, v_sku, coalesce(p_stock_minimo, 0), p_descripcion)
  returning id_producto into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'sku', v_sku,
                             'id_categoria', p_id_categoria,
                             'stock_minimo', p_stock_minimo),
          p_ip);

  return v_id;
end $$;

grant execute on function sp_create_producto(uuid, text, text, integer, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_crear_stock_directo
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
  if not (select auth_tiene_permiso('inventario', 'crear')) then
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
-- 3. sp_set_costo_producto
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
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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
-- 4. sp_importar_remito
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
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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
-- 5. sp_confirmar_ingreso
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
-- 6. sp_asignar_talles_a_producto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_asignar_talles_a_producto(
  p_id_producto  uuid,
  p_distribucion jsonb,
  p_ip           inet default null
) returns integer language plpgsql as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_talles_cat   text[];
  v_disponibles  integer;
  v_total_dist   integer := 0;
  v_asignados    integer := 0;
  v_entrada      record;
  v_item         record;
begin
  if not (select auth_tiene_permiso('inventario', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select c.talles into v_talles_cat
    from producto p
    join categoria c on c.id_categoria = p.id_categoria
   where p.id_producto = p_id_producto
     and p.id_tenant   = v_tenant;

  if v_talles_cat is null then
    raise exception 'producto-not-found' using errcode = '42704';
  end if;

  if array_length(v_talles_cat, 1) is null then
    raise exception 'categoria-sin-talles' using errcode = '22023';
  end if;

  for v_entrada in
    select (elem->>'talle')::text as talle,
           (elem->>'cantidad')::integer as cantidad
      from jsonb_array_elements(p_distribucion) as elem
  loop
    if v_entrada.cantidad is null or v_entrada.cantidad <= 0 then
      raise exception 'cantidad-invalida' using errcode = '22023';
    end if;
    if not (v_entrada.talle = ANY(v_talles_cat)) then
      raise exception 'talle-no-valido: %', v_entrada.talle using errcode = '22023';
    end if;
    v_total_dist := v_total_dist + v_entrada.cantidad;
  end loop;

  if v_total_dist = 0 then
    return 0;
  end if;

  select count(*) into v_disponibles
    from item_producto
   where id_tenant   = v_tenant
     and id_producto = p_id_producto
     and talle is null
     and estado_item = 'disponible';

  if v_total_dist > v_disponibles then
    raise exception 'excede-disponibles: pide % pero hay %', v_total_dist, v_disponibles
      using errcode = '22023';
  end if;

  for v_entrada in
    select (elem->>'talle')::text as talle,
           (elem->>'cantidad')::integer as cantidad
      from jsonb_array_elements(p_distribucion) as elem
  loop
    for v_item in
      select id_item
        from item_producto
       where id_tenant   = v_tenant
         and id_producto = p_id_producto
         and talle is null
         and estado_item = 'disponible'
       order by fecha_ingreso asc, id_item asc
       limit v_entrada.cantidad
       for update
    loop
      update item_producto
         set talle = v_entrada.talle
       where id_item = v_item.id_item;

      -- Fix vs 00044: `referencia_id` es uuid, no text. Pasamos el uuid crudo
      -- igual que hace sp_confirmar_ingreso con `p_id_ingreso`.
      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id,
                                  diferencia, id_usuario)
      values (v_tenant, v_item.id_item, 'ajuste',
              'disponible', 'disponible',
              'producto', p_id_producto,
              jsonb_build_object('talle_asignado', v_entrada.talle),
              v_actor);

      v_asignados := v_asignados + 1;
    end loop;
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', p_id_producto::text, 'asignar_talles',
          jsonb_build_object('distribucion', p_distribucion,
                             'items_actualizados', v_asignados),
          p_ip);

  return v_asignados;
end $$;

grant execute on function sp_asignar_talles_a_producto(uuid, jsonb, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. sp_cancelar_ingreso
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_cancelar_ingreso(
  p_id_ingreso uuid,
  p_motivo     text default null,
  p_ip         inet default null
) returns jsonb language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_confirmado boolean;
  v_cancelado  timestamptz;
  v_movidos    integer;
  v_items      integer := 0;
  v_prods      integer := 0;
  v_prod_ids   uuid[];
begin
  if not (
    (select auth_tiene_permiso('inventario', 'eliminar'))
    or (select auth_tiene_permiso('inventario', 'crear'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select confirmado, cancelado_at into v_confirmado, v_cancelado
    from ingreso_mercaderia
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant
   for update;
  if v_confirmado is null then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;
  if v_cancelado is not null then
    raise exception 'ingreso-ya-cancelado' using errcode = '22023';
  end if;

  -- Confirmado: solo si TODOS los ítems siguen 'disponible'. Si alguno se
  -- movió, no se puede revertir sin deshacer esa operación primero.
  if v_confirmado then
    select count(*) into v_movidos
      from item_producto
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
       and estado_item <> 'disponible';
    if v_movidos > 0 then
      raise exception 'ingreso-con-items-movidos: %', v_movidos using errcode = '22023';
    end if;
  end if;

  -- Productos tocados por este ingreso (para evaluar el borrado de los creados acá).
  select array_agg(distinct id_producto) into v_prod_ids
    from ingreso_mercaderia_detalle
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant;

  -- 1) Borrar los ítems generados por este ingreso (el stock agregado).
  --    movimiento_item cascada por FK.
  delete from item_producto
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant;
  get diagnostics v_items = row_count;

  -- 2) Borrar el detalle del ingreso (libera la FK RESTRICT sobre producto).
  delete from ingreso_mercaderia_detalle
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant;

  -- 3) Borrar los productos creados en este ingreso (es_nuevo) que quedaron
  --    huérfanos: sin ítems y sin otro detalle de ingreso. Los preexistentes
  --    se conservan. costo_producto / precios cascadean.
  if v_prod_ids is not null then
    delete from producto p
     where p.id_tenant = v_tenant
       and p.es_nuevo
       and p.id_producto = any(v_prod_ids)
       and not exists (select 1 from item_producto i where i.id_producto = p.id_producto)
       and not exists (
         select 1 from ingreso_mercaderia_detalle d where d.id_producto = p.id_producto
       );
    get diagnostics v_prods = row_count;
  end if;

  -- 4) Borrar la cabecera → el ingreso desaparece de la lista.
  delete from ingreso_mercaderia
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text,
          case when v_confirmado then 'cancelar' else 'cancelar-borrador' end,
          jsonb_build_object(
            'items_eliminados', v_items,
            'productos_eliminados', v_prods,
            'motivo', p_motivo
          ), p_ip);

  return jsonb_build_object(
    'modo', case when v_confirmado then 'confirmado' else 'borrador' end,
    'items_baja', v_items,
    'productos_eliminados', v_prods
  );
end $$;

grant execute on function sp_cancelar_ingreso(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. sp_aplicar_ultimo_costo
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
  if not (
    (select auth_tiene_permiso('inventario', 'crear'))
    or (select auth_tiene_permiso('precios', 'editar_cotizacion'))
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

grant execute on function sp_aplicar_ultimo_costo(uuid, numeric, text, numeric, numeric, date, text, inet, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. sp_marcar_precio_desactualizado_by_producto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_marcar_precio_desactualizado_by_producto(
  p_id_producto uuid
) returns void language plpgsql as $$
begin
  if not (
    (select auth_tiene_permiso('inventario', 'crear'))
    or (select auth_tiene_permiso('precios', 'editar_cotizacion'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  update producto
     set precio_venta_desactualizado = true
   where id_producto = p_id_producto and id_tenant = auth_tenant_id();
end;
$$;

grant execute on function sp_marcar_precio_desactualizado_by_producto(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. sp_transicion_item_producto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_transicion_item_producto(
  p_id_item        uuid,
  p_estado_hasta   estado_item,
  p_tipo_movimiento text,
  p_referencia_id  uuid default null,
  p_referencia_tipo text default null,
  p_ip             inet default null
) returns void language plpgsql as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_actor   uuid := auth.uid();
  v_desde   estado_item;
begin
  if not (
    (select auth_tiene_permiso('ventas', 'crear'))
    or (select auth_tiene_permiso('ventas', 'editar'))
    or (select auth_tiene_permiso('inventario', 'editar'))
    or (select auth_tiene_permiso('consignaciones', 'editar'))
    or (select auth_tiene_permiso('consignaciones', 'eliminar'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
    or (select auth_tiene_permiso('revendedoras', 'editar'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Lock optimista: SELECT ... FOR UPDATE evita carreras
  -- (Etapa 5 §98 "dos escaneos simultáneos no duplican la venta").
  select estado_item into v_desde
    from item_producto
   where id_item = p_id_item and id_tenant = v_tenant
   for update;

  if v_desde is null then
    raise exception 'item-not-found' using errcode = '42704';
  end if;

  if not is_transicion_item_valida(v_desde, p_estado_hasta) then
    raise exception 'invalid-transition: % -> %', v_desde, p_estado_hasta
      using errcode = '22023';
  end if;

  update item_producto
     set estado_item = p_estado_hasta,
         fecha_venta = case when p_estado_hasta = 'vendido' then now() else fecha_venta end,
         fecha_devolucion = case when p_estado_hasta in ('devuelto', 'devuelto_cliente')
                                 then now() else fecha_devolucion end
   where id_item = p_id_item;

  insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                              estado_desde, estado_hasta,
                              referencia_tipo, referencia_id, id_usuario)
  values (v_tenant, p_id_item, p_tipo_movimiento,
          v_desde, p_estado_hasta,
          p_referencia_tipo, p_referencia_id, v_actor);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'item_producto', p_id_item::text, p_tipo_movimiento,
          jsonb_build_object('desde', v_desde, 'hasta', p_estado_hasta,
                             'referencia', jsonb_build_object('tipo', p_referencia_tipo,
                                                              'id', p_referencia_id)),
          p_ip);
end $$;

grant execute on function sp_transicion_item_producto(uuid, estado_item, text, uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Reversión a definiciones anteriores
-- ─────────────────────────────────────────────────────────────────

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_create_producto
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_create_producto(
--   p_id_categoria uuid,
--   p_nombre       text,
--   p_sku          text default null,
--   p_stock_minimo integer default 0,
--   p_descripcion  text default null,
--   p_ip           inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
--   v_sku    text;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- SKU explícito (si vino) o autogenerado.
--   v_sku := nullif(trim(p_sku), '');
--   if v_sku is null then
--     v_sku := sp_gen_sku(p_id_categoria);
--   end if;
--
--   insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, descripcion)
--   values (v_tenant, p_id_categoria, p_nombre, v_sku, coalesce(p_stock_minimo, 0), p_descripcion)
--   returning id_producto into v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'producto', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'sku', v_sku,
--                              'id_categoria', p_id_categoria,
--                              'stock_minimo', p_stock_minimo),
--           p_ip);
--
--   return v_id;
-- end $$;
--
-- grant execute on function sp_create_producto(uuid, text, text, integer, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_crear_stock_directo
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
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_set_costo_producto
-- NOTE: ────────────────────────────────────────────────────────────
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
--   v_tenant uuid := auth_tenant_id();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   return sp_aplicar_ultimo_costo(
--     p_id_producto,
--     p_costo,
--     p_moneda,
--     p_costo_original_usd,
--     p_cotizacion_aplicada,
--     p_cotizacion_fecha_valor,
--     p_motivo,
--     p_ip,
--     true
--   );
-- end;
-- $$;
--
-- grant execute on function sp_set_costo_producto(uuid, numeric, text, text, inet, numeric, numeric, date) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_importar_remito
-- NOTE: ────────────────────────────────────────────────────────────
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
--   -- D3: Validar que no existan costos distintos para el mismo producto en p_lineas
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
--   loop
--     v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
--     v_nombre   := trim(v_linea->>'nombre');
--     v_costo    := coalesce((v_linea->>'costoUnitario')::numeric, 0);
--
--     if p_moneda = 'USD' then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
--         v_costo := round(v_costo * p_cotizacion_aplicada, 2);
--       end if;
--     end if;
--
--     -- Comparar contra otras líneas de p_lineas
--     if exists (
--       select 1
--         from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) other
--        where (
--          (v_id_producto is not null and nullif(other->>'idProducto', '')::uuid = v_id_producto)
--          or (v_id_producto is null and trim(other->>'nombre') = v_nombre)
--        )
--        and (
--          case when p_moneda = 'USD' and nullif(other->>'costoOriginalUsd', '') is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0
--               then round(coalesce((other->>'costoUnitario')::numeric, 0) * p_cotizacion_aplicada, 2)
--               else coalesce((other->>'costoUnitario')::numeric, 0)
--          end
--        ) <> v_costo
--     ) then
--       raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
--     end if;
--   end loop;
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
--         perform sp_aplicar_ultimo_costo(
--           v_id_producto,
--           v_costo,
--           coalesce(p_moneda, 'ARS'),
--           case when p_moneda = 'USD' then v_costo_original_usd else null end,
--           case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--           case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end,
--           'costo inicial (import remito)',
--           p_ip,
--           true
--         );
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
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_confirmar_ingreso
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_confirmar_ingreso(
--   p_id_ingreso uuid,
--   p_ip         inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
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
--   v_prod      record;
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
--     return 0;  -- idempotente
--   end if;
--
--   -- D3: si dos líneas del mismo producto traen costos distintos, rechazar
--   if exists (
--     select 1
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--      group by id_producto
--     having count(distinct costo_unitario) > 1
--   ) then
--     raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
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
--   -- D2: llamar a D1 una vez por producto del ingreso.
--   -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
--   for v_prod in
--     select id_producto,
--            costo_unitario,
--            costo_original_usd,
--            cotizacion_aplicada,
--            cotizacion_fecha_valor,
--            case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
--       from (
--         select distinct on (id_producto)
--                id_producto,
--                costo_unitario,
--                costo_original_usd,
--                cotizacion_aplicada,
--                cotizacion_fecha_valor
--           from ingreso_mercaderia_detalle
--          where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--          order by id_producto, id_detalle
--       ) s
--   loop
--     if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
--       perform sp_aplicar_ultimo_costo(
--         v_prod.id_producto,
--         v_prod.costo_unitario,
--         v_prod.moneda,
--         v_prod.costo_original_usd,
--         v_prod.cotizacion_aplicada,
--         v_prod.cotizacion_fecha_valor,
--         'ingreso mercaderia',
--         p_ip,
--         v_tipo <> 'consignacion'
--       );
--     end if;
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
-- end;
-- $$;
--
-- grant execute on function sp_confirmar_ingreso(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_asignar_talles_a_producto
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_asignar_talles_a_producto(
--   p_id_producto  uuid,
--   p_distribucion jsonb,
--   p_ip           inet default null
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_talles_cat   text[];
--   v_disponibles  integer;
--   v_total_dist   integer := 0;
--   v_asignados    integer := 0;
--   v_entrada      record;
--   v_item         record;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select c.talles into v_talles_cat
--     from producto p
--     join categoria c on c.id_categoria = p.id_categoria
--    where p.id_producto = p_id_producto
--      and p.id_tenant   = v_tenant;
--
--   if v_talles_cat is null then
--     raise exception 'producto-not-found' using errcode = '42704';
--   end if;
--
--   if array_length(v_talles_cat, 1) is null then
--     raise exception 'categoria-sin-talles' using errcode = '22023';
--   end if;
--
--   for v_entrada in
--     select (elem->>'talle')::text as talle,
--            (elem->>'cantidad')::integer as cantidad
--       from jsonb_array_elements(p_distribucion) as elem
--   loop
--     if v_entrada.cantidad is null or v_entrada.cantidad <= 0 then
--       raise exception 'cantidad-invalida' using errcode = '22023';
--     end if;
--     if not (v_entrada.talle = ANY(v_talles_cat)) then
--       raise exception 'talle-no-valido: %', v_entrada.talle using errcode = '22023';
--     end if;
--     v_total_dist := v_total_dist + v_entrada.cantidad;
--   end loop;
--
--   if v_total_dist = 0 then
--     return 0;
--   end if;
--
--   select count(*) into v_disponibles
--     from item_producto
--    where id_tenant   = v_tenant
--      and id_producto = p_id_producto
--      and talle is null
--      and estado_item = 'disponible';
--
--   if v_total_dist > v_disponibles then
--     raise exception 'excede-disponibles: pide % pero hay %', v_total_dist, v_disponibles
--       using errcode = '22023';
--   end if;
--
--   for v_entrada in
--     select (elem->>'talle')::text as talle,
--            (elem->>'cantidad')::integer as cantidad
--       from jsonb_array_elements(p_distribucion) as elem
--   loop
--     for v_item in
--       select id_item
--         from item_producto
--        where id_tenant   = v_tenant
--          and id_producto = p_id_producto
--          and talle is null
--          and estado_item = 'disponible'
--        order by fecha_ingreso asc, id_item asc
--        limit v_entrada.cantidad
--        for update
--     loop
--       update item_producto
--          set talle = v_entrada.talle
--        where id_item = v_item.id_item;
--
--       -- Fix vs 00044: `referencia_id` es uuid, no text. Pasamos el uuid crudo
--       -- igual que hace sp_confirmar_ingreso con `p_id_ingreso`.
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id,
--                                   diferencia, id_usuario)
--       values (v_tenant, v_item.id_item, 'ajuste',
--               'disponible', 'disponible',
--               'producto', p_id_producto,
--               jsonb_build_object('talle_asignado', v_entrada.talle),
--               v_actor);
--
--       v_asignados := v_asignados + 1;
--     end loop;
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'producto', p_id_producto::text, 'asignar_talles',
--          jsonb_build_object('distribucion', p_distribucion,
--                             'items_actualizados', v_asignados),
--          p_ip);
--
--   return v_asignados;
-- end $$;
--
-- grant execute on function sp_asignar_talles_a_producto(uuid, jsonb, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_cancelar_ingreso
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_cancelar_ingreso(
--   p_id_ingreso uuid,
--   p_motivo     text default null,
--   p_ip         inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_confirmado boolean;
--   v_cancelado  timestamptz;
--   v_movidos    integer;
--   v_items      integer := 0;
--   v_prods      integer := 0;
--   v_prod_ids   uuid[];
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select confirmado, cancelado_at into v_confirmado, v_cancelado
--     from ingreso_mercaderia
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--    for update;
--   if v_confirmado is null then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--   if v_cancelado is not null then
--     raise exception 'ingreso-ya-cancelado' using errcode = '22023';
--   end if;
--
--   -- Confirmado: solo si TODOS los ítems siguen 'disponible'. Si alguno se
--   -- movió, no se puede revertir sin deshacer esa operación primero.
--   if v_confirmado then
--     select count(*) into v_movidos
--       from item_producto
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--        and estado_item <> 'disponible';
--     if v_movidos > 0 then
--       raise exception 'ingreso-con-items-movidos: %', v_movidos using errcode = '22023';
--     end if;
--   end if;
--
--   -- Productos tocados por este ingreso (para evaluar el borrado de los creados acá).
--   select array_agg(distinct id_producto) into v_prod_ids
--     from ingreso_mercaderia_detalle
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant;
--
--   -- 1) Borrar los ítems generados por este ingreso (el stock agregado).
--   --    movimiento_item cascada por FK.
--   delete from item_producto
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant;
--   get diagnostics v_items = row_count;
--
--   -- 2) Borrar el detalle del ingreso (libera la FK RESTRICT sobre producto).
--   delete from ingreso_mercaderia_detalle
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant;
--
--   -- 3) Borrar los productos creados en este ingreso (es_nuevo) que quedaron
--   --    huérfanos: sin ítems y sin otro detalle de ingreso. Los preexistentes
--   --    se conservan. costo_producto / precios cascadean.
--   if v_prod_ids is not null then
--     delete from producto p
--      where p.id_tenant = v_tenant
--        and p.es_nuevo
--        and p.id_producto = any(v_prod_ids)
--        and not exists (select 1 from item_producto i where i.id_producto = p.id_producto)
--        and not exists (
--          select 1 from ingreso_mercaderia_detalle d where d.id_producto = p.id_producto
--        );
--     get diagnostics v_prods = row_count;
--   end if;
--
--   -- 4) Borrar la cabecera → el ingreso desaparece de la lista.
--   delete from ingreso_mercaderia
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text,
--           case when v_confirmado then 'cancelar' else 'cancelar-borrador' end,
--           jsonb_build_object(
--             'items_eliminados', v_items,
--             'productos_eliminados', v_prods,
--             'motivo', p_motivo
--           ), p_ip);
--
--   return jsonb_build_object(
--     'modo', case when v_confirmado then 'confirmado' else 'borrador' end,
--     'items_baja', v_items,
--     'productos_eliminados', v_prods
--   );
-- end $$;
--
-- grant execute on function sp_cancelar_ingreso(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_aplicar_ultimo_costo
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_vigente      record;
--   v_id           uuid;
--   v_es_igual     boolean := false;
-- begin
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
--     update item_producto
--        set costo_ingreso = p_costo
--      where id_tenant = v_tenant
--        and id_producto = p_id_producto
--        and tipo_ingreso = 'compra'
--        and estado_item in ('disponible', 'reservado', 'en_revendedora');
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
-- grant execute on function sp_aplicar_ultimo_costo(uuid, numeric, text, numeric, numeric, date, text, inet, boolean) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_marcar_precio_desactualizado_by_producto
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_marcar_precio_desactualizado_by_producto(
--   p_id_producto uuid
-- ) returns void language sql as $$
--   update producto
--      set precio_venta_desactualizado = true
--    where id_producto = p_id_producto and id_tenant = auth_tenant_id();
-- $$;
--
-- grant execute on function sp_marcar_precio_desactualizado_by_producto(uuid) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_transicion_item_producto
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_transicion_item_producto(
--   p_id_item        uuid,
--   p_estado_hasta   estado_item,
--   p_tipo_movimiento text,
--   p_referencia_id  uuid default null,
--   p_referencia_tipo text default null,
--   p_ip             inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_actor   uuid := auth.uid();
--   v_desde   estado_item;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Lock optimista: SELECT ... FOR UPDATE evita carreras
--   -- (Etapa 5 §98 "dos escaneos simultáneos no duplican la venta").
--   select estado_item into v_desde
--     from item_producto
--    where id_item = p_id_item and id_tenant = v_tenant
--    for update;
--
--   if v_desde is null then
--     raise exception 'item-not-found' using errcode = '42704';
--   end if;
--
--   if not is_transicion_item_valida(v_desde, p_estado_hasta) then
--     raise exception 'invalid-transition: % -> %', v_desde, p_estado_hasta
--       using errcode = '22023';
--   end if;
--
--   update item_producto
--      set estado_item = p_estado_hasta,
--          fecha_venta = case when p_estado_hasta = 'vendido' then now() else fecha_venta end,
--          fecha_devolucion = case when p_estado_hasta in ('devuelto', 'devuelto_cliente')
--                                  then now() else fecha_devolucion end
--    where id_item = p_id_item;
--
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--   values (v_tenant, p_id_item, p_tipo_movimiento,
--           v_desde, p_estado_hasta,
--           p_referencia_tipo, p_referencia_id, v_actor);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'item_producto', p_id_item::text, p_tipo_movimiento,
--           jsonb_build_object('desde', v_desde, 'hasta', p_estado_hasta,
--                              'referencia', jsonb_build_object('tipo', p_referencia_tipo,
--                                                               'id', p_referencia_id)),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_transicion_item_producto(uuid, estado_item, text, uuid, text, inet) to authenticated;
