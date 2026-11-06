-- 00138_fix_sp_generar_rendicion_update.sql
-- sp_generar_rendicion fallaba SIEMPRE que había líneas pendientes: el UPDATE ... FROM
-- de 00071/00126 hacía "left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta",
-- y en Postgres la tabla destino del UPDATE (dv) no se puede referenciar desde un JOIN del FROM
-- ("invalid reference to FROM-clause entry for table dv"). Los tests solo cubrían los caminos que
-- abortan antes (módulo apagado, sin líneas). Se reemplaza el join por NOT EXISTS; misma semántica.
--
-- DOWN:
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
-- grant execute on function sp_generar_rendicion(uuid, text, inet) to authenticated;

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
