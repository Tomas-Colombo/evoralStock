-- 00160_auth_tiene_permiso_definer.sql
-- auth_tiene_permiso pasa a SECURITY DEFINER con el cuerpo SQL original de 00140.
--
-- Por qué: 00159 puso policies en usuario y rol que llaman a auth_tiene_permiso, y la
-- función (INVOKER) lee usuario y rol: recursión infinita. 00159 la cortó con un candado
-- por GUC dentro de una función stable con bloque exception (subtransacción por llamada).
-- Como DEFINER (owner postgres, sin FORCE RLS) lee usuario/rol sin evaluar sus policies:
-- sin recursión, sin candado. No expone datos: solo responde si EL QUE LLAMA tiene el
-- permiso (filtra por auth.uid() y auth_tenant_id()). Los grants se conservan
-- (create or replace mantiene el ACL): anon sigue recibiendo false, no un error.
-- Como DEFINER bypasses RLS, se preserva explícitamente el filtro de la restrictiva 00078
-- (auth_revendedora_id() is null) para que una revendedora nunca tenga permisos de operador.
-- Excepción DEFINER aprobada por la persona el 2026-11-13; listada en
-- tests/db/rvp-lecturas.test.ts y AGENTS.md.
--
-- DOWN:
-- NOTE: Restaura la definición vigente anterior (00159), copiada sin cambios.
-- create or replace function auth_tiene_permiso(p_modulo text, p_accion text)
-- returns boolean
-- language plpgsql
-- stable
-- security invoker
-- set search_path = public
-- as $$
-- declare
--   v_permiso boolean;
--   v_id_rol  uuid;
-- begin
--   if p_modulo is null or p_accion is null then
--     return false;
--   end if;
--
--   if current_setting('utopia.auth_check_active', true) = 'true' then
--     return false;
--   end if;
--
--   perform set_config('utopia.auth_check_active', 'true', true);
--
--   select u.id_rol into v_id_rol
--     from usuario u
--    where u.id_usuario = auth.uid()
--      and u.id_tenant = auth_tenant_id()
--      and u.estado_usuario <> 'inactivo';
--
--   if v_id_rol is null then
--     perform set_config('utopia.auth_check_active', 'false', true);
--     return false;
--   end if;
--
--   select (r.permisos -> p_modulo ? p_accion) into v_permiso
--     from rol r
--    where r.id_rol = v_id_rol
--      and r.id_tenant = auth_tenant_id();
--
--   perform set_config('utopia.auth_check_active', 'false', true);
--   return coalesce(v_permiso, false);
-- exception
--   when others then
--     perform set_config('utopia.auth_check_active', 'false', true);
--     raise;
-- end;
-- $$;

create or replace function auth_tiene_permiso(p_modulo text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select r.permisos -> p_modulo ? p_accion
      from usuario u
      join rol r on r.id_rol = u.id_rol
      where u.id_usuario = auth.uid()
        and u.id_tenant = auth_tenant_id()
        and r.id_tenant = auth_tenant_id()
        and u.estado_usuario <> 'inactivo'
        and auth_revendedora_id() is null
    ),
    false
  );
$$;
