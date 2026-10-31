-- 00126_rendicion_modulo.sql
-- Exigir paquete opcional de rendiciones habilitado para el tenant en preview_rendicion y SPs de rendición a proveedor (REQ-MODOP-07).
--
-- UP:
--   1. preview_rendicion: pasa a language plpgsql para validar fn_modulo_habilitado(auth_tenant_id(), 'rendiciones') antes de consultar; mantiene firma, columnas de retorno y volatilidad stable.
--   2. sp_generar_rendicion: valida fn_modulo_habilitado(v_tenant, 'rendiciones') inmediatamente después de validar v_tenant.
--   3. sp_excluir_detalle_rendicion: valida fn_modulo_habilitado(v_tenant, 'rendiciones') al inicio de la ejecución.
--   4. sp_reincluir_detalle_rendicion: valida fn_modulo_habilitado(v_tenant, 'rendiciones') al inicio de la ejecución.
--   5. sp_marcar_rendicion_pagada: valida fn_modulo_habilitado(v_tenant, 'rendiciones') al inicio de la ejecución.
--   Copiadas de las definiciones vigentes en 00071_devolucion_cliente.sql (preview y generar) y 00027_rendicion_gasto_functions.sql (excluir, reincluir, pagar), manteniendo firmas, semántica y grants.
--
-- DOWN:
-- NOTE: restaurar definiciones vigentes previas de preview_rendicion y sp_generar_rendicion desde 00071_devolucion_cliente.sql.
-- NOTE: restaurar definiciones vigentes previas de sp_excluir_detalle_rendicion, sp_reincluir_detalle_rendicion y sp_marcar_rendicion_pagada desde 00027_rendicion_gasto_functions.sql.
-- create or replace function preview_rendicion(
--   p_id_proveedor uuid
-- ) returns table (
--   id_detalle_venta uuid,
--   id_venta         uuid,
--   fecha            timestamptz,
--   producto_nombre  text,
--   producto_sku     text,
--   qr_code          text,
--   precio_venta     numeric,
--   costo_snapshot   numeric,
--   monto_proveedor  numeric,
--   cliente_nombre   text
-- ) language sql stable as $$
--   select
--     dv.id_detalle_venta,
--     v.id_venta,
--     v.fecha,
--     p.nombre  as producto_nombre,
--     p.sku     as producto_sku,
--     ip.qr_code,
--     dv.precio_venta,
--     dv.costo_snapshot,
--     dv.monto_proveedor,
--     c.nombre  as cliente_nombre
--   from detalle_venta dv
--   join venta v          on v.id_venta = dv.id_venta
--   join producto p       on p.id_producto = dv.id_producto
--   join item_producto ip on ip.id_item = dv.id_item
--   left join cliente c   on c.id_cliente = v.id_cliente
--   left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--   where dv.id_tenant = auth_tenant_id()
--     and dv.id_proveedor = p_id_proveedor
--     and dv.id_rendicion is null
--     and dv.excluida_rendicion = false
--     and dv.monto_proveedor > 0
--     and v.estado_venta = 'registrada'
--     and dev.id_devolucion is null -- EXCLUIR DEVUELTOS
--   order by v.fecha asc;
-- $$;
-- create or replace function sp_generar_rendicion(
--   p_id_proveedor  uuid,
--   p_observaciones text default null,
--   p_ip            inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id       uuid;
--   v_total    numeric(14, 2);
--   v_count    integer;
--   v_desde    timestamptz;
--   v_hasta    timestamptz;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   -- Modificado para excluir devueltos
--   select
--     coalesce(sum(dv.monto_proveedor), 0),
--     count(*),
--     min(v.fecha),
--     max(v.fecha)
--   into v_total, v_count, v_desde, v_hasta
--   from detalle_venta dv
--   join venta v on v.id_venta = dv.id_venta
--   left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--   where dv.id_tenant = v_tenant
--     and dv.id_proveedor = p_id_proveedor
--     and dv.id_rendicion is null
--     and dv.excluida_rendicion = false
--     and dv.monto_proveedor > 0
--     and v.estado_venta = 'registrada'
--     and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS
--   if v_count = 0 then
--     raise exception 'sin-lineas-pendientes' using errcode = '22023';
--   end if;
--   insert into rendicion_proveedor(
--     id_tenant, id_proveedor, id_usuario_alta,
--     periodo_desde, periodo_hasta,
--     monto_total, cantidad_lineas, observaciones
--   ) values (
--     v_tenant, p_id_proveedor, v_actor,
--     v_desde, v_hasta,
--     v_total, v_count, p_observaciones
--   ) returning id_rendicion into v_id;
--   update detalle_venta dv
--      set id_rendicion = v_id
--    from venta v
--    left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--    where v.id_venta = dv.id_venta
--      and dv.id_tenant = v_tenant
--      and dv.id_proveedor = p_id_proveedor
--      and dv.id_rendicion is null
--      and dv.excluida_rendicion = false
--      and dv.monto_proveedor > 0
--      and v.estado_venta = 'registrada'
--      and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS
--   select coalesce(sum(monto_proveedor), 0), count(*)
--     into v_total, v_count
--     from detalle_venta
--    where id_rendicion = v_id;
--   update rendicion_proveedor
--      set monto_total = v_total, cantidad_lineas = v_count
--    where id_rendicion = v_id;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rendicion_proveedor', v_id::text, 'generar',
--           jsonb_build_object('id_proveedor', p_id_proveedor,
--                              'monto_total', v_total,
--                              'cantidad_lineas', v_count,
--                              'periodo_desde', v_desde,
--                              'periodo_hasta', v_hasta),
--           p_ip);
--   return v_id;
-- end $$;
-- create or replace function sp_excluir_detalle_rendicion(
--   p_id_detalle uuid,
--   p_motivo     text default null,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_rendida    boolean;
--   v_excluida   boolean;
-- begin
--   select id_rendicion is not null, excluida_rendicion
--     into v_rendida, v_excluida
--     from detalle_venta
--    where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
--    for update;
--   if not found then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--   if v_rendida then
--     raise exception 'detalle-ya-rendido' using errcode = '22023';
--   end if;
--   if v_excluida then
--     return; -- idempotente
--   end if;
--   update detalle_venta set excluida_rendicion = true
--    where id_detalle_venta = p_id_detalle;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'excluir_rendicion',
--           jsonb_build_object('motivo', p_motivo), p_ip);
-- end $$;
-- create or replace function sp_reincluir_detalle_rendicion(
--   p_id_detalle uuid,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_rendida  boolean;
--   v_excluida boolean;
-- begin
--   select id_rendicion is not null, excluida_rendicion
--     into v_rendida, v_excluida
--     from detalle_venta
--    where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
--    for update;
--   if not found then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--   if v_rendida then
--     raise exception 'detalle-ya-rendido' using errcode = '22023';
--   end if;
--   if not v_excluida then
--     return; -- idempotente
--   end if;
--   update detalle_venta set excluida_rendicion = false
--    where id_detalle_venta = p_id_detalle;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'reincluir_rendicion',
--           '{}'::jsonb, p_ip);
-- end $$;
-- create or replace function sp_marcar_rendicion_pagada(
--   p_id_rendicion uuid,
--   p_fecha_pago   timestamptz default null,
--   p_ip           inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_estado estado_rendicion;
-- begin
--   select estado into v_estado
--     from rendicion_proveedor
--    where id_rendicion = p_id_rendicion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'rendicion-not-found' using errcode = '42704';
--   end if;
--   if v_estado = 'pagada' then
--     return; -- idempotente
--   end if;
--   update rendicion_proveedor
--      set estado = 'pagada',
--          fecha_pago = coalesce(p_fecha_pago, now())
--    where id_rendicion = p_id_rendicion;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rendicion_proveedor', p_id_rendicion::text, 'marcar_pagada',
--           jsonb_build_object('fecha_pago', coalesce(p_fecha_pago, now())),
--           p_ip);
-- end $$;
-- grant execute on function preview_rendicion(uuid) to authenticated;
-- grant execute on function sp_generar_rendicion(uuid, text, inet) to authenticated;
-- grant execute on function sp_excluir_detalle_rendicion(uuid, text, inet) to authenticated;
-- grant execute on function sp_reincluir_detalle_rendicion(uuid, inet) to authenticated;
-- grant execute on function sp_marcar_rendicion_pagada(uuid, timestamptz, inet) to authenticated;

