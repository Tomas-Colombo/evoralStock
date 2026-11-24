-- 00168_rvp_filtros.sql
-- Filtros de período, estado, búsqueda y total_filas en las funciones rvp_* del portal revendedora.

-- ─── 1. rvp_mi_cuenta ──────────────────────────────────────────────────────

drop function if exists rvp_mi_cuenta();

create or replace function rvp_mi_cuenta(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  piezas_en_poder            bigint,
  monto_en_poder             numeric,
  total_vendido              numeric,
  comision_liquidada         numeric,
  comision_estimada          numeric,
  total_liquidado            numeric,
  total_pagado               numeric,
  total_adeudado             numeric,
  declaraciones_pendientes   bigint,
  porcentaje_comision_actual numeric,
  proximo_tramo_comision     jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_zona           text;

  v_piezas_poder        bigint := 0;
  v_monto_poder         numeric := 0;
  v_vendido             numeric := 0;
  v_diferencias         numeric := 0;
  v_vendido_hist        numeric := 0;
  v_diferencias_hist    numeric := 0;
  v_comision_liq        numeric := 0;
  v_comision_liq_hist   numeric := 0;
  v_comision_est        numeric := 0;
  v_liquidado           numeric := 0;
  v_pagado              numeric := 0;
  v_adeudado            numeric := 0;
  v_decs_pend           bigint := 0;

  v_porc_actual    numeric := 0;
  v_id_regla       uuid;
  v_proximo_tramo  jsonb := null;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  select zona_horaria into v_zona from tenant where id_tenant = v_tenant;

  -- 1. Mercadería en poder (foto actual, no se filtra)
  select
    count(crd.id_item),
    coalesce(sum(p.precio_venta), 0)
  into v_piezas_poder, v_monto_poder
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join producto p on p.id_producto = crd.id_producto
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder';

  -- 2. Vendido canal revendedora del período (para total_vendido y comision_estimada)
  select
    coalesce(sum(dv.precio_venta), 0),
    coalesce(sum(case when dv.id_liquidacion is null then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2) else 0 end), 0)
  into v_vendido, v_comision_est
  from detalle_venta dv
  join venta v on v.id_venta = dv.id_venta
  where v.id_tenant = v_tenant
    and v.canal = 'revendedora'
    and v.id_revendedora = v_revendedora_id
    and v.estado_venta = 'registrada'
    and not exists (
      select 1 from cambio_venta cv
      where cv.id_detalle_original = dv.id_detalle_venta
        and cv.id_tenant = v.id_tenant
    )
    and (p_desde is null or (v.fecha at time zone v_zona)::date >= p_desde)
    and (p_hasta is null or (v.fecha at time zone v_zona)::date <= p_hasta);

  -- Diferencias de precio de cambios del período (D3: imputadas por cv.created_at en zona del tenant)
  select coalesce(sum(cv.diferencia), 0) into v_diferencias
  from cambio_venta cv
  join venta v on v.id_venta = cv.id_venta_original
  where cv.id_tenant = v_tenant
    and cv.origen = 'revendedora'
    and v.id_revendedora = v_revendedora_id
    and (p_desde is null or (cv.created_at at time zone v_zona)::date >= p_desde)
    and (p_hasta is null or (cv.created_at at time zone v_zona)::date <= p_hasta);

  v_vendido := v_vendido + v_diferencias;

  -- Vendido histórico (sin filtro) para saldo adeudado y tramo de comisión vigente
  if p_desde is null and p_hasta is null then
    v_vendido_hist := v_vendido;
  else
    select coalesce(sum(dv.precio_venta), 0)
    into v_vendido_hist
    from detalle_venta dv
    join venta v on v.id_venta = dv.id_venta
    where v.id_tenant = v_tenant
      and v.canal = 'revendedora'
      and v.id_revendedora = v_revendedora_id
      and v.estado_venta = 'registrada'
      and not exists (
        select 1 from cambio_venta cv
        where cv.id_detalle_original = dv.id_detalle_venta
          and cv.id_tenant = v.id_tenant
      );

    select coalesce(sum(cv.diferencia), 0) into v_diferencias_hist
    from cambio_venta cv
    join venta v on v.id_venta = cv.id_venta_original
    where cv.id_tenant = v_tenant
      and cv.origen = 'revendedora'
      and v.id_revendedora = v_revendedora_id;

    v_vendido_hist := v_vendido_hist + v_diferencias_hist;
  end if;

  -- 3. Liquidaciones: comision_liquidada del período; totales históricos para adeudado
  select
    coalesce(sum(case
      when (p_desde is null or fecha_liquidacion >= p_desde)
       and (p_hasta is null or fecha_liquidacion <= p_hasta)
      then monto_comision else 0 end), 0),
    coalesce(sum(monto_comision), 0),
    coalesce(sum(monto_a_cobrar), 0)
  into v_comision_liq, v_comision_liq_hist, v_liquidado
  from liquidacion_revendedora
  where id_tenant = v_tenant
    and id_revendedora = v_revendedora_id;

  -- 4. Pagos (foto actual, no se filtra)
  select
    coalesce(sum(pr.monto), 0)
  into v_pagado
  from pago_revendedora pr
  join liquidacion_revendedora lr on lr.id_liquidacion = pr.id_liquidacion
  where lr.id_tenant = v_tenant
    and lr.id_revendedora = v_revendedora_id;

  -- 5. Adeudado (foto actual, usa totales históricos)
  v_adeudado := greatest(0, v_vendido_hist - v_comision_liq_hist - v_pagado);

  -- 6. Declaraciones pendientes (foto actual)
  select count(*) into v_decs_pend
  from declaracion_venta_revendedora
  where id_tenant = v_tenant
    and id_revendedora = v_revendedora_id
    and estado = 'pendiente';

  -- 7. Comisión actual y tramos (foto actual, usa vendido histórico)
  select rc.porcentaje, rc.id_regla
  into v_porc_actual, v_id_regla
  from fn_resolver_comision(v_revendedora_id, current_date, v_vendido_hist, 'revendedora') rc;

  if v_id_regla is not null then
    select jsonb_build_object(
      'tramo_actual', v_porc_actual,
      'proximo_porcentaje', ec.porcentaje,
      'objetivo_desde', ec.objetivo_desde,
      'falta', greatest(0, ec.objetivo_desde - v_vendido_hist)
    ) into v_proximo_tramo
    from escala_comision ec
    where ec.id_tenant = v_tenant
      and ec.id_regla = v_id_regla
      and ec.objetivo_desde > v_vendido_hist
    order by ec.objetivo_desde asc
    limit 1;
  end if;

  return query select
    v_piezas_poder,
    v_monto_poder,
    v_vendido,
    v_comision_liq,
    v_comision_est,
    v_liquidado,
    v_pagado,
    v_adeudado,
    v_decs_pend,
    coalesce(v_porc_actual, 0::numeric),
    v_proximo_tramo;
