-- 00125_consignacion_modulo_grupo_b.sql
-- Exigir paquete opcional de consignaciones habilitado para el tenant en SPs de alta, edición, confirmación y baja de consignaciones (REQ-MODOP-07).
--
-- UP:
--   1. sp_crear_consignacion_con_items: valida fn_modulo_habilitado(v_tenant, 'consignaciones') inmediatamente después de validar v_tenant.
--   2. sp_editar_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') inmediatamente después de validar v_tenant.
--   3. sp_confirmar_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') inmediatamente después de validar v_tenant.
--   4. sp_eliminar_consignacion: valida fn_modulo_habilitado(v_tenant, 'consignaciones') inmediatamente después de validar v_tenant.
--   Copiadas de la definición vigente en 00054_consignacion_crud.sql manteniendo firmas, semántica y grants.
--
-- DOWN:
-- NOTE: restaurar definiciones vigentes previas desde 00054_consignacion_crud.sql
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
--   if p_id_proveedor is null then
--     raise exception 'proveedor-requerido' using errcode = '22023';
--   end if;
--   v_total := coalesce(array_length(p_items, 1), 0);
--   if v_total = 0 then
--     raise exception 'consignacion-vacia' using errcode = '22023';
--   end if;
--   insert into consignacion(id_tenant, id_proveedor, id_usuario_alta, observaciones)
--   values (v_tenant, p_id_proveedor, v_actor, p_observaciones)
--   returning id_consignacion into v_id;
--   foreach v_item in array p_items loop
--     perform sp_agregar_item_consignacion(v_id, v_item, p_motivo, p_ip);
--   end loop;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', v_id::text, 'crear',
--           jsonb_build_object('id_proveedor', p_id_proveedor,
--                              'observaciones', p_observaciones,
--                              'items', v_total),
--           p_ip);
--   return v_id;
-- end $$;
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
--   update consignacion set observaciones = v_obs
--    where id_consignacion = p_id_consignacion;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'editar',
--           jsonb_build_object(
--             'observaciones_antes', v_obs_prev,
--             'observaciones_despues', v_obs,
--             'id_proveedor_antes', v_prov_prev,
--             'id_proveedor_despues', coalesce(p_id_proveedor, v_prov_prev)
--           ), p_ip);
-- end $$;
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
--   perform sp_cerrar_consignacion(p_id_consignacion, p_ip);
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'confirmar',
--           jsonb_build_object('items_confirmados', v_count), p_ip);
--   return v_count;
-- end $$;
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
--   select estado into v_estado
--     from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
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
--              )
--            ) filter (where d.id_consignacion_detalle is not null), '[]'::jsonb)
--          )
--     into v_snapshot
--     from consignacion c
--     left join consignacion_detalle d
--            on d.id_consignacion = c.id_consignacion
--    where c.id_consignacion = p_id_consignacion
--    group by c.id_consignacion;
--   for v_item in
--     select d.id_consignacion_detalle, d.id_item
--       from consignacion_detalle d
--       join item_producto i on i.id_item = d.id_item
--      where d.id_consignacion = p_id_consignacion
--        and d.id_tenant = v_tenant
--        and d.estado = 'devuelto'
--        and i.estado_item = 'devuelto'
--   loop
--     perform sp_transicion_item_producto(
--       v_item.id_item, 'disponible', 'ajuste',
--       p_id_consignacion, 'consignacion', p_ip
--     );
--     v_reestock := v_reestock + 1;
--   end loop;
--   delete from consignacion_detalle
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant;
--   get diagnostics v_borrados = row_count;
--   delete from consignacion
--    where id_consignacion = p_id_consignacion and id_tenant = v_tenant;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'consignacion', p_id_consignacion::text, 'eliminar',
--           v_snapshot || jsonb_build_object(
--             'items_reestockeados', v_reestock,
--             'detalles_borrados', v_borrados
--           ), p_ip);
--   return jsonb_build_object(
--     'items_reestockeados', v_reestock,
--     'detalles_borrados', v_borrados
--   );
-- end $$;
-- grant execute on function sp_crear_consignacion_con_items(uuid, text, uuid[], text, inet) to authenticated;
-- grant execute on function sp_editar_consignacion(uuid, text, uuid, inet) to authenticated;
-- grant execute on function sp_confirmar_consignacion(uuid, inet) to authenticated;
-- grant execute on function sp_eliminar_consignacion(uuid, inet) to authenticated;

-- ─── 1. sp_crear_consignacion_con_items ──────────────────────────────

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

-- ─── 2. sp_editar_consignacion ───────────────────────────────────────

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

-- ─── 3. sp_confirmar_consignacion ────────────────────────────────────

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

-- ─── 4. sp_eliminar_consignacion ─────────────────────────────────────

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

grant execute on function sp_crear_consignacion_con_items(uuid, text, uuid[], text, inet) to authenticated;
grant execute on function sp_editar_consignacion(uuid, text, uuid, inet) to authenticated;
grant execute on function sp_confirmar_consignacion(uuid, inet) to authenticated;
grant execute on function sp_eliminar_consignacion(uuid, inet) to authenticated;
