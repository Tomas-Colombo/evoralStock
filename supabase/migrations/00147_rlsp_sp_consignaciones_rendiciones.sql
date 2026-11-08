-- 00147_rlsp_sp_consignaciones_rendiciones.sql
-- Fase 5b-M4 de rls-por-permiso: chequeo de permiso en los 13 sp_* de Consignaciones y Rendiciones.
--
-- UP:
--   1. sp_crear_consignacion_con_items: consignaciones.crear
--   2. sp_agregar_item_consignacion: consignaciones.crear
--   3. sp_editar_consignacion: consignaciones.editar
--   4. sp_confirmar_consignacion: consignaciones.editar
--   5. sp_cancelar_item_consignacion: consignaciones.editar
--   6. sp_confirmar_salida_item: consignaciones.editar
--   7. sp_cerrar_consignacion: consignaciones.editar
--   8. sp_eliminar_consignacion: consignaciones.eliminar
--   9. sp_registrar_ajuste_inventario: inventario.editar
--   10. sp_generar_rendicion: rendiciones.crear
--   11. sp_marcar_rendicion_pagada: rendiciones.editar
--   12. sp_excluir_detalle_rendicion: rendiciones.editar
--   13. sp_reincluir_detalle_rendicion: rendiciones.editar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_crear_consignacion_con_items
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_consignacion_con_items(
  p_id_proveedor  uuid,
  p_observaciones text default null,
  p_items         uuid[] default null,
  p_motivo        text default null,
  p_ip            inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
  v_item   uuid;
  v_total  integer;
begin
  if not (select auth_tiene_permiso('consignaciones', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  if p_id_proveedor is null then
    raise exception 'proveedor-requerido' using errcode = '22023';
  end if;

  v_total := coalesce(array_length(p_items, 1), 0);
  if v_total = 0 then
    raise exception 'consignacion-vacia' using errcode = '22023';
  end if;

  insert into consignacion(id_tenant, id_proveedor, id_usuario_alta, observaciones)
  values (v_tenant, p_id_proveedor, v_actor, p_observaciones)
  returning id_consignacion into v_id;

  -- Reusa TODAS las validaciones por ítem (estado, tipo_ingreso, proveedor,
  -- consignación pendiente, reserva activa) + su movimiento_item y auditoría.
  -- Si un solo ítem falla, la transacción entera se va atrás: no queda un
  -- lote a medio armar.
  foreach v_item in array p_items loop
    perform sp_agregar_item_consignacion(v_id, v_item, p_motivo, p_ip);
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion', v_id::text, 'crear',
          jsonb_build_object('id_proveedor', p_id_proveedor,
                             'observaciones', p_observaciones,
                             'items', v_total),
          p_ip);
  return v_id;
end $$;

grant execute on function sp_crear_consignacion_con_items(uuid, text, uuid[], text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_agregar_item_consignacion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('consignaciones', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_agregar_item_consignacion(uuid, uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. sp_editar_consignacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_editar_consignacion(
  p_id_consignacion uuid,
  p_observaciones   text default null,
  p_id_proveedor    uuid default null,
  p_ip              inet default null
) returns void language plpgsql as $$
declare
  v_tenant    uuid := auth_tenant_id();
  v_actor     uuid := auth.uid();
  v_estado    estado_consignacion;
  v_prov_prev uuid;
  v_obs_prev  text;
  v_items     integer;
  v_obs       text := nullif(btrim(coalesce(p_observaciones, '')), '');
begin
  if not (select auth_tiene_permiso('consignaciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado, id_proveedor, observaciones
    into v_estado, v_prov_prev, v_obs_prev
    from consignacion
   where id_consignacion = p_id_consignacion and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_estado <> 'activa' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;

  -- Cambiar de proveedor con ítems adentro dejaría un lote cuyos ítems
  -- pertenecen a otro: sólo se permite mientras esté vacío de detalles.
  if p_id_proveedor is not null and p_id_proveedor <> v_prov_prev then
    select count(*) into v_items
      from consignacion_detalle
     where id_consignacion = p_id_consignacion and estado <> 'cancelado';
    if v_items > 0 then
      raise exception 'proveedor-con-items: %', v_items using errcode = '22023';
    end if;
    update consignacion set id_proveedor = p_id_proveedor
     where id_consignacion = p_id_consignacion;
  end if;

  update consignacion set observaciones = v_obs
   where id_consignacion = p_id_consignacion;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'editar',
          jsonb_build_object(
            'observaciones_antes', v_obs_prev,
            'observaciones_despues', v_obs,
            'id_proveedor_antes', v_prov_prev,
            'id_proveedor_despues', coalesce(p_id_proveedor, v_prov_prev)
          ), p_ip);
end $$;

grant execute on function sp_editar_consignacion(uuid, text, uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. sp_confirmar_consignacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_confirmar_consignacion(
  p_id_consignacion uuid,
  p_ip              inet default null
) returns integer language plpgsql as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_actor   uuid := auth.uid();
  v_estado  estado_consignacion;
  v_detalle uuid;
  v_count   integer := 0;
begin
  if not (select auth_tiene_permiso('consignaciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

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
  if v_estado <> 'activa' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;

  -- Reusa sp_confirmar_salida_item: transición de estado por la máquina,
  -- movimiento_item tipo='devolucion' y auditoría por ítem.
  for v_detalle in
    select id_consignacion_detalle
      from consignacion_detalle
     where id_consignacion = p_id_consignacion
       and id_tenant = v_tenant
       and estado = 'pendiente'
     order by fecha_apartado
     for update
  loop
    perform sp_confirmar_salida_item(v_detalle, p_ip);
    v_count := v_count + 1;
  end loop;

  -- Cierra el lote. Ya no quedan pendientes, así que nunca choca con la
  -- validación de sp_cerrar_consignacion.
  perform sp_cerrar_consignacion(p_id_consignacion, p_ip);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'confirmar',
          jsonb_build_object('items_confirmados', v_count), p_ip);
  return v_count;
end $$;

grant execute on function sp_confirmar_consignacion(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. sp_cancelar_item_consignacion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('consignaciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_cancelar_item_consignacion(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. sp_confirmar_salida_item
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('consignaciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_confirmar_salida_item(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. sp_cerrar_consignacion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('consignaciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_cerrar_consignacion(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. sp_eliminar_consignacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_eliminar_consignacion(
  p_id_consignacion uuid,
  p_ip              inet default null
) returns jsonb language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_estado     estado_consignacion;
  v_snapshot   jsonb;
  v_reestock   integer := 0;
  v_borrados   integer := 0;
  v_item       record;
begin
  if not (select auth_tiene_permiso('consignaciones', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

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

  -- Snapshot completo ANTES de borrar: el lote desaparece de las tablas, así
  -- que la auditoría es el único lugar donde va a quedar qué se deshizo.
  select jsonb_build_object(
           'estado', c.estado,
           'id_proveedor', c.id_proveedor,
           'fecha', c.fecha,
           'observaciones', c.observaciones,
           'detalles', coalesce(jsonb_agg(
             jsonb_build_object(
               'id_item', d.id_item,
               'id_producto', d.id_producto,
               'estado', d.estado,
               'motivo', d.motivo
             )
           ) filter (where d.id_consignacion_detalle is not null), '[]'::jsonb)
         )
    into v_snapshot
    from consignacion c
    left join consignacion_detalle d
           on d.id_consignacion = c.id_consignacion
   where c.id_consignacion = p_id_consignacion
   group by c.id_consignacion;

  -- Reestock: sólo los que ya habían SALIDO ('devuelto') hay que traerlos de
  -- vuelta. Los 'pendiente' nunca dejaron de estar 'disponible' — apartar no
  -- cambia el estado físico — y los 'cancelado' ya fueron liberados.
  for v_item in
    select d.id_consignacion_detalle, d.id_item
      from consignacion_detalle d
      join item_producto i on i.id_item = d.id_item
     where d.id_consignacion = p_id_consignacion
       and d.id_tenant = v_tenant
       and d.estado = 'devuelto'
       and i.estado_item = 'devuelto'
  loop
    -- sp_transicion_item_producto toma su propio FOR UPDATE sobre el ítem y
    -- valida la transición contra la máquina de estados.
    perform sp_transicion_item_producto(
      v_item.id_item, 'disponible', 'ajuste',
      p_id_consignacion, 'consignacion', p_ip
    );
    v_reestock := v_reestock + 1;
  end loop;

  delete from consignacion_detalle
   where id_consignacion = p_id_consignacion and id_tenant = v_tenant;
  get diagnostics v_borrados = row_count;

  delete from consignacion
   where id_consignacion = p_id_consignacion and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'eliminar',
          v_snapshot || jsonb_build_object(
            'items_reestockeados', v_reestock,
            'detalles_borrados', v_borrados
          ), p_ip);

  return jsonb_build_object(
    'items_reestockeados', v_reestock,
    'detalles_borrados', v_borrados
  );
end $$;

grant execute on function sp_eliminar_consignacion(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. sp_registrar_ajuste_inventario
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_registrar_ajuste_inventario(
  p_id_item          uuid,
  p_cantidad_sistema integer,
  p_cantidad_contada integer,
  p_observaciones    text,
  p_dar_de_baja      boolean default false,
  p_ip               inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_diferencia integer := coalesce(p_cantidad_contada, 0) - coalesce(p_cantidad_sistema, 0);
  v_item       item_producto;
  v_id_mov     uuid;
begin
  if not (select auth_tiene_permiso('inventario', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  if p_observaciones is null or trim(p_observaciones) = '' then
    raise exception 'observaciones-requeridas' using errcode = '22023';
  end if;

  select * into v_item from item_producto
   where id_item = p_id_item and id_tenant = v_tenant
   for update;
  if v_item.id_item is null then
    raise exception 'item-not-found' using errcode = '42704';
  end if;

  -- Si van a dar de baja: la transición se hace vía state machine (que
  -- crea SU propio movimiento_item). Después registramos otro movimiento
  -- tipo='ajuste_inventario' con la diferencia. Son dos movimientos
  -- válidos (baja + ajuste_inventario) — cada uno documenta un aspecto.
  if p_dar_de_baja then
    if v_item.estado_item not in ('disponible', 'devuelto_cliente') then
      raise exception 'item-no-puede-darse-de-baja: estado=%', v_item.estado_item
        using errcode = '22023';
    end if;
    perform sp_transicion_item_producto(
      p_id_item, 'baja', 'baja', null, 'ajuste_inventario', p_ip
    );
  end if;

  insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                              estado_desde, estado_hasta,
                              referencia_tipo, referencia_id, diferencia, id_usuario)
  values (v_tenant, p_id_item, 'ajuste_inventario',
          v_item.estado_item,
          case when p_dar_de_baja then 'baja'::estado_item else v_item.estado_item end,
          'ajuste', null,
          jsonb_build_object(
            'cantidad_sistema', p_cantidad_sistema,
            'cantidad_contada', p_cantidad_contada,
            'diferencia', v_diferencia,
            'observaciones', p_observaciones,
            'dado_de_baja', p_dar_de_baja
          ),
          v_actor)
  returning id_movimiento into v_id_mov;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'item_producto', p_id_item::text, 'ajuste_inventario',
          jsonb_build_object(
            'cantidad_sistema', p_cantidad_sistema,
            'cantidad_contada', p_cantidad_contada,
            'diferencia', v_diferencia,
            'dado_de_baja', p_dar_de_baja,
            'observaciones', p_observaciones
          ),
          p_ip);
  return v_id_mov;
end $$;

grant execute on function sp_registrar_ajuste_inventario(uuid, integer, integer, text, boolean, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. sp_generar_rendicion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('rendiciones', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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
   where v.id_venta = dv.id_venta
     and dv.id_tenant = v_tenant
     and dv.id_proveedor = p_id_proveedor
     and dv.id_rendicion is null
     and dv.excluida_rendicion = false
     and dv.monto_proveedor > 0
     and v.estado_venta = 'registrada'
     and not exists (select 1 from devolucion_venta dev
                      where dev.id_detalle_venta = dv.id_detalle_venta); -- EXCLUIR DEVUELTOS

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

grant execute on function sp_generar_rendicion(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 11. sp_marcar_rendicion_pagada
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('rendiciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_marcar_rendicion_pagada(uuid, timestamptz, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 12. sp_excluir_detalle_rendicion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('rendiciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_excluir_detalle_rendicion(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 13. sp_reincluir_detalle_rendicion
-- ─────────────────────────────────────────────────────────────────

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
  if not (select auth_tiene_permiso('rendiciones', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

grant execute on function sp_reincluir_detalle_rendicion(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 1. sp_crear_consignacion_con_items (00125_consignacion_modulo_grupo_b.sql:224)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_consignacion_con_items(
--   p_id_proveedor  uuid,
--   p_observaciones text default null,
--   p_items         uuid[] default null,
--   p_motivo        text default null,
--   p_ip            inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
--   v_item   uuid;
--   v_total  integer;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   if p_id_proveedor is null then
--     raise exception 'proveedor-requerido' using errcode = '22023';
--   end if;
--
--   v_total := coalesce(array_length(p_items, 1), 0);
--   if v_total = 0 then
--     raise exception 'consignacion-vacia' using errcode = '22023';
--   end if;
--
--   insert into consignacion(id_tenant, id_proveedor, id_usuario_alta, observaciones)
--   values (v_tenant, p_id_proveedor, v_actor, p_observaciones)
--   returning id_consignacion into v_id;
--
--   -- Reusa TODAS las validaciones por ítem (estado, tipo_ingreso, proveedor,
--   -- consignación pendiente, reserva activa) + su movimiento_item y auditoría.
--   -- Si un solo ítem falla, la transacción entera se va atrás: no queda un
--   -- lote a medio armar.
--   foreach v_item in array p_items loop
--     perform sp_agregar_item_consignacion(v_id, v_item, p_motivo, p_ip);
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', v_id::text, 'crear',
--           jsonb_build_object('id_proveedor', p_id_proveedor,
--                              'observaciones', p_observaciones,
--                              'items', v_total),
--           p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_crear_consignacion_con_items(uuid, text, uuid[], text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 2. sp_agregar_item_consignacion (00124_consignacion_modulo_grupo_a.sql:203)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   -- Lock consignación + validar estado
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
--
--   -- Lock item + validar
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
--
--   -- Validar que el item viene del proveedor de esta consignación
--   select im.id_proveedor into v_id_proveedor_item
--     from ingreso_mercaderia im
--    where im.id_ingreso = v_item.id_ingreso;
--   if v_id_proveedor_item is null or v_id_proveedor_item <> v_id_proveedor_cons then
--     raise exception 'item-otro-proveedor: %', p_id_item using errcode = '22023';
--   end if;
--
--   -- Chequeo explícito de "1 consignación pendiente por item" (§L41).
--   -- El partial unique index también atajará, pero este raise da error
--   -- semántico mejor que el 23505 crudo.
--   select exists(
--     select 1 from consignacion_detalle
--      where id_item = p_id_item and estado = 'pendiente'
--   ) into v_ya_pendiente;
--   if v_ya_pendiente then
--     raise exception 'item-ya-en-consignacion-pendiente: %', p_id_item using errcode = '23505';
--   end if;
--
--   -- Chequeo: no se puede apartar un item que está en reserva activa
--   if exists(
--     select 1 from detalle_reserva
--      where id_item = p_id_item and estado = 'activa'
--   ) then
--     raise exception 'item-en-reserva: %', p_id_item using errcode = '22023';
--   end if;
--
--   insert into consignacion_detalle(
--     id_tenant, id_consignacion, id_item, id_producto, motivo
--   ) values (
--     v_tenant, p_id_consignacion, p_id_item, v_item.id_producto, p_motivo
--   ) returning id_consignacion_detalle into v_id_detalle;
--
--   -- Movimiento "aparté" (item SIGUE 'disponible' físicamente).
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--  values (v_tenant, p_id_item, 'consignacion',
--           v_item.estado_item, v_item.estado_item,
--           'consignacion_detalle', v_id_detalle, v_actor);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', v_id_detalle::text, 'apartar',
--           jsonb_build_object('id_item', p_id_item,
--                              'id_consignacion', p_id_consignacion,
--                              'motivo', p_motivo),
--           p_ip);
--   return v_id_detalle;
-- end $$;
--
-- grant execute on function sp_agregar_item_consignacion(uuid, uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 3. sp_editar_consignacion (00125_consignacion_modulo_grupo_b.sql:280)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_editar_consignacion(
--   p_id_consignacion uuid,
--   p_observaciones   text default null,
--   p_id_proveedor    uuid default null,
--   p_ip              inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant    uuid := auth_tenant_id();
--   v_actor     uuid := auth.uid();
--   v_estado    estado_consignacion;
--   v_prov_prev uuid;
--   v_obs_prev  text;
--   v_items     integer;
--   v_obs       text := nullif(btrim(coalesce(p_observaciones, '')), '');
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select estado, id_proveedor, observaciones
--     into v_estado, v_prov_prev, v_obs_prev
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_estado <> 'activa' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--
--   -- Cambiar de proveedor con ítems adentro dejaría un lote cuyos ítems
--   -- pertenecen a otro: sólo se permite mientras esté vacío de detalles.
--   if p_id_proveedor is not null and p_id_proveedor <> v_prov_prev then
--     select count(*) into v_items
--       from consignacion_detalle
--      where id_consignacion = p_id_consignacion and estado <> 'cancelado';
--     if v_items > 0 then
--       raise exception 'proveedor-con-items: %', v_items using errcode = '22023';
--     end if;
--     update consignacion set id_proveedor = p_id_proveedor
--      where id_consignacion = p_id_consignacion;
--   end if;
--
--   update consignacion set observaciones = v_obs
--    where id_consignacion = p_id_consignacion;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'editar',
--           jsonb_build_object(
--             'observaciones_antes', v_obs_prev,
--             'observaciones_despues', v_obs,
--             'id_proveedor_antes', v_prov_prev,
--             'id_proveedor_despues', coalesce(p_id_proveedor, v_prov_prev)
--           ), p_ip);
-- end $$;
--
-- grant execute on function sp_editar_consignacion(uuid, text, uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 4. sp_confirmar_consignacion (00125_consignacion_modulo_grupo_b.sql:345)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_confirmar_consignacion(
--   p_id_consignacion uuid,
--   p_ip              inet default null
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_actor   uuid := auth.uid();
--   v_estado  estado_consignacion;
--   v_detalle uuid;
--   v_count   integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select estado into v_estado
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_estado <> 'activa' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--
--   -- Reusa sp_confirmar_salida_item: transición de estado por la máquina,
--   -- movimiento_item tipo='devolucion' y auditoría por ítem.
--   for v_detalle in
--     select id_consignacion_detalle
--       from consignacion_detalle
--      where id_consignacion = p_id_consignacion
--        and id_tenant = v_tenant
--        and estado = 'pendiente'
--      order by fecha_apartado
--      for update
--   loop
--     perform sp_confirmar_salida_item(v_detalle, p_ip);
--     v_count := v_count + 1;
--   end loop;
--
--   -- Cierra el lote. Ya no quedan pendientes, así que nunca choca con la
--   -- validación de sp_cerrar_consignacion.
--   perform sp_cerrar_consignacion(p_id_consignacion, p_ip);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'confirmar',
--           jsonb_build_object('items_confirmados', v_count), p_ip);
--   return v_count;
-- end $$;
--
-- grant execute on function sp_confirmar_consignacion(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 5. sp_cancelar_item_consignacion (00124_consignacion_modulo_grupo_a.sql:310)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
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
--
--   update consignacion_detalle
--      set estado = 'cancelado',
--          fecha_devolucion = null
--    where id_consignacion_detalle = p_id_detalle;
--
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--   select v_tenant, v_id_item, 'ajuste',
--          estado_item, estado_item,
--          'consignacion_detalle', p_id_detalle, v_actor
--     from item_producto where id_item = v_id_item;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'cancelar',
--           jsonb_build_object('motivo', p_motivo), p_ip);
-- end $$;
--
-- grant execute on function sp_cancelar_item_consignacion(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 6. sp_confirmar_salida_item (00124_consignacion_modulo_grupo_a.sql:358)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
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
--
--   -- 1) transicionar item a 'devuelto' (§L83). Este RPC crea SU PROPIO
--   --    movimiento_item tipo='devolucion' vía la máquina de estados.
--   --    Le pasamos p_tipo_movimiento='devolucion' para que quede así en
--   --    movimiento_item — es el "ya salió" del §L85.
--   perform sp_transicion_item_producto(
--     v_id_item, 'devuelto', 'devolucion',
--     p_id_detalle, 'consignacion_detalle', p_ip
--   );
--
--   -- 2) marcar detalle como devuelto con fecha
--   update consignacion_detalle
--      set estado = 'devuelto',
--          fecha_devolucion = now()
--    where id_consignacion_detalle = p_id_detalle;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion_detalle', p_id_detalle::text, 'confirmar_salida',
--           jsonb_build_object('id_item', v_id_item), p_ip);
-- end $$;
--
-- grant execute on function sp_confirmar_salida_item(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 7. sp_cerrar_consignacion (00124_consignacion_modulo_grupo_a.sql:407)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select estado into v_estado
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_estado = 'cerrada' then
--     return; -- idempotente
--   end if;
--
--   select count(*) into v_pendientes
--     from consignacion_detalle
--    where id_consignacion = p_id_consignacion and estado = 'pendiente';
--   if v_pendientes > 0 then
--     raise exception 'quedan-pendientes: %', v_pendientes using errcode = '22023';
--   end if;
--
--   update consignacion
--      set estado = 'cerrada', fecha_cierre = now()
--    where id_consignacion = p_id_consignacion;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'cerrar',
--           '{}'::jsonb, p_ip);
-- end $$;
--
-- grant execute on function sp_cerrar_consignacion(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 8. sp_eliminar_consignacion (00125_consignacion_modulo_grupo_b.sql:404)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_eliminar_consignacion(
--   p_id_consignacion uuid,
--   p_ip              inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_estado     estado_consignacion;
--   v_snapshot   jsonb;
--   v_reestock   integer := 0;
--   v_borrados   integer := 0;
--   v_item       record;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'consignaciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select estado into v_estado
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--
--   -- Snapshot completo ANTES de borrar: el lote desaparece de las tablas, así
--   -- que la auditoría es el único lugar donde va a quedar qué se deshizo.
--   select jsonb_build_object(
--            'estado', c.estado,
--            'id_proveedor', c.id_proveedor,
--            'fecha', c.fecha,
--            'observaciones', c.observaciones,
--            'detalles', coalesce(jsonb_agg(
--              jsonb_build_object(
--                'id_item', d.id_item,
--                'id_producto', d.id_producto,
--                'estado', d.estado,
--                'motivo', d.motivo
--             )
--            ) filter (where d.id_consignacion_detalle is not null), '[]'::jsonb)
--          )
--     into v_snapshot
--     from consignacion c
--     left join consignacion_detalle d
--            on d.id_consignacion = c.id_consignacion
--    where c.id_consignacion = p_id_consignacion
--    group by c.id_consignacion;
--
--   -- Reestock: sólo los que ya habían SALIDO ('devuelto') hay que traerlos de
--   -- vuelta. Los 'pendiente' nunca dejaron de estar 'disponible' — apartar no
--   -- cambia el estado físico — y los 'cancelado' ya fueron liberados.
--   for v_item in
--     select d.id_consignacion_detalle, d.id_item
--       from consignacion_detalle d
--       join item_producto i on i.id_item = d.id_item
--      where d.id_consignacion = p_id_consignacion
--        and d.id_tenant = v_tenant
--        and d.estado = 'devuelto'
--        and i.estado_item = 'devuelto'
--   loop
--     -- sp_transicion_item_producto toma su propio FOR UPDATE sobre el ítem y
--     -- valida la transición contra la máquina de estados.
--     perform sp_transicion_item_producto(
--       v_item.id_item, 'disponible', 'ajuste',
--       p_id_consignacion, 'consignacion', p_ip
--     );
--     v_reestock := v_reestock + 1;
--   end loop;
--
--   delete from consignacion_detalle
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant;
--   get diagnostics v_borrados = row_count;
--
--   delete from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'eliminar',
--           v_snapshot || jsonb_build_object(
--             'items_reestockeados', v_reestock,
--             'detalles_borrados', v_borrados
--           ), p_ip);
--
--   return jsonb_build_object(
--     'items_reestockeados', v_reestock,
--     'detalles_borrados', v_borrados
--   );
-- end $$;
--
-- grant execute on function sp_eliminar_consignacion(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 9. sp_registrar_ajuste_inventario (00025_consignacion_functions.sql:281)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_registrar_ajuste_inventario(
--   p_id_item          uuid,
--   p_cantidad_sistema integer,
--   p_cantidad_contada integer,
--   p_observaciones    text,
--   p_dar_de_baja      boolean default false,
--   p_ip               inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_diferencia integer := coalesce(p_cantidad_contada, 0) - coalesce(p_cantidad_sistema, 0);
--   v_item       item_producto;
--   v_id_mov     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if p_observaciones is null or trim(p_observaciones) = '' then
--     raise exception 'observaciones-requeridas' using errcode = '22023';
--   end if;
--
--   select * into v_item from item_producto
--    where id_item = p_id_item and id_tenant = v_tenant
--    for update;
--   if v_item.id_item is null then
--     raise exception 'item-not-found' using errcode = '42704';
--   end if;
--
--   -- Si van a dar de baja: la transición se hace vía state machine (que
--   -- crea SU propio movimiento_item). Después registramos otro movimiento
--   -- tipo='ajuste_inventario' con la diferencia. Son dos movimientos
--   -- válidos (baja + ajuste_inventario) — cada uno documenta un aspecto.
--   if p_dar_de_baja then
--     if v_item.estado_item not in ('disponible', 'devuelto_cliente') then
--       raise exception 'item-no-puede-darse-de-baja: estado=%', v_item.estado_item
--         using errcode = '22023';
--     end if;
--     perform sp_transicion_item_producto(
--       p_id_item, 'baja', 'baja', null, 'ajuste_inventario', p_ip
--     );
--   end if;
--
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, diferencia, id_usuario)
--   values (v_tenant, p_id_item, 'ajuste_inventario',
--           v_item.estado_item,
--           case when p_dar_de_baja then 'baja'::estado_item else v_item.estado_item end,
--           'ajuste', null,
--           jsonb_build_object(
--             'cantidad_sistema', p_cantidad_sistema,
--             'cantidad_contada', p_cantidad_contada,
--             'diferencia', v_diferencia,
--             'observaciones', p_observaciones,
--             'dado_de_baja', p_dar_de_baja
--           ),
--           v_actor)
--   returning id_movimiento into v_id_mov;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'item_producto', p_id_item::text, 'ajuste_inventario',
--           jsonb_build_object(
--             'cantidad_sistema', p_cantidad_sistema,
--             'cantidad_contada', p_cantidad_contada,
--             'diferencia', v_diferencia,
--             'dado_de_baja', p_dar_de_baja,
--             'observaciones', p_observaciones
--           ),
--           p_ip);
--   return v_id_mov;
-- end $$;
--
-- grant execute on function sp_registrar_ajuste_inventario(uuid, integer, integer, text, boolean, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 10. sp_generar_rendicion (00138_fix_sp_generar_rendicion_update.sql:99)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
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
--
--   if v_count = 0 then
--     raise exception 'sin-lineas-pendientes' using errcode = '22023';
--   end if;
--
--   insert into rendicion_proveedor(
--     id_tenant, id_proveedor, id_usuario_alta,
--     periodo_desde, periodo_hasta,
--     monto_total, cantidad_lineas, observaciones
--   ) values (
--     v_tenant, p_id_proveedor, v_actor,
--     v_desde, v_hasta,
--     v_total, v_count, p_observaciones
--   ) returning id_rendicion into v_id;
--
--   update detalle_venta dv
--      set id_rendicion = v_id
--     from venta v
--    where v.id_venta = dv.id_venta
--      and dv.id_tenant = v_tenant
--      and dv.id_proveedor = p_id_proveedor
--      and dv.id_rendicion is null
--      and dv.excluida_rendicion = false
--      and dv.monto_proveedor > 0
--      and v.estado_venta = 'registrada'
--      and not exists (select 1 from devolucion_venta dev
--                       where dev.id_detalle_venta = dv.id_detalle_venta); -- EXCLUIR DEVUELTOS
--
--   select coalesce(sum(monto_proveedor), 0), count(*)
--     into v_total, v_count
--     from detalle_venta
--    where id_rendicion = v_id;
--
--   update rendicion_proveedor
--      set monto_total = v_total, cantidad_lineas = v_count
--    where id_rendicion = v_id;
--
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
--
-- grant execute on function sp_generar_rendicion(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 11. sp_marcar_rendicion_pagada (00126_rendicion_modulo.sql:457)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
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
--
--   update rendicion_proveedor
--      set estado = 'pagada',
--          fecha_pago = coalesce(p_fecha_pago, now())
--    where id_rendicion = p_id_rendicion;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rendicion_proveedor', p_id_rendicion::text, 'marcar_pagada',
--           jsonb_build_object('fecha_pago', coalesce(p_fecha_pago, now())),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_marcar_rendicion_pagada(uuid, timestamptz, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 12. sp_excluir_detalle_rendicion (00126_rendicion_modulo.sql:373)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select id_rendicion is not null, excluida_rendicion
--     into v_rendida, v_excluida
--     from detalle_venta
--    where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
--    for update;
--
--   if not found then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--   if v_rendida then
--     raise exception 'detalle-ya-rendido' using errcode = '22023';
--   end if;
--   if v_excluida then
--     return; -- idempotente
--   end if;
--
--   update detalle_venta set excluida_rendicion = true
--    where id_detalle_venta = p_id_detalle;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'excluir_rendicion',
--           jsonb_build_object('motivo', p_motivo), p_ip);
-- end $$;
--
-- grant execute on function sp_excluir_detalle_rendicion(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 13. sp_reincluir_detalle_rendicion (00126_rendicion_modulo.sql:416)
-- NOTE: ────────────────────────────────────────────────────────────
--
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
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
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
--
--   update detalle_venta set excluida_rendicion = false
--    where id_detalle_venta = p_id_detalle;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'reincluir_rendicion',
--           '{}'::jsonb, p_ip);
-- end $$;
--
-- grant execute on function sp_reincluir_detalle_rendicion(uuid, inet) to authenticated;