end;
$$;

revoke execute on function rvp_mi_cuenta(date, date) from public;
grant execute on function rvp_mi_cuenta(date, date) to authenticated;

-- ─── 2. rvp_mi_stock ───────────────────────────────────────────────────────

drop function if exists rvp_mi_stock(integer, integer);

create or replace function rvp_mi_stock(
  p_limit    integer default 50,
  p_offset   integer default 0,
  p_estado   text default null,
  p_busqueda text default null
) returns table (
  id_item             uuid,
  id_producto         uuid,
  descripcion         text,
  sku                 text,
  talle               text,
  color               text,
  precio_venta        numeric,
  fecha_consignacion  date,
  declarado_pendiente boolean,
  total_filas         bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_limit          integer;
  v_offset         integer;
  v_busqueda       text;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('con_pendiente', 'sin_declaracion') then
    raise exception 'estado-filtro-invalido' using errcode = '22023';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_busqueda := nullif(trim(p_busqueda), '');

  return query
  select
    crd.id_item,
    crd.id_producto,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    ''::text as color,
    p.precio_venta,
    cr.periodo_desde as fecha_consignacion,
    exists (
      select 1 from declaracion_venta_revendedora dvr
      where dvr.id_tenant = v_tenant
        and dvr.id_item = crd.id_item
        and dvr.estado = 'pendiente'
    ) as declarado_pendiente,
    count(*) over()::bigint as total_filas
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join producto p on p.id_producto = crd.id_producto
  join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder'
    and ip.estado_item = 'en_revendedora'
    and (
      p_estado is null
      or (
        p_estado = 'con_pendiente'
        and exists (
          select 1 from declaracion_venta_revendedora dvr
          where dvr.id_tenant = v_tenant
            and dvr.id_item = crd.id_item
            and dvr.estado = 'pendiente'
        )
      )
      or (
        p_estado = 'sin_declaracion'
        and not exists (
          select 1 from declaracion_venta_revendedora dvr
          where dvr.id_tenant = v_tenant
            and dvr.id_item = crd.id_item
            and dvr.estado = 'pendiente'
        )
      )
    )
    and (
      v_busqueda is null
      or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
      or coalesce(p.sku, '') ilike ('%' || v_busqueda || '%') escape '\'
    )
  order by cr.periodo_desde desc, crd.id_consignacion_revendedora_detalle
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function rvp_mi_stock(integer, integer, text, text) from public;
grant execute on function rvp_mi_stock(integer, integer, text, text) to authenticated;

-- ─── 3. rvp_mis_ventas ─────────────────────────────────────────────────────

drop function if exists rvp_mis_ventas(integer, integer);

create or replace function rvp_mis_ventas(
  p_limit    integer default 50,
  p_offset   integer default 0,
  p_desde    date default null,
  p_hasta    date default null,
  p_estado   text default null,
  p_busqueda text default null
) returns table (
  id_venta           uuid,
  id_detalle_venta   uuid,
  id_item            uuid,
  descripcion        text,
  talle              text,
  color              text,
  fecha_venta        date,
  precio_venta       numeric,
  comision_liquidada numeric,
  comision_estimada  numeric,
  estado_liquidacion text,
  fecha_liquidacion  date,
  total_filas        bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_zona           text;
  v_limit          integer;
  v_offset         integer;
  v_busqueda       text;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('liquidada', 'pendiente') then
    raise exception 'estado-filtro-invalido' using errcode = '22023';
  end if;

  select zona_horaria into v_zona from tenant where id_tenant = v_tenant;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_busqueda := nullif(trim(p_busqueda), '');

  return query
  select
    v.id_venta,
    dv.id_detalle_venta,
    dv.id_item,
    p.nombre as descripcion,
    coalesce(ip.talle, '') as talle,
    ''::text as color,
    (v.fecha at time zone v_zona)::date as fecha_venta,
    dv.precio_venta,
    case
      when dv.id_liquidacion is not null then dv.monto_comision
      else 0::numeric(14, 2)
    end as comision_liquidada,
    case
      when dv.id_liquidacion is null then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2)
      else 0::numeric(14, 2)
    end as comision_estimada,
    case
      when dv.id_liquidacion is not null then 'liquidada'
      else 'pendiente'
    end as estado_liquidacion,
    lr.fecha_liquidacion,
    count(*) over()::bigint as total_filas
  from detalle_venta dv
  join venta v on v.id_venta = dv.id_venta
  join producto p on p.id_producto = dv.id_producto
  left join item_producto ip on ip.id_item = dv.id_item and ip.id_tenant = v.id_tenant
  left join liquidacion_revendedora lr on lr.id_liquidacion = dv.id_liquidacion and lr.id_tenant = v.id_tenant
  where v.id_tenant = v_tenant
    and v.canal = 'revendedora'
    and v.id_revendedora = v_revendedora_id
    and v.estado_venta = 'registrada'
    and not exists (
      select 1 from cambio_venta cv
      where cv.id_detalle_original = dv.id_detalle_venta
        and cv.id_tenant = v.id_tenant
    )
    and (p_desde is null or (v.fecha at time zone v_zona)::date >= p_desde)
    and (p_hasta is null or (v.fecha at time zone v_zona)::date <= p_hasta)
    and (
      p_estado is null
      or (p_estado = 'liquidada' and dv.id_liquidacion is not null)
      or (p_estado = 'pendiente' and dv.id_liquidacion is null)
    )
    and (
      v_busqueda is null
      or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
    )
  order by v.fecha desc, dv.id_detalle_venta
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function rvp_mis_ventas(integer, integer, date, date, text, text) from public;
grant execute on function rvp_mis_ventas(integer, integer, date, date, text, text) to authenticated;

-- ─── 4. rvp_mis_liquidaciones ──────────────────────────────────────────────

drop function if exists rvp_mis_liquidaciones(integer, integer);

create or replace function rvp_mis_liquidaciones(
  p_limit  integer default 50,
  p_offset integer default 0,
  p_desde  date default null,
  p_hasta  date default null,
  p_estado text default null
) returns table (
  id_liquidacion      uuid,
  fecha_liquidacion   date,
  periodo_desde       date,
  periodo_hasta       date,
  monto_vendido       numeric,
  porcentaje_aplicado numeric,
  monto_comision      numeric,
  monto_a_cobrar      numeric,
  cantidad_lineas     integer,
  estado              text,
  fecha_pago          timestamptz,
  monto_pagado        numeric,
  total_filas         bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_limit          integer;
  v_offset         integer;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('pendiente', 'pagada') then
    raise exception 'estado-filtro-invalido' using errcode = '22023';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    lr.id_liquidacion,
    lr.fecha_liquidacion,
    lr.periodo_desde,
    lr.periodo_hasta,
    lr.monto_vendido,
    lr.porcentaje_aplicado,
    lr.monto_comision,
    lr.monto_a_cobrar,
    lr.cantidad_lineas,
    lr.estado::text,
    lr.fecha_pago,
    coalesce((
      select sum(pr.monto)
      from pago_revendedora pr
      where pr.id_liquidacion = lr.id_liquidacion
        and pr.id_tenant = lr.id_tenant
    ), 0::numeric) as monto_pagado,
    count(*) over()::bigint as total_filas
  from liquidacion_revendedora lr
  where lr.id_tenant = v_tenant
    and lr.id_revendedora = v_revendedora_id
    and (p_desde is null or lr.fecha_liquidacion >= p_desde)
    and (p_hasta is null or lr.fecha_liquidacion <= p_hasta)
    and (p_estado is null or lr.estado::text = p_estado)
  order by lr.fecha_liquidacion desc, lr.id_liquidacion
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function rvp_mis_liquidaciones(integer, integer, date, date, text) from public;
grant execute on function rvp_mis_liquidaciones(integer, integer, date, date, text) to authenticated;

-- ─── 5. rvp_mis_declaraciones ──────────────────────────────────────────────

drop function if exists rvp_mis_declaraciones(integer, integer);

create or replace function rvp_mis_declaraciones(
  p_limit    integer default 50,
  p_offset   integer default 0,
  p_desde    date default null,
  p_hasta    date default null,
  p_estado   text default null,
  p_busqueda text default null
) returns table (
  id_declaracion uuid,
  id_item        uuid,
  descripcion    text,
  sku            text,
  talle          text,
  color          text,
  precio_venta   numeric,
  fecha          date,
  nota           text,
  estado         text,
  motivo_rechazo text,
  created_at     timestamptz,
  total_filas    bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_limit          integer;
  v_offset         integer;
  v_busqueda       text;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('pendiente', 'confirmada', 'rechazada', 'retirada') then
    raise exception 'estado-filtro-invalido' using errcode = '22023';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_busqueda := nullif(trim(p_busqueda), '');

  return query
  select
    dvr.id_declaracion,
    dvr.id_item,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    ''::text as color,
    p.precio_venta,
    dvr.fecha,
    dvr.nota,
    dvr.estado::text,
    dvr.motivo_rechazo,
    dvr.created_at,
    count(*) over()::bigint as total_filas
  from declaracion_venta_revendedora dvr
  join item_producto ip on ip.id_item = dvr.id_item and ip.id_tenant = dvr.id_tenant
  join producto p on p.id_producto = ip.id_producto and p.id_tenant = dvr.id_tenant
  where dvr.id_tenant = v_tenant
    and dvr.id_revendedora = v_revendedora_id
    and (p_desde is null or dvr.fecha >= p_desde)
    and (p_hasta is null or dvr.fecha <= p_hasta)
    and (p_estado is null or dvr.estado::text = p_estado)
    and (
      v_busqueda is null
      or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
      or coalesce(p.sku, '') ilike ('%' || v_busqueda || '%') escape '\'
    )
  order by dvr.created_at desc, dvr.id_declaracion
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function rvp_mis_declaraciones(integer, integer, date, date, text, text) from public;
grant execute on function rvp_mis_declaraciones(integer, integer, date, date, text, text) to authenticated;

-- DOWN:
-- drop function if exists rvp_mi_cuenta(date, date);
-- create or replace function rvp_mi_cuenta()
-- returns table (
--   piezas_en_poder            bigint,
--   monto_en_poder             numeric,
--   total_vendido              numeric,
--   comision_liquidada         numeric,
--   comision_estimada          numeric,
--   total_liquidado            numeric,
--   total_pagado               numeric,
--   total_adeudado             numeric,
--   declaraciones_pendientes   bigint,
--   porcentaje_comision_actual numeric,
--   proximo_tramo_comision     jsonb
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_piezas_poder   bigint := 0;
--   v_monto_poder    numeric := 0;
--   v_vendido        numeric := 0;
--   v_diferencias    numeric := 0;
--   v_comision_liq   numeric := 0;
--   v_comision_est   numeric := 0;
--   v_liquidado      numeric := 0;
--   v_pagado         numeric := 0;
--   v_adeudado       numeric := 0;
--   v_decs_pend      bigint := 0;
--   v_porc_actual    numeric := 0;
--   v_id_regla       uuid;
--   v_proximo_tramo  jsonb := null;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--   if v_revendedora_id is null then
--     raise exception 'no-revendedora' using errcode = '42501';
--   end if;
--   select count(crd.id_item), coalesce(sum(p.precio_venta), 0)
--   into v_piezas_poder, v_monto_poder
--   from consignacion_revendedora_detalle crd
--   join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
--   join producto p on p.id_producto = crd.id_producto
--   where cr.id_tenant = v_tenant
--     and cr.id_revendedora = v_revendedora_id
--     and cr.confirmada = true
--     and cr.estado = 'abierta'
--     and crd.estado_detalle = 'en_poder';
--   select
--     coalesce(sum(dv.precio_venta), 0),
--     coalesce(sum(case when dv.id_liquidacion is null then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2) else 0 end), 0)
--   into v_vendido, v_comision_est
--   from detalle_venta dv
--   join venta v on v.id_venta = dv.id_venta
--   where v.id_tenant = v_tenant
--     and v.canal = 'revendedora'
--     and v.id_revendedora = v_revendedora_id
--     and v.estado_venta = 'registrada'
--     and not exists (
--       select 1 from cambio_venta cv
--       where cv.id_detalle_original = dv.id_detalle_venta
--         and cv.id_tenant = v.id_tenant
--     );
--   select coalesce(sum(cv.diferencia), 0) into v_diferencias
--   from cambio_venta cv
--   join venta v on v.id_venta = cv.id_venta_original
--   where cv.id_tenant = v_tenant
--     and cv.origen = 'revendedora'
--     and v.id_revendedora = v_revendedora_id;
--   v_vendido := v_vendido + v_diferencias;
--   select coalesce(sum(monto_comision), 0), coalesce(sum(monto_a_cobrar), 0)
--   into v_comision_liq, v_liquidado
--   from liquidacion_revendedora
--   where id_tenant = v_tenant and id_revendedora = v_revendedora_id;
--   select coalesce(sum(pr.monto), 0)
--   into v_pagado
--   from pago_revendedora pr
--   join liquidacion_revendedora lr on lr.id_liquidacion = pr.id_liquidacion
--   where lr.id_tenant = v_tenant and lr.id_revendedora = v_revendedora_id;
--   v_adeudado := greatest(0, v_vendido - v_comision_liq - v_pagado);
--   select count(*) into v_decs_pend
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_revendedora = v_revendedora_id and estado = 'pendiente';
--   select rc.porcentaje, rc.id_regla
--   into v_porc_actual, v_id_regla
--   from fn_resolver_comision(v_revendedora_id, current_date, v_vendido, 'revendedora') rc;
--   if v_id_regla is not null then
--     select jsonb_build_object(
--       'tramo_actual', v_porc_actual,
--       'proximo_porcentaje', ec.porcentaje,
--       'objetivo_desde', ec.objetivo_desde,
--       'falta', greatest(0, ec.objetivo_desde - v_vendido)
--     ) into v_proximo_tramo
--     from escala_comision ec
--     where ec.id_tenant = v_tenant
--       and ec.id_regla = v_id_regla
--       and ec.objetivo_desde > v_vendido
--     order by ec.objetivo_desde asc
--     limit 1;
--   end if;
--   return query select
--     v_piezas_poder, v_monto_poder, v_vendido, v_comision_liq, v_comision_est,
--     v_liquidado, v_pagado, v_adeudado, v_decs_pend, coalesce(v_porc_actual, 0::numeric), v_proximo_tramo;
-- end;
-- $$;
-- revoke execute on function rvp_mi_cuenta() from public;
-- grant execute on function rvp_mi_cuenta() to authenticated;
--
-- drop function if exists rvp_mi_stock(integer, integer, text, text);
-- create or replace function rvp_mi_stock(
--   p_limit  integer default 50,
--   p_offset integer default 0
-- ) returns table (
--   id_item             uuid,
--   id_producto         uuid,
--   descripcion         text,
--   talle               text,
--   color               text,
--   precio_venta        numeric,
--   fecha_consignacion  date,
--   declarado_pendiente boolean
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit          integer;
--   v_offset         integer;
-- begin
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if not exists (
--     select 1 from tenant_modulo tm join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501'; end if;
--   if v_revendedora_id is null then raise exception 'no-revendedora' using errcode = '42501'; end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   return query
--   select crd.id_item, crd.id_producto, p.nombre as descripcion, coalesce(ip.talle, '') as talle,
--     ''::text as color, p.precio_venta, cr.periodo_desde as fecha_consignacion,
--     exists (
--       select 1 from declaracion_venta_revendedora dvr
--       where dvr.id_tenant = v_tenant and dvr.id_item = crd.id_item and dvr.estado = 'pendiente'
--     ) as declarado_pendiente
--   from consignacion_revendedora_detalle crd
--   join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
--   join producto p on p.id_producto = crd.id_producto
--   join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
--   where cr.id_tenant = v_tenant and cr.id_revendedora = v_revendedora_id
--     and cr.confirmada = true and cr.estado = 'abierta'
--     and crd.estado_detalle = 'en_poder' and ip.estado_item = 'en_revendedora'
--   order by cr.periodo_desde desc, crd.id_consignacion_revendedora_detalle
--   limit v_limit offset v_offset;
-- end;
-- $$;
-- revoke execute on function rvp_mi_stock(integer, integer) from public;
-- grant execute on function rvp_mi_stock(integer, integer) to authenticated;
--
-- drop function if exists rvp_mis_ventas(integer, integer, date, date, text, text);
-- create or replace function rvp_mis_ventas(
--   p_limit  integer default 50,
--   p_offset integer default 0
-- ) returns table (
--   id_venta uuid, id_detalle_venta uuid, id_item uuid, descripcion text, talle text, color text,
--   fecha_venta date, precio_venta numeric, comision_liquidada numeric, comision_estimada numeric,
--   estado_liquidacion text, fecha_liquidacion date
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit integer;
--   v_offset integer;
-- begin
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if not exists (
--     select 1 from tenant_modulo tm join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501'; end if;
--   if v_revendedora_id is null then raise exception 'no-revendedora' using errcode = '42501'; end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   return query
--   select v.id_venta, dv.id_detalle_venta, dv.id_item, p.nombre as descripcion, coalesce(ip.talle, '') as talle,
--     ''::text as color, v.fecha::date as fecha_venta, dv.precio_venta,
--     case when dv.id_liquidacion is not null then dv.monto_comision else 0::numeric(14, 2) end as comision_liquidada,
--     case when dv.id_liquidacion is null then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2) else 0::numeric(14, 2) end as comision_estimada,
--     case when dv.id_liquidacion is not null then 'liquidada' else 'pendiente' end as estado_liquidacion,
--     lr.fecha_liquidacion
--   from detalle_venta dv
--   join venta v on v.id_venta = dv.id_venta
--   join producto p on p.id_producto = dv.id_producto
--   left join item_producto ip on ip.id_item = dv.id_item and ip.id_tenant = v.id_tenant
--   left join liquidacion_revendedora lr on lr.id_liquidacion = dv.id_liquidacion and lr.id_tenant = v.id_tenant
--   where v.id_tenant = v_tenant and v.canal = 'revendedora' and v.id_revendedora = v_revendedora_id
--     and v.estado_venta = 'registrada'
--     and not exists (select 1 from cambio_venta cv where cv.id_detalle_original = dv.id_detalle_venta and cv.id_tenant = v.id_tenant)
--   order by v.fecha desc, dv.id_detalle_venta
--   limit v_limit offset v_offset;
-- end;
-- $$;
-- revoke execute on function rvp_mis_ventas(integer, integer) from public;
-- grant execute on function rvp_mis_ventas(integer, integer) to authenticated;
--
-- drop function if exists rvp_mis_liquidaciones(integer, integer, date, date, text);
-- create or replace function rvp_mis_liquidaciones(
--   p_limit  integer default 50,
--   p_offset integer default 0
-- ) returns table (
--   id_liquidacion uuid, fecha_liquidacion date, periodo_desde date, periodo_hasta date,
--   monto_vendido numeric, porcentaje_aplicado numeric, monto_comision numeric, monto_a_cobrar numeric,
--   cantidad_lineas integer, estado text, fecha_pago timestamptz, monto_pagado numeric
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit integer;
--   v_offset integer;
-- begin
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if not exists (
--     select 1 from tenant_modulo tm join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501'; end if;
--   if v_revendedora_id is null then raise exception 'no-revendedora' using errcode = '42501'; end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   return query
--   select lr.id_liquidacion, lr.fecha_liquidacion, lr.periodo_desde, lr.periodo_hasta,
--     lr.monto_vendido, lr.porcentaje_aplicado, lr.monto_comision, lr.monto_a_cobrar,
--     lr.cantidad_lineas, lr.estado::text, lr.fecha_pago,
--     coalesce((select sum(pr.monto) from pago_revendedora pr where pr.id_liquidacion = lr.id_liquidacion and pr.id_tenant = lr.id_tenant), 0::numeric) as monto_pagado
--   from liquidacion_revendedora lr
--   where lr.id_tenant = v_tenant and lr.id_revendedora = v_revendedora_id
--   order by lr.fecha_liquidacion desc, lr.id_liquidacion
--   limit v_limit offset v_offset;
-- end;
-- $$;
-- revoke execute on function rvp_mis_liquidaciones(integer, integer) from public;
-- grant execute on function rvp_mis_liquidaciones(integer, integer) to authenticated;
--
-- drop function if exists rvp_mis_declaraciones(integer, integer, date, date, text, text);
-- create or replace function rvp_mis_declaraciones(
--   p_limit  integer default 50,
--   p_offset integer default 0
-- ) returns table (
--   id_declaracion uuid, id_item uuid, descripcion text, talle text, color text,
--   precio_venta numeric, fecha date, nota text, estado text, motivo_rechazo text, created_at timestamptz
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit integer;
--   v_offset integer;
-- begin
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if not exists (
--     select 1 from tenant_modulo tm join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501'; end if;
--   if v_revendedora_id is null then raise exception 'no-revendedora' using errcode = '42501'; end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   return query
--   select dvr.id_declaracion, dvr.id_item, p.nombre as descripcion, coalesce(ip.talle, '') as talle,
--     ''::text as color, p.precio_venta, dvr.fecha, dvr.nota, dvr.estado::text, dvr.motivo_rechazo, dvr.created_at
--   from declaracion_venta_revendedora dvr
--   join item_producto ip on ip.id_item = dvr.id_item and ip.id_tenant = dvr.id_tenant
--   join producto p on p.id_producto = ip.id_producto and p.id_tenant = dvr.id_tenant
--   where dvr.id_tenant = v_tenant and dvr.id_revendedora = v_revendedora_id
--   order by dvr.created_at desc, dvr.id_declaracion
--   limit v_limit offset v_offset;
-- end;
-- $$;
-- revoke execute on function rvp_mis_declaraciones(integer, integer) from public;
-- grant execute on function rvp_mis_declaraciones(integer, integer) to authenticated;
