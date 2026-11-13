-- 00159_rls_administracion.sql
-- Restrictive RLS policies on rol and usuario tables to prevent privilege escalation.
--
-- DOWN:
-- drop policy if exists rlsp_rol_select on rol;
-- drop policy if exists rlsp_rol_insert on rol;
-- drop policy if exists rlsp_rol_update on rol;
-- drop policy if exists rlsp_rol_delete on rol;
-- drop policy if exists rlsp_usuario_select on usuario;
-- drop policy if exists rlsp_usuario_insert on usuario;
-- drop policy if exists rlsp_usuario_update on usuario;
-- drop policy if exists rlsp_usuario_delete on usuario;
-- create or replace function auth_tiene_permiso(p_modulo text, p_accion text)
-- returns boolean
-- language sql
-- stable
-- security invoker
-- set search_path = public
-- as $$
--   select coalesce(
--     (
--       select r.permisos -> p_modulo ? p_accion
--       from usuario u
--       join rol r on r.id_rol = u.id_rol
--       where u.id_usuario = auth.uid()
--         and u.id_tenant = auth_tenant_id()
--         and r.id_tenant = auth_tenant_id()
--         and u.estado_usuario <> 'inactivo'
--     ),
--     false
--   );
-- $$;

-- ─── 0. HELPER auth_tiene_permiso EN PL/PGSQL CON RECURSION GUARD ─────────────
-- Actualizar helper a PL/pgSQL con guarda anti-recursión para que llamadas reentrantes
-- durante la evaluación de policies de usuario/rol corten en false inmediatamente sin desbordar stack.
-- Respeta REQ-RLSP-01: retorna false ante nulos o inactivos.
create or replace function auth_tiene_permiso(p_modulo text, p_accion text)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_permiso boolean;
  v_id_rol  uuid;
begin
  if p_modulo is null or p_accion is null then
    return false;
  end if;

  if current_setting('utopia.auth_check_active', true) = 'true' then
    return false;
  end if;

  perform set_config('utopia.auth_check_active', 'true', true);

  select u.id_rol into v_id_rol
    from usuario u
   where u.id_usuario = auth.uid()
     and u.id_tenant = auth_tenant_id()
     and u.estado_usuario <> 'inactivo';

  if v_id_rol is null then
    perform set_config('utopia.auth_check_active', 'false', true);
    return false;
  end if;

  select (r.permisos -> p_modulo ? p_accion) into v_permiso
    from rol r
   where r.id_rol = v_id_rol
     and r.id_tenant = auth_tenant_id();

  perform set_config('utopia.auth_check_active', 'false', true);
  return coalesce(v_permiso, false);
exception
  when others then
    perform set_config('utopia.auth_check_active', 'false', true);
    raise;
end;
$$;

-- ─── 1. TABLA ROL ────────────────────────────────────────────────────────────

-- SELECT: El rol propio asignado al usuario O administradores (cualquier permiso de administración).
create policy rlsp_rol_select on rol as restrictive for select to authenticated
  using (
    id_rol = (select u.id_rol from usuario u where u.id_usuario = auth.uid())
    or (select auth_tiene_permiso('administracion', 'ver'))
    or (select auth_tiene_permiso('administracion', 'crear'))
    or (select auth_tiene_permiso('administracion', 'editar'))
    or (select auth_tiene_permiso('administracion', 'eliminar'))
  );

-- INSERT: Solo con permiso 'crear' de administración.
create policy rlsp_rol_insert on rol as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('administracion', 'crear')));

-- UPDATE: Solo con permiso 'editar' de administración.
-- En USING se incluye 'eliminar' porque sp_delete_rol realiza SELECT ... FOR UPDATE antes de borrar.
-- WITH CHECK exige estrictamente 'editar' para cualquier mutación de valores.
create policy rlsp_rol_update on rol as restrictive for update to authenticated
  using (
    (select auth_tiene_permiso('administracion', 'editar'))
    or (select auth_tiene_permiso('administracion', 'eliminar'))
  )
  with check ((select auth_tiene_permiso('administracion', 'editar')));

-- DELETE: Solo con permiso 'eliminar' de administración.
create policy rlsp_rol_delete on rol as restrictive for delete to authenticated
  using ((select auth_tiene_permiso('administracion', 'eliminar')));

-- ─── 2. TABLA USUARIO ────────────────────────────────────────────────────────

-- SELECT: La propia fila del usuario O administradores (cualquier permiso de administración).
create policy rlsp_usuario_select on usuario as restrictive for select to authenticated
  using (
    id_usuario = auth.uid()
    or (select auth_tiene_permiso('administracion', 'ver'))
    or (select auth_tiene_permiso('administracion', 'crear'))
    or (select auth_tiene_permiso('administracion', 'editar'))
    or (select auth_tiene_permiso('administracion', 'eliminar'))
  );

-- INSERT: Solo con permiso 'crear' de administración.
create policy rlsp_usuario_insert on usuario as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('administracion', 'crear')));

-- UPDATE: Solo con permiso 'editar' de administración.
create policy rlsp_usuario_update on usuario as restrictive for update to authenticated
  using ((select auth_tiene_permiso('administracion', 'editar')))
  with check ((select auth_tiene_permiso('administracion', 'editar')));

-- DELETE: Solo con permiso 'eliminar' de administración.
create policy rlsp_usuario_delete on usuario as restrictive for delete to authenticated
  using ((select auth_tiene_permiso('administracion', 'eliminar')));
