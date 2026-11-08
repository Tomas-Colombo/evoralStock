-- 00146_rlsp_sp_precios.sql
-- Fase 5b-M3 de rls-por-permiso: chequeo de permiso en los 10 sp_* de Precios.
--
-- UP:
--   1. sp_create_regla_precio: precios.crear
--   2. sp_baja_regla_precio: precios.eliminar
--   3. sp_extender_vigencia_regla: precios.editar
--   4. sp_recalcular_precio_venta: precios.editar
--   5. sp_recalcular_precios_batch: precios.editar
--   6. sp_set_cotizacion_manual: precios.editar_cotizacion
--   7. sp_set_modo_cotizacion: precios.editar_cotizacion
--   8. sp_registrar_cotizacion_bcra: inventario.crear OR precios.editar_cotizacion
--   9. sp_revaluar_costos_usd_vigentes: precios.editar_cotizacion
--   10. sp_marcar_precio_desactualizado_by_regla: precios.crear OR precios.eliminar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_create_regla_precio
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_create_regla_precio(
  p_nombre       text,
  p_tipo_regla   tipo_regla,
  p_tipo_valor   tipo_valor_regla,
  p_valor        numeric,
  p_alcance      alcance_regla,
  p_id_producto  uuid default null,
  p_id_categoria uuid default null,
  p_id_proveedor uuid default null,
  p_forma_pago   forma_pago default null,
  p_prioridad    integer default 0,
  p_fecha_inicio timestamptz default null,
  p_fecha_hasta  timestamptz default null,
  p_acumulable   boolean default false,
  p_ip           inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('precios', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  insert into regla_precio(
    id_tenant, nombre, tipo_regla, tipo_valor, valor, alcance,
    id_producto, id_categoria, id_proveedor, forma_pago,
    prioridad, fecha_inicio, fecha_hasta, acumulable
  ) values (
    v_tenant, p_nombre, p_tipo_regla, p_tipo_valor, p_valor, p_alcance,
    p_id_producto, p_id_categoria, p_id_proveedor, p_forma_pago,
    coalesce(p_prioridad, 0), p_fecha_inicio, p_fecha_hasta,
    -- acumulable sólo aplica a descuentos; para margen/recargo se guarda false.
    case when p_tipo_regla = 'descuento' then coalesce(p_acumulable, false) else false end
  ) returning id_regla into v_id;

  if p_tipo_regla = 'margen' then
    perform sp_marcar_precio_desactualizado_by_regla(v_id);
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'regla_precio', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'tipo_regla', p_tipo_regla,
                             'tipo_valor', p_tipo_valor, 'valor', p_valor,
                             'alcance', p_alcance, 'forma_pago', p_forma_pago,
                             'prioridad', p_prioridad, 'acumulable', p_acumulable),
          p_ip);
  return v_id;
end $$;

