-- 00148_rlsp_sp_revendedoras.sql
-- Fase 5b-M5 de rls-por-permiso: chequeo de permiso en los 19 sp_* de Revendedoras (Gestión).
--
-- UP:
--   1. sp_crear_revendedora: revendedoras.crear
--   2. sp_crear_consignacion_revendedora_con_items: revendedoras.crear
--   3. sp_entregar_consignacion_revendedora: revendedoras.crear
--   4. sp_confirmar_consignacion_revendedora: revendedoras.crear
--   5. sp_confirmar_declaracion_venta: revendedoras.crear
--   6. sp_rechazar_declaracion_venta: revendedoras.crear
--   7. sp_editar_revendedora: revendedoras.editar
--   8. sp_crear_regla_comision: revendedoras.editar
--   9. sp_terminar_regla_comision: revendedoras.editar
--   10. sp_editar_consignacion_revendedora: revendedoras.editar
--   11. sp_registrar_devolucion_revendedora: revendedoras.editar
--   12. sp_devolver_items_revendedora: revendedoras.editar
--   13. sp_cerrar_consignacion_revendedora: revendedoras.editar
--   14. sp_eliminar_consignacion_revendedora: revendedoras.eliminar
--   15. sp_baja_revendedora: revendedoras.eliminar OR revendedoras.crear
--   16. sp_generar_liquidacion: revendedoras.liquidar
--   17. sp_excluir_detalle_liquidacion: revendedoras.liquidar
--   18. sp_reincluir_detalle_liquidacion: revendedoras.liquidar
--   19. sp_marcar_liquidacion_pagada: revendedoras.liquidar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_crear_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_revendedora(
  p_nombre   text,
  p_apellido text,
  p_telefono text default null,
  p_email    text default null,
  p_notas    text default null,
  p_ip       inet default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if p_email is not null and trim(p_email) <> '' then
    if exists (
      select 1 from revendedora
      where id_tenant = v_tenant and email = trim(p_email) and activo = true
    ) then
      raise exception 'email-duplicado' using errcode = '23505';
    end if;
  end if;

  insert into revendedora (id_tenant, nombre, apellido, telefono, email, notas, activo, fecha_alta)
  values (v_tenant, trim(p_nombre), trim(p_apellido), nullif(trim(p_telefono), ''), nullif(trim(p_email), ''), p_notas, true, current_date)
  returning id_revendedora into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'revendedora', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'apellido', p_apellido, 'email', p_email, 'telefono', p_telefono), p_ip);

  return v_id;
end;
$$;

