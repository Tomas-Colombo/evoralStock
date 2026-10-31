-- 00124_consignacion_modulo_grupo_a.sql
-- Exigir paquete opcional de consignaciones habilitado para el tenant en SPs de gestión de ítems y cierre de consignación (REQ-MODOP-07).
--
-- UP:
--   1. sp_agregar_item_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') inmediatamente después de validar v_tenant.
--   2. sp_cancelar_item_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') al inicio de la ejecución.
--   3. sp_confirmar_salida_item: valida fn_modulo_habilitado(v_tenant, 'consignaciones') al inicio de la ejecución.
--   4. sp_cerrar_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') al inicio de la ejecución.
--   Copiadas de la definición vigente en 00025_consignacion_functions.sql manteniendo firmas, semántica y grants.
--
-- DOWN:
-- NOTE: restaurar definiciones vigentes previas desde 00025_consignacion_functions.sql
-- create or replace function sp_agregar_item_consignacion(
--   p_id_consignacion uuid,
--   p_id_item         uuid,
--   p_motivo          text default null,
--   p_ip              inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant           uuid := auth_tenant_id();
--   v_actor            uuid := auth.uid();
--   v_estado_cons      estado_consignacion;
--   v_id_proveedor_cons uuid;
--   v_item             item_producto;
--   v_id_proveedor_item uuid;
--   v_id_detalle       uuid;
--   v_ya_pendiente     boolean;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   select estado, id_proveedor into v_estado_cons, v_id_proveedor_cons
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado_cons is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_estado_cons <> 'activa' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--   select * into v_item
--     from item_producto
--    where id_item = p_id_item and id_tenant = v_tenant
--    for update;
--   if v_item.id_item is null then
--     raise exception 'item-not-found: %', p_id_item using errcode = '42704';
--   end if;
--   if v_item.estado_item <> 'disponible' then
--     raise exception 'item-no-disponible: % (estado=%)',
--       p_id_item, v_item.estado_item using errcode = '22023';
--   end if;
--   if v_item.tipo_ingreso <> 'consignacion' then
--     raise exception 'item-no-es-consignacion: % (tipo_ingreso=%)',
--       p_id_item, v_item.tipo_ingreso using errcode = '22023';
--   end if;
--   select im.id_proveedor into v_id_proveedor_item
--     from ingreso_mercaderia im
--    where im.id_ingreso = v_item.id_ingreso;
--   if v_id_proveedor_item is null or v_id_proveedor_item <> v_id_proveedor_cons then
--     raise exception 'item-otro-proveedor: %', p_id_item using errcode = '22023';
--   end if;
--   select exists(
--     select 1 from consignacion_detalle
--      where id_item = p_id_item and estado = 'pendiente'
--   ) into v_ya_pendiente;
--   if v_ya_pendiente then
--     raise exception 'item-ya-en-consignacion-pendiente: %', p_id_item using errcode = '23505';
--   end if;
--   if exists(
--     select 1 from detalle_reserva
--      where id_item = p_id_item and estado = 'activa'
--   ) then
--     raise exception 'item-en-reserva: %', p_id_item using errcode = '22023';
--   end if;
--   insert into consignacion_detalle(
--     id_tenant, id_consignacion, id_item, id_producto, motivo
--   ) values (
--     v_tenant, p_id_consignacion, p_id_item, v_item.id_producto, p_motivo
--   ) returning id_consignacion_detalle into v_id_detalle;
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--   values (v_tenant, p_id_item, 'consignacion',
--           v_item.estado_item, v_item.estado_item,
--           'consignacion_detalle', v_id_detalle, v_actor);
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', v_id_detalle::text, 'apartar',
--           jsonb_build_object('id_item', p_id_item,
--                              'id_consignacion', p_id_consignacion,
--                              'motivo', p_motivo),
--           p_ip);
--   return v_id_detalle;
-- end $$;
-- create or replace function sp_cancelar_item_consignacion(
--   p_id_detalle uuid,
--   p_motivo     text default null,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_actor   uuid := auth.uid();
--   v_estado  estado_consignacion_detalle;
--   v_id_item uuid;
-- begin
--   select estado, id_item into v_estado, v_id_item
--     from consignacion_detalle
--    where id_consignacion_detalle = p_id_detalle and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--   if v_estado <> 'pendiente' then
--     raise exception 'detalle-no-pendiente: estado=%', v_estado using errcode = '22023';
--   end if;
--   update consignacion_detalle
--      set estado = 'cancelado',
--          fecha_devolucion = null
--    where id_consignacion_detalle = p_id_detalle;
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--   select v_tenant, v_id_item, 'ajuste',
--          estado_item, estado_item,
--          'consignacion_detalle', p_id_detalle, v_actor
--     from item_producto where id_item = v_id_item;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'cancelar',
--           jsonb_build_object('motivo', p_motivo), p_ip);
-- end $$;
-- create or replace function sp_confirmar_salida_item(
--   p_id_detalle uuid,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_actor   uuid := auth.uid();
--   v_estado  estado_consignacion_detalle;
--   v_id_item uuid;
-- begin
--   select estado, id_item into v_estado, v_id_item
--     from consignacion_detalle
--    where id_consignacion_detalle = p_id_detalle and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--   if v_estado <> 'pendiente' then
--     raise exception 'detalle-no-pendiente: estado=%', v_estado using errcode = '22023';
--   end if;
--   perform sp_transicion_item_producto(
--     v_id_item, 'devuelto', 'devolucion',
--     p_id_detalle, 'consignacion_detalle', p_ip
--   );
--   update consignacion_detalle
--      set estado = 'devuelto',
--          fecha_devolucion = now()
--    where id_consignacion_detalle = p_id_detalle;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'confirmar_salida',
--           jsonb_build_object('id_item', v_id_item), p_ip);
-- end $$;
-- create or replace function sp_cerrar_consignacion(
--   p_id_consignacion uuid,
--   p_ip              inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_estado     estado_consignacion;
--   v_pendientes integer;
-- begin
--   select estado into v_estado
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_estado = 'cerrada' then
--     return;
--   end if;
--   select count(*) into v_pendientes
--     from consignacion_detalle
--    where id_consignacion = p_id_consignacion and estado = 'pendiente';
--   if v_pendientes > 0 then
--     raise exception 'quedan-pendientes: %', v_pendientes using errcode = '22023';
--   end if;
--   update consignacion
--      set estado = 'cerrada', fecha_cierre = now()
--    where id_consignacion = p_id_consignacion;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'cerrar',
--           '{}'::jsonb, p_ip);
-- end $$;
-- grant execute on function sp_agregar_item_consignacion(uuid, uuid, text, inet) to authenticated;
-- grant execute on function sp_cancelar_item_consignacion(uuid, text, inet) to authenticated;
-- grant execute on function sp_confirmar_salida_item(uuid, inet) to authenticated;
-- grant execute on function sp_cerrar_consignacion(uuid, inet) to authenticated;