grant execute on function sp_create_regla_precio(text, tipo_regla, tipo_valor_regla, numeric, alcance_regla, uuid, uuid, uuid, forma_pago, integer, timestamptz, timestamptz, boolean, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_baja_regla_precio
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_baja_regla_precio(
  p_id_regla uuid,
  p_ip       inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_regla  regla_precio;
begin
  if not (select auth_tiene_permiso('precios', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select * into v_regla from regla_precio
    where id_regla = p_id_regla and id_tenant = v_tenant;
  if v_regla.id_regla is null then
    raise exception 'regla-not-found' using errcode = '42704';
  end if;
  if v_regla.fecha_baja is not null then
    return; -- idempotente
  end if;

  update regla_precio set fecha_baja = now() where id_regla = p_id_regla;

  if v_regla.tipo_regla = 'margen' then
    perform sp_marcar_precio_desactualizado_by_regla(p_id_regla);
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'regla_precio', p_id_regla::text, 'baja',
          jsonb_build_object('nombre', v_regla.nombre),
          p_ip);
end $$;

grant execute on function sp_baja_regla_precio(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. sp_extender_vigencia_regla
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_extender_vigencia_regla(
  p_id_regla     uuid,
  p_fecha_hasta  timestamptz,
  p_ip           inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_prev   timestamptz;
begin
  if not (select auth_tiene_permiso('precios', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select fecha_hasta into v_prev from regla_precio
    where id_regla = p_id_regla and id_tenant = v_tenant;
  if not found then
    raise exception 'regla-not-found' using errcode = '42704';
  end if;

  update regla_precio set fecha_hasta = p_fecha_hasta
   where id_regla = p_id_regla;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'regla_precio', p_id_regla::text, 'extender_vigencia',
          jsonb_build_object('fecha_hasta_anterior', v_prev,
                             'fecha_hasta_nueva', p_fecha_hasta),
          p_ip);
end $$;

grant execute on function sp_extender_vigencia_regla(uuid, timestamptz, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. sp_recalcular_precio_venta
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('precios', 'editar')) then
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
  elsif v_regla.tipo_valor = 'porcentaje' then
    v_precio_nuevo := v_costo * (1 + v_regla.valor);
  else
    v_precio_nuevo := v_costo + v_regla.valor;
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

grant execute on function sp_recalcular_precio_venta(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. sp_recalcular_precios_batch
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_recalcular_precios_batch(
  p_ids uuid[],
  p_ip  inet default null
) returns table (
  id_producto uuid,
  precio      numeric
) language plpgsql as $$
declare
  v_id uuid;
begin
  if not (select auth_tiene_permiso('precios', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if auth_tenant_id() is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      id_producto := v_id;
      precio := sp_recalcular_precio_venta(v_id, p_ip);
    exception when others then
      -- El subbloque revierte solo lo de ESTE producto (incluida su
      -- fila de auditoría); los ya procesados quedan firmes.
      id_producto := v_id;
      precio := null;
    end;
    return next;
  end loop;
end $$;

grant execute on function sp_recalcular_precios_batch(uuid[], inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. sp_set_cotizacion_manual
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_cotizacion_manual(
  p_valor numeric,
  p_ip inet
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor uuid := auth.uid();
  v_hoy date;
begin
  if not (select auth_tiene_permiso('precios', 'editar_cotizacion')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'cotizacion-manual-invalida' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from tenant
   where id_tenant = v_tenant;

  insert into cotizacion_config (
    id_tenant,
    modo,
    updated_at,
    id_usuario_modificacion
  ) values (
    v_tenant,
    'manual',
    now(),
    v_actor
  )
  on conflict (id_tenant)
  do update set modo = 'manual',
                updated_at = now(),
                id_usuario_modificacion = v_actor;

  insert into cotizacion_dolar (
    id_tenant,
    fecha,
    valor,
    origen,
    fecha_valor,
    desactualizada,
    id_usuario,
    created_at
  ) values (
    v_tenant,
    v_hoy,
    p_valor,
    'manual',
    v_hoy,
    false,
    v_actor,
    now()
  )
  on conflict (id_tenant, fecha, origen)
  do update set valor = excluded.valor,
                fecha_valor = excluded.fecha_valor,
                desactualizada = excluded.desactualizada,
                id_usuario = excluded.id_usuario,
                created_at = excluded.created_at;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'cotizacion_dolar',
    v_hoy::text || ':manual',
    'actualizar',
    jsonb_build_object('valor', p_valor, 'modo', 'manual'),
    p_ip
  );
end;
$$;

grant execute on function sp_set_cotizacion_manual(numeric, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. sp_set_modo_cotizacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_modo_cotizacion(
  p_modo text,
  p_ip inet
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('precios', 'editar_cotizacion')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_modo is null or p_modo not in ('automatica', 'manual') then
    raise exception 'modo-cotizacion-invalido' using errcode = '22023';
  end if;

  insert into cotizacion_config (
    id_tenant,
    modo,
    updated_at,
    id_usuario_modificacion
  ) values (
    v_tenant,
    p_modo,
    now(),
    v_actor
  )
  on conflict (id_tenant)
  do update set modo = p_modo,
                updated_at = now(),
                id_usuario_modificacion = v_actor;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'cotizacion_config',
    v_tenant::text,
    'actualizar',
    jsonb_build_object('modo', p_modo),
    p_ip
  );
end;
$$;

grant execute on function sp_set_modo_cotizacion(text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. sp_registrar_cotizacion_bcra
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_registrar_cotizacion_bcra(
  p_valor numeric,
  p_fecha_valor date,
  p_desactualizada boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_hoy date;
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

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor-invalido' using errcode = '22023';
  end if;

  if p_fecha_valor is null then
    raise exception 'fecha-invalida' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from tenant
   where id_tenant = v_tenant;

  insert into cotizacion_dolar (
    id_tenant,
    fecha,
    valor,
    origen,
    fecha_valor,
    desactualizada,
    id_usuario,
    created_at
  ) values (
    v_tenant,
    v_hoy,
    p_valor,
    'bcra',
    p_fecha_valor,
    coalesce(p_desactualizada, false),
    null,
    now()
  )
  on conflict (id_tenant, fecha, origen)
  do update set valor = excluded.valor,
                fecha_valor = excluded.fecha_valor,
                desactualizada = excluded.desactualizada,
                created_at = excluded.created_at;
end;
$$;

grant execute on function sp_registrar_cotizacion_bcra(numeric, date, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. sp_revaluar_costos_usd_vigentes
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
  if not (select auth_tiene_permiso('precios', 'editar_cotizacion')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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
-- 10. sp_marcar_precio_desactualizado_by_regla
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_marcar_precio_desactualizado_by_regla(
  p_id_regla uuid
) returns integer language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_regla  regla_precio;
  v_count  integer := 0;
begin
  if not (
    (select auth_tiene_permiso('precios', 'crear'))
    or (select auth_tiene_permiso('precios', 'eliminar'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select * into v_regla from regla_precio
    where id_regla = p_id_regla and id_tenant = v_tenant;
  if v_regla.id_regla is null then return 0; end if;

  -- Solo reglas de margen impactan precio_venta. Descuento/recargo se
  -- resuelven en venta.
  if v_regla.tipo_regla <> 'margen' then return 0; end if;

  if v_regla.alcance = 'producto' then
    update producto set precio_venta_desactualizado = true
     where id_producto = v_regla.id_producto and id_tenant = v_tenant;
    get diagnostics v_count = row_count;
  elsif v_regla.alcance = 'categoria' then
    update producto set precio_venta_desactualizado = true
     where id_categoria = v_regla.id_categoria and id_tenant = v_tenant;
    get diagnostics v_count = row_count;
  else
    -- proveedor / global: marca todos los productos del tenant (barrida).
    -- Los proveedores no están mapeados directamente en producto — es un
    -- catch-all seguro.
    update producto set precio_venta_desactualizado = true
     where id_tenant = v_tenant;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end $$;

grant execute on function sp_marcar_precio_desactualizado_by_regla(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Reversión a definiciones anteriores
-- ─────────────────────────────────────────────────────────────────

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_create_regla_precio (00046_descuentos_seleccionables.sql:217)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_create_regla_precio(
--   p_nombre       text,
--   p_tipo_regla   tipo_regla,
--   p_tipo_valor   tipo_valor_regla,
--   p_valor        numeric,
--   p_alcance      alcance_regla,
--   p_id_producto  uuid default null,
--   p_id_categoria uuid default null,
--   p_id_proveedor uuid default null,
--   p_forma_pago   forma_pago default null,
--   p_prioridad    integer default 0,
--   p_fecha_inicio timestamptz default null,
--   p_fecha_hasta  timestamptz default null,
--   p_acumulable   boolean default false,
--   p_ip           inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   insert into regla_precio(
--     id_tenant, nombre, tipo_regla, tipo_valor, valor, alcance,
--     id_producto, id_categoria, id_proveedor, forma_pago,
--     prioridad, fecha_inicio, fecha_hasta, acumulable
--   ) values (
--     v_tenant, p_nombre, p_tipo_regla, p_tipo_valor, p_valor, p_alcance,
--     p_id_producto, p_id_categoria, p_id_proveedor, p_forma_pago,
--     coalesce(p_prioridad, 0), p_fecha_inicio, p_fecha_hasta,
--     -- acumulable sólo aplica a descuentos; para margen/recargo se guarda false.
--     case when p_tipo_regla = 'descuento' then coalesce(p_acumulable, false) else false end
--   ) returning id_regla into v_id;
--
--   if p_tipo_regla = 'margen' then
--     perform sp_marcar_precio_desactualizado_by_regla(v_id);
--   end if;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'regla_precio', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'tipo_regla', p_tipo_regla,
--                              'tipo_valor', p_tipo_valor, 'valor', p_valor,
--                              'alcance', p_alcance, 'forma_pago', p_forma_pago,
--                              'prioridad', p_prioridad, 'acumulable', p_acumulable),
--           p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_create_regla_precio(text, tipo_regla, tipo_valor_regla, numeric, alcance_regla, uuid, uuid, uuid, forma_pago, integer, timestamptz, timestamptz, boolean, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_baja_regla_precio (00019_precios_functions.sql:463)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_baja_regla_precio(
--   p_id_regla uuid,
--   p_ip       inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_regla  regla_precio;
-- begin
--   select * into v_regla from regla_precio
--     where id_regla = p_id_regla and id_tenant = v_tenant;
--   if v_regla.id_regla is null then
--     raise exception 'regla-not-found' using errcode = '42704';
--   end if;
--   if v_regla.fecha_baja is not null then
--     return; -- idempotente
--   end if;
--
--   update regla_precio set fecha_baja = now() where id_regla = p_id_regla;
--
--   if v_regla.tipo_regla = 'margen' then
--     perform sp_marcar_precio_desactualizado_by_regla(p_id_regla);
--   end if;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'regla_precio', p_id_regla::text, 'baja',
--           jsonb_build_object('nombre', v_regla.nombre),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_baja_regla_precio(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_extender_vigencia_regla (00019_precios_functions.sql:495)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_extender_vigencia_regla(
--   p_id_regla     uuid,
--   p_fecha_hasta  timestamptz,
--   p_ip           inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_prev   timestamptz;
-- begin
--   select fecha_hasta into v_prev from regla_precio
--     where id_regla = p_id_regla and id_tenant = v_tenant;
--   if not found then
--     raise exception 'regla-not-found' using errcode = '42704';
--   end if;
--
--   update regla_precio set fecha_hasta = p_fecha_hasta
--    where id_regla = p_id_regla;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'regla_precio', p_id_regla::text, 'extender_vigencia',
--           jsonb_build_object('fecha_hasta_anterior', v_prev,
--                              'fecha_hasta_nueva', p_fecha_hasta),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_extender_vigencia_regla(uuid, timestamptz, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_recalcular_precio_venta (00019_precios_functions.sql:149)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select costo into v_costo
--     from costo_producto
--    where id_producto = p_id_producto and vigente_hasta is null;
--
--   if v_costo is null then
--     -- Sin costo vigente no hay precio calculable — marcar desactualizado y salir.
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
--     -- Sin regla de margen: precio = costo (0% margen). Marca desactualizado
--     -- FALSE porque respetó la (no)regla; el operador puede definir la regla
--     -- después y volver a recalcular.
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
-- grant execute on function sp_recalcular_precio_venta(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_recalcular_precios_batch (00040_precios_batch.sql:130)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_recalcular_precios_batch(
--   p_ids uuid[],
--   p_ip  inet default null
-- ) returns table (
--   id_producto uuid,
--   precio      numeric
-- ) language plpgsql as $$
-- declare
--   v_id uuid;
-- begin
--   if auth_tenant_id() is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
--     begin
--       id_producto := v_id;
--       precio := sp_recalcular_precio_venta(v_id, p_ip);
--     exception when others then
--       -- El subbloque revierte solo lo de ESTE producto (incluida su
--       -- fila de auditoría); los ya procesados quedan firmes.
--       id_producto := v_id;
--       precio := null;
--     end;
--     return next;
--   end loop;
-- end $$;
--
-- grant execute on function sp_recalcular_precios_batch(uuid[], inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_set_cotizacion_manual (00130_cotizacion_usd.sql:195)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_cotizacion_manual(
--   p_valor numeric,
--   p_ip inet
-- )
-- returns void
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor uuid := auth.uid();
--   v_hoy date;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_valor is null or p_valor <= 0 then
--     raise exception 'cotizacion-manual-invalida' using errcode = '22023';
--   end if;
--
--   select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
--     into v_hoy
--     from tenant
--    where id_tenant = v_tenant;
--
--   insert into cotizacion_config (
--     id_tenant,
--     modo,
--     updated_at,
--     id_usuario_modificacion
--   ) values (
--     v_tenant,
--     'manual',
--     now(),
--     v_actor
--   )
--   on conflict (id_tenant)
--   do update set modo = 'manual',
--                 updated_at = now(),
--                 id_usuario_modificacion = v_actor;
--
--   insert into cotizacion_dolar (
--     id_tenant,
--     fecha,
--     valor,
--     origen,
--     fecha_valor,
--     desactualizada,
--     id_usuario,
--     created_at
--   ) values (
--     v_tenant,
--     v_hoy,
--     p_valor,
--     'manual',
--     v_hoy,
--     false,
--     v_actor,
--     now()
--   )
--   on conflict (id_tenant, fecha, origen)
--   do update set valor = excluded.valor,
--                 fecha_valor = excluded.fecha_valor,
--                 desactualizada = excluded.desactualizada,
--                 id_usuario = excluded.id_usuario,
--                 created_at = excluded.created_at;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant,
--     v_actor,
--     'cotizacion_dolar',
--     v_hoy::text || ':manual',
--     'actualizar',
--     jsonb_build_object('valor', p_valor, 'modo', 'manual'),
--     p_ip
--   );
-- end;
-- $$;
--
-- grant execute on function sp_set_cotizacion_manual(numeric, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_set_modo_cotizacion (00130_cotizacion_usd.sql:281)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_modo_cotizacion(
--   p_modo text,
--   p_ip inet
-- )
-- returns void
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_modo is null or p_modo not in ('automatica', 'manual') then
--     raise exception 'modo-cotizacion-invalido' using errcode = '22023';
--   end if;
--
--   insert into cotizacion_config (
--     id_tenant,
--     modo,
--     updated_at,
--     id_usuario_modificacion
--   ) values (
--     v_tenant,
--     p_modo,
--     now(),
--     v_actor
--   )
--   on conflict (id_tenant)
--   do update set modo = p_modo,
--                 updated_at = now(),
--                 id_usuario_modificacion = v_actor;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant,
--     v_actor,
--     'cotizacion_config',
--     v_tenant::text,
--     'actualizar',
--     jsonb_build_object('modo', p_modo),
--     p_ip
--   );
-- end;
-- $$;
--
-- grant execute on function sp_set_modo_cotizacion(text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_registrar_cotizacion_bcra (00133_sp_registrar_cotizacion_bcra_hoy.sql:68)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_registrar_cotizacion_bcra(
--   p_valor numeric,
--   p_fecha_valor date,
--   p_desactualizada boolean
-- )
-- returns void
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_hoy date;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_valor is null or p_valor <= 0 then
--     raise exception 'valor-invalido' using errcode = '22023';
--   end if;
--
--   if p_fecha_valor is null then
--     raise exception 'fecha-invalida' using errcode = '22023';
--   end if;
--
--   select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
--     into v_hoy
--     from tenant
--    where id_tenant = v_tenant;
--
--   insert into cotizacion_dolar (
--     id_tenant,
--     fecha,
--     valor,
--     origen,
--     fecha_valor,
--     desactualizada,
--     id_usuario,
--     created_at
--   ) values (
--     v_tenant,
--     v_hoy,
--     p_valor,
--     'bcra',
--     p_fecha_valor,
--     coalesce(p_desactualizada, false),
--     null,
--     now()
--   )
--   on conflict (id_tenant, fecha, origen)
--   do update set valor = excluded.valor,
--                 fecha_valor = excluded.fecha_valor,
--                 desactualizada = excluded.desactualizada,
--                 created_at = excluded.created_at;
-- end;
-- $$;
--
-- grant execute on function sp_registrar_cotizacion_bcra(numeric, date, boolean) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_revaluar_costos_usd_vigentes (00143_costo_unico.sql:561)
-- NOTE: ────────────────────────────────────────────────────────────
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
--   -- 1. Contar filas vigentes con moneda='USD' pero costo_original_usd nulo (se omiten)
--   select count(*)
--     into v_omitidos_sin_original
--     from costo_producto
--    where id_tenant = v_tenant
--      and vigente_hasta is null
--      and moneda = 'USD'
--      and costo_original_usd is null;
--
--   -- 2. Procesar las filas vigentes con moneda='USD' y costo_original_usd no nulo
--   for r in
--     select id_costo, id_producto, costo, costo_original_usd, cotizacion_aplicada
--       from costo_producto
--      where id_tenant = v_tenant
--        and vigente_hasta is null
--        and moneda = 'USD'
--        and costo_original_usd is not null
--      for update
--   loop
--     -- Si la cotización aplicada ya es igual a la vigente, omitir sin generar historial
--     if r.cotizacion_aplicada is not distinct from v_valor then
--       v_sin_cambios := v_sin_cambios + 1;
--       continue;
--     end if;
--
--     v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);
--
--     perform sp_aplicar_ultimo_costo(
--       r.id_producto,
--       v_costo_nuevo,
--       'USD',
--       r.costo_original_usd,
--       v_valor,
--       v_fecha_valor,
--       'revaluacion masiva usd',
--       p_ip,
--       true
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
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_marcar_precio_desactualizado_by_regla (00019_precios_functions.sql:232)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_marcar_precio_desactualizado_by_regla(
--   p_id_regla uuid
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_regla  regla_precio;
--   v_count  integer := 0;
-- begin
--   select * into v_regla from regla_precio
--     where id_regla = p_id_regla and id_tenant = v_tenant;
--   if v_regla.id_regla is null then return 0; end if;
--
--   -- Solo reglas de margen impactan precio_venta. Descuento/recargo se
--   -- resuelven en venta.
--   if v_regla.tipo_regla <> 'margen' then return 0; end if;
--
--   if v_regla.alcance = 'producto' then
--     update producto set precio_venta_desactualizado = true
--      where id_producto = v_regla.id_producto and id_tenant = v_tenant;
--     get diagnostics v_count = row_count;
--   elsif v_regla.alcance = 'categoria' then
--     update producto set precio_venta_desactualizado = true
--      where id_categoria = v_regla.id_categoria and id_tenant = v_tenant;
--     get diagnostics v_count = row_count;
--   else
--     -- proveedor / global: marca todos los productos del tenant (barrida).
--     -- Los proveedores no están mapeados directamente en producto — es un
--     -- catch-all seguro.
--     update producto set precio_venta_desactualizado = true
--      where id_tenant = v_tenant;
--     get diagnostics v_count = row_count;
--   end if;
--
--   return v_count;
-- end $$;
--
-- grant execute on function sp_marcar_precio_desactualizado_by_regla(uuid) to authenticated;
