-- Costo por peso: habilita categorías con peso (`categoria.lleva_peso`) y peso
-- opcional en gramos en `producto.peso_gramos`. Actualiza `sp_create_producto`
-- (dropeando la firma previa para evitar overload) y `sp_listar_productos`
-- para devolver `peso_gramos` y `categoria.lleva_peso` en el mismo round-trip.

alter table categoria
  add column lleva_peso boolean not null default false;

alter table producto
  add column peso_gramos numeric,
  add constraint producto_peso_gramos_pos check (peso_gramos > 0);

revoke execute on function sp_create_producto(uuid, text, text, integer, text, inet) from authenticated;
drop function if exists sp_create_producto(uuid, text, text, integer, text, inet);

create or replace function sp_create_producto(
  p_id_categoria uuid,
  p_nombre       text,
  p_sku          text default null,
  p_stock_minimo integer default 0,
  p_descripcion  text default null,
  p_ip           inet default null,
  p_peso_gramos  numeric default null
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

  insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, descripcion, peso_gramos)
  values (v_tenant, p_id_categoria, p_nombre, v_sku, coalesce(p_stock_minimo, 0), p_descripcion, p_peso_gramos)
  returning id_producto into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'sku', v_sku,
                             'id_categoria', p_id_categoria,
                             'stock_minimo', p_stock_minimo,
                             'peso_gramos', p_peso_gramos),
          p_ip);

  return v_id;
end $$;

grant execute on function sp_create_producto(uuid, text, text, integer, text, inet, numeric) to authenticated;

create or replace function sp_listar_productos(
  p_search       text    default null,
  p_id_categoria uuid    default null,
  p_solo_activos boolean default false,
  p_limit        integer default null,
  p_offset       integer default 0
) returns jsonb language sql stable as $$
  with filtrados as (
    select p.*
      from producto p
     where p.id_tenant = auth_tenant_id()
       and (not p_solo_activos or p.activo)
       and (p_id_categoria is null or p.id_categoria = p_id_categoria)
       and (
         p_search is null
         or btrim(p_search) = ''
         or p.nombre ilike '%' || btrim(p_search) || '%'
         or p.sku    ilike '%' || btrim(p_search) || '%'
       )
  ),
  pagina as (
    select
      f.id_producto,
      f.id_tenant,
      f.id_categoria,
      f.sku,
      f.nombre,
      f.descripcion,
      f.stock_minimo,
      f.peso_gramos,
      f.activo,
      f.es_nuevo,
      f.precio_venta,
      f.id_regla_margen_aplicada,
      f.precio_venta_resuelto_at,
      f.precio_venta_desactualizado,
      f.created_at,
      f.updated_at,
      case when c.id_categoria is not null
           then jsonb_build_object(
             'id_categoria', c.id_categoria,
             'nombre', c.nombre,
             'lleva_peso', c.lleva_peso
           )
      end as categoria,
      cp.costo as costo_vigente,
      case when cp.id_costo is not null then coalesce(cp.moneda, 'ARS') end as moneda_vigente,
      st.disponible as stock_disponible,
      st.total      as stock_total
    from filtrados f
    left join categoria c
      on c.id_categoria = f.id_categoria
    left join costo_producto cp
      on cp.id_producto = f.id_producto
     and cp.vigente_hasta is null
    left join lateral (
      select
        count(*) filter (where ip.estado_item <> 'baja' and ip.estado_item <> 'devuelto')::integer as total,
        count(*) filter (where ip.estado_item = 'disponible')::integer as disponible
      from item_producto ip
      where ip.id_producto = f.id_producto
    ) st on true
    order by f.nombre asc
    limit  p_limit
    offset coalesce(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrados),
    'rows',  coalesce(
               (select jsonb_agg(to_jsonb(pg) order by pg.nombre asc) from pagina pg),
               '[]'::jsonb
             )
  );
$$;

-- DOWN:
-- create or replace function sp_listar_productos(
--   p_search       text    default null,
--   p_id_categoria uuid    default null,
--   p_solo_activos boolean default false,
--   p_limit        integer default null,
--   p_offset       integer default 0
-- ) returns jsonb language sql stable as $$
--   with filtrados as (
--     select p.*
--       from producto p
--      where p.id_tenant = auth_tenant_id()
--        and (not p_solo_activos or p.activo)
--        and (p_id_categoria is null or p.id_categoria = p_id_categoria)
--        and (
--          p_search is null
--          or btrim(p_search) = ''
--          or p.nombre ilike '%' || btrim(p_search) || '%'
--          or p.sku    ilike '%' || btrim(p_search) || '%'
--        )
--   ),
--   pagina as (
--     select
--       f.id_producto,
--       f.id_tenant,
--       f.id_categoria,
--       f.sku,
--       f.nombre,
--       f.descripcion,
--       f.stock_minimo,
--       f.activo,
--       f.es_nuevo,
--       f.precio_venta,
--       f.id_regla_margen_aplicada,
--       f.precio_venta_resuelto_at,
--       f.precio_venta_desactualizado,
--       f.created_at,
--       f.updated_at,
--       case when c.id_categoria is not null
--            then jsonb_build_object('id_categoria', c.id_categoria, 'nombre', c.nombre)
--       end as categoria,
--       cp.costo as costo_vigente,
--       case when cp.id_costo is not null then coalesce(cp.moneda, 'ARS') end as moneda_vigente,
--       st.disponible as stock_disponible,
--       st.total      as stock_total
--     from filtrados f
--     left join categoria c
--       on c.id_categoria = f.id_categoria
--     left join costo_producto cp
--       on cp.id_producto = f.id_producto
--      and cp.vigente_hasta is null
--     left join lateral (
--       select
--         count(*) filter (where ip.estado_item <> 'baja' and ip.estado_item <> 'devuelto')::integer as total,
--         count(*) filter (where ip.estado_item = 'disponible')::integer as disponible
--       from item_producto ip
--       where ip.id_producto = f.id_producto
--     ) st on true
--     order by f.nombre asc
--     limit  p_limit
--     offset coalesce(p_offset, 0)
--   )
--   select jsonb_build_object(
--     'total', (select count(*) from filtrados),
--     'rows',  coalesce(
--                (select jsonb_agg(to_jsonb(pg) order by pg.nombre asc) from pagina pg),
--                '[]'::jsonb
--              )
--   );
-- $$;
-- revoke execute on function sp_create_producto(uuid, text, text, integer, text, inet, numeric) from authenticated;
-- drop function if exists sp_create_producto(uuid, text, text, integer, text, inet, numeric);
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
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   v_sku := nullif(trim(p_sku), '');
--   if v_sku is null then
--     v_sku := sp_gen_sku(p_id_categoria);
--   end if;
--   insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, descripcion)
--   values (v_tenant, p_id_categoria, p_nombre, v_sku, coalesce(p_stock_minimo, 0), p_descripcion)
--   returning id_producto into v_id;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'producto', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'sku', v_sku,
--                              'id_categoria', p_id_categoria,
--                              'stock_minimo', p_stock_minimo),
--           p_ip);
--   return v_id;
-- end $$;
-- grant execute on function sp_create_producto(uuid, text, text, integer, text, inet) to authenticated;
-- alter table producto drop constraint if exists producto_peso_gramos_pos;
-- alter table producto drop column if exists peso_gramos;
-- alter table categoria drop column if exists lleva_peso;
