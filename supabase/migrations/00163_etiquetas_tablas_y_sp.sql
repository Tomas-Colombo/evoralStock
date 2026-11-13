-- 00163_etiquetas_tablas_y_sp.sql
-- UP: Tablas etiqueta_config y etiqueta_plantilla con RLS cerrada (§2.2, REQ-ETQ-08) y 5 stored procedures INVOKER (§2.1).
--
-- DOWN:
--   drop function if exists sp_eliminar_etiqueta_plantilla(uuid, inet);
--   drop function if exists sp_marcar_etiqueta_plantilla_predeterminada(uuid, inet);
--   drop function if exists sp_editar_etiqueta_plantilla(uuid, text, numeric, numeric, boolean, boolean, boolean, boolean, inet);
--   drop function if exists sp_crear_etiqueta_plantilla(text, numeric, numeric, boolean, boolean, boolean, boolean, inet);
--   drop function if exists sp_set_etiqueta_config(text, text, numeric, numeric, integer, numeric, numeric, inet);
--   drop policy if exists etiqueta_plantilla_rlsp_delete on etiqueta_plantilla;
--   drop policy if exists etiqueta_plantilla_rlsp_update on etiqueta_plantilla;
--   drop policy if exists etiqueta_plantilla_rlsp_insert on etiqueta_plantilla;
--   drop policy if exists etiqueta_plantilla_rlsp_select on etiqueta_plantilla;
--   drop policy if exists etiqueta_plantilla_restrict_revendedora on etiqueta_plantilla;
--   drop policy if exists etiqueta_plantilla_tenant_isolation on etiqueta_plantilla;
--   drop table if exists etiqueta_plantilla;
--   drop policy if exists etiqueta_config_rlsp_delete on etiqueta_config;
--   drop policy if exists etiqueta_config_rlsp_update on etiqueta_config;
--   drop policy if exists etiqueta_config_rlsp_insert on etiqueta_config;
--   drop policy if exists etiqueta_config_rlsp_select on etiqueta_config;
--   drop policy if exists etiqueta_config_restrict_revendedora on etiqueta_config;
--   drop policy if exists etiqueta_config_tenant_isolation on etiqueta_config;
--   drop table if exists etiqueta_config;