-- ─── 1. preview_rendicion ───────────────────────────────────────────

-- Cambia de language sql a plpgsql para poder levantar la excepción 'module-disabled'
-- si el módulo 'rendiciones' no está habilitado para el tenant (REQ-MODOP-07).
-- Mantiene firma, columnas de retorno y volatilidad stable.
create or replace function preview_rendicion(
  p_id_proveedor uuid
) returns table (
  id_detalle_venta uuid,
  id_venta         uuid,
  fecha            timestamptz,
  producto_nombre  text,
  producto_sku     text,
  qr_code          text,
  precio_venta     numeric,
  costo_snapshot   numeric,
  monto_proveedor  numeric,
  cliente_nombre   text
) language plpgsql stable as $$
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(auth_tenant_id(), 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  return query
  select
    dv.id_detalle_venta,
    v.id_venta,
    v.fecha,
    p.nombre  as producto_nombre,
    p.sku     as producto_sku,
    ip.qr_code,
    dv.precio_venta,
    dv.costo_snapshot,
    dv.monto_proveedor,
    c.nombre  as cliente_nombre
  from detalle_venta dv
  join venta v          on v.id_venta = dv.id_venta
  join producto p       on p.id_producto = dv.id_producto
  join item_producto ip on ip.id_item = dv.id_item
  left join cliente c   on c.id_cliente = v.id_cliente
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = auth_tenant_id()
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dv.monto_proveedor > 0
    and v.estado_venta = 'registrada'
    and dev.id_devolucion is null -- EXCLUIR DEVUELTOS
  order by v.fecha asc;
end $$;

-- ─── 2. sp_generar_rendicion ─────────────────────────────────────────

create or replace function sp_generar_rendicion(
  p_id_proveedor  uuid,
  p_observaciones text default null,
  p_ip            inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_total    numeric(14, 2);
  v_count    integer;
  v_desde    timestamptz;
  v_hasta    timestamptz;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  -- Modificado para excluir devueltos
  select
    coalesce(sum(dv.monto_proveedor), 0),
    count(*),
    min(v.fecha),
    max(v.fecha)
  into v_total, v_count, v_desde, v_hasta
  from detalle_venta dv
  join venta v on v.id_venta = dv.id_venta
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = v_tenant
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dv.monto_proveedor > 0
    and v.estado_venta = 'registrada'
    and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS

  if v_count = 0 then
    raise exception 'sin-lineas-pendientes' using errcode = '22023';
  end if;

  insert into rendicion_proveedor(
    id_tenant, id_proveedor, id_usuario_alta,
    periodo_desde, periodo_hasta,
    monto_total, cantidad_lineas, observaciones
  ) values (
    v_tenant, p_id_proveedor, v_actor,
    v_desde, v_hasta,
    v_total, v_count, p_observaciones
  ) returning id_rendicion into v_id;

  update detalle_venta dv
     set id_rendicion = v_id
   from venta v
   left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
   where v.id_venta = dv.id_venta
     and dv.id_tenant = v_tenant
     and dv.id_proveedor = p_id_proveedor
     and dv.id_rendicion is null
     and dv.excluida_rendicion = false
     and dv.monto_proveedor > 0
     and v.estado_venta = 'registrada'
     and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS

  select coalesce(sum(monto_proveedor), 0), count(*)
    into v_total, v_count
    from detalle_venta
   where id_rendicion = v_id;

  update rendicion_proveedor
     set monto_total = v_total, cantidad_lineas = v_count
   where id_rendicion = v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rendicion_proveedor', v_id::text, 'generar',
          jsonb_build_object('id_proveedor', p_id_proveedor,
                             'monto_total', v_total,
                             'cantidad_lineas', v_count,
                             'periodo_desde', v_desde,
                             'periodo_hasta', v_hasta),
          p_ip);
  return v_id;
end $$;

-- ─── 3. sp_excluir_detalle_rendicion ─────────────────────────────────

create or replace function sp_excluir_detalle_rendicion(
  p_id_detalle uuid,
  p_motivo     text default null,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_rendida    boolean;
  v_excluida   boolean;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select id_rendicion is not null, excluida_rendicion
    into v_rendida, v_excluida
    from detalle_venta
   where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
   for update;

  if not found then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;
  if v_rendida then
    raise exception 'detalle-ya-rendido' using errcode = '22023';
  end if;
  if v_excluida then
    return; -- idempotente
  end if;

  update detalle_venta set excluida_rendicion = true
   where id_detalle_venta = p_id_detalle;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'excluir_rendicion',
          jsonb_build_object('motivo', p_motivo), p_ip);
end $$;

-- ─── 4. sp_reincluir_detalle_rendicion ───────────────────────────────

create or replace function sp_reincluir_detalle_rendicion(
  p_id_detalle uuid,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_rendida  boolean;
  v_excluida boolean;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select id_rendicion is not null, excluida_rendicion
    into v_rendida, v_excluida
    from detalle_venta
   where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
   for update;
  if not found then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;
  if v_rendida then
    raise exception 'detalle-ya-rendido' using errcode = '22023';
  end if;
  if not v_excluida then
    return; -- idempotente
  end if;

  update detalle_venta set excluida_rendicion = false
   where id_detalle_venta = p_id_detalle;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'reincluir_rendicion',
          '{}'::jsonb, p_ip);
end $$;

-- ─── 5. sp_marcar_rendicion_pagada ───────────────────────────────────

create or replace function sp_marcar_rendicion_pagada(
  p_id_rendicion uuid,
  p_fecha_pago   timestamptz default null,
  p_ip           inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_estado estado_rendicion;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado into v_estado
    from rendicion_proveedor
   where id_rendicion = p_id_rendicion and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'rendicion-not-found' using errcode = '42704';
  end if;
  if v_estado = 'pagada' then
    return; -- idempotente
  end if;

  update rendicion_proveedor
     set estado = 'pagada',
         fecha_pago = coalesce(p_fecha_pago, now())
   where id_rendicion = p_id_rendicion;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rendicion_proveedor', p_id_rendicion::text, 'marcar_pagada',
          jsonb_build_object('fecha_pago', coalesce(p_fecha_pago, now())),
          p_ip);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────

grant execute on function preview_rendicion(uuid) to authenticated;
grant execute on function sp_generar_rendicion(uuid, text, inet) to authenticated;
grant execute on function sp_excluir_detalle_rendicion(uuid, text, inet) to authenticated;
grant execute on function sp_reincluir_detalle_rendicion(uuid, inet) to authenticated;
grant execute on function sp_marcar_rendicion_pagada(uuid, timestamptz, inet) to authenticated;
