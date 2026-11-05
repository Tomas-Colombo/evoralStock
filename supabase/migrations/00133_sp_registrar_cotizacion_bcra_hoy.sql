-- 00133_sp_registrar_cotizacion_bcra_hoy.sql
-- Redefinir sp_registrar_cotizacion_bcra sin p_fecha:
-- la fecha 'hoy' se resuelve adentro con tenant.zona_horaria.
--
-- DOWN:
-- drop function if exists sp_registrar_cotizacion_bcra(numeric, date, boolean);
-- create or replace function sp_registrar_cotizacion_bcra(
--   p_fecha date,
--   p_valor numeric,
--   p_fecha_valor date,
--   p_desactualizada boolean
-- )
-- returns void
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
-- 
--   if p_fecha is null then
--     raise exception 'fecha-invalida' using errcode = '22023';
--   end if;
-- 
--   if p_valor is null or p_valor <= 0 then
--     raise exception 'valor-invalido' using errcode = '22023';
--   end if;
-- 
--   if p_fecha_valor is null then
--     raise exception 'fecha-invalida' using errcode = '22023';
--   end if;
-- 
--   insert into cotizacion_dolar (
--     id_tenant,
--     fecha,
--     valor,
--     origen,
--     fecha_valor,
--     desactualizada,
--     id_usuario,
--     created_at
--   ) values (
--     v_tenant,
--     p_fecha,
--     p_valor,
--     'bcra',
--     p_fecha_valor,
--     coalesce(p_desactualizada, false),
--     null,
--     now()
--   )
--   on conflict (id_tenant, fecha, origen)
--   do update set valor = excluded.valor,
--                 fecha_valor = excluded.fecha_valor,
--                 desactualizada = excluded.desactualizada,
--                 created_at = excluded.created_at;
-- end;
-- $$;
-- revoke all on function sp_registrar_cotizacion_bcra(date, numeric, date, boolean) from public, anon;
-- grant execute on function sp_registrar_cotizacion_bcra(date, numeric, date, boolean) to authenticated;

drop function if exists sp_registrar_cotizacion_bcra(date, numeric, date, boolean);

create or replace function sp_registrar_cotizacion_bcra(
  p_valor numeric,
  p_fecha_valor date,
  p_desactualizada boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_hoy date;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor-invalido' using errcode = '22023';
  end if;

  if p_fecha_valor is null then
    raise exception 'fecha-invalida' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from tenant
   where id_tenant = v_tenant;

  insert into cotizacion_dolar (
    id_tenant,
    fecha,
    valor,
    origen,
    fecha_valor,
    desactualizada,
    id_usuario,
    created_at
  ) values (
    v_tenant,
    v_hoy,
    p_valor,
    'bcra',
    p_fecha_valor,
    coalesce(p_desactualizada, false),
    null,
    now()
  )
  on conflict (id_tenant, fecha, origen)
  do update set valor = excluded.valor,
                fecha_valor = excluded.fecha_valor,
                desactualizada = excluded.desactualizada,
                created_at = excluded.created_at;
end;
$$;

revoke all on function sp_registrar_cotizacion_bcra(numeric, date, boolean) from public, anon;
grant execute on function sp_registrar_cotizacion_bcra(numeric, date, boolean) to authenticated;
