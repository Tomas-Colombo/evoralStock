-- 00150_rlsp_sp_ayuda.sql
-- Fase 5b-M7 de rls-por-permiso: chequeo de permiso en los 2 sp_* de Ayuda.
--
-- UP:
--   1. sp_registrar_consulta_ayuda: ayuda.consultar
--   2. sp_calificar_consulta_ayuda: ayuda.consultar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- 1. sp_registrar_consulta_ayuda
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_registrar_consulta_ayuda(
  p_id_conversacion uuid,
  p_pregunta        text,
  p_respuesta       text,
  p_entrada_id      text,
  p_resultado       text
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_usuario uuid := auth.uid();
  v_id      uuid;
begin
  if not (select auth_tiene_permiso('ayuda', 'consultar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not fn_modulo_habilitado(v_tenant, 'ayuda') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  insert into consulta_ayuda (
    id_tenant,
    id_usuario,
    id_conversacion,
    pregunta,
    respuesta,
    entrada_id,
    resultado
  ) values (
    v_tenant,
    v_usuario,
    p_id_conversacion,
    p_pregunta,
    p_respuesta,
    p_entrada_id,
    p_resultado
  ) returning id_consulta_ayuda into v_id;

  return v_id;
end;
$$;

revoke all on function sp_registrar_consulta_ayuda(uuid, text, text, text, text) from public, anon;
grant execute on function sp_registrar_consulta_ayuda(uuid, text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. sp_calificar_consulta_ayuda
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_calificar_consulta_ayuda(
  p_id   uuid,
  p_util boolean
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid := auth_tenant_id();
  v_usuario uuid := auth.uid();
begin
  if not (select auth_tiene_permiso('ayuda', 'consultar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not fn_modulo_habilitado(v_tenant, 'ayuda') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  update consulta_ayuda
     set util = p_util
   where id_consulta_ayuda = p_id
     and id_tenant = v_tenant
     and id_usuario = v_usuario
     and resultado = 'respondida';

  if not found then
    raise exception 'consulta-no-encontrada' using errcode = '42704';
  end if;
end;
$$;

revoke all on function sp_calificar_consulta_ayuda(uuid, boolean) from public, anon;
grant execute on function sp_calificar_consulta_ayuda(uuid, boolean) to authenticated;

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 1. sp_registrar_consulta_ayuda (00127_ayuda.sql:110)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_registrar_consulta_ayuda(
--   p_id_conversacion uuid,
--   p_pregunta        text,
--   p_respuesta       text,
--   p_entrada_id      text,
--   p_resultado       text
-- ) returns uuid
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_usuario uuid := auth.uid();
--   v_id      uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not fn_modulo_habilitado(v_tenant, 'ayuda') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   insert into consulta_ayuda (
--     id_tenant,
--     id_usuario,
--     id_conversacion,
--     pregunta,
--     respuesta,
--     entrada_id,
--     resultado
--   ) values (
--     v_tenant,
--     v_usuario,
--     p_id_conversacion,
--     p_pregunta,
--     p_respuesta,
--     p_entrada_id,
--     p_resultado
--   ) returning id_consulta_ayuda into v_id;
--
--   return v_id;
-- end;
-- $$;
--
-- revoke all on function sp_registrar_consulta_ayuda(uuid, text, text, text, text) from public, anon;
-- grant execute on function sp_registrar_consulta_ayuda(uuid, text, text, text, text) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: 2. sp_calificar_consulta_ayuda (00127_ayuda.sql:160)
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_calificar_consulta_ayuda(
--   p_id   uuid,
--   p_util boolean
-- ) returns void
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_usuario uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not fn_modulo_habilitado(v_tenant, 'ayuda') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   update consulta_ayuda
--      set util = p_util
--    where id_consulta_ayuda = p_id
--      and id_tenant = v_tenant
--      and id_usuario = v_usuario
--      and resultado = 'respondida';
--
--   if not found then
--     raise exception 'consulta-no-encontrada' using errcode = '42704';
--   end if;
-- end;
-- $$;
--
-- revoke all on function sp_calificar_consulta_ayuda(uuid, boolean) from public, anon;
-- grant execute on function sp_calificar_consulta_ayuda(uuid, boolean) to authenticated;
