-- 00120_alta_baja_tenant.sql
-- Alta de tenant, suspensión/reactivación y control de acceso en custom_access_token_hook.
-- REQ-SA-09, REQ-SA-10. DR-SA-06. D1, D2, D3, D4.
--
-- UP:
--   1. Permisos para supabase_auth_admin sobre public.tenant (lectura de estado_tenant en el hook).
--   2. Actualización de custom_access_token_hook: si el tenant no está 'activo', no inyecta claims.
--   3. sp_alta_tenant(p_nombre, p_subdominio, p_paquetes, p_id_auth_user, p_email, p_nombre_admin, p_permisos, p_actor) INVOKER.
--   4. sp_cambiar_estado_tenant(p_id_tenant, p_estado, p_actor) INVOKER.
--   5. Revocación de permisos a authenticated, anon y public sobre los nuevos SPs.
--
-- DOWN:
-- drop function if exists sp_cambiar_estado_tenant(uuid, text, uuid);
-- drop function if exists sp_alta_tenant(text, text, text[], uuid, text, text, jsonb, uuid);
-- drop policy if exists tenant_auth_admin_read on tenant;
-- revoke select on public.tenant from supabase_auth_admin;
-- create or replace function public.custom_access_token_hook(event jsonb)
--   returns jsonb
--   language plpgsql
--   stable
-- as $$
-- declare
--   claims        jsonb;
--   v_tenant      uuid;
--   v_rol_nombre  text;
--   v_revendedora uuid;
-- begin
--   select u.id_tenant, r.nombre into v_tenant, v_rol_nombre
--     from public.usuario u
--     left join public.rol r on u.id_rol = r.id_rol
--    where u.id_usuario = (event ->> 'user_id')::uuid;
--
--   select id_revendedora into v_revendedora
--     from public.revendedora
--    where id_usuario = (event ->> 'user_id')::uuid;
--
--   claims := event -> 'claims';
--
--   if v_rol_nombre = 'Revendedora' and v_revendedora is null then
--     claims := claims - 'tenant_id' - 'id_revendedora';
--   else
--     if v_tenant is not null then
--       claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant::text));
--     else
--       claims := claims - 'tenant_id';
--     end if;
--
--     if v_revendedora is not null then
--       claims := jsonb_set(claims, '{id_revendedora}', to_jsonb(v_revendedora::text));
--     else
--       claims := claims - 'id_revendedora';
--     end if;
--   end if;
--
--   return jsonb_set(event, '{claims}', claims);
-- end;
-- $$;

-- ─── 1. PERMISOS supabase_auth_admin ─────────────────────────────────
grant select on public.tenant to supabase_auth_admin;

drop policy if exists tenant_auth_admin_read on tenant;
create policy tenant_auth_admin_read on tenant
  for select to supabase_auth_admin
  using (true);

-- ─── 2. ACTUALIZACIÓN custom_access_token_hook ────────────────────────
-- D2: Si el tenant del usuario no está 'activo', el hook NO inyecta tenant_id ni id_revendedora.
create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
as $$
declare
  claims          jsonb;
  v_tenant        uuid;
  v_estado_tenant public.tenant_estado;
  v_rol_nombre    text;
  v_revendedora   uuid;
