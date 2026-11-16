-- 00165_ayuda_v2.sql
-- Límite, cuota diaria atómica y telemetría de ayuda v2 (REQ-AYUDA-V2-11/12, spec §5)
--
-- UP:
--   1. Tabla limite_ayuda_tenant con RLS y policies restrictivas (revendedora + permiso).
--   2. Tabla cuota_ayuda_diaria con triggers anti-adulteración trg_guardia_insert_cuota_ayuda y trg_guardia_update_cuota_ayuda.
--   3. sp_reservar_cuota_ayuda (SECURITY INVOKER) con chequeo de límite y reserva atómica.
--   4. Extensión de consulta_ayuda: entradas_citadas text[], telemetría y checks actualizados.
--   5. sp_registrar_consulta_ayuda (SECURITY INVOKER) con nueva firma (entradas_citadas y telemetría).
--
-- DOWN:
-- alter table consulta_ayuda add column if not exists entrada_id text;
--
-- update consulta_ayuda
-- set entrada_id = case
--   when cardinality(entradas_citadas) > 0 then entradas_citadas[1]
--   else null
-- end;
--
-- update consulta_ayuda
-- set resultado = case
--   when entrada_id is not null then 'respondida'
--   else 'fuera_de_opciones'
-- end
-- where resultado = 'sin_cita';
--
-- update consulta_ayuda
-- set resultado = 'fuera_de_opciones', entrada_id = null
-- where resultado = 'sin_llm';
--
-- update consulta_ayuda
-- set entrada_id = null
-- where resultado in ('fuera_de_opciones', 'error');
--
-- alter table consulta_ayuda drop constraint if exists consulta_ayuda_entradas_citadas_check;
-- alter table consulta_ayuda drop constraint if exists consulta_ayuda_resultado_check;
-- alter table consulta_ayuda drop constraint if exists consulta_ayuda_respuesta_check;
-- alter table consulta_ayuda drop column if exists entradas_citadas cascade;
-- alter table consulta_ayuda drop column if exists tipo_error cascade;
-- alter table consulta_ayuda drop column if exists latencia_ms cascade;
-- alter table consulta_ayuda drop column if exists modelo cascade;
-- alter table consulta_ayuda drop column if exists tokens_input cascade;
-- alter table consulta_ayuda drop column if exists tokens_output cascade;
-- alter table consulta_ayuda drop column if exists tokens_cached cascade;
-- alter table consulta_ayuda drop column if exists tokens_thinking cascade;
--
-- NOTE: el rollback recorta las respuestas de v2 para cumplir con el check original.
-- update consulta_ayuda set respuesta = left(respuesta, 2000)
--   where char_length(respuesta) > 2000;
--
-- alter table consulta_ayuda add constraint consulta_ayuda_respuesta_check
--   check (respuesta is null or char_length(respuesta) <= 2000);
--
-- alter table consulta_ayuda add constraint consulta_ayuda_entrada_id_check
--   check (entrada_id is null or char_length(entrada_id) <= 64);
--
-- alter table consulta_ayuda add constraint consulta_ayuda_resultado_check
--   check (resultado in ('respondida', 'fuera_de_opciones', 'error'));
--
-- alter table consulta_ayuda add constraint consulta_ayuda_resultado_entrada_check
--   check ((resultado = 'respondida') = (entrada_id is not null));
--
-- drop function if exists sp_registrar_consulta_ayuda(uuid, text, text, text[], text, text, integer, text, integer, integer, integer, integer);
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
--   if not (select auth_tiene_permiso('ayuda', 'consultar')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
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
-- drop function if exists sp_reservar_cuota_ayuda();
-- drop trigger if exists trg_guardia_update_cuota_ayuda on cuota_ayuda_diaria;
-- drop function if exists fn_guardia_update_cuota_ayuda();
-- drop trigger if exists trg_guardia_insert_cuota_ayuda on cuota_ayuda_diaria;
-- drop function if exists fn_guardia_insert_cuota_ayuda();
-- drop table if exists cuota_ayuda_diaria cascade;
-- drop table if exists limite_ayuda_tenant cascade;

-- 1. Tabla limite_ayuda_tenant
create table if not exists limite_ayuda_tenant (
  id_tenant      uuid primary key references tenant(id_tenant) on delete cascade,
  limite_diario  integer not null default 100,
  created_at     timestamptz not null default now(),
  constraint limite_ayuda_tenant_limite_check check (limite_diario >= 0)
);

alter table limite_ayuda_tenant enable row level security;

create policy limite_ayuda_tenant_tenant on limite_ayuda_tenant
  for select to authenticated
  using (id_tenant = auth_tenant_id());

create policy restrict_revendedora_limite_ayuda_tenant on limite_ayuda_tenant
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy restrict_permiso_limite_ayuda_tenant on limite_ayuda_tenant
  as restrictive for all to authenticated
  using ((select auth_tiene_permiso('ayuda', 'consultar')));

revoke all on limite_ayuda_tenant from public, anon;
grant select on limite_ayuda_tenant to authenticated;
revoke insert, update, delete on limite_ayuda_tenant from authenticated;

-- 2. Tabla cuota_ayuda_diaria y triggers
create table if not exists cuota_ayuda_diaria (
  id_tenant             uuid not null references tenant(id_tenant) on delete cascade,
  fecha                 date not null,
  consultas_realizadas  integer not null default 0,
  created_at            timestamptz not null default now(),
  primary key (id_tenant, fecha)
);

alter table cuota_ayuda_diaria enable row level security;

create policy cuota_ayuda_diaria_tenant on cuota_ayuda_diaria
  for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

create policy restrict_revendedora_cuota_ayuda_diaria on cuota_ayuda_diaria
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy restrict_permiso_cuota_ayuda_diaria on cuota_ayuda_diaria
  as restrictive for all to authenticated
  using ((select auth_tiene_permiso('ayuda', 'consultar')));

revoke all on cuota_ayuda_diaria from public, anon;
grant select, insert (id_tenant, fecha, consultas_realizadas), update (consultas_realizadas)
  on cuota_ayuda_diaria to authenticated;
revoke delete on cuota_ayuda_diaria from authenticated;

create or replace function fn_guardia_insert_cuota_ayuda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.fecha := fn_hoy_tenant();
  if new.consultas_realizadas not in (0, 1) then
    raise exception 'cuota-insert-invalido' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_guardia_insert_cuota_ayuda
  before insert on cuota_ayuda_diaria
  for each row execute function fn_guardia_insert_cuota_ayuda();

create or replace function fn_guardia_update_cuota_ayuda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.consultas_realizadas <= old.consultas_realizadas then
    raise exception 'cuota-decremento-prohibido' using errcode = '42501';
  end if;
  if new.id_tenant is distinct from old.id_tenant or new.fecha is distinct from old.fecha then
    raise exception 'cuota-modificacion-invalida' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_guardia_update_cuota_ayuda
  before update on cuota_ayuda_diaria
  for each row execute function fn_guardia_update_cuota_ayuda();

-- 3. sp_reservar_cuota_ayuda
create or replace function sp_reservar_cuota_ayuda() returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_limite integer;
  v_res    integer;
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

  select coalesce(limite_diario, 100) into v_limite
  from limite_ayuda_tenant where id_tenant = v_tenant;
  if v_limite is null then
    v_limite := 100;
  end if;

  if v_limite < 1 then
    raise exception 'cuota-excedida' using errcode = 'P0001';
  end if;

  insert into cuota_ayuda_diaria (id_tenant, fecha, consultas_realizadas)
  values (v_tenant, fn_hoy_tenant(), 1)
  on conflict (id_tenant, fecha) do update
    set consultas_realizadas = cuota_ayuda_diaria.consultas_realizadas + 1
    where cuota_ayuda_diaria.consultas_realizadas < v_limite
  returning consultas_realizadas into v_res;

  if v_res is null then
    raise exception 'cuota-excedida' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function sp_reservar_cuota_ayuda() from public, anon;
grant execute on function sp_reservar_cuota_ayuda() to authenticated;

-- 4. Modificación de consulta_ayuda
alter table consulta_ayuda add column if not exists entradas_citadas text[] not null default array[]::text[];

update consulta_ayuda
set entradas_citadas = case
  when entrada_id is not null then array[entrada_id]
  else array[]::text[]
end;

alter table consulta_ayuda drop constraint if exists consulta_ayuda_resultado_entrada_check;
alter table consulta_ayuda drop constraint if exists consulta_ayuda_resultado_check;
alter table consulta_ayuda drop constraint if exists consulta_ayuda_entrada_id_check;
alter table consulta_ayuda drop constraint if exists consulta_ayuda_respuesta_check;

alter table consulta_ayuda add constraint consulta_ayuda_resultado_check
  check (resultado in ('respondida', 'sin_cita', 'sin_llm', 'fuera_de_opciones', 'error'));

-- Elección y justificación: 5.000 caracteres en DB para cubrir maxOutputTokens sin truncar datos de calidad en DAL
alter table consulta_ayuda add constraint consulta_ayuda_respuesta_check
  check (respuesta is null or char_length(respuesta) <= 5000);

alter table consulta_ayuda add constraint consulta_ayuda_entradas_citadas_check
  check (coalesce(cardinality(entradas_citadas), 0) <= 6 and array_to_string(entradas_citadas, ',') !~ '[^,]{65,}');

alter table consulta_ayuda drop column if exists entrada_id;

alter table consulta_ayuda add column if not exists tipo_error text;
alter table consulta_ayuda add column if not exists latencia_ms integer;
alter table consulta_ayuda add column if not exists modelo text;
alter table consulta_ayuda add column if not exists tokens_input integer;
alter table consulta_ayuda add column if not exists tokens_output integer;
alter table consulta_ayuda add column if not exists tokens_cached integer;
alter table consulta_ayuda add column if not exists tokens_thinking integer;

-- 5. Drop de firma anterior de sp_registrar_consulta_ayuda y recreación
drop function if exists sp_registrar_consulta_ayuda(uuid, text, text, text, text);

create or replace function sp_registrar_consulta_ayuda(
  p_id_conversacion uuid,
  p_pregunta        text,
  p_respuesta       text,
  p_entradas_citadas text[],
  p_resultado       text,
  p_tipo_error      text default null,
  p_latencia_ms     integer default null,
  p_modelo          text default null,
  p_tokens_input    integer default null,
  p_tokens_output   integer default null,
  p_tokens_cached   integer default null,
  p_tokens_thinking integer default null
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
    entradas_citadas,
    resultado,
    tipo_error,
    latencia_ms,
    modelo,
    tokens_input,
    tokens_output,
    tokens_cached,
    tokens_thinking
  ) values (
    v_tenant,
    v_usuario,
    p_id_conversacion,
    p_pregunta,
    p_respuesta,
    coalesce(p_entradas_citadas, array[]::text[]),
    p_resultado,
    p_tipo_error,
    p_latencia_ms,
    p_modelo,
    p_tokens_input,
    p_tokens_output,
    p_tokens_cached,
    p_tokens_thinking
  ) returning id_consulta_ayuda into v_id;

  return v_id;
end;
$$;

revoke all on function sp_registrar_consulta_ayuda(uuid, text, text, text[], text, text, integer, text, integer, integer, integer, integer) from public, anon;
grant execute on function sp_registrar_consulta_ayuda(uuid, text, text, text[], text, text, integer, text, integer, integer, integer, integer) to authenticated;
