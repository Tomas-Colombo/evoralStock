-- 00161_confirmar_impacto_regla.sql
-- Tanda 1 del cambio confirmar-impacto-regla: capa de datos.
-- Agrega sp_impacto_regla_margen y sp_aplicar_regla_margen, y actualiza sp_control_de_precios
-- incorporando id_categoria, id_regla_margen_resuelta y filtro por precios.ver.
--
-- DOWN:
-- NOTE: Restaura sp_control_de_precios con la firma de 00040 y borra las funciones nuevas.
-- drop function if exists sp_impacto_regla_margen(uuid);
-- drop function if exists sp_aplicar_regla_margen(uuid);
-- drop function if exists sp_control_de_precios();
-- create or replace function sp_control_de_precios()
-- returns table (
--   id_producto                 uuid,
--   nombre                      text,
--   sku                         text,
--   categoria_nombre            text,
--   costo_vigente               numeric,
--   precio_venta                numeric,
--   precio_venta_resuelto_at    timestamptz,
--   precio_venta_desactualizado boolean,
--   regla_margen_nombre         text,
--   precio_proyectado           numeric,
--   diferencia_pct              numeric
-- ) language sql stable as $$
--   with base as (
--     select
--       p.id_producto,
--       p.nombre,
--       p.sku,
--       c.nombre as categoria_nombre,
--       cp.costo as costo_vigente,
--       p.precio_venta,
--       p.precio_venta_resuelto_at,
--       p.precio_venta_desactualizado,
--       ra.nombre as regla_margen_nombre,
--       case
--         when cp.costo is null then null
--         when r.valor is null then round(cp.costo, 2)
--         when r.tipo_valor = 'porcentaje' then round(cp.costo * (1 + r.valor), 2)
--         else round(cp.costo + r.valor, 2)
--       end as precio_proyectado
--     from producto p
--     left join categoria c
--       on c.id_categoria = p.id_categoria
--     left join costo_producto cp
--       on cp.id_producto = p.id_producto
--      and cp.vigente_hasta is null
--     left join regla_precio ra
--       on ra.id_regla = p.id_regla_margen_aplicada
--     left join lateral resolver_regla_margen(p.id_producto) r on true
--     where p.id_tenant = auth_tenant_id()
--       and p.activo
--   )
--   select
--     b.id_producto,
--     b.nombre,
--     b.sku,
--     b.categoria_nombre,
--     b.costo_vigente,
--     b.precio_venta,
--     b.precio_venta_resuelto_at,
--     b.precio_venta_desactualizado,
--     b.regla_margen_nombre,
--     b.precio_proyectado,
--     case
--       when b.precio_venta is not null
--        and b.precio_venta > 0
--        and b.precio_proyectado is not null
--       then round(((b.precio_proyectado - b.precio_venta) / b.precio_venta) * 100, 2)
--       else null
--     end as diferencia_pct
--   from base b
--   order by b.nombre asc;
-- $$;
-- grant execute on function sp_control_de_precios() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_impacto_regla_margen (INVOKER)
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_impacto_regla_margen(
  p_id_regla uuid
)
returns table (
  id_categoria     uuid,
  categoria_nombre text,
  productos        integer,
  cambian          integer,
  suben            integer,
  bajan            integer,
  sin_costo        integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant           uuid := auth_tenant_id();
  v_regla            regla_precio;
  v_puede_ver_costos boolean;
begin
  if not (select auth_tiene_permiso('precios', 'ver_margenes')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select * into v_regla
    from regla_precio
   where id_regla = p_id_regla and id_tenant = v_tenant;

  if v_regla.id_regla is null then
    raise exception 'regla-not-found' using errcode = '42704';
  end if;

  if v_regla.tipo_regla <> 'margen' then
    raise exception 'regla-no-es-margen' using errcode = '22023';
  end if;

  v_puede_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));

  return query
  with productos_afectados as (
    select
      p.id_producto,
      p.id_categoria,
      coalesce(c.nombre, 'Sin categoría') as cat_nombre,
      p.precio_venta,
      cp.costo,
      case
        when cp.costo is null then null
        when v_regla.valor is null then round(cp.costo, 2)
        when v_regla.tipo_valor = 'porcentaje' then round(cp.costo * (1 + v_regla.valor), 2)
        else round(cp.costo + v_regla.valor, 2)
      end as precio_proyectado
    from producto p
    left join categoria c
      on c.id_categoria = p.id_categoria
    left join costo_producto cp
      on cp.id_producto = p.id_producto
     and cp.vigente_hasta is null
    cross join lateral resolver_regla_margen(p.id_producto) r
    where p.id_tenant = v_tenant
      and p.activo
      and r.id_regla = p_id_regla
  )
  select
    pa.id_categoria,
    pa.cat_nombre as categoria_nombre,
    count(*)::integer as productos,
    case
      when v_puede_ver_costos then
        count(*) filter (
          where pa.costo is not null
            and pa.precio_venta is distinct from pa.precio_proyectado
        )::integer
      else null::integer
    end as cambian,
    case
      when v_puede_ver_costos then
        count(*) filter (
          where pa.costo is not null
            and pa.precio_venta is not null
            and pa.precio_proyectado > pa.precio_venta
        )::integer
      else null::integer
    end as suben,
    case
      when v_puede_ver_costos then
        count(*) filter (
          where pa.costo is not null
            and pa.precio_venta is not null
            and pa.precio_proyectado < pa.precio_venta
        )::integer
      else null::integer
    end as bajan,
    case
      when v_puede_ver_costos then
        count(*) filter (where pa.costo is null)::integer
      else null::integer
    end as sin_costo
  from productos_afectados pa
  group by pa.id_categoria, pa.cat_nombre
  order by pa.cat_nombre asc;