-- ─── 1. sp_agregar_item_consignacion ─────────────────────────────────

create or replace function sp_agregar_item_consignacion(
  p_id_consignacion uuid,
  p_id_item         uuid,
  p_motivo          text default null,
  p_ip              inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant           uuid := auth_tenant_id();
  v_actor            uuid := auth.uid();
  v_estado_cons      estado_consignacion;
  v_id_proveedor_cons uuid;
  v_item             item_producto;
  v_id_proveedor_item uuid;
  v_id_detalle       uuid;
  v_ya_pendiente     boolean;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  -- Lock consignación + validar estado
  select estado, id_proveedor into v_estado_cons, v_id_proveedor_cons
    from consignacion
   where id_consignacion = p_id_consignacion and id_tenant = v_tenant
   for update;
  if v_estado_cons is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_estado_cons <> 'activa' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;

  -- Lock item + validar
  select * into v_item
    from item_producto
   where id_item = p_id_item and id_tenant = v_tenant
   for update;
  if v_item.id_item is null then
    raise exception 'item-not-found: %', p_id_item using errcode = '42704';
  end if;
  if v_item.estado_item <> 'disponible' then
    raise exception 'item-no-disponible: % (estado=%)',
      p_id_item, v_item.estado_item using errcode = '22023';
  end if;
  if v_item.tipo_ingreso <> 'consignacion' then
    raise exception 'item-no-es-consignacion: % (tipo_ingreso=%)',
      p_id_item, v_item.tipo_ingreso using errcode = '22023';
  end if;

  -- Validar que el item viene del proveedor de esta consignación
  select im.id_proveedor into v_id_proveedor_item
    from ingreso_mercaderia im
   where im.id_ingreso = v_item.id_ingreso;
  if v_id_proveedor_item is null or v_id_proveedor_item <> v_id_proveedor_cons then
    raise exception 'item-otro-proveedor: %', p_id_item using errcode = '22023';
  end if;

  -- Chequeo explícito de "1 consignación pendiente por item" (§L41).
  -- El partial unique index también atajará, pero este raise da error
  -- semántico mejor que el 23505 crudo.
  select exists(
    select 1 from consignacion_detalle
     where id_item = p_id_item and estado = 'pendiente'
  ) into v_ya_pendiente;
  if v_ya_pendiente then
    raise exception 'item-ya-en-consignacion-pendiente: %', p_id_item using errcode = '23505';
  end if;

  -- Chequeo: no se puede apartar un item que está en reserva activa
  if exists(
    select 1 from detalle_reserva
     where id_item = p_id_item and estado = 'activa'
  ) then
    raise exception 'item-en-reserva: %', p_id_item using errcode = '22023';
  end if;

  insert into consignacion_detalle(
    id_tenant, id_consignacion, id_item, id_producto, motivo
  ) values (
    v_tenant, p_id_consignacion, p_id_item, v_item.id_producto, p_motivo
  ) returning id_consignacion_detalle into v_id_detalle;

  -- Movimiento "aparté" (item SIGUE 'disponible' físicamente).
  insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                              estado_desde, estado_hasta,
                              referencia_tipo, referencia_id, id_usuario)
  values (v_tenant, p_id_item, 'consignacion',
          v_item.estado_item, v_item.estado_item,
          'consignacion_detalle', v_id_detalle, v_actor);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion_detalle', v_id_detalle::text, 'apartar',
          jsonb_build_object('id_item', p_id_item,
                             'id_consignacion', p_id_consignacion,
                             'motivo', p_motivo),
          p_ip);
  return v_id_detalle;
