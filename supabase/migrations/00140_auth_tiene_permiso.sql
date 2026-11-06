-- 00140_auth_tiene_permiso.sql
-- Helper de seguridad para RLS por permiso (REQ-RLSP-01, DR-RLSP-03).
--
-- DOWN:
-- drop function if exists auth_tiene_permiso(text, text);

create or replace function auth_tiene_permiso(p_modulo text, p_accion text)
returns boolean
language sql
stable
security invoker
set search_path = public
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
    ),
    false
  );
$$;