begin
  select u.id_tenant, t.estado_tenant, r.nombre
    into v_tenant, v_estado_tenant, v_rol_nombre
    from public.usuario u
    left join public.tenant t on u.id_tenant = t.id_tenant
    left join public.rol r on u.id_rol = r.id_rol
   where u.id_usuario = (event ->> 'user_id')::uuid;

  select id_revendedora into v_revendedora
    from public.revendedora
   where id_usuario = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  -- Si el tenant existe pero su estado no es 'activo' (ej: 'suspendido'), no inyectar claims
  if v_tenant is not null and v_estado_tenant is distinct from 'activo' then
    claims := claims - 'tenant_id' - 'id_revendedora';
  elsif v_rol_nombre = 'Revendedora' and v_revendedora is null then
    claims := claims - 'tenant_id' - 'id_revendedora';
  else
    if v_tenant is not null then
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant::text));
    else
      claims := claims - 'tenant_id';
    end if;

    if v_revendedora is not null then
      claims := jsonb_set(claims, '{id_revendedora}', to_jsonb(v_revendedora::text));
    else
      claims := claims - 'id_revendedora';
    end if;
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ─── 3. sp_alta_tenant ───────────────────────────────────────────────
-- D3: Alta en una transacción: tenant, rol Administrador, módulos (núcleo + opcionales) y usuario.
create or replace function sp_alta_tenant(
  p_nombre        text,
  p_subdominio    text,
  p_paquetes      text[],
  p_id_auth_user  uuid,
  p_email         text,
  p_nombre_admin  text,
  p_permisos      jsonb,
  p_actor         uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id_tenant  uuid;
  v_id_rol     uuid;
  v_paquete    text;
  v_codigos    text[];
  v_codigo     text;
  v_id_modulo  uuid;
begin
  -- Validación de actor superadmin
  if p_actor is null or not exists (
    select 1 from superadmin where id_auth_user = p_actor
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de nombre
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'nombre-invalido' using errcode = 'P0001';
  end if;

  -- Validación de subdominio
  if p_subdominio is null or trim(p_subdominio) = '' then
    raise exception 'subdominio-invalido' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from tenant where lower(subdominio) = lower(trim(p_subdominio))
  ) then
    raise exception 'subdominio-en-uso' using errcode = 'P0001';
  end if;

  -- Validación de usuario Auth y email
  if p_id_auth_user is null or p_email is null or trim(p_email) = '' then
    raise exception 'usuario-invalido' using errcode = 'P0001';
  end if;

  -- Validación de nombre del administrador
  if p_nombre_admin is null or trim(p_nombre_admin) = '' then
    raise exception 'nombre-invalido' using errcode = 'P0001';
  end if;

  -- Validación de permisos
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'object' then
    raise exception 'permisos-no-objeto' using errcode = 'P0001';
  end if;

  -- Validación previa de paquetes
  if p_paquetes is not null then
    foreach v_paquete in array p_paquetes loop
      v_codigos := fn_codigos_paquete(v_paquete);
      if v_codigos is null or array_length(v_codigos, 1) is null then
        raise exception 'paquete-invalido' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- 1. Insertar tenant (con captura de unique_violation ante carreras concurrentes)
  begin
    insert into tenant (
      nombre_comercial,
      subdominio,
      estado_tenant
    ) values (
      trim(p_nombre),
      lower(trim(p_subdominio)),
      'activo'
    ) returning id_tenant into v_id_tenant;
  exception
    when unique_violation then
      raise exception 'subdominio-en-uso' using errcode = 'P0001';
  end;

  -- 2. Insertar rol 'Administrador' con permisos
  insert into rol (
    id_tenant,
    nombre,
    permisos
  ) values (
    v_id_tenant,
    'Administrador',
    p_permisos
  ) returning id_rol into v_id_rol;

  -- 3. Insertar módulos del núcleo
  insert into tenant_modulo (id_tenant, id_modulo, habilitado)
  select v_id_tenant, id_modulo, true
    from modulo
   where fn_modulo_es_nucleo(codigo);

  -- 4. Insertar módulos opcionales seleccionados
  if p_paquetes is not null then
    foreach v_paquete in array p_paquetes loop
      v_codigos := fn_codigos_paquete(v_paquete);
      foreach v_codigo in array v_codigos loop
        select id_modulo into v_id_modulo from modulo where codigo = v_codigo;
        if v_id_modulo is not null then
          insert into tenant_modulo (id_tenant, id_modulo, habilitado)
          values (v_id_tenant, v_id_modulo, true)
          on conflict (id_tenant, id_modulo)
          do update set habilitado = true;
        end if;
      end loop;
    end loop;
  end if;

  -- 5. Insertar perfil de usuario administrador
  insert into usuario (
    id_usuario,
    id_tenant,
    email,
    nombre_completo,
    id_rol,
    estado_usuario
  ) values (
    p_id_auth_user,
    v_id_tenant,
    lower(trim(p_email)),
    trim(p_nombre_admin),
    v_id_rol,
    'invitado'
  );

  return v_id_tenant;
end;
$$;

revoke all on function sp_alta_tenant(text, text, text[], uuid, text, text, jsonb, uuid) from authenticated, anon, public;

-- ─── 4. sp_cambiar_estado_tenant ─────────────────────────────────────
-- D1, D4: Cambiar estado entre 'activo' y 'suspendido'. Idempotente.
create or replace function sp_cambiar_estado_tenant(
  p_id_tenant uuid,
  p_estado    text,
  p_actor     uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_estado_actual tenant_estado;
begin
  -- Validación de actor superadmin
  if p_actor is null or not exists (
    select 1 from superadmin where id_auth_user = p_actor
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de estado permitido
  if p_estado is null or p_estado not in ('activo', 'suspendido') then
    raise exception 'estado-invalido' using errcode = 'P0001';
  end if;

  -- Validación de existencia del tenant
  select estado_tenant into v_estado_actual
    from tenant
   where id_tenant = p_id_tenant
   for update;

  if not found then
    raise exception 'tenant-inexistente' using errcode = 'P0001';
  end if;

  -- Idempotente: actualizar si difiere
  if v_estado_actual::text <> p_estado then
    update tenant
       set estado_tenant = p_estado::tenant_estado
     where id_tenant = p_id_tenant;
  end if;
end;
$$;

revoke all on function sp_cambiar_estado_tenant(uuid, text, uuid) from authenticated, anon, public;