end $$;

-- ─── 2. sp_cancelar_item_consignacion ────────────────────────────────

create or replace function sp_cancelar_item_consignacion(
  p_id_detalle uuid,
  p_motivo     text default null,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_actor   uuid := auth.uid();
  v_estado  estado_consignacion_detalle;
  v_id_item uuid;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado, id_item into v_estado, v_id_item
    from consignacion_detalle
   where id_consignacion_detalle = p_id_detalle and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'detalle-no-pendiente: estado=%', v_estado using errcode = '22023';
  end if;

  update consignacion_detalle
     set estado = 'cancelado',
         fecha_devolucion = null
   where id_consignacion_detalle = p_id_detalle;

  insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                              estado_desde, estado_hasta,
                              referencia_tipo, referencia_id, id_usuario)
  select v_tenant, v_id_item, 'ajuste',
         estado_item, estado_item,
         'consignacion_detalle', p_id_detalle, v_actor
    from item_producto where id_item = v_id_item;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'cancelar',
          jsonb_build_object('motivo', p_motivo), p_ip);
end $$;

-- ─── 3. sp_confirmar_salida_item ─────────────────────────────────────

create or replace function sp_confirmar_salida_item(
  p_id_detalle uuid,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_actor   uuid := auth.uid();
  v_estado  estado_consignacion_detalle;
  v_id_item uuid;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado, id_item into v_estado, v_id_item
    from consignacion_detalle
   where id_consignacion_detalle = p_id_detalle and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'detalle-no-pendiente: estado=%', v_estado using errcode = '22023';
  end if;

  -- 1) transicionar item a 'devuelto' (§L83). Este RPC crea SU PROPIO
  --    movimiento_item tipo='devolucion' vía la máquina de estados.
  --    Le pasamos p_tipo_movimiento='devolucion' para que quede así en
  --    movimiento_item — es el "ya salió" del §L85.
  perform sp_transicion_item_producto(
    v_id_item, 'devuelto', 'devolucion',
    p_id_detalle, 'consignacion_detalle', p_ip
  );

  -- 2) marcar detalle como devuelto con fecha
  update consignacion_detalle
     set estado = 'devuelto',
         fecha_devolucion = now()
   where id_consignacion_detalle = p_id_detalle;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'confirmar_salida',
          jsonb_build_object('id_item', v_id_item), p_ip);
end $$;

-- ─── 4. sp_cerrar_consignacion ────────────────────────────────────────

create or replace function sp_cerrar_consignacion(
  p_id_consignacion uuid,
  p_ip              inet default null
) returns void language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_estado     estado_consignacion;
  v_pendientes integer;
begin
  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado into v_estado
    from consignacion
   where id_consignacion = p_id_consignacion and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_estado = 'cerrada' then
    return; -- idempotente
  end if;

  select count(*) into v_pendientes
    from consignacion_detalle
   where id_consignacion = p_id_consignacion and estado = 'pendiente';
  if v_pendientes > 0 then
    raise exception 'quedan-pendientes: %', v_pendientes using errcode = '22023';
  end if;

  update consignacion
     set estado = 'cerrada', fecha_cierre = now()
   where id_consignacion = p_id_consignacion;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'cerrar',
          '{}'::jsonb, p_ip);
end $$;

grant execute on function sp_agregar_item_consignacion(uuid, uuid, text, inet) to authenticated;
grant execute on function sp_cancelar_item_consignacion(uuid, text, inet) to authenticated;
grant execute on function sp_confirmar_salida_item(uuid, inet) to authenticated;
grant execute on function sp_cerrar_consignacion(uuid, inet) to authenticated;
