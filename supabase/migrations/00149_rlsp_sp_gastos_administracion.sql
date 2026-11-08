-- 00149_rlsp_sp_gastos_administracion.sql
-- Fase 5b-M6 de rls-por-permiso: chequeo de permiso en los 12 sp_* de Gastos y Administración.
--
-- UP:
--   1. sp_registrar_gasto: gastos.crear
--   2. sp_eliminar_gasto: gastos.editar
--   3. sp_set_presupuesto_categoria_gasto: gastos.editar
--   4. sp_create_rol: administracion.crear
--   5. sp_toggle_usuario_activo: administracion.editar
--   6. sp_update_usuario: administracion.editar
--   7. sp_update_rol_permisos: administracion.editar
--   8. sp_set_configuracion_qr_lado_mm: administracion.editar
--   9. sp_set_configuracion_impresora: administracion.editar
--   10. sp_set_tenant_logo: administracion.editar
--   11. sp_delete_rol: administracion.eliminar
--   12. sp_change_password_user: p_id_usuario is distinct from auth.uid()
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_registrar_gasto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_registrar_gasto(
  p_id_categoria_gasto uuid,
  p_monto              numeric,
  p_descripcion        text,
  p_fecha              timestamptz default null,
  p_comprobante_ref    text default null,
  p_ip                 inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_desc   text := nullif(btrim(coalesce(p_descripcion, '')), '');
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('gastos', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto-invalido' using errcode = '22023';
  end if;

  insert into gasto_negocio(id_tenant, id_categoria_gasto, id_usuario_alta,
                             fecha, monto, descripcion, comprobante_ref)
  values (v_tenant, p_id_categoria_gasto, v_actor,
          coalesce(p_fecha, now()), p_monto, v_desc, p_comprobante_ref)
  returning id_gasto into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'gasto_negocio', v_id::text, 'crear',
          jsonb_build_object('id_categoria_gasto', p_id_categoria_gasto,
                             'monto', p_monto,
                             'descripcion', v_desc),
          p_ip);
  return v_id;
end $$;

grant execute on function sp_registrar_gasto(uuid, numeric, text, timestamptz, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_eliminar_gasto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_eliminar_gasto(
  p_id_gasto uuid,
  p_ip       inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_row    gasto_negocio%rowtype;
begin
  if not (select auth_tiene_permiso('gastos', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- El select ya pasa por RLS: un gasto de otro tenant no se ve y cae acá.
  select * into v_row
    from gasto_negocio
   where id_gasto = p_id_gasto;
  if not found then
    raise exception 'gasto-inexistente' using errcode = '22023';
  end if;

  delete from gasto_negocio where id_gasto = p_id_gasto;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'gasto_negocio', p_id_gasto::text, 'eliminar',
          jsonb_build_object('id_categoria_gasto', v_row.id_categoria_gasto,
                             'fecha', v_row.fecha,
                             'monto', v_row.monto,
                             'descripcion', v_row.descripcion,
                             'comprobante_ref', v_row.comprobante_ref),
          p_ip);
end $$;

grant execute on function sp_eliminar_gasto(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. sp_set_presupuesto_categoria_gasto
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_presupuesto_categoria_gasto(
  p_id_categoria uuid,
  p_presupuesto  numeric,  -- null = quita presupuesto
  p_ip           inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_prev   numeric;
begin
  if not (select auth_tiene_permiso('gastos', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select presupuesto_mensual into v_prev
    from categoria_gasto
   where id_categoria_gasto = p_id_categoria and id_tenant = v_tenant
   for update;
  if not found then
    raise exception 'categoria-not-found' using errcode = '42704';
  end if;

  update categoria_gasto
     set presupuesto_mensual = p_presupuesto
   where id_categoria_gasto = p_id_categoria;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'categoria_gasto', p_id_categoria::text, 'set_presupuesto',
          jsonb_build_object('presupuesto_anterior', v_prev,
                             'presupuesto_nuevo', p_presupuesto),
          p_ip);
end $$;

grant execute on function sp_set_presupuesto_categoria_gasto(uuid, numeric, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. sp_create_rol
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_create_rol(
  p_nombre    text,
  p_permisos  jsonb default '{}'::jsonb,
  p_ip        inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('administracion', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'nombre-requerido' using errcode = '22023';
  end if;

  insert into rol(id_tenant, nombre, permisos)
  values (v_tenant, trim(p_nombre), coalesce(p_permisos, '{}'::jsonb))
  returning id_rol into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rol', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'permisos', p_permisos), p_ip);
  return v_id;
end $$;

grant execute on function sp_create_rol(text, jsonb, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. sp_toggle_usuario_activo
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_toggle_usuario_activo(
  p_id_usuario uuid,
  p_estado     usuario_estado,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_prev   usuario_estado;
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select estado_usuario into v_prev from usuario
    where id_usuario = p_id_usuario and id_tenant = v_tenant for update;
  if not found then
    raise exception 'usuario-not-found' using errcode = '42704';
  end if;

  update usuario set estado_usuario = p_estado
   where id_usuario = p_id_usuario;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'cambiar_estado',
          jsonb_build_object('estado_anterior', v_prev, 'estado_nuevo', p_estado), p_ip);
end $$;

grant execute on function sp_toggle_usuario_activo(uuid, usuario_estado, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. sp_update_usuario
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_update_usuario(
  p_id_usuario uuid, p_nombre_completo text, p_id_rol uuid, p_ip inet default null
) returns void language plpgsql as $$
declare
  v_before jsonb;
  v_tenant uuid;
  v_actor  uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select to_jsonb(u.*), u.id_tenant into v_before, v_tenant
    from usuario u where u.id_usuario = p_id_usuario;

  update usuario set nombre_completo = p_nombre_completo, id_rol = p_id_rol
   where id_usuario = p_id_usuario;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'editar',
          jsonb_build_object('before', v_before,
            'after', jsonb_build_object('nombre_completo', p_nombre_completo, 'id_rol', p_id_rol)),
          p_ip);
end $$;

grant execute on function sp_update_usuario(uuid, text, uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. sp_update_rol_permisos
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_update_rol_permisos(
  p_id_rol   uuid,
  p_nombre   text,
  p_permisos jsonb,
  p_ip       inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_prev   jsonb;
  v_prev_nombre text;
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select to_jsonb(permisos), nombre into v_prev, v_prev_nombre
    from rol where id_rol = p_id_rol and id_tenant = v_tenant
    for update;
  if not found then
    raise exception 'rol-not-found' using errcode = '42704';
  end if;

  update rol
     set nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
         permisos = coalesce(p_permisos, permisos)
   where id_rol = p_id_rol;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rol', p_id_rol::text, 'editar',
          jsonb_build_object('nombre_anterior', v_prev_nombre,
                             'nombre_nuevo', p_nombre,
                             'permisos_anteriores', v_prev,
                             'permisos_nuevos', p_permisos),
          p_ip);
end $$;

grant execute on function sp_update_rol_permisos(uuid, text, jsonb, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. sp_set_configuracion_qr_lado_mm
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_configuracion_qr_lado_mm(
  p_lado_mm integer,
  p_ip      inet default null
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_lado_mm is null or p_lado_mm < 15 or p_lado_mm > 100 then
    raise exception 'qr-lado-mm-invalido' using errcode = '22023';
  end if;

  insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
  values (v_tenant, 'etiquetas', 'qr_lado_mm', to_jsonb(p_lado_mm), 'number', now())
  on conflict (id_tenant, seccion, clave)
  do update set valor = excluded.valor,
                tipo = excluded.tipo,
                updated_at = now();

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'configuracion', 'etiquetas:qr_lado_mm', 'actualizar',
          jsonb_build_object('qr_lado_mm', p_lado_mm), p_ip);

  return p_lado_mm;
end $$;

grant execute on function sp_set_configuracion_qr_lado_mm(integer, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. sp_set_configuracion_impresora
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_configuracion_impresora(
  p_ancho_mm integer,
  p_alto_mm  integer,
  p_ip       inet default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if (p_ancho_mm is not null and (p_ancho_mm < 20 or p_ancho_mm > 300))
     or (p_alto_mm is not null and (p_alto_mm < 20 or p_alto_mm > 300)) then
    raise exception 'impresora-medida-invalida' using errcode = '22023';
  end if;

  if p_ancho_mm is null then
    delete from configuracion
     where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_ancho_mm';
  else
    insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
    values (v_tenant, 'etiquetas', 'impresora_ancho_mm', to_jsonb(p_ancho_mm), 'number', now())
    on conflict (id_tenant, seccion, clave)
    do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
  end if;

  if p_alto_mm is null then
    delete from configuracion
     where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_alto_mm';
  else
    insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
    values (v_tenant, 'etiquetas', 'impresora_alto_mm', to_jsonb(p_alto_mm), 'number', now())
    on conflict (id_tenant, seccion, clave)
    do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'configuracion', 'etiquetas:impresora', 'actualizar',
          jsonb_build_object('impresora_ancho_mm', p_ancho_mm, 'impresora_alto_mm', p_alto_mm), p_ip);
end $$;

grant execute on function sp_set_configuracion_impresora(integer, integer, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. sp_set_tenant_logo
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_set_tenant_logo(
  p_logo_url text,
  p_ip       inet default null
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('administracion', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_logo_url is not null and (
       length(p_logo_url) > 1000
       or p_logo_url !~ '^https?://'
       or strpos(p_logo_url, '/storage/v1/object/public/tenant-logos/' || v_tenant::text || '/') = 0
     ) then
    raise exception 'logo-invalido' using errcode = '22023';
  end if;

  update tenant
     set logo_url = p_logo_url,
         updated_at = now()
   where id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'tenant', v_tenant::text, 'actualizar_logo',
          jsonb_build_object('logo_url', p_logo_url), p_ip);

  return p_logo_url;
end $$;

grant execute on function sp_set_tenant_logo(text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 11. sp_delete_rol
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_delete_rol(
  p_id_rol uuid,
  p_ip     inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_count  integer;
  v_nombre text;
begin
  if not (select auth_tiene_permiso('administracion', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select nombre into v_nombre from rol
    where id_rol = p_id_rol and id_tenant = v_tenant for update;
  if not found then
    raise exception 'rol-not-found' using errcode = '42704';
  end if;

  select count(*) into v_count from usuario
   where id_rol = p_id_rol and id_tenant = v_tenant;
  if v_count > 0 then
    raise exception 'rol-en-uso: % usuarios asignados', v_count using errcode = '22023';
  end if;

  delete from rol where id_rol = p_id_rol;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rol', p_id_rol::text, 'eliminar',
          jsonb_build_object('nombre', v_nombre), p_ip);
end $$;

grant execute on function sp_delete_rol(uuid, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 12. sp_change_password_user
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_change_password_user(
  p_id_usuario uuid, p_ip inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid;
  v_actor  uuid := auth.uid();
begin
  if p_id_usuario is distinct from auth.uid() then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select id_tenant into v_tenant from usuario where id_usuario = p_id_usuario;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'cambiar_password', '{}'::jsonb, p_ip);
end $$;

grant execute on function sp_change_password_user(uuid, inet) to authenticated;

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 1. sp_registrar_gasto (00053_gasto_descripcion_opcional_y_delete.sql:31)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_registrar_gasto(
--   p_id_categoria_gasto uuid,
--   p_monto              numeric,
--   p_descripcion        text,
--   p_fecha              timestamptz default null,
--   p_comprobante_ref    text default null,
--   p_ip                 inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_desc   text := nullif(btrim(coalesce(p_descripcion, '')), '');
--   v_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if p_monto is null or p_monto <= 0 then
--     raise exception 'monto-invalido' using errcode = '22023';
--   end if;
--
--   insert into gasto_negocio(id_tenant, id_categoria_gasto, id_usuario_alta,
--                              fecha, monto, descripcion, comprobante_ref)
--   values (v_tenant, p_id_categoria_gasto, v_actor,
--           coalesce(p_fecha, now()), p_monto, v_desc, p_comprobante_ref)
--   returning id_gasto into v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'gasto_negocio', v_id::text, 'crear',
--           jsonb_build_object('id_categoria_gasto', p_id_categoria_gasto,
--                              'monto', p_monto,
--                              'descripcion', v_desc),
--           p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_registrar_gasto(uuid, numeric, text, timestamptz, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 2. sp_eliminar_gasto (00053_gasto_descripcion_opcional_y_delete.sql:71)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_eliminar_gasto(
--   p_id_gasto uuid,
--   p_ip       inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_row    gasto_negocio%rowtype;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- El select ya pasa por RLS: un gasto de otro tenant no se ve y cae acá.
--   select * into v_row
--     from gasto_negocio
--    where id_gasto = p_id_gasto;
--   if not found then
--     raise exception 'gasto-inexistente' using errcode = '22023';
--   end if;
--
--   delete from gasto_negocio where id_gasto = p_id_gasto;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'gasto_negocio', p_id_gasto::text, 'eliminar',
--           jsonb_build_object('id_categoria_gasto', v_row.id_categoria_gasto,
--                              'fecha', v_row.fecha,
--                              'monto', v_row.monto,
--                              'descripcion', v_row.descripcion,
--                              'comprobante_ref', v_row.comprobante_ref),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_eliminar_gasto(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 3. sp_set_presupuesto_categoria_gasto (00027_rendicion_gasto_functions.sql:301)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_presupuesto_categoria_gasto(
--   p_id_categoria uuid,
--   p_presupuesto  numeric,  -- null = quita presupuesto
--   p_ip           inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_prev   numeric;
-- begin
--   select presupuesto_mensual into v_prev
--     from categoria_gasto
--    where id_categoria_gasto = p_id_categoria and id_tenant = v_tenant
--    for update;
--   if not found then
--     raise exception 'categoria-not-found' using errcode = '42704';
--   end if;
--
--   update categoria_gasto
--      set presupuesto_mensual = p_presupuesto
--    where id_categoria_gasto = p_id_categoria;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'categoria_gasto', p_id_categoria::text, 'set_presupuesto',
--           jsonb_build_object('presupuesto_anterior', v_prev,
--                              'presupuesto_nuevo', p_presupuesto),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_set_presupuesto_categoria_gasto(uuid, numeric, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 4. sp_create_rol (00029_administracion_functions.sql:19)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_create_rol(
--   p_nombre    text,
--   p_permisos  jsonb default '{}'::jsonb,
--   p_ip        inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if p_nombre is null or trim(p_nombre) = '' then
--     raise exception 'nombre-requerido' using errcode = '22023';
--   end if;
--
--   insert into rol(id_tenant, nombre, permisos)
--   values (v_tenant, trim(p_nombre), coalesce(p_permisos, '{}'::jsonb))
--   returning id_rol into v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rol', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'permisos', p_permisos), p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_create_rol(text, jsonb, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 5. sp_toggle_usuario_activo (00029_administracion_functions.sql:134)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_toggle_usuario_activo(
--   p_id_usuario uuid,
--   p_estado     usuario_estado,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_prev   usuario_estado;
-- begin
--   select estado_usuario into v_prev from usuario
--     where id_usuario = p_id_usuario and id_tenant = v_tenant for update;
--   if not found then
--     raise exception 'usuario-not-found' using errcode = '42704';
--   end if;
--
--   update usuario set estado_usuario = p_estado
--    where id_usuario = p_id_usuario;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'cambiar_estado',
--           jsonb_build_object('estado_anterior', v_prev, 'estado_nuevo', p_estado), p_ip);
-- end $$;
--
-- grant execute on function sp_toggle_usuario_activo(uuid, usuario_estado, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 6. sp_update_usuario (00009_seed_setup_functions.sql:12)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_update_usuario(
--   p_id_usuario uuid, p_nombre_completo text, p_id_rol uuid, p_ip inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_before jsonb;
--   v_tenant uuid;
--   v_actor  uuid := auth.uid();
-- begin
--   select to_jsonb(u.*), u.id_tenant into v_before, v_tenant
--     from usuario u where u.id_usuario = p_id_usuario;
--
--   update usuario set nombre_completo = p_nombre_completo, id_rol = p_id_rol
--    where id_usuario = p_id_usuario;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'editar',
--           jsonb_build_object('before', v_before,
--             'after', jsonb_build_object('nombre_completo', p_nombre_completo, 'id_rol', p_id_rol)),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_update_usuario(uuid, text, uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 7. sp_update_rol_permisos (00029_administracion_functions.sql:46)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_update_rol_permisos(
--   p_id_rol   uuid,
--   p_nombre   text,
--   p_permisos jsonb,
--   p_ip       inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_prev   jsonb;
--   v_prev_nombre text;
-- begin
--   select to_jsonb(permisos), nombre into v_prev, v_prev_nombre
--     from rol where id_rol = p_id_rol and id_tenant = v_tenant
--     for update;
--   if not found then
--     raise exception 'rol-not-found' using errcode = '42704';
--   end if;
--
--   update rol
--      set nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
--          permisos = coalesce(p_permisos, permisos)
--    where id_rol = p_id_rol;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rol', p_id_rol::text, 'editar',
--           jsonb_build_object('nombre_anterior', v_prev_nombre,
--                              'nombre_nuevo', p_nombre,
--                              'permisos_anteriores', v_prev,
--                              'permisos_nuevos', p_permisos),
--           p_ip);
-- end $$;
--
-- grant execute on function sp_update_rol_permisos(uuid, text, jsonb, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 8. sp_set_configuracion_qr_lado_mm (00113_configuracion_etiquetas_qr.sql:9)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_configuracion_qr_lado_mm(
--   p_lado_mm integer,
--   p_ip      inet default null
-- ) returns integer language plpgsql security invoker set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_lado_mm is null or p_lado_mm < 15 or p_lado_mm > 100 then
--     raise exception 'qr-lado-mm-invalido' using errcode = '22023';
--   end if;
--
--   insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--   values (v_tenant, 'etiquetas', 'qr_lado_mm', to_jsonb(p_lado_mm), 'number', now())
--   on conflict (id_tenant, seccion, clave)
--   do update set valor = excluded.valor,
--                 tipo = excluded.tipo,
--                 updated_at = now();
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'configuracion', 'etiquetas:qr_lado_mm', 'actualizar',
--           jsonb_build_object('qr_lado_mm', p_lado_mm), p_ip);
--
--   return p_lado_mm;
-- end $$;
--
-- grant execute on function sp_set_configuracion_qr_lado_mm(integer, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 9. sp_set_configuracion_impresora (00139_configuracion_impresora_etiquetas.sql:10)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_configuracion_impresora(
--   p_ancho_mm integer,
--   p_alto_mm  integer,
--   p_ip       inet default null
-- ) returns void language plpgsql security invoker set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if (p_ancho_mm is not null and (p_ancho_mm < 20 or p_ancho_mm > 300))
--      or (p_alto_mm is not null and (p_alto_mm < 20 or p_alto_mm > 300)) then
--     raise exception 'impresora-medida-invalida' using errcode = '22023';
--   end if;
--
--   if p_ancho_mm is null then
--     delete from configuracion
--      where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_ancho_mm';
--   else
--     insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--     values (v_tenant, 'etiquetas', 'impresora_ancho_mm', to_jsonb(p_ancho_mm), 'number', now())
--     on conflict (id_tenant, seccion, clave)
--     do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
--   end if;
--
--   if p_alto_mm is null then
--     delete from configuracion
--      where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_alto_mm';
--   else
--     insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--     values (v_tenant, 'etiquetas', 'impresora_alto_mm', to_jsonb(p_alto_mm), 'number', now())
--     on conflict (id_tenant, seccion, clave)
--     do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
--   end if;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'configuracion', 'etiquetas:impresora', 'actualizar',
--           jsonb_build_object('impresora_ancho_mm', p_ancho_mm, 'impresora_alto_mm', p_alto_mm), p_ip);
-- end $$;
--
-- grant execute on function sp_set_configuracion_impresora(integer, integer, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 10. sp_set_tenant_logo (00116_logo_tenant_storage.sql:102)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_set_tenant_logo(
--   p_logo_url text,
--   p_ip       inet default null
-- ) returns text language plpgsql security invoker set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_logo_url is not null and (
--        length(p_logo_url) > 1000
--        or p_logo_url !~ '^https?://'
--        or strpos(p_logo_url, '/storage/v1/object/public/tenant-logos/' || v_tenant::text || '/') = 0
--      ) then
--     raise exception 'logo-invalido' using errcode = '22023';
--   end if;
--
--   update tenant
--      set logo_url = p_logo_url,
--          updated_at = now()
--    where id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'tenant', v_tenant::text, 'actualizar_logo',
--           jsonb_build_object('logo_url', p_logo_url), p_ip);
--
--   return p_logo_url;
-- end $$;
--
-- grant execute on function sp_set_tenant_logo(text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 11. sp_delete_rol (00029_administracion_functions.sql:80)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_delete_rol(
--   p_id_rol uuid,
--   p_ip     inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_count  integer;
--   v_nombre text;
-- begin
--   select nombre into v_nombre from rol
--     where id_rol = p_id_rol and id_tenant = v_tenant for update;
--   if not found then
--     raise exception 'rol-not-found' using errcode = '42704';
--   end if;
--
--   select count(*) into v_count from usuario
--    where id_rol = p_id_rol and id_tenant = v_tenant;
--   if v_count > 0 then
--     raise exception 'rol-en-uso: % usuarios asignados', v_count using errcode = '22023';
--   end if;
--
--   delete from rol where id_rol = p_id_rol;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rol', p_id_rol::text, 'eliminar',
--           jsonb_build_object('nombre', v_nombre), p_ip);
-- end $$;
--
-- grant execute on function sp_delete_rol(uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 12. sp_change_password_user (00009_seed_setup_functions.sql:36)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_change_password_user(
--   p_id_usuario uuid, p_ip inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid;
--   v_actor  uuid := auth.uid();
-- begin
--   select id_tenant into v_tenant from usuario where id_usuario = p_id_usuario;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'usuario', p_id_usuario::text, 'cambiar_password', '{}'::jsonb, p_ip);
-- end $$;
--
-- grant execute on function sp_change_password_user(uuid, inet) to authenticated;