grant execute on function sp_crear_revendedora(text, text, text, text, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_crear_consignacion_revendedora_con_items
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_consignacion_revendedora_con_items(
  p_id_revendedora uuid,
  p_items          uuid[],
  p_periodo_desde  date default null,
  p_periodo_hasta  date default null,
  p_observaciones  text default null,
  p_motivo         text default null,
  p_ip             inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_rev_activa boolean;
  v_items      uuid[];
  v_total      integer;
  v_id         uuid;
  v_item_id    uuid;
  v_item       item_producto;
  v_id_detalle uuid;
  v_obs        text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  if p_id_revendedora is null then
    raise exception 'revendedora-requerida' using errcode = '22023';
  end if;

  if p_periodo_desde is not null and p_periodo_hasta is not null and p_periodo_hasta < p_periodo_desde then
    raise exception 'periodo-invalido' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_items
    from unnest(coalesce(p_items, '{}')) as x
   where x is not null;

  v_total := coalesce(array_length(v_items, 1), 0);
  if v_total = 0 then
    raise exception 'consignacion-vacia' using errcode = '22023';
  end if;

  select activo into v_rev_activa
    from revendedora
   where id_revendedora = p_id_revendedora and id_tenant = v_tenant
   for update;
  if v_rev_activa is null then
    raise exception 'revendedora-not-found' using errcode = '42704';
  end if;
  if not v_rev_activa then
    raise exception 'revendedora-inactiva' using errcode = '22023';
  end if;

  insert into consignacion_revendedora(
    id_tenant, id_revendedora, id_usuario_alta,
    periodo_desde, periodo_hasta, observaciones
  ) values (
    v_tenant, p_id_revendedora, v_actor,
    p_periodo_desde, p_periodo_hasta, v_obs
  ) returning id_consignacion_revendedora into v_id;

  foreach v_item_id in array v_items loop
    select * into v_item
      from item_producto
     where id_item = v_item_id and id_tenant = v_tenant
     for update;

    if v_item.id_item is null then
      raise exception 'item-not-found: %', v_item_id using errcode = '42704';
    end if;

    if v_item.estado_item <> 'disponible'
       or not is_transicion_item_valida(v_item.estado_item, 'en_revendedora') then
      raise exception 'item-no-entregable: % (estado=%)', v_item_id, v_item.estado_item
        using errcode = '22023';
    end if;

    if exists (
      select 1 from detalle_reserva
       where id_item = v_item_id and estado = 'activa'
    ) then
      raise exception 'item-en-reserva: %', v_item_id using errcode = '22023';
    end if;

    if exists (
      select 1 from consignacion_detalle
       where id_item = v_item_id and estado = 'pendiente'
    ) then
      raise exception 'item-ya-en-consignacion-pendiente: %', v_item_id using errcode = '23505';
    end if;

    if exists (
      select 1 from consignacion_revendedora_detalle
       where id_item = v_item_id and estado_detalle in ('pendiente', 'en_poder')
    ) then
      raise exception 'item-ya-en-consignacion-revendedora: %', v_item_id using errcode = '23505';
    end if;

    insert into consignacion_revendedora_detalle(
      id_tenant, id_consignacion_revendedora, id_item, id_producto,
      estado_detalle, motivo
    ) values (
      v_tenant, v_id, v_item_id, v_item.id_producto,
      'pendiente', v_motivo
    ) returning id_consignacion_revendedora_detalle into v_id_detalle;

    insert into movimiento_item(
      id_tenant, id_item, tipo_movimiento,
      estado_desde, estado_hasta,
      referencia_tipo, referencia_id, id_usuario
    ) values (
      v_tenant, v_item_id, 'consignacion_revendedora',
      v_item.estado_item, v_item.estado_item,
      'consignacion_revendedora_detalle', v_id_detalle, v_actor
    );
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', v_id::text, 'crear',
    jsonb_build_object(
      'id_revendedora', p_id_revendedora,
      'periodo_desde', p_periodo_desde,
      'periodo_hasta', p_periodo_hasta,
      'observaciones', v_obs,
      'items', v_total
    ),
    p_ip
  );

  return v_id;
end $$;

grant execute on function sp_crear_consignacion_revendedora_con_items(uuid, uuid[], date, date, text, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. sp_entregar_consignacion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_entregar_consignacion_revendedora(
  p_id_revendedora uuid,
  p_items          uuid[],
  p_periodo_desde  date default null,
  p_periodo_hasta  date default null,
  p_observaciones  text default null,
  p_motivo         text default null,
  p_ip             inet default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  v_id := sp_crear_consignacion_revendedora_con_items(
    p_id_revendedora, p_items, p_periodo_desde, p_periodo_hasta,
    p_observaciones, p_motivo, p_ip
  );
  perform sp_confirmar_consignacion_revendedora(v_id, p_ip);
  return v_id;
end $$;

grant execute on function sp_entregar_consignacion_revendedora(uuid, uuid[], date, date, text, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. sp_confirmar_consignacion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_confirmar_consignacion_revendedora(
  p_id_consignacion_revendedora uuid,
  p_ip                          inet default null
) returns integer language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_consig consignacion_revendedora;
  v_det    record;
  v_item   item_producto;
  v_count  integer := 0;
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_consig
    from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
   for update;

  if v_consig.id_consignacion_revendedora is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_consig.estado <> 'abierta' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;
  if v_consig.confirmada then
    raise exception 'consignacion-ya-confirmada' using errcode = '22023';
  end if;

  for v_det in
    select id_consignacion_revendedora_detalle, id_item
      from consignacion_revendedora_detalle
     where id_consignacion_revendedora = p_id_consignacion_revendedora
       and id_tenant = v_tenant
       and estado_detalle = 'pendiente'
     order by id_item
     for update
  loop
    select * into v_item
      from item_producto
     where id_item = v_det.id_item and id_tenant = v_tenant
     for update;

    if v_item.estado_item <> 'disponible'
       or not is_transicion_item_valida(v_item.estado_item, 'en_revendedora') then
      raise exception 'item-no-entregable: % (estado=%)', v_det.id_item, v_item.estado_item
        using errcode = '22023';
    end if;

    perform sp_transicion_item_producto(
      v_det.id_item,
      'en_revendedora',
      'entrega_revendedora',
      v_det.id_consignacion_revendedora_detalle,
      'consignacion_revendedora_detalle',
      p_ip
    );

    update consignacion_revendedora_detalle
       set estado_detalle = 'en_poder',
           fecha_entrega = now()
     where id_consignacion_revendedora_detalle = v_det.id_consignacion_revendedora_detalle;

    v_count := v_count + 1;
  end loop;

  update consignacion_revendedora
     set confirmada = true,
         fecha_confirmacion = now()
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'confirmar',
    jsonb_build_object('items_confirmados', v_count),
    p_ip
  );

  return v_count;
end $$;

grant execute on function sp_confirmar_consignacion_revendedora(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. sp_confirmar_declaracion_venta
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_confirmar_declaracion_venta(
  p_id_declaracion uuid
) returns uuid language plpgsql security invoker as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_dec      declaracion_venta_revendedora;
  v_id_venta uuid;
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Solo operador del local (sin claim de revendedora)
  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  select * into v_dec
  from declaracion_venta_revendedora
  where id_tenant = v_tenant and id_declaracion = p_id_declaracion
  for update;

  if v_dec.id_declaracion is null then
    raise exception 'declaracion-no-encontrada' using errcode = '42704';
  end if;

  if v_dec.estado <> 'pendiente' then
    raise exception 'declaracion-no-pendiente' using errcode = '22023';
  end if;

  -- Registrar la venta a través de sp_registrar_venta (canal revendedora, pago cuenta_revendedora automático)
  v_id_venta := sp_registrar_venta(
    p_lineas := jsonb_build_array(jsonb_build_object('id_item', v_dec.id_item)),
    p_canal := 'revendedora',
    p_id_revendedora := v_dec.id_revendedora
  );

  update declaracion_venta_revendedora
  set estado = 'confirmada',
      id_venta = v_id_venta,
      confirmada_por = v_actor,
      updated_at = now()
  where id_declaracion = p_id_declaracion and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
  values (
    v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
    'confirmar_declaracion_venta',
    jsonb_build_object('id_venta', v_id_venta, 'id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora)
  );

  return v_id_venta;
end;
$$;

grant execute on function sp_confirmar_declaracion_venta(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. sp_rechazar_declaracion_venta
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_rechazar_declaracion_venta(
  p_id_declaracion uuid,
  p_motivo         text
) returns void language plpgsql security invoker as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_dec    declaracion_venta_revendedora;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not (select auth_tiene_permiso('revendedoras', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Solo operador del local
  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  -- Motivo obligatorio
  if v_motivo is null then
    raise exception 'motivo-requerido' using errcode = '22023';
  end if;

  select * into v_dec
  from declaracion_venta_revendedora
  where id_tenant = v_tenant and id_declaracion = p_id_declaracion
  for update;

  if v_dec.id_declaracion is null then
    raise exception 'declaracion-no-encontrada' using errcode = '42704';
  end if;

  if v_dec.estado <> 'pendiente' then
    raise exception 'declaracion-no-pendiente' using errcode = '22023';
  end if;

  update declaracion_venta_revendedora
  set estado = 'rechazada',
      motivo_rechazo = v_motivo,
      confirmada_por = v_actor,
      updated_at = now()
  where id_declaracion = p_id_declaracion and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
  values (
    v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
    'rechazar_declaracion_venta',
    jsonb_build_object('id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora, 'motivo', v_motivo)
  );
end;
$$;

grant execute on function sp_rechazar_declaracion_venta(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. sp_editar_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_editar_revendedora(
  p_id uuid,
  p_nombre text,
  p_apellido text,
  p_telefono text default null,
  p_email text default null,
  p_notas text default null,
  p_ip inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_old    record;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_old from revendedora where id_revendedora = p_id and id_tenant = v_tenant for update;
  if not found then
    raise exception 'revendedora-not-found' using errcode = 'P0002';
  end if;

  update revendedora
  set nombre = p_nombre,
      apellido = p_apellido,
      telefono = p_telefono,
      email = p_email,
      notas = p_notas
  where id_revendedora = p_id and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'revendedora', p_id::text, 'editar',
          jsonb_build_object('nombre', p_nombre, 'apellido', p_apellido, 'email', p_email, 'telefono', p_telefono), p_ip);
end $$;

grant execute on function sp_editar_revendedora(uuid, text, text, text, text, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. sp_crear_regla_comision
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_regla_comision(
  p_ambito         ambito_comision,
  p_nombre         text,
  p_id_revendedora uuid default null,
  p_vigente_desde  date default current_date,
  p_vigente_hasta  date default null,
  p_escalas        jsonb default '[]'::jsonb,
  p_ip             inet default null
) returns uuid language plpgsql set search_path = public as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id_regla uuid;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- 1. Validar módulo revendedoras habilitado para el tenant
  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  -- 2. Validar escalas no vacías
  if p_escalas is null or jsonb_typeof(p_escalas) <> 'array' or jsonb_array_length(p_escalas) = 0 then
    raise exception 'escala-comision-invalida' using errcode = '22023';
  end if;

  -- 3. Si es regla propia de revendedora, validar que pertenezca al tenant
  if p_id_revendedora is not null then
    if not exists (
      select 1 from revendedora
      where id_tenant = v_tenant and id_revendedora = p_id_revendedora
    ) then
      raise exception 'revendedora-not-found' using errcode = '42704';
    end if;
  end if;

  -- 4. Insertar regla y tramos de escala en una sola transacción protegiendo exclusión
  begin
    insert into regla_comision(
      id_tenant,
      ambito,
      nombre,
      id_revendedora,
      vigente_desde,
      vigente_hasta,
      activo
    ) values (
      v_tenant,
      p_ambito,
      p_nombre,
      p_id_revendedora,
      p_vigente_desde,
      p_vigente_hasta,
      true
    ) returning id_regla into v_id_regla;

    insert into escala_comision(
      id_tenant,
      id_regla,
      objetivo_desde,
      porcentaje
    )
    select
      v_tenant,
      v_id_regla,
      (elem->>'objetivo_desde')::numeric,
      (elem->>'porcentaje')::numeric
    from jsonb_array_elements(p_escalas) as elem;

  exception
    when exclusion_violation then
      raise exception 'regla-solapada' using errcode = '23P01';
  end;

  -- 5. Auditar creación
  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'regla_comision',
    v_id_regla::text,
    'crear',
    jsonb_build_object(
      'ambito', p_ambito,
      'nombre', p_nombre,
      'id_revendedora', p_id_revendedora,
      'vigente_desde', p_vigente_desde,
      'vigente_hasta', p_vigente_hasta,
      'escalas', p_escalas
    ),
    p_ip
  );

  return v_id_regla;
end;
$$;

grant execute on function sp_crear_regla_comision(ambito_comision, text, uuid, date, date, jsonb, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. sp_terminar_regla_comision
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_terminar_regla_comision(
  p_id_regla      uuid,
  p_vigente_hasta date default current_date,
  p_ip            inet default null
) returns void language plpgsql set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_regla  regla_comision%rowtype;
  v_fecha  date := coalesce(p_vigente_hasta, current_date);
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- 1. Validar módulo revendedoras habilitado
  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  -- 2. Validar que la regla exista en el tenant
  select * into v_regla from regla_comision
  where id_tenant = v_tenant and id_regla = p_id_regla
  for update;

  if not found then
    raise exception 'regla-comision-not-found' using errcode = '42704';
  end if;

  -- 3. Actualizar fecha de fin de vigencia
  begin
    update regla_comision
    set vigente_hasta = v_fecha
    where id_tenant = v_tenant and id_regla = p_id_regla;
  exception
    when exclusion_violation then
      raise exception 'regla-solapada' using errcode = '23P01';
  end;

  -- 4. Auditar término de vigencia
  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'regla_comision',
    p_id_regla::text,
    'terminar',
    jsonb_build_object(
      'vigente_hasta_anterior', v_regla.vigente_hasta,
      'vigente_hasta_nuevo', v_fecha
    ),
    p_ip
  );
end;
$$;

grant execute on function sp_terminar_regla_comision(uuid, date, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. sp_editar_consignacion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_editar_consignacion_revendedora(
  p_id_consignacion_revendedora uuid,
  p_observaciones               text default null,
  p_periodo_desde               date default null,
  p_periodo_hasta               date default null,
  p_ip                          inet default null
) returns void language plpgsql as $$
declare
  v_tenant      uuid := auth_tenant_id();
  v_actor       uuid := auth.uid();
  v_consig      consignacion_revendedora;
  v_obs         text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_desde_final date;
  v_hasta_final date;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_consig
    from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
   for update;

  if v_consig.id_consignacion_revendedora is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_consig.estado <> 'abierta' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;

  v_desde_final := coalesce(p_periodo_desde, v_consig.periodo_desde);
  v_hasta_final := coalesce(p_periodo_hasta, v_consig.periodo_hasta);
  if v_desde_final is not null and v_hasta_final is not null and v_hasta_final < v_desde_final then
    raise exception 'periodo-invalido' using errcode = '22023';
  end if;

  update consignacion_revendedora
     set observaciones = v_obs,
         periodo_desde = v_desde_final,
         periodo_hasta = v_hasta_final
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'editar',
    jsonb_build_object(
      'observaciones_antes', v_consig.observaciones,
      'observaciones_despues', v_obs,
      'periodo_desde_antes', v_consig.periodo_desde,
      'periodo_desde_despues', v_desde_final,
      'periodo_hasta_antes', v_consig.periodo_hasta,
      'periodo_hasta_despues', v_hasta_final
    ),
    p_ip
  );
end $$;

grant execute on function sp_editar_consignacion_revendedora(uuid, text, date, date, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 11. sp_registrar_devolucion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_registrar_devolucion_revendedora(
  p_id_consignacion_revendedora uuid,
  p_items                       uuid[],
  p_estado_destino              estado_item default 'disponible',
  p_motivo                      text default null,
  p_ip                          inet default null
) returns integer language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_consig   consignacion_revendedora;
  v_items    uuid[];
  v_total    integer;
  v_item_id  uuid;
  v_det      consignacion_revendedora_detalle;
  v_item     item_producto;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_est_det  estado_consignacion_revendedora_detalle;
  v_count    integer := 0;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  if p_estado_destino not in ('disponible', 'devuelto', 'baja') then
    raise exception 'invalid-transition' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_items
    from unnest(coalesce(p_items, '{}')) as x
   where x is not null;

  v_total := coalesce(array_length(v_items, 1), 0);
  if v_total = 0 then
    raise exception 'items-vacios' using errcode = '22023';
  end if;

  select * into v_consig
    from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
   for update;

  if v_consig.id_consignacion_revendedora is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_consig.estado <> 'abierta' then
    raise exception 'consignacion-no-activa' using errcode = '22023';
  end if;
  if not v_consig.confirmada then
    raise exception 'consignacion-no-confirmada' using errcode = '22023';
  end if;

  v_est_det := case
    when p_estado_destino = 'baja' then 'baja'::estado_consignacion_revendedora_detalle
    else 'devuelto'::estado_consignacion_revendedora_detalle
  end;

  foreach v_item_id in array v_items loop
    select * into v_det
      from consignacion_revendedora_detalle
     where id_consignacion_revendedora = p_id_consignacion_revendedora
       and id_item = v_item_id
       and id_tenant = v_tenant
     for update;

    if v_det.id_consignacion_revendedora_detalle is null then
      raise exception 'detalle-not-found' using errcode = '42704';
    end if;
    if v_det.estado_detalle <> 'en_poder' then
      raise exception 'detalle-no-pendiente' using errcode = '22023';
    end if;

    select * into v_item
      from item_producto
     where id_item = v_item_id and id_tenant = v_tenant
     for update;

    if not is_transicion_item_valida(v_item.estado_item, p_estado_destino) then
      raise exception 'invalid-transition' using errcode = '22023';
    end if;

    perform sp_transicion_item_producto(
      v_item_id,
      p_estado_destino,
      'devolucion_revendedora',
      v_det.id_consignacion_revendedora_detalle,
      'consignacion_revendedora_detalle',
      p_ip
    );

    update consignacion_revendedora_detalle
       set estado_detalle = v_est_det,
           fecha_devolucion = now(),
           motivo = coalesce(v_motivo, motivo)
     where id_consignacion_revendedora_detalle = v_det.id_consignacion_revendedora_detalle;

    v_count := v_count + 1;
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'devolucion',
    jsonb_build_object(
      'items_devueltos', v_count,
      'estado_destino', p_estado_destino,
      'motivo', v_motivo
    ),
    p_ip
  );

  return v_count;
end $$;

grant execute on function sp_registrar_devolucion_revendedora(uuid, uuid[], estado_item, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 12. sp_devolver_items_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_devolver_items_revendedora(
  p_id_revendedora uuid,
  p_items          uuid[],
  p_estado_destino estado_item default 'disponible',
  p_motivo         text default null,
  p_ip             inet default null
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_items  uuid[];
  v_grupo  record;
  v_count  integer := 0;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_id_revendedora is null then
    raise exception 'revendedora-requerida' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_items
    from unnest(coalesce(p_items, '{}')) as x
   where x is not null;

  if coalesce(array_length(v_items, 1), 0) = 0 then
    raise exception 'items-vacios' using errcode = '22023';
  end if;

  if not exists (
    select 1 from revendedora
     where id_revendedora = p_id_revendedora and id_tenant = v_tenant
  ) then
    raise exception 'revendedora-not-found' using errcode = '42704';
  end if;

  -- Todo o nada: un ítem ajeno no puede colarse en la devolución de otra.
  if exists (
    select 1
      from unnest(v_items) as x
     where not exists (
       select 1
         from consignacion_revendedora_detalle d
         join consignacion_revendedora c
           on c.id_consignacion_revendedora = d.id_consignacion_revendedora
        where d.id_item = x
          and d.id_tenant = v_tenant
          and d.estado_detalle = 'en_poder'
          and c.id_revendedora = p_id_revendedora
     )
  ) then
    raise exception 'item-no-en-poder-revendedora' using errcode = '22023';
  end if;

  for v_grupo in
    select d.id_consignacion_revendedora as id_consig,
           array_agg(d.id_item order by d.id_item) as items
      from consignacion_revendedora_detalle d
      join consignacion_revendedora c
        on c.id_consignacion_revendedora = d.id_consignacion_revendedora
     where d.id_item = any(v_items)
       and d.id_tenant = v_tenant
       and d.estado_detalle = 'en_poder'
       and c.id_revendedora = p_id_revendedora
     group by d.id_consignacion_revendedora
     order by d.id_consignacion_revendedora
  loop
    v_count := v_count + sp_registrar_devolucion_revendedora(
      v_grupo.id_consig, v_grupo.items, p_estado_destino, p_motivo, p_ip
    );
  end loop;

  return v_count;
end $$;

grant execute on function sp_devolver_items_revendedora(uuid, uuid[], estado_item, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 13. sp_cerrar_consignacion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_cerrar_consignacion_revendedora(
  p_id_consignacion_revendedora uuid,
  p_ip                          inet default null
) returns void language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_consig   consignacion_revendedora;
  v_en_poder integer;
begin
  if not (select auth_tiene_permiso('revendedoras', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_consig
    from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
   for update;

  if v_consig.id_consignacion_revendedora is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;
  if v_consig.estado = 'cerrada' then
    return;
  end if;

  select count(*) into v_en_poder
    from consignacion_revendedora_detalle
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
     and estado_detalle in ('pendiente', 'en_poder');

  if v_en_poder > 0 then
    raise exception 'consignacion-con-items-en-poder: %', v_en_poder using errcode = '22023';
  end if;

  update consignacion_revendedora
     set estado = 'cerrada',
         fecha_cierre = now()
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'cerrar',
    '{}'::jsonb,
    p_ip
  );
end $$;

grant execute on function sp_cerrar_consignacion_revendedora(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 14. sp_eliminar_consignacion_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_eliminar_consignacion_revendedora(
  p_id_consignacion_revendedora uuid,
  p_ip                          inet default null
) returns void language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_consig   consignacion_revendedora;
  v_snapshot jsonb;
  v_borrados integer := 0;
begin
  if not (select auth_tiene_permiso('revendedoras', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_consig
    from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant
   for update;

  if v_consig.id_consignacion_revendedora is null then
    raise exception 'consignacion-not-found' using errcode = '42704';
  end if;

  if v_consig.confirmada or v_consig.estado <> 'abierta' then
    raise exception 'consignacion-confirmada' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'id_revendedora', c.id_revendedora,
           'periodo_desde', c.periodo_desde,
           'periodo_hasta', c.periodo_hasta,
           'observaciones', c.observaciones,
           'detalles', coalesce(jsonb_agg(
             jsonb_build_object(
               'id_item', d.id_item,
               'id_producto', d.id_producto,
               'estado_detalle', d.estado_detalle,
               'motivo', d.motivo
             )
           ) filter (where d.id_consignacion_revendedora_detalle is not null), '[]'::jsonb)
         )
    into v_snapshot
    from consignacion_revendedora c
    left join consignacion_revendedora_detalle d
           on d.id_consignacion_revendedora = c.id_consignacion_revendedora
          and d.id_tenant = c.id_tenant
   where c.id_consignacion_revendedora = p_id_consignacion_revendedora
     and c.id_tenant = v_tenant
   group by c.id_consignacion_revendedora;

  delete from consignacion_revendedora_detalle
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant;
  get diagnostics v_borrados = row_count;

  delete from consignacion_revendedora
   where id_consignacion_revendedora = p_id_consignacion_revendedora
     and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'eliminar',
    coalesce(v_snapshot, '{}'::jsonb) || jsonb_build_object('detalles_borrados', v_borrados),
    p_ip
  );
end $$;

grant execute on function sp_eliminar_consignacion_revendedora(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 15. sp_baja_revendedora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_baja_revendedora(
  p_id uuid,
  p_ip inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_old    record;
begin
  if not (
    (select auth_tiene_permiso('revendedoras', 'eliminar'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

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

  select * into v_old from revendedora where id_revendedora = p_id and id_tenant = v_tenant for update;
  if not found then
    raise exception 'revendedora-not-found' using errcode = 'P0002';
  end if;

  if not v_old.activo then
    return;
  end if;

  if exists (
    select 1
      from consignacion_revendedora_detalle d
      join consignacion_revendedora c
        on c.id_consignacion_revendedora = d.id_consignacion_revendedora
       and c.id_tenant = d.id_tenant
     where c.id_tenant = v_tenant
       and c.id_revendedora = p_id
       and d.estado_detalle = 'en_poder'
  ) then
    raise exception 'revendedora-con-stock' using errcode = '22023';
  end if;

  update revendedora
  set activo = false
  where id_revendedora = p_id and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'revendedora', p_id::text, 'baja',
          jsonb_build_object('activo', false), p_ip);
end $$;

grant execute on function sp_baja_revendedora(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 16. sp_generar_liquidacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_generar_liquidacion(
  p_id_revendedora uuid,
  p_desde          date,
  p_hasta          date,
  p_observaciones  text default null,
  p_ip             inet default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_tenant            uuid := auth_tenant_id();
  v_actor             uuid := auth.uid();
  v_id_liq            uuid;
  v_rango             tstzrange;
  v_total_candidato   numeric := 0;
  v_count_candidato   integer := 0;
  v_porcentaje        numeric := 0;
  v_vendido_real      numeric := 0;
  v_comision_real     numeric := 0;
  v_cobrar_real       numeric := 0;
  v_count_real        integer := 0;
begin
  if not (select auth_tiene_permiso('revendedoras', 'liquidar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if not exists (
    select 1 from revendedora
    where id_tenant = v_tenant and id_revendedora = p_id_revendedora and activo = true
    for update
  ) then
    raise exception 'revendedora-not-found' using errcode = '42704';
  end if;

  v_rango := fn_rango_tenant(p_desde, p_hasta);

  -- Sumar total del período sobre líneas candidatas bloqueándolas con FOR UPDATE
  with lineas_candidatas as (
    select dv.id_detalle_venta, dv.precio_venta
    from detalle_venta dv
    join venta v on v.id_venta = dv.id_venta
    left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
    where dv.id_tenant = v_tenant
      and v.id_tenant = v_tenant
      and v.canal = 'revendedora'
      and v.id_revendedora = p_id_revendedora
      and v.estado_venta = 'registrada'
      and dev.id_devolucion is null
      and dv.id_liquidacion is null
      and dv.excluida_liquidacion = false
      and v.fecha <@ v_rango
    for update of dv
  )
  select
    coalesce(sum(precio_venta), 0),
    count(*)
  into v_total_candidato, v_count_candidato
  from lineas_candidatas;

  if v_count_candidato = 0 then
    raise exception 'liquidacion-vacia' using errcode = '22023';
  end if;

  -- Resolver comisión UNA SOLA VEZ con el total acumulado del período
  select coalesce(porcentaje, 0) into v_porcentaje
    from fn_resolver_comision(p_id_revendedora, p_hasta, v_total_candidato, 'revendedora')
   limit 1;
  v_porcentaje := coalesce(v_porcentaje, 0);

  -- Insertar cabecera inicial
  insert into liquidacion_revendedora (
    id_tenant, id_revendedora, periodo_desde, periodo_hasta,
    monto_vendido, monto_comision, monto_a_cobrar,
    cantidad_lineas, porcentaje_aplicado, estado,
    fecha_liquidacion, observaciones, id_usuario_alta
  ) values (
    v_tenant, p_id_revendedora, p_desde, p_hasta,
    v_total_candidato, round(v_total_candidato * (v_porcentaje / 100.0), 2),
    v_total_candidato - round(v_total_candidato * (v_porcentaje / 100.0), 2),
    v_count_candidato, v_porcentaje, 'pendiente',
    (now() at time zone 'UTC')::date, p_observaciones, v_actor
  ) returning id_liquidacion into v_id_liq;

  -- Sellar id_liquidacion y escribir monto_comision por línea
  update detalle_venta dv
     set id_liquidacion = v_id_liq,
         monto_comision = round(dv.precio_venta * (v_porcentaje / 100.0), 2)
    from venta v
   where v.id_venta = dv.id_venta
     and dv.id_tenant = v_tenant
     and v.id_tenant = v_tenant
     and v.canal = 'revendedora'
     and v.id_revendedora = p_id_revendedora
     and v.estado_venta = 'registrada'
     and dv.id_liquidacion is null
     and dv.excluida_liquidacion = false
     and v.fecha <@ v_rango
     and not exists (
       select 1 from devolucion_venta dev
        where dev.id_detalle_venta = dv.id_detalle_venta
     );

  -- Recalcular cabecera desde las filas realmente selladas (guarda de concurrencia)
  select
    coalesce(sum(precio_venta), 0),
    coalesce(sum(monto_comision), 0),
    count(*)
  into v_vendido_real, v_comision_real, v_count_real
  from detalle_venta
  where id_liquidacion = v_id_liq
    and id_tenant = v_tenant;

  v_cobrar_real := v_vendido_real - v_comision_real;

  update liquidacion_revendedora
     set monto_vendido = v_vendido_real,
         monto_comision = v_comision_real,
         monto_a_cobrar = v_cobrar_real,
         cantidad_lineas = v_count_real
   where id_liquidacion = v_id_liq;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'liquidacion_revendedora', v_id_liq::text, 'generar_liquidacion',
    jsonb_build_object(
      'id_revendedora', p_id_revendedora,
      'periodo_desde', p_desde,
      'periodo_hasta', p_hasta,
      'monto_vendido', v_vendido_real,
      'monto_comision', v_comision_real,
      'monto_a_cobrar', v_cobrar_real,
      'porcentaje_aplicado', v_porcentaje,
      'cantidad_lineas', v_count_real
    ),
    p_ip
  );

  return v_id_liq;
end;
$$;

grant execute on function sp_generar_liquidacion(uuid, date, date, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 17. sp_excluir_detalle_liquidacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_excluir_detalle_liquidacion(
  p_id_detalle uuid,
  p_motivo     text default null,
  p_ip         inet default null
) returns void
language plpgsql
security invoker
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_liquidada  boolean;
  v_excluida   boolean;
begin
  if not (select auth_tiene_permiso('revendedoras', 'liquidar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  select id_liquidacion is not null, excluida_liquidacion
    into v_liquidada, v_excluida
    from detalle_venta
   where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
   for update;

  if not found then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;

  if v_liquidada then
    raise exception 'detalle-ya-liquidado' using errcode = '22023';
  end if;

  if v_excluida then
    return; -- idempotente
  end if;

  update detalle_venta
     set excluida_liquidacion = true
   where id_detalle_venta = p_id_detalle;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'excluir_liquidacion',
    jsonb_build_object('motivo', p_motivo), p_ip
  );
end;
$$;

grant execute on function sp_excluir_detalle_liquidacion(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 18. sp_reincluir_detalle_liquidacion
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_reincluir_detalle_liquidacion(
  p_id_detalle uuid,
  p_ip         inet default null
) returns void
language plpgsql
security invoker
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_liquidada  boolean;
  v_excluida   boolean;
begin
  if not (select auth_tiene_permiso('revendedoras', 'liquidar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  select id_liquidacion is not null, excluida_liquidacion
    into v_liquidada, v_excluida
    from detalle_venta
   where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
   for update;

  if not found then
    raise exception 'detalle-not-found' using errcode = '42704';
  end if;

  if v_liquidada then
    raise exception 'detalle-ya-liquidado' using errcode = '22023';
  end if;

  if not v_excluida then
    return; -- idempotente
  end if;

  update detalle_venta
     set excluida_liquidacion = false
   where id_detalle_venta = p_id_detalle;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'reincluir_liquidacion',
    '{}'::jsonb, p_ip
  );
end;
$$;

grant execute on function sp_reincluir_detalle_liquidacion(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 19. sp_marcar_liquidacion_pagada
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_marcar_liquidacion_pagada(
  p_id_liquidacion uuid,
  p_id_cuenta      uuid,
  p_monto          numeric,
  p_metodo         text default 'transferencia',
  p_referencia     text default null,
  p_fecha          timestamptz default null,
  p_ip             inet default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_liq          liquidacion_revendedora%rowtype;
  v_id_pago      uuid;
begin
  if not (select auth_tiene_permiso('revendedoras', 'liquidar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  select * into v_liq
    from liquidacion_revendedora
   where id_liquidacion = p_id_liquidacion
     and id_tenant = v_tenant
   for update;

  if not found then
    raise exception 'liquidacion-no-encontrada' using errcode = '42704';
  end if;

  if v_liq.estado = 'pagada' then
    raise exception 'liquidacion-ya-pagada' using errcode = '22023';
  end if;

  if not exists (
    select 1 from cuenta_destino
     where id_cuenta_destino = p_id_cuenta
       and id_tenant = v_tenant
       and activo = true
  ) then
    raise exception 'cuenta-invalida-liquidacion' using errcode = '22023';
  end if;

  if p_monto is null or p_monto <> v_liq.monto_a_cobrar then
    raise exception 'monto-pago-invalido' using errcode = '22023';
  end if;

  insert into pago_revendedora (
    id_tenant, id_liquidacion, monto, metodo, referencia, id_cuenta, fecha, id_usuario_alta
  ) values (
    v_tenant, p_id_liquidacion, p_monto, coalesce(p_metodo, 'transferencia'),
    p_referencia, p_id_cuenta, coalesce(p_fecha, now()), v_actor
  ) returning id_pago_revendedora into v_id_pago;

  update liquidacion_revendedora
     set estado = 'pagada',
         fecha_pago = coalesce(p_fecha, now())
   where id_liquidacion = p_id_liquidacion;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'liquidacion_revendedora', p_id_liquidacion::text, 'pagar_liquidacion',
    jsonb_build_object(
      'id_pago_revendedora', v_id_pago,
      'monto', p_monto,
      'id_cuenta', p_id_cuenta,
      'metodo', p_metodo,
      'referencia', p_referencia,
      'fecha', coalesce(p_fecha, now())
    ),
    p_ip
  );

  return v_id_pago;
end;
$$;

grant execute on function sp_marcar_liquidacion_pagada(uuid, uuid, numeric, text, text, timestamptz, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 1. sp_crear_revendedora (00097_panel_revendedoras.sql:488)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_revendedora(
--   p_nombre   text,
--   p_apellido text,
--   p_telefono text default null,
--   p_email    text default null,
--   p_notas    text default null,
--   p_ip       inet default null
-- ) returns uuid
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   if p_email is not null and trim(p_email) <> '' then
--     if exists (
--       select 1 from revendedora
--       where id_tenant = v_tenant and email = trim(p_email) and activo = true
--     ) then
--       raise exception 'email-duplicado' using errcode = '23505';
--     end if;
--   end if;
--
--   insert into revendedora (id_tenant, nombre, apellido, telefono, email, notas, activo, fecha_alta)
--   values (v_tenant, trim(p_nombre), trim(p_apellido), nullif(trim(p_telefono), ''), nullif(trim(p_email), ''), p_notas, true, current_date)
--   returning id_revendedora into v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'revendedora', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'apellido', p_apellido, 'email', p_email, 'telefono', p_telefono), p_ip);
--
--   return v_id;
-- end;
-- $$;
--
-- grant execute on function sp_crear_revendedora(text, text, text, text, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 2. sp_crear_consignacion_revendedora_con_items (00085_consignacion_revendedora_functions.sql:103)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_consignacion_revendedora_con_items(
--   p_id_revendedora uuid,
--   p_items          uuid[],
--   p_periodo_desde  date default null,
--   p_periodo_hasta  date default null,
--   p_observaciones  text default null,
--   p_motivo         text default null,
--   p_ip             inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_rev_activa boolean;
--   v_items      uuid[];
--   v_total      integer;
--   v_id         uuid;
--   v_item_id    uuid;
--   v_item       item_producto;
--   v_id_detalle uuid;
--   v_obs        text := nullif(btrim(coalesce(p_observaciones, '')), '');
--   v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   if p_id_revendedora is null then
--     raise exception 'revendedora-requerida' using errcode = '22023';
--   end if;
--
--   if p_periodo_desde is not null and p_periodo_hasta is not null and p_periodo_hasta < p_periodo_desde then
--     raise exception 'periodo-invalido' using errcode = '22023';
--   end if;
--
--   select coalesce(array_agg(distinct x order by x), '{}')
--     into v_items
--     from unnest(coalesce(p_items, '{}')) as x
--    where x is not null;
--
--   v_total := coalesce(array_length(v_items, 1), 0);
--   if v_total = 0 then
--     raise exception 'consignacion-vacia' using errcode = '22023';
--   end if;
--
--   select activo into v_rev_activa
--     from revendedora
--    where id_revendedora = p_id_revendedora and id_tenant = v_tenant
--    for update;
--   if v_rev_activa is null then
--     raise exception 'revendedora-not-found' using errcode = '42704';
--   end if;
--   if not v_rev_activa then
--     raise exception 'revendedora-inactiva' using errcode = '22023';
--   end if;
--
--   insert into consignacion_revendedora(
--     id_tenant, id_revendedora, id_usuario_alta,
--     periodo_desde, periodo_hasta, observaciones
--   ) values (
--     v_tenant, p_id_revendedora, v_actor,
--     p_periodo_desde, p_periodo_hasta, v_obs
--   ) returning id_consignacion_revendedora into v_id;
--
--   foreach v_item_id in array v_items loop
--     select * into v_item
--       from item_producto
--      where id_item = v_item_id and id_tenant = v_tenant
--      for update;
--
--     if v_item.id_item is null then
--       raise exception 'item-not-found: %', v_item_id using errcode = '42704';
--     end if;
--
--     if v_item.estado_item <> 'disponible'
--        or not is_transicion_item_valida(v_item.estado_item, 'en_revendedora') then
--       raise exception 'item-no-entregable: % (estado=%)', v_item_id, v_item.estado_item
--         using errcode = '22023';
--     end if;
--
--     if exists (
--       select 1 from detalle_reserva
--        where id_item = v_item_id and estado = 'activa'
--     ) then
--       raise exception 'item-en-reserva: %', v_item_id using errcode = '22023';
--     end if;
--
--     if exists (
--       select 1 from consignacion_detalle
--        where id_item = v_item_id and estado = 'pendiente'
--     ) then
--       raise exception 'item-ya-en-consignacion-pendiente: %', v_item_id using errcode = '23505';
--     end if;
--
--     if exists (
--       select 1 from consignacion_revendedora_detalle
--        where id_item = v_item_id and estado_detalle in ('pendiente', 'en_poder')
--     ) then
--       raise exception 'item-ya-en-consignacion-revendedora: %', v_item_id using errcode = '23505';
--     end if;
--
--     insert into consignacion_revendedora_detalle(
--       id_tenant, id_consignacion_revendedora, id_item, id_producto,
--       estado_detalle, motivo
--     ) values (
--       v_tenant, v_id, v_item_id, v_item.id_producto,
--       'pendiente', v_motivo
--     ) returning id_consignacion_revendedora_detalle into v_id_detalle;
--
--     insert into movimiento_item(
--       id_tenant, id_item, tipo_movimiento,
--       estado_desde, estado_hasta,
--       referencia_tipo, referencia_id, id_usuario
--     ) values (
--       v_tenant, v_item_id, 'consignacion_revendedora',
--       v_item.estado_item, v_item.estado_item,
--       'consignacion_revendedora_detalle', v_id_detalle, v_actor
--     );
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', v_id::text, 'crear',
--     jsonb_build_object(
--       'id_revendedora', p_id_revendedora,
--       'periodo_desde', p_periodo_desde,
--       'periodo_hasta', p_periodo_hasta,
--       'observaciones', v_obs,
--       'items', v_total
--     ),
--     p_ip
--   );
--
--   return v_id;
-- end $$;
--
-- grant execute on function sp_crear_consignacion_revendedora_con_items(uuid, uuid[], date, date, text, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 3. sp_entregar_consignacion_revendedora (00115_entrega_y_devolucion_revendedora.sql:27)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_entregar_consignacion_revendedora(
--   p_id_revendedora uuid,
--   p_items          uuid[],
--   p_periodo_desde  date default null,
--   p_periodo_hasta  date default null,
--   p_observaciones  text default null,
--   p_motivo         text default null,
--   p_ip             inet default null
-- ) returns uuid language plpgsql security invoker set search_path = public as $$
-- declare
--   v_id uuid;
-- begin
--   v_id := sp_crear_consignacion_revendedora_con_items(
--     p_id_revendedora, p_items, p_periodo_desde, p_periodo_hasta,
--     p_observaciones, p_motivo, p_ip
--   );
--   perform sp_confirmar_consignacion_revendedora(v_id, p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_entregar_consignacion_revendedora(uuid, uuid[], date, date, text, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 4. sp_confirmar_consignacion_revendedora (00085_consignacion_revendedora_functions.sql:322)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_confirmar_consignacion_revendedora(
--   p_id_consignacion_revendedora uuid,
--   p_ip                          inet default null
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_consig consignacion_revendedora;
--   v_det    record;
--   v_item   item_producto;
--   v_count  integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_consig
--     from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--    for update;
--
--   if v_consig.id_consignacion_revendedora is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_consig.estado <> 'abierta' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--   if v_consig.confirmada then
--     raise exception 'consignacion-ya-confirmada' using errcode = '22023';
--   end if;
--
--   for v_det in
--     select id_consignacion_revendedora_detalle, id_item
--       from consignacion_revendedora_detalle
--      where id_consignacion_revendedora = p_id_consignacion_revendedora
--        and id_tenant = v_tenant
--        and estado_detalle = 'pendiente'
--      order by id_item
--      for update
--   loop
--     select * into v_item
--       from item_producto
--      where id_item = v_det.id_item and id_tenant = v_tenant
--      for update;
--
--     if v_item.estado_item <> 'disponible'
--        or not is_transicion_item_valida(v_item.estado_item, 'en_revendedora') then
--       raise exception 'item-no-entregable: % (estado=%)', v_det.id_item, v_item.estado_item
--         using errcode = '22023';
--     end if;
--
--     perform sp_transicion_item_producto(
--       v_det.id_item,
--       'en_revendedora',
--       'entrega_revendedora',
--       v_det.id_consignacion_revendedora_detalle,
--       'consignacion_revendedora_detalle',
--       p_ip
--     );
--
--     update consignacion_revendedora_detalle
--        set estado_detalle = 'en_poder',
--            fecha_entrega = now()
--      where id_consignacion_revendedora_detalle = v_det.id_consignacion_revendedora_detalle;
--
--     v_count := v_count + 1;
--   end loop;
--
--   update consignacion_revendedora
--      set confirmada = true,
--          fecha_confirmacion = now()
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'confirmar',
--     jsonb_build_object('items_confirmados', v_count),
--     p_ip
--   );
--
--   return v_count;
-- end $$;
--
-- grant execute on function sp_confirmar_consignacion_revendedora(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 5. sp_confirmar_declaracion_venta (00104_declaracion_venta_functions.sql:170)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_confirmar_declaracion_venta(
--   p_id_declaracion uuid
-- ) returns uuid language plpgsql security invoker as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_dec      declaracion_venta_revendedora;
--   v_id_venta uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Solo operador del local (sin claim de revendedora)
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_dec
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_declaracion = p_id_declaracion
--   for update;
--
--   if v_dec.id_declaracion is null then
--     raise exception 'declaracion-no-encontrada' using errcode = '42704';
--   end if;
--
--   if v_dec.estado <> 'pendiente' then
--     raise exception 'declaracion-no-pendiente' using errcode = '22023';
--   end if;
--
--   -- Registrar la venta a través de sp_registrar_venta (canal revendedora, pago cuenta_revendedora automático)
--   v_id_venta := sp_registrar_venta(
--     p_lineas := jsonb_build_array(jsonb_build_object('id_item', v_dec.id_item)),
--     p_canal := 'revendedora',
--     p_id_revendedora := v_dec.id_revendedora
--   );
--
--   update declaracion_venta_revendedora
--   set estado = 'confirmada',
--       id_venta = v_id_venta,
--       confirmada_por = v_actor,
--       updated_at = now()
--   where id_declaracion = p_id_declaracion and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
--   values (
--     v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
--     'confirmar_declaracion_venta',
--     jsonb_build_object('id_venta', v_id_venta, 'id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora)
--   );
--
--   return v_id_venta;
-- end;
-- $$;
--
-- grant execute on function sp_confirmar_declaracion_venta(uuid) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 6. sp_rechazar_declaracion_venta (00104_declaracion_venta_functions.sql:238)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_rechazar_declaracion_venta(
--   p_id_declaracion uuid,
--   p_motivo         text
-- ) returns void language plpgsql security invoker as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_dec    declaracion_venta_revendedora;
--   v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Solo operador del local
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   -- Motivo obligatorio
--   if v_motivo is null then
--     raise exception 'motivo-requerido' using errcode = '22023';
--   end if;
--
--   select * into v_dec
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_declaracion = p_id_declaracion
--   for update;
--
--   if v_dec.id_declaracion is null then
--     raise exception 'declaracion-no-encontrada' using errcode = '42704';
--   end if;
--
--   if v_dec.estado <> 'pendiente' then
--     raise exception 'declaracion-no-pendiente' using errcode = '22023';
--   end if;
--
--   update declaracion_venta_revendedora
--   set estado = 'rechazada',
--       motivo_rechazo = v_motivo,
--       confirmada_por = v_actor,
--       updated_at = now()
--   where id_declaracion = p_id_declaracion and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
--   values (
--     v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
--     'rechazar_declaracion_venta',
--     jsonb_build_object('id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora, 'motivo', v_motivo)
--   );
-- end;
-- $$;
--
-- grant execute on function sp_rechazar_declaracion_venta(uuid, text) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 7. sp_editar_revendedora (00076_revendedora.sql:75)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_editar_revendedora(
--   p_id uuid,
--   p_nombre text,
--   p_apellido text,
--   p_telefono text default null,
--   p_email text default null,
--   p_notas text default null,
--   p_ip inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_old    record;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_old from revendedora where id_revendedora = p_id and id_tenant = v_tenant for update;
--   if not found then
--     raise exception 'revendedora-not-found' using errcode = 'P0002';
--   end if;
--
--   update revendedora
--   set nombre = p_nombre,
--       apellido = p_apellido,
--       telefono = p_telefono,
--       email = p_email,
--       notas = p_notas
--   where id_revendedora = p_id and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'revendedora', p_id::text, 'editar',
--           jsonb_build_object('nombre', p_nombre, 'apellido', p_apellido, 'email', p_email, 'telefono', p_telefono), p_ip);
-- end $$;
--
-- grant execute on function sp_editar_revendedora(uuid, text, text, text, text, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 8. sp_crear_regla_comision (00087_comisiones_functions.sql:8)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_regla_comision(
--   p_ambito         ambito_comision,
--   p_nombre         text,
--   p_id_revendedora uuid default null,
--   p_vigente_desde  date default current_date,
--   p_vigente_hasta  date default null,
--   p_escalas        jsonb default '[]'::jsonb,
--   p_ip             inet default null
-- ) returns uuid language plpgsql set search_path = public as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id_regla uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- 1. Validar módulo revendedoras habilitado para el tenant
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   -- 2. Validar escalas no vacías
--   if p_escalas is null or jsonb_typeof(p_escalas) <> 'array' or jsonb_array_length(p_escalas) = 0 then
--     raise exception 'escala-comision-invalida' using errcode = '22023';
--   end if;
--
--   -- 3. Si es regla propia de revendedora, validar que pertenezca al tenant
--   if p_id_revendedora is not null then
--     if not exists (
--       select 1 from revendedora
--       where id_tenant = v_tenant and id_revendedora = p_id_revendedora
--     ) then
--       raise exception 'revendedora-not-found' using errcode = '42704';
--     end if;
--   end if;
--
--   -- 4. Insertar regla y tramos de escala en una sola transacción protegiendo exclusión
--   begin
--     insert into regla_comision(
--       id_tenant,
--       ambito,
--       nombre,
--       id_revendedora,
--       vigente_desde,
--       vigente_hasta,
--       activo
--     ) values (
--       v_tenant,
--       p_ambito,
--       p_nombre,
--       p_id_revendedora,
--       p_vigente_desde,
--       p_vigente_hasta,
--       true
--     ) returning id_regla into v_id_regla;
--
--     insert into escala_comision(
--       id_tenant,
--       id_regla,
--       objetivo_desde,
--       porcentaje
--     )
--     select
--       v_tenant,
--       v_id_regla,
--       (elem->>'objetivo_desde')::numeric,
--       (elem->>'porcentaje')::numeric
--     from jsonb_array_elements(p_escalas) as elem;
--
--   exception
--     when exclusion_violation then
--       raise exception 'regla-solapada' using errcode = '23P01';
--   end;
--
--   -- 5. Auditar creación
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant,
--     v_actor,
--     'regla_comision',
--     v_id_regla::text,
--     'crear',
--     jsonb_build_object(
--       'ambito', p_ambito,
--       'nombre', p_nombre,
--       'id_revendedora', p_id_revendedora,
--       'vigente_desde', p_vigente_desde,
--       'vigente_hasta', p_vigente_hasta,
--       'escalas', p_escalas
--     ),
--     p_ip
--   );
--
--   return v_id_regla;
-- end;
-- $$;
--
-- grant execute on function sp_crear_regla_comision(ambito_comision, text, uuid, date, date, jsonb, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 9. sp_terminar_regla_comision (00087_comisiones_functions.sql:111)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_terminar_regla_comision(
--   p_id_regla      uuid,
--   p_vigente_hasta date default current_date,
--   p_ip            inet default null
-- ) returns void language plpgsql set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_regla  regla_comision%rowtype;
--   v_fecha  date := coalesce(p_vigente_hasta, current_date);
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- 1. Validar módulo revendedoras habilitado
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   -- 2. Validar que la regla exista en el tenant
--   select * into v_regla from regla_comision
--   where id_tenant = v_tenant and id_regla = p_id_regla
--   for update;
--
--   if not found then
--     raise exception 'regla-comision-not-found' using errcode = '42704';
--   end if;
--
--   -- 3. Actualizar fecha de fin de vigencia
--   begin
--     update regla_comision
--     set vigente_hasta = v_fecha
--     where id_tenant = v_tenant and id_regla = p_id_regla;
--   exception
--     when exclusion_violation then
--       raise exception 'regla-solapada' using errcode = '23P01';
--   end;
--
--   -- 4. Auditar término de vigencia
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant,
--     v_actor,
--     'regla_comision',
--     p_id_regla::text,
--     'terminar',
--     jsonb_build_object(
--       'vigente_hasta_anterior', v_regla.vigente_hasta,
--       'vigente_hasta_nuevo', v_fecha
--     ),
--     p_ip
--   );
-- end;
-- $$;
--
-- grant execute on function sp_terminar_regla_comision(uuid, date, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 10. sp_editar_consignacion_revendedora (00085_consignacion_revendedora_functions.sql:250)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_editar_consignacion_revendedora(
--   p_id_consignacion_revendedora uuid,
--   p_observaciones               text default null,
--   p_periodo_desde               date default null,
--   p_periodo_hasta               date default null,
--   p_ip                          inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant      uuid := auth_tenant_id();
--   v_actor       uuid := auth.uid();
--   v_consig      consignacion_revendedora;
--   v_obs         text := nullif(btrim(coalesce(p_observaciones, '')), '');
--   v_desde_final date;
--   v_hasta_final date;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_consig
--     from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--    for update;
--
--   if v_consig.id_consignacion_revendedora is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_consig.estado <> 'abierta' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--
--   v_desde_final := coalesce(p_periodo_desde, v_consig.periodo_desde);
--   v_hasta_final := coalesce(p_periodo_hasta, v_consig.periodo_hasta);
--   if v_desde_final is not null and v_hasta_final is not null and v_hasta_final < v_desde_final then
--     raise exception 'periodo-invalido' using errcode = '22023';
--   end if;
--
--   update consignacion_revendedora
--      set observaciones = v_obs,
--          periodo_desde = v_desde_final,
--          periodo_hasta = v_hasta_final
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'editar',
--     jsonb_build_object(
--       'observaciones_antes', v_consig.observaciones,
--       'observaciones_despues', v_obs,
--       'periodo_desde_antes', v_consig.periodo_desde,
--       'periodo_desde_despues', v_desde_final,
--       'periodo_hasta_antes', v_consig.periodo_hasta,
--       'periodo_hasta_despues', v_hasta_final
--     ),
--     p_ip
--   );
-- end $$;
--
-- grant execute on function sp_editar_consignacion_revendedora(uuid, text, date, date, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 11. sp_registrar_devolucion_revendedora (00085_consignacion_revendedora_functions.sql:419)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_registrar_devolucion_revendedora(
--   p_id_consignacion_revendedora uuid,
--   p_items                       uuid[],
--   p_estado_destino              estado_item default 'disponible',
--   p_motivo                      text default null,
--   p_ip                          inet default null
-- ) returns integer language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_consig   consignacion_revendedora;
--   v_items    uuid[];
--   v_total    integer;
--   v_item_id  uuid;
--   v_det      consignacion_revendedora_detalle;
--   v_item     item_producto;
--   v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
--   v_est_det  estado_consignacion_revendedora_detalle;
--   v_count    integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   if p_estado_destino not in ('disponible', 'devuelto', 'baja') then
--     raise exception 'invalid-transition' using errcode = '22023';
--   end if;
--
--   select coalesce(array_agg(distinct x order by x), '{}')
--     into v_items
--     from unnest(coalesce(p_items, '{}')) as x
--    where x is not null;
--
--   v_total := coalesce(array_length(v_items, 1), 0);
--   if v_total = 0 then
--     raise exception 'items-vacios' using errcode = '22023';
--   end if;
--
--   select * into v_consig
--     from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--    for update;
--
--   if v_consig.id_consignacion_revendedora is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_consig.estado <> 'abierta' then
--     raise exception 'consignacion-no-activa' using errcode = '22023';
--   end if;
--   if not v_consig.confirmada then
--     raise exception 'consignacion-no-confirmada' using errcode = '22023';
--   end if;
--
--   v_est_det := case
--     when p_estado_destino = 'baja' then 'baja'::estado_consignacion_revendedora_detalle
--     else 'devuelto'::estado_consignacion_revendedora_detalle
--   end;
--
--   foreach v_item_id in array v_items loop
--     select * into v_det
--       from consignacion_revendedora_detalle
--      where id_consignacion_revendedora = p_id_consignacion_revendedora
--        and id_item = v_item_id
--        and id_tenant = v_tenant
--      for update;
--
--     if v_det.id_consignacion_revendedora_detalle is null then
--       raise exception 'detalle-not-found' using errcode = '42704';
--     end if;
--     if v_det.estado_detalle <> 'en_poder' then
--       raise exception 'detalle-no-pendiente' using errcode = '22023';
--     end if;
--
--     select * into v_item
--       from item_producto
--      where id_item = v_item_id and id_tenant = v_tenant
--      for update;
--
--     if not is_transicion_item_valida(v_item.estado_item, p_estado_destino) then
--       raise exception 'invalid-transition' using errcode = '22023';
--     end if;
--
--     perform sp_transicion_item_producto(
--       v_item_id,
--       p_estado_destino,
--       'devolucion_revendedora',
--       v_det.id_consignacion_revendedora_detalle,
--       'consignacion_revendedora_detalle',
--       p_ip
--     );
--
--     update consignacion_revendedora_detalle
--        set estado_detalle = v_est_det,
--            fecha_devolucion = now(),
--            motivo = coalesce(v_motivo, motivo)
--      where id_consignacion_revendedora_detalle = v_det.id_consignacion_revendedora_detalle;
--
--     v_count := v_count + 1;
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'devolucion',
--     jsonb_build_object(
--       'items_devueltos', v_count,
--       'estado_destino', p_estado_destino,
--       'motivo', v_motivo
--     ),
--     p_ip
--   );
--
--   return v_count;
-- end $$;
--
-- grant execute on function sp_registrar_devolucion_revendedora(uuid, uuid[], estado_item, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 12. sp_devolver_items_revendedora (00115_entrega_y_devolucion_revendedora.sql:47)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_devolver_items_revendedora(
--   p_id_revendedora uuid,
--   p_items          uuid[],
--   p_estado_destino estado_item default 'disponible',
--   p_motivo         text default null,
--   p_ip             inet default null
-- ) returns integer language plpgsql security invoker set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_items  uuid[];
--   v_grupo  record;
--   v_count  integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_id_revendedora is null then
--     raise exception 'revendedora-requerida' using errcode = '22023';
--   end if;
--
--   select coalesce(array_agg(distinct x order by x), '{}')
--     into v_items
--     from unnest(coalesce(p_items, '{}')) as x
--    where x is not null;
--
--   if coalesce(array_length(v_items, 1), 0) = 0 then
--     raise exception 'items-vacios' using errcode = '22023';
--   end if;
--
--   if not exists (
--     select 1 from revendedora
--      where id_revendedora = p_id_revendedora and id_tenant = v_tenant
--   ) then
--     raise exception 'revendedora-not-found' using errcode = '42704';
--   end if;
--
--   -- Todo o nada: un ítem ajeno no puede colarse en la devolución de otra.
--   if exists (
--     select 1
--       from unnest(v_items) as x
--      where not exists (
--        select 1
--          from consignacion_revendedora_detalle d
--          join consignacion_revendedora c
--            on c.id_consignacion_revendedora = d.id_consignacion_revendedora
--         where d.id_item = x
--           and d.id_tenant = v_tenant
--           and d.estado_detalle = 'en_poder'
--           and c.id_revendedora = p_id_revendedora
--      )
--   ) then
--     raise exception 'item-no-en-poder-revendedora' using errcode = '22023';
--   end if;
--
--   for v_grupo in
--     select d.id_consignacion_revendedora as id_consig,
--            array_agg(d.id_item order by d.id_item) as items
--      from consignacion_revendedora_detalle d
--      join consignacion_revendedora c
--        on c.id_consignacion_revendedora = d.id_consignacion_revendedora
--      where d.id_item = any(v_items)
--        and d.id_tenant = v_tenant
--        and d.estado_detalle = 'en_poder'
--        and c.id_revendedora = p_id_revendedora
--      group by d.id_consignacion_revendedora
--      order by d.id_consignacion_revendedora
--   loop
--     v_count := v_count + sp_registrar_devolucion_revendedora(
--       v_grupo.id_consig, v_grupo.items, p_estado_destino, p_motivo, p_ip
--     );
--   end loop;
--
--   return v_count;
-- end $$;
--
-- grant execute on function sp_devolver_items_revendedora(uuid, uuid[], estado_item, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 13. sp_cerrar_consignacion_revendedora (00085_consignacion_revendedora_functions.sql:546)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_cerrar_consignacion_revendedora(
--   p_id_consignacion_revendedora uuid,
--   p_ip                          inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_consig   consignacion_revendedora;
--   v_en_poder integer;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_consig
--     from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--    for update;
--
--   if v_consig.id_consignacion_revendedora is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--   if v_consig.estado = 'cerrada' then
--     return;
--   end if;
--
--   select count(*) into v_en_poder
--     from consignacion_revendedora_detalle
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--      and estado_detalle in ('pendiente', 'en_poder');
--
--   if v_en_poder > 0 then
--     raise exception 'consignacion-con-items-en-poder: %', v_en_poder using errcode = '22023';
--   end if;
--
--   update consignacion_revendedora
--      set estado = 'cerrada',
--          fecha_cierre = now()
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'cerrar',
--     '{}'::jsonb,
--     p_ip
--   );
-- end $$;
--
-- grant execute on function sp_cerrar_consignacion_revendedora(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 14. sp_eliminar_consignacion_revendedora (00085_consignacion_revendedora_functions.sql:609)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_eliminar_consignacion_revendedora(
--   p_id_consignacion_revendedora uuid,
--   p_ip                          inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_consig   consignacion_revendedora;
--   v_snapshot jsonb;
--   v_borrados integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_consig
--     from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant
--    for update;
--
--   if v_consig.id_consignacion_revendedora is null then
--     raise exception 'consignacion-not-found' using errcode = '42704';
--   end if;
--
--   if v_consig.confirmada or v_consig.estado <> 'abierta' then
--     raise exception 'consignacion-confirmada' using errcode = '22023';
--   end if;
--
--   select jsonb_build_object(
--            'id_revendedora', c.id_revendedora,
--            'periodo_desde', c.periodo_desde,
--            'periodo_hasta', c.periodo_hasta,
--            'observaciones', c.observaciones,
--            'detalles', coalesce(jsonb_agg(
--              jsonb_build_object(
--                'id_item', d.id_item,
--                'id_producto', d.id_producto,
--                'estado_detalle', d.estado_detalle,
--                'motivo', d.motivo
--              )
--            ) filter (where d.id_consignacion_revendedora_detalle is not null), '[]'::jsonb)
--          )
--     into v_snapshot
--     from consignacion_revendedora c
--     left join consignacion_revendedora_detalle d
--            on d.id_consignacion_revendedora = c.id_consignacion_revendedora
--           and d.id_tenant = c.id_tenant
--    where c.id_consignacion_revendedora = p_id_consignacion_revendedora
--      and c.id_tenant = v_tenant
--    group by c.id_consignacion_revendedora;
--
--   delete from consignacion_revendedora_detalle
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant;
--   get diagnostics v_borrados = row_count;
--
--   delete from consignacion_revendedora
--    where id_consignacion_revendedora = p_id_consignacion_revendedora
--      and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'consignacion_revendedora', p_id_consignacion_revendedora::text, 'eliminar',
--     coalesce(v_snapshot, '{}'::jsonb) || jsonb_build_object('detalles_borrados', v_borrados),
--     p_ip
--   );
-- end $$;
--
-- grant execute on function sp_eliminar_consignacion_revendedora(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 15. sp_baja_revendedora (00085_consignacion_revendedora_functions.sql:47)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_baja_revendedora(
--   p_id uuid,
--   p_ip inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_old    record;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_old from revendedora where id_revendedora = p_id and id_tenant = v_tenant for update;
--   if not found then
--     raise exception 'revendedora-not-found' using errcode = 'P0002';
--   end if;
--
--   if not v_old.activo then
--     return;
--   end if;
--
--   if exists (
--     select 1
--       from consignacion_revendedora_detalle d
--       join consignacion_revendedora c
--         on c.id_consignacion_revendedora = d.id_consignacion_revendedora
--        and c.id_tenant = d.id_tenant
--      where c.id_tenant = v_tenant
--        and c.id_revendedora = p_id
--        and d.estado_detalle = 'en_poder'
--   ) then
--     raise exception 'revendedora-con-stock' using errcode = '22023';
--   end if;
--
--   update revendedora
--   set activo = false
--   where id_revendedora = p_id and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'revendedora', p_id::text, 'baja',
--           jsonb_build_object('activo', false), p_ip);
-- end $$;
--
-- grant execute on function sp_baja_revendedora(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 16. sp_generar_liquidacion (00095_liquidacion_functions.sql:266)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_generar_liquidacion(
--   p_id_revendedora uuid,
--   p_desde          date,
--   p_hasta          date,
--   p_observaciones  text default null,
--   p_ip             inet default null
-- ) returns uuid
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant            uuid := auth_tenant_id();
--   v_actor             uuid := auth.uid();
--   v_id_liq            uuid;
--   v_rango             tstzrange;
--   v_total_candidato   numeric := 0;
--   v_count_candidato   integer := 0;
--   v_porcentaje        numeric := 0;
--   v_vendido_real      numeric := 0;
--   v_comision_real     numeric := 0;
--   v_cobrar_real       numeric := 0;
--   v_count_real        integer := 0;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from revendedora
--     where id_tenant = v_tenant and id_revendedora = p_id_revendedora and activo = true
--     for update
--   ) then
--     raise exception 'revendedora-not-found' using errcode = '42704';
--   end if;
--
--   v_rango := fn_rango_tenant(p_desde, p_hasta);
--
--   -- Sumar total del período sobre líneas candidatas bloqueándolas con FOR UPDATE
--   with lineas_candidatas as (
--     select dv.id_detalle_venta, dv.precio_venta
--     from detalle_venta dv
--     join venta v on v.id_venta = dv.id_venta
--     left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--     where dv.id_tenant = v_tenant
--       and v.id_tenant = v_tenant
--       and v.canal = 'revendedora'
--       and v.id_revendedora = p_id_revendedora
--       and v.estado_venta = 'registrada'
--       and dev.id_devolucion is null
--       and dv.id_liquidacion is null
--       and dv.excluida_liquidacion = false
--       and v.fecha <@ v_rango
--     for update of dv
--   )
--   select
--     coalesce(sum(precio_venta), 0),
--     count(*)
--   into v_total_candidato, v_count_candidato
--   from lineas_candidatas;
--
--   if v_count_candidato = 0 then
--     raise exception 'liquidacion-vacia' using errcode = '22023';
--   end if;
--
--   -- Resolver comisión UNA SOLA VEZ con el total acumulado del período
--   select coalesce(porcentaje, 0) into v_porcentaje
--     from fn_resolver_comision(p_id_revendedora, p_hasta, v_total_candidato, 'revendedora')
--    limit 1;
--   v_porcentaje := coalesce(v_porcentaje, 0);
--
--   -- Insertar cabecera inicial
--   insert into liquidacion_revendedora (
--     id_tenant, id_revendedora, periodo_desde, periodo_hasta,
--     monto_vendido, monto_comision, monto_a_cobrar,
--     cantidad_lineas, porcentaje_aplicado, estado,
--     fecha_liquidacion, observaciones, id_usuario_alta
--   ) values (
--     v_tenant, p_id_revendedora, p_desde, p_hasta,
--     v_total_candidato, round(v_total_candidato * (v_porcentaje / 100.0), 2),
--     v_total_candidato - round(v_total_candidato * (v_porcentaje / 100.0), 2),
--     v_count_candidato, v_porcentaje, 'pendiente',
--     (now() at time zone 'UTC')::date, p_observaciones, v_actor
--   ) returning id_liquidacion into v_id_liq;
--
--   -- Sellar id_liquidacion y escribir monto_comision por línea
--   update detalle_venta dv
--      set id_liquidacion = v_id_liq,
--          monto_comision = round(dv.precio_venta * (v_porcentaje / 100.0), 2)
--     from venta v
--    where v.id_venta = dv.id_venta
--      and dv.id_tenant = v_tenant
--      and v.id_tenant = v_tenant
--      and v.canal = 'revendedora'
--      and v.id_revendedora = p_id_revendedora
--      and v.estado_venta = 'registrada'
--      and dv.id_liquidacion is null
--      and dv.excluida_liquidacion = false
--      and v.fecha <@ v_rango
--      and not exists (
--        select 1 from devolucion_venta dev
--         where dev.id_detalle_venta = dv.id_detalle_venta
--      );
--
--   -- Recalcular cabecera desde las filas realmente selladas (guarda de concurrencia)
--   select
--     coalesce(sum(precio_venta), 0),
--     coalesce(sum(monto_comision), 0),
--     count(*)
--   into v_vendido_real, v_comision_real, v_count_real
--   from detalle_venta
--   where id_liquidacion = v_id_liq
--     and id_tenant = v_tenant;
--
--   v_cobrar_real := v_vendido_real - v_comision_real;
--
--   update liquidacion_revendedora
--      set monto_vendido = v_vendido_real,
--          monto_comision = v_comision_real,
--          monto_a_cobrar = v_cobrar_real,
--          cantidad_lineas = v_count_real
--    where id_liquidacion = v_id_liq;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'liquidacion_revendedora', v_id_liq::text, 'generar_liquidacion',
--     jsonb_build_object(
--       'id_revendedora', p_id_revendedora,
--       'periodo_desde', p_desde,
--       'periodo_hasta', p_hasta,
--       'monto_vendido', v_vendido_real,
--       'monto_comision', v_comision_real,
--       'monto_a_cobrar', v_cobrar_real,
--       'porcentaje_aplicado', v_porcentaje,
--       'cantidad_lineas', v_count_real
--     ),
--     p_ip
--   );
--
--   return v_id_liq;
-- end;
-- $$;
--
-- grant execute on function sp_generar_liquidacion(uuid, date, date, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 17. sp_excluir_detalle_liquidacion (00095_liquidacion_functions.sql:424)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_excluir_detalle_liquidacion(
--   p_id_detalle uuid,
--   p_motivo     text default null,
--   p_ip         inet default null
-- ) returns void
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_liquidada  boolean;
--   v_excluida   boolean;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select id_liquidacion is not null, excluida_liquidacion
--     into v_liquidada, v_excluida
--     from detalle_venta
--    where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
--    for update;
--
--   if not found then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--
--   if v_liquidada then
--     raise exception 'detalle-ya-liquidado' using errcode = '22023';
--   end if;
--
--   if v_excluida then
--     return; -- idempotente
--   end if;
--
--   update detalle_venta
--      set excluida_liquidacion = true
--    where id_detalle_venta = p_id_detalle;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'excluir_liquidacion',
--     jsonb_build_object('motivo', p_motivo), p_ip
--   );
-- end;
-- $$;
--
-- grant execute on function sp_excluir_detalle_liquidacion(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 18. sp_reincluir_detalle_liquidacion (00095_liquidacion_functions.sql:488)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_reincluir_detalle_liquidacion(
--   p_id_detalle uuid,
--   p_ip         inet default null
-- ) returns void
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_liquidada  boolean;
--   v_excluida   boolean;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select id_liquidacion is not null, excluida_liquidacion
--     into v_liquidada, v_excluida
--     from detalle_venta
--    where id_detalle_venta = p_id_detalle and id_tenant = v_tenant
--    for update;
--
--   if not found then
--     raise exception 'detalle-not-found' using errcode = '42704';
--   end if;
--
--   if v_liquidada then
--     raise exception 'detalle-ya-liquidado' using errcode = '22023';
--   end if;
--
--   if not v_excluida then
--     return; -- idempotente
--   end if;
--
--   update detalle_venta
--      set excluida_liquidacion = false
--    where id_detalle_venta = p_id_detalle;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'detalle_venta', p_id_detalle::text, 'reincluir_liquidacion',
--     '{}'::jsonb, p_ip
--   );
-- end;
-- $$;
--
-- grant execute on function sp_reincluir_detalle_liquidacion(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 19. sp_marcar_liquidacion_pagada (00095_liquidacion_functions.sql:551)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_marcar_liquidacion_pagada(
--   p_id_liquidacion uuid,
--   p_id_cuenta      uuid,
--   p_monto          numeric,
--   p_metodo         text default 'transferencia',
--   p_referencia     text default null,
--   p_fecha          timestamptz default null,
--   p_ip             inet default null
-- ) returns uuid
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_liq          liquidacion_revendedora%rowtype;
--   v_id_pago      uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--
--   select * into v_liq
--     from liquidacion_revendedora
--    where id_liquidacion = p_id_liquidacion
--      and id_tenant = v_tenant
--    for update;
--
--   if not found then
--     raise exception 'liquidacion-no-encontrada' using errcode = '42704';
--   end if;
--
--   if v_liq.estado = 'pagada' then
--     raise exception 'liquidacion-ya-pagada' using errcode = '22023';
--   end if;
--
--   if not exists (
--     select 1 from cuenta_destino
--      where id_cuenta_destino = p_id_cuenta
--        and id_tenant = v_tenant
--        and activo = true
--   ) then
--     raise exception 'cuenta-invalida-liquidacion' using errcode = '22023';
--   end if;
--
--   if p_monto is null or p_monto <> v_liq.monto_a_cobrar then
--     raise exception 'monto-pago-invalido' using errcode = '22023';
--   end if;
--
--   insert into pago_revendedora (
--     id_tenant, id_liquidacion, monto, metodo, referencia, id_cuenta, fecha, id_usuario_alta
--   ) values (
--     v_tenant, p_id_liquidacion, p_monto, coalesce(p_metodo, 'transferencia'),
--     p_referencia, p_id_cuenta, coalesce(p_fecha, now()), v_actor
--   ) returning id_pago_revendedora into v_id_pago;
--
--   update liquidacion_revendedora
--      set estado = 'pagada',
--          fecha_pago = coalesce(p_fecha, now())
--    where id_liquidacion = p_id_liquidacion;
--
--   insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (
--     v_tenant, v_actor, 'liquidacion_revendedora', p_id_liquidacion::text, 'pagar_liquidacion',
--     jsonb_build_object(
--       'id_pago_revendedora', v_id_pago,
--       'monto', p_monto,
--       'id_cuenta', p_id_cuenta,
--       'metodo', p_metodo,
--       'referencia', p_referencia,
--       'fecha', coalesce(p_fecha, now())
--     ),
--     p_ip
--   );
--
--   return v_id_pago;
-- end;
-- $$;
--
-- grant execute on function sp_marcar_liquidacion_pagada(uuid, uuid, numeric, text, text, timestamptz, inet) to authenticated;