end;
$$;

revoke execute on function sp_impacto_regla_margen(uuid) from public, anon;
grant execute on function sp_impacto_regla_margen(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_aplicar_regla_margen (INVOKER)
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_aplicar_regla_margen(
  p_id_regla uuid
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_regla  regla_precio;
  v_prod   record;
  v_count  integer := 0;
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

  select * into v_regla
    from regla_precio
   where id_regla = p_id_regla and id_tenant = v_tenant;

  if v_regla.id_regla is null then
    raise exception 'regla-not-found' using errcode = '42704';
  end if;

  if v_regla.tipo_regla <> 'margen' then
    raise exception 'regla-no-es-margen' using errcode = '22023';
  end if;

  for v_prod in
    select p.id_producto
      from producto p
      join costo_producto cp
        on cp.id_producto = p.id_producto
       and cp.vigente_hasta is null
      cross join lateral resolver_regla_margen(p.id_producto) r
      cross join lateral (
        select case
          when cp.costo is null then null
          when v_regla.valor is null then round(cp.costo, 2)
          when v_regla.tipo_valor = 'porcentaje' then round(cp.costo * (1 + v_regla.valor), 2)
          else round(cp.costo + v_regla.valor, 2)
        end as precio_proyectado
      ) proj
     where p.id_tenant = v_tenant
       and p.activo
       and r.id_regla = p_id_regla
       and (
         p.precio_venta is distinct from proj.precio_proyectado
         or p.precio_venta_desactualizado = true
       )
     order by p.nombre asc, p.id_producto asc
  loop
    perform sp_recalcular_precio_venta(v_prod.id_producto);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function sp_aplicar_regla_margen(uuid) from public, anon;
grant execute on function sp_aplicar_regla_margen(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. sp_control_de_precios (INVOKER)
-- ─────────────────────────────────────────────────────────────────

drop function if exists sp_control_de_precios();

create or replace function sp_control_de_precios()
returns table (
  id_producto                 uuid,
  id_categoria                uuid,
  nombre                      text,
  sku                         text,
  categoria_nombre            text,
  costo_vigente               numeric,
  precio_venta                numeric,
  precio_venta_resuelto_at    timestamptz,
  precio_venta_desactualizado boolean,
  regla_margen_nombre         text,
  id_regla_margen_resuelta    uuid,
  precio_proyectado           numeric,
  diferencia_pct              numeric
) language sql stable security invoker as $$
  with base as (
    select
      p.id_producto,
      p.id_categoria,
      p.nombre,
      p.sku,
      c.nombre as categoria_nombre,
      cp.costo as costo_vigente,
      p.precio_venta,
      p.precio_venta_resuelto_at,
      p.precio_venta_desactualizado,
      ra.nombre as regla_margen_nombre,
      r.id_regla as id_regla_margen_resuelta,
      case
        when cp.costo is null then null
        when r.valor is null then round(cp.costo, 2)
        when r.tipo_valor = 'porcentaje' then round(cp.costo * (1 + r.valor), 2)
        else round(cp.costo + r.valor, 2)
      end as precio_proyectado
    from producto p
    left join categoria c
      on c.id_categoria = p.id_categoria
    left join costo_producto cp
      on cp.id_producto = p.id_producto
     and cp.vigente_hasta is null
    left join regla_precio ra
      on ra.id_regla = p.id_regla_margen_aplicada
    left join lateral resolver_regla_margen(p.id_producto) r on true
    where p.id_tenant = auth_tenant_id()
      and p.activo
      and (select auth_tiene_permiso('precios', 'ver'))
  )
  select
    b.id_producto,
    b.id_categoria,
    b.nombre,
    b.sku,
    b.categoria_nombre,
    b.costo_vigente,
    b.precio_venta,
    b.precio_venta_resuelto_at,
    b.precio_venta_desactualizado,
    b.regla_margen_nombre,
    b.id_regla_margen_resuelta,
    b.precio_proyectado,
    case
      when b.precio_venta is not null
       and b.precio_venta > 0
       and b.precio_proyectado is not null
      then round(((b.precio_proyectado - b.precio_venta) / b.precio_venta) * 100, 2)
      else null
    end as diferencia_pct
  from base b
  order by b.nombre asc;
$$;

revoke execute on function sp_control_de_precios() from public, anon;
grant execute on function sp_control_de_precios() to authenticated;
