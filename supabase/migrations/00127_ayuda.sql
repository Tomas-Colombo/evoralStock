-- 00127_ayuda.sql
-- Módulo ayuda, tabla consulta_ayuda, paquete opcional y SPs de registro y calificación (REQ-AYUDA-10/11, spec §5)
--
-- UP:
--   1. Registra módulo 'ayuda' en tabla modulo.
--   2. Actualiza fn_codigos_paquete para incluir paquete 'ayuda'.
--   3. Asigna permiso 'ayuda.consultar' al rol Administrador en todos los tenants.
--   4. Crea tabla consulta_ayuda con checks, RLS, índice y grants restringidos (sin delete).
--   5. Crea sp_registrar_consulta_ayuda (INVOKER, valida tenant_id y fn_modulo_habilitado).
--   6. Crea sp_calificar_consulta_ayuda (INVOKER, actualiza util en fila propia respondida).
--
-- DOWN:
-- delete from tenant_modulo where id_modulo in (select id_modulo from modulo where codigo = 'ayuda');
-- update rol set permisos = permisos - 'ayuda' where nombre = 'Administrador';
-- create or replace function fn_codigos_paquete(p_paquete text)
-- returns text[]
-- language sql
-- immutable
-- parallel safe
-- set search_path = public
-- as $$
--   select case p_paquete
--     when 'revendedoras' then array['revendedoras']::text[]
--     when 'consignacionProveedor' then array['consignaciones', 'rendiciones']::text[]
--     else null
--   end;
-- $$;
-- revoke all on function fn_codigos_paquete(text) from authenticated, anon, public;
-- drop function if exists sp_calificar_consulta_ayuda(uuid, boolean);
-- drop function if exists sp_registrar_consulta_ayuda(uuid, text, text, text, text);
-- drop table if exists consulta_ayuda cascade;
-- delete from modulo where codigo = 'ayuda';

-- 1. Módulo ayuda (sin tenant_modulo; paquete opcional controlado por el operador)
insert into modulo (codigo, nombre) values ('ayuda', 'Ayuda');

-- 2. Paquete opcional en fn_codigos_paquete
create or replace function fn_codigos_paquete(p_paquete text)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  select case p_paquete
    when 'revendedoras' then array['revendedoras']::text[]
    when 'consignacionProveedor' then array['consignaciones', 'rendiciones']::text[]
    when 'ayuda' then array['ayuda']::text[]
    else null
  end;
$$;

revoke all on function fn_codigos_paquete(text) from authenticated, anon, public;

-- 3. Permiso ayuda.consultar a roles Administrador de todos los tenants (spec §5.4)
update rol
set permisos = permisos || '{"ayuda": ["consultar"]}'::jsonb
where nombre = 'Administrador';

-- 4. Tabla consulta_ayuda
create table if not exists consulta_ayuda (
  id_consulta_ayuda  uuid primary key default gen_random_uuid(),
  id_tenant          uuid not null references tenant(id_tenant) on delete cascade,
  id_usuario         uuid not null references usuario(id_usuario) on delete cascade,
  id_conversacion    uuid not null,
  pregunta           text not null,
  respuesta          text,
  entrada_id         text,
  resultado          text not null,
  util               boolean,
  created_at         timestamptz not null default now(),

  constraint consulta_ayuda_pregunta_check
    check (char_length(pregunta) between 1 and 300),

  constraint consulta_ayuda_respuesta_check
    check (respuesta is null or char_length(respuesta) <= 2000),

  constraint consulta_ayuda_entrada_id_check
    check (entrada_id is null or char_length(entrada_id) <= 64),

  constraint consulta_ayuda_resultado_check
    check (resultado in ('respondida', 'fuera_de_opciones', 'error')),

  constraint consulta_ayuda_resultado_entrada_check
    check ((resultado = 'respondida') = (entrada_id is not null))
);

create index if not exists idx_consulta_ayuda_tenant_created
  on consulta_ayuda (id_tenant, created_at desc);

alter table consulta_ayuda enable row level security;

create policy consulta_ayuda_tenant on consulta_ayuda
  for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

revoke all on consulta_ayuda from public, anon;
grant select, insert on consulta_ayuda to authenticated;
grant update (util) on consulta_ayuda to authenticated;

-- 5. sp_registrar_consulta_ayuda (INVOKER)
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

-- 6. sp_calificar_consulta_ayuda (INVOKER)
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
