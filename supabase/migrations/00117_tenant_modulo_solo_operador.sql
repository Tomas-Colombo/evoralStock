-- 00117_tenant_modulo_solo_operador.sql
-- UP: `tenant_modulo` pasa a ser de solo lectura para `authenticated`.
--     Qué módulos tiene un tenant es lo que el cliente contrató, y lo cambia
--     el operador con service-role (`provision-tenant`). Hasta acá la policy
--     `for all` de 00003 y el grant de `sp_toggle_tenant_modulo` (00086)
--     dejaban que el admin del tenant se habilitara un módulo que no pagó,
--     por PostgREST directo o llamando al SP.
-- DOWN:
--   drop policy if exists tenant_modulo_select_own_tenant on tenant_modulo;
--   create policy tenant_modulo_all_own_tenant on tenant_modulo for all to authenticated
--     using (id_tenant = auth_tenant_id())
--     with check (id_tenant = auth_tenant_id());
--   grant insert, update, delete on tenant_modulo to authenticated;
--   grant execute on function sp_toggle_tenant_modulo(uuid, boolean, inet) to authenticated;

drop policy if exists tenant_modulo_all_own_tenant on tenant_modulo;

-- Lectura sigue igual: `sp_session_context` (INVOKER) arma
-- `modulos_habilitados` leyendo esta tabla con el JWT del usuario.
create policy tenant_modulo_select_own_tenant on tenant_modulo for select to authenticated
  using (id_tenant = auth_tenant_id());

-- Sin policy de escritura RLS ya niega; el revoke lo corta antes, a nivel
-- privilegio, por si alguien vuelve a agregar una policy `for all`.
revoke insert, update, delete on tenant_modulo from authenticated, anon;

revoke execute on function sp_toggle_tenant_modulo(uuid, boolean, inet) from authenticated, anon, public;