-- ─── 1. Tabla etiqueta_config ─────────────────────────────────────────
create table if not exists etiqueta_config (
  id_tenant      uuid primary key references tenant(id_tenant) on delete cascade,
  metodo         text not null default 'qr' check (metodo in ('qr', 'datamatrix', 'code128', 'ean13')),
  impresora_tipo text not null default 'hoja' check (impresora_tipo in ('hoja', 'rollo')),
  margen_mm      numeric(5, 2) not null default 10 check (margen_mm between 0 and 20),
  separacion_mm  numeric(5, 2) not null default 2 check (separacion_mm between 0 and 20),
  columnas       integer check (columnas is null or (columnas between 1 and 10)),
  offset_x_mm    numeric(5, 2) not null default 0 check (offset_x_mm between -10 and 10),
  offset_y_mm    numeric(5, 2) not null default 0 check (offset_y_mm between -10 and 10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table etiqueta_config enable row level security;

-- Permissive tenant isolation
create policy etiqueta_config_tenant_isolation on etiqueta_config
  for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

-- Restrictiva revendedora (REQ-ETQ-08 N2)
create policy etiqueta_config_restrict_revendedora on etiqueta_config as restrictive
  for all to authenticated
  using (auth_revendedora_id() is null);

-- Restrictiva por comando (§2.2):
-- SELECT: inventario.ver OR administracion.ver OR administracion.editar
create policy etiqueta_config_rlsp_select on etiqueta_config as restrictive
  for select to authenticated
  using (
    (select auth_tiene_permiso('inventario', 'ver'))
    or (select auth_tiene_permiso('administracion', 'ver'))
    or (select auth_tiene_permiso('administracion', 'editar'))
  );

-- INSERT: administracion.editar
create policy etiqueta_config_rlsp_insert on etiqueta_config as restrictive
  for insert to authenticated
  with check ((select auth_tiene_permiso('administracion', 'editar')));

-- UPDATE: administracion.editar
create policy etiqueta_config_rlsp_update on etiqueta_config as restrictive
  for update to authenticated
  using ((select auth_tiene_permiso('administracion', 'editar')))
  with check ((select auth_tiene_permiso('administracion', 'editar')));

-- DELETE: solo DEFINER (nadie)
create policy etiqueta_config_rlsp_delete on etiqueta_config as restrictive
  for delete to authenticated
  using (false);

revoke all on etiqueta_config from anon, public;
grant select, insert, update on etiqueta_config to authenticated;

-- ─── 2. Tabla etiqueta_plantilla ──────────────────────────────────────
create table if not exists etiqueta_plantilla (
  id_plantilla         uuid primary key default gen_random_uuid(),
  id_tenant            uuid not null references tenant(id_tenant) on delete cascade,
  nombre               text not null check (length(trim(nombre)) between 1 and 40 and trim(nombre) = nombre),
  ancho_mm             numeric(5, 2) not null check (ancho_mm between 15 and 300),
  alto_mm              numeric(5, 2) not null check (alto_mm between 10 and 300),
  mostrar_nombre       boolean not null default true,
  mostrar_talle        boolean not null default true,
  mostrar_sku          boolean not null default true,
  mostrar_texto_codigo boolean not null default true,
  predeterminada       boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Case-insensitive unique name per tenant (REQ-ETQ-03)
create unique index if not exists etiqueta_plantilla_tenant_nombre_lower_uk
  on etiqueta_plantilla(id_tenant, lower(nombre));

-- Exactly one predeterminada per tenant (REQ-ETQ-03)
create unique index if not exists etiqueta_plantilla_tenant_predeterminada_uk
  on etiqueta_plantilla(id_tenant)
  where (predeterminada = true);

alter table etiqueta_plantilla enable row level security;

-- Permissive tenant isolation
create policy etiqueta_plantilla_tenant_isolation on etiqueta_plantilla
  for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

-- Restrictiva revendedora (REQ-ETQ-08 N2)
create policy etiqueta_plantilla_restrict_revendedora on etiqueta_plantilla as restrictive
  for all to authenticated
  using (auth_revendedora_id() is null);

-- Restrictiva por comando (§2.2):
-- SELECT: inventario.ver OR administracion.ver OR administracion.crear OR administracion.editar OR administracion.eliminar
create policy etiqueta_plantilla_rlsp_select on etiqueta_plantilla as restrictive
  for select to authenticated
  using (
    (select auth_tiene_permiso('inventario', 'ver'))
    or (select auth_tiene_permiso('administracion', 'ver'))
    or (select auth_tiene_permiso('administracion', 'crear'))
    or (select auth_tiene_permiso('administracion', 'editar'))
    or (select auth_tiene_permiso('administracion', 'eliminar'))
  );

-- INSERT: administracion.crear
create policy etiqueta_plantilla_rlsp_insert on etiqueta_plantilla as restrictive
  for insert to authenticated
  with check ((select auth_tiene_permiso('administracion', 'crear')));

-- UPDATE: administracion.editar
create policy etiqueta_plantilla_rlsp_update on etiqueta_plantilla as restrictive
  for update to authenticated
  using ((select auth_tiene_permiso('administracion', 'editar')))
  with check ((select auth_tiene_permiso('administracion', 'editar')));

-- DELETE: administracion.eliminar
create policy etiqueta_plantilla_rlsp_delete on etiqueta_plantilla as restrictive
  for delete to authenticated
  using ((select auth_tiene_permiso('administracion', 'eliminar')));

revoke all on etiqueta_plantilla from anon, public;
grant select, insert, update, delete on etiqueta_plantilla to authenticated;

-- ─── 3. Stored Procedures ─────────────────────────────────────────────

-- 3.1 sp_set_etiqueta_config (administracion.editar)
create or replace function sp_set_etiqueta_config(
  p_metodo         text,
  p_impresora_tipo text,
  p_margen_mm      numeric,
  p_separacion_mm  numeric,
  p_columnas       integer default null,
  p_offset_x_mm    numeric default 0,
  p_offset_y_mm    numeric default 0,
  p_ip             inet default null
) returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
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

  if p_metodo is null or p_metodo not in ('qr', 'datamatrix', 'code128', 'ean13') then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_impresora_tipo is null or p_impresora_tipo not in ('hoja', 'rollo') then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_margen_mm is null or p_margen_mm < 0 or p_margen_mm > 20 then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_separacion_mm is null or p_separacion_mm < 0 or p_separacion_mm > 20 then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_columnas is not null and (p_columnas < 1 or p_columnas > 10) then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_offset_x_mm is null or p_offset_x_mm < -10 or p_offset_x_mm > 10 then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  if p_offset_y_mm is null or p_offset_y_mm < -10 or p_offset_y_mm > 10 then
    raise exception 'etiqueta-config-invalida' using errcode = '22023';
  end if;

  insert into etiqueta_config (
    id_tenant, metodo, impresora_tipo, margen_mm, separacion_mm, columnas, offset_x_mm, offset_y_mm, updated_at
  )
  values (
    v_tenant, p_metodo, p_impresora_tipo, p_margen_mm, p_separacion_mm, p_columnas, p_offset_x_mm, p_offset_y_mm, now()
  )
  on conflict (id_tenant)
  do update set
    metodo         = excluded.metodo,
    impresora_tipo = excluded.impresora_tipo,
    margen_mm      = excluded.margen_mm,
    separacion_mm  = excluded.separacion_mm,
    columnas       = excluded.columnas,
    offset_x_mm    = excluded.offset_x_mm,
    offset_y_mm    = excluded.offset_y_mm,
    updated_at     = now();

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'etiqueta_config', v_tenant::text, 'actualizar',
    jsonb_build_object(
      'metodo', p_metodo,
      'impresora_tipo', p_impresora_tipo,
      'margen_mm', p_margen_mm,
      'separacion_mm', p_separacion_mm,
      'columnas', p_columnas,
      'offset_x_mm', p_offset_x_mm,
      'offset_y_mm', p_offset_y_mm
    ),
    p_ip
  );
end;
$$;

revoke all on function sp_set_etiqueta_config(text, text, numeric, numeric, integer, numeric, numeric, inet) from anon, public;
grant execute on function sp_set_etiqueta_config(text, text, numeric, numeric, integer, numeric, numeric, inet) to authenticated;

-- 3.2 sp_crear_etiqueta_plantilla (administracion.crear)
create or replace function sp_crear_etiqueta_plantilla(
  p_nombre               text,
  p_ancho_mm             numeric,
  p_alto_mm              numeric,
  p_mostrar_nombre       boolean default true,
  p_mostrar_talle        boolean default true,
  p_mostrar_sku          boolean default true,
  p_mostrar_texto_codigo boolean default true,
  p_ip                   inet default null
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_count    integer;
  v_es_primera boolean;
begin
  if not (select auth_tiene_permiso('administracion', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_nombre is null or length(trim(p_nombre)) < 1 or length(trim(p_nombre)) > 40 or trim(p_nombre) <> p_nombre then
    raise exception 'plantilla-nombre-duplicado' using errcode = '22023';
  end if;

  if p_ancho_mm is null or p_ancho_mm < 15 or p_ancho_mm > 300
     or p_alto_mm is null or p_alto_mm < 10 or p_alto_mm > 300 then
    raise exception 'plantilla-medidas-invalidas' using errcode = '22023';
  end if;

  -- Chequear límite de 20 plantillas
  select count(*) into v_count
    from etiqueta_plantilla
   where id_tenant = v_tenant;

  if v_count >= 20 then
    raise exception 'plantillas-limite' using errcode = '22023';
  end if;

  -- Chequear unicidad de nombre case-insensitive
  if exists (
    select 1 from etiqueta_plantilla
     where id_tenant = v_tenant and lower(nombre) = lower(trim(p_nombre))
  ) then
    raise exception 'plantilla-nombre-duplicado' using errcode = '23505';
  end if;

  v_es_primera := (v_count = 0);

  insert into etiqueta_plantilla (
    id_tenant, nombre, ancho_mm, alto_mm,
    mostrar_nombre, mostrar_talle, mostrar_sku, mostrar_texto_codigo,
    predeterminada
  )
  values (
    v_tenant, trim(p_nombre), p_ancho_mm, p_alto_mm,
    coalesce(p_mostrar_nombre, true),
    coalesce(p_mostrar_talle, true),
    coalesce(p_mostrar_sku, true),
    coalesce(p_mostrar_texto_codigo, true),
    v_es_primera
  )
  returning id_plantilla into v_id;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'etiqueta_plantilla', v_id::text, 'crear',
    jsonb_build_object(
      'nombre', trim(p_nombre),
      'ancho_mm', p_ancho_mm,
      'alto_mm', p_alto_mm,
      'predeterminada', v_es_primera
    ),
    p_ip
  );

  return v_id;
end;
$$;

revoke all on function sp_crear_etiqueta_plantilla(text, numeric, numeric, boolean, boolean, boolean, boolean, inet) from anon, public;
grant execute on function sp_crear_etiqueta_plantilla(text, numeric, numeric, boolean, boolean, boolean, boolean, inet) to authenticated;

-- 3.3 sp_editar_etiqueta_plantilla (administracion.editar)
create or replace function sp_editar_etiqueta_plantilla(
  p_id_plantilla         uuid,
  p_nombre               text,
  p_ancho_mm             numeric,
  p_alto_mm              numeric,
  p_mostrar_nombre       boolean default true,
  p_mostrar_talle        boolean default true,
  p_mostrar_sku          boolean default true,
  p_mostrar_texto_codigo boolean default true,
  p_ip                   inet default null
) returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
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

  if not exists (
    select 1 from etiqueta_plantilla
     where id_plantilla = p_id_plantilla and id_tenant = v_tenant
  ) then
    raise exception 'plantilla-no-encontrada' using errcode = '42704';
  end if;

  if p_nombre is null or length(trim(p_nombre)) < 1 or length(trim(p_nombre)) > 40 or trim(p_nombre) <> p_nombre then
    raise exception 'plantilla-nombre-duplicado' using errcode = '22023';
  end if;

  if p_ancho_mm is null or p_ancho_mm < 15 or p_ancho_mm > 300
     or p_alto_mm is null or p_alto_mm < 10 or p_alto_mm > 300 then
    raise exception 'plantilla-medidas-invalidas' using errcode = '22023';
  end if;

  if exists (
    select 1 from etiqueta_plantilla
     where id_tenant = v_tenant
       and id_plantilla <> p_id_plantilla
       and lower(nombre) = lower(trim(p_nombre))
  ) then
    raise exception 'plantilla-nombre-duplicado' using errcode = '23505';
  end if;

  update etiqueta_plantilla
     set nombre               = trim(p_nombre),
         ancho_mm             = p_ancho_mm,
         alto_mm              = p_alto_mm,
         mostrar_nombre       = coalesce(p_mostrar_nombre, true),
         mostrar_talle        = coalesce(p_mostrar_talle, true),
         mostrar_sku          = coalesce(p_mostrar_sku, true),
         mostrar_texto_codigo = coalesce(p_mostrar_texto_codigo, true),
         updated_at           = now()
   where id_plantilla = p_id_plantilla
     and id_tenant = v_tenant;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'etiqueta_plantilla', p_id_plantilla::text, 'actualizar',
    jsonb_build_object(
      'nombre', trim(p_nombre),
      'ancho_mm', p_ancho_mm,
      'alto_mm', p_alto_mm
    ),
    p_ip
  );
end;
$$;

revoke all on function sp_editar_etiqueta_plantilla(uuid, text, numeric, numeric, boolean, boolean, boolean, boolean, inet) from anon, public;
grant execute on function sp_editar_etiqueta_plantilla(uuid, text, numeric, numeric, boolean, boolean, boolean, boolean, inet) to authenticated;

-- 3.4 sp_marcar_etiqueta_plantilla_predeterminada (administracion.editar)
create or replace function sp_marcar_etiqueta_plantilla_predeterminada(
  p_id_plantilla uuid,
  p_ip           inet default null
) returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
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

  if not exists (
    select 1 from etiqueta_plantilla
     where id_plantilla = p_id_plantilla and id_tenant = v_tenant
  ) then
    raise exception 'plantilla-no-encontrada' using errcode = '42704';
  end if;

  update etiqueta_plantilla
     set predeterminada = false,
         updated_at     = now()
   where id_tenant = v_tenant
     and predeterminada = true;

  update etiqueta_plantilla
     set predeterminada = true,
         updated_at     = now()
   where id_plantilla = p_id_plantilla
     and id_tenant = v_tenant;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'etiqueta_plantilla', p_id_plantilla::text, 'marcar_predeterminada',
    jsonb_build_object('predeterminada', true),
    p_ip
  );
end;
$$;

revoke all on function sp_marcar_etiqueta_plantilla_predeterminada(uuid, inet) from anon, public;
grant execute on function sp_marcar_etiqueta_plantilla_predeterminada(uuid, inet) to authenticated;

-- 3.5 sp_eliminar_etiqueta_plantilla (administracion.eliminar)
create or replace function sp_eliminar_etiqueta_plantilla(
  p_id_plantilla uuid,
  p_ip           inet default null
) returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_actor          uuid := auth.uid();
  v_predeterminada boolean;
begin
  if not (select auth_tiene_permiso('administracion', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select predeterminada into v_predeterminada
    from etiqueta_plantilla
   where id_plantilla = p_id_plantilla and id_tenant = v_tenant;

  if v_predeterminada is null then
    raise exception 'plantilla-no-encontrada' using errcode = '42704';
  end if;

  if v_predeterminada then
    raise exception 'plantilla-predeterminada-no-se-borra' using errcode = '22023';
  end if;

  delete from etiqueta_plantilla
   where id_plantilla = p_id_plantilla
     and id_tenant = v_tenant;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant, v_actor, 'etiqueta_plantilla', p_id_plantilla::text, 'eliminar',
    jsonb_build_object('id_plantilla', p_id_plantilla),
    p_ip
  );
end;
$$;

revoke all on function sp_eliminar_etiqueta_plantilla(uuid, inet) from anon, public;
grant execute on function sp_eliminar_etiqueta_plantilla(uuid, inet) to authenticated;
