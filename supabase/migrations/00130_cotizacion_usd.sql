-- 00130_cotizacion_usd.sql
-- Modelo de datos, RLS restrictiva y SPs para cotización USD (Slice 2).
-- Tablas cotizacion_config y cotizacion_dolar, campos en costo_producto e ingreso_mercaderia_detalle.
-- Funciones INVOKER sp_get_cotizacion_vigente, sp_set_cotizacion_manual, sp_set_modo_cotizacion, sp_registrar_cotizacion_bcra.
--
-- DOWN:
-- drop function if exists sp_registrar_cotizacion_bcra(date, numeric, date, boolean);
-- drop function if exists sp_set_modo_cotizacion(text, inet);
-- drop function if exists sp_set_cotizacion_manual(numeric, inet);
-- drop function if exists sp_get_cotizacion_vigente();
-- alter table ingreso_mercaderia_detalle drop column if exists cotizacion_fecha_valor, drop column if exists cotizacion_aplicada, drop column if exists costo_original_usd;
-- alter table costo_producto drop column if exists cotizacion_fecha_valor, drop column if exists cotizacion_aplicada, drop column if exists costo_original_usd;
-- drop table if exists cotizacion_dolar;
-- drop table if exists cotizacion_config;

-- 1. Tabla cotizacion_config
create table if not exists cotizacion_config (
  id_tenant                uuid primary key references tenant(id_tenant) on delete cascade,
  modo                     text not null default 'automatica' check (modo in ('automatica', 'manual')),
  updated_at               timestamptz not null default now(),
  id_usuario_modificacion  uuid references auth.users(id)
);

alter table cotizacion_config enable row level security;

create policy cotizacion_config_tenant on cotizacion_config for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

create policy restrict_revendedora_cotizacion_config on cotizacion_config
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

revoke all on cotizacion_config from public, anon;
grant select, insert, update on cotizacion_config to authenticated;

-- 2. Tabla cotizacion_dolar
create table if not exists cotizacion_dolar (
  id_cotizacion            uuid primary key default gen_random_uuid(),
  id_tenant                uuid not null references tenant(id_tenant) on delete cascade,
  fecha                    date not null,
  valor                    numeric(14, 4) not null check (valor > 0),
  origen                   text not null check (origen in ('bcra', 'manual')),
  fecha_valor              date not null,
  desactualizada           boolean not null default false,
  id_usuario               uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  constraint cotizacion_dolar_tenant_fecha_origen_uk unique (id_tenant, fecha, origen)
);

alter table cotizacion_dolar enable row level security;

create policy cotizacion_dolar_tenant on cotizacion_dolar for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

create policy restrict_revendedora_cotizacion_dolar on cotizacion_dolar
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

revoke all on cotizacion_dolar from public, anon;
grant select, insert, update on cotizacion_dolar to authenticated;

-- 3. Extensiones en costo_producto e ingreso_mercaderia_detalle
alter table costo_producto
  add column if not exists costo_original_usd numeric(14, 2) check (costo_original_usd is null or costo_original_usd >= 0),
  add column if not exists cotizacion_aplicada numeric(14, 4) check (cotizacion_aplicada is null or cotizacion_aplicada > 0),
  add column if not exists cotizacion_fecha_valor date;

alter table ingreso_mercaderia_detalle
  add column if not exists costo_original_usd numeric(14, 2) check (costo_original_usd is null or costo_original_usd >= 0),
  add column if not exists cotizacion_aplicada numeric(14, 4) check (cotizacion_aplicada is null or cotizacion_aplicada > 0),
  add column if not exists cotizacion_fecha_valor date;

-- 4. Stored Procedures (INVOKER)

-- 4.1. sp_get_cotizacion_vigente
create or replace function sp_get_cotizacion_vigente()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_hoy date;
  v_modo text;
  v_row record;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from tenant
   where id_tenant = v_tenant;

  select coalesce(modo, 'automatica')
    into v_modo
    from cotizacion_config
   where id_tenant = v_tenant;

  v_modo := coalesce(v_modo, 'automatica');

  if v_modo = 'manual' then
    select id_cotizacion, valor, fecha, fecha_valor, origen, desactualizada
      into v_row
      from cotizacion_dolar
     where id_tenant = v_tenant
       and origen = 'manual'
     order by fecha desc, created_at desc
     limit 1;

    if found then
      return jsonb_build_object(
        'modo', v_modo,
        'id_cotizacion', v_row.id_cotizacion,
        'valor', v_row.valor,
        'fecha', v_row.fecha,
        'fecha_valor', v_row.fecha_valor,
        'origen', v_row.origen,
        'desactualizada', v_row.desactualizada
      );
    else
      return jsonb_build_object(
        'modo', v_modo,
        'id_cotizacion', null,
        'valor', null,
        'fecha', null,
        'fecha_valor', null,
        'origen', null,
        'desactualizada', true
      );
    end if;
  else
    -- Modo automatico: busca hoy con origen 'bcra'
    select id_cotizacion, valor, fecha, fecha_valor, origen, desactualizada
      into v_row
      from cotizacion_dolar
     where id_tenant = v_tenant
       and fecha = v_hoy
       and origen = 'bcra';

    if found then
      return jsonb_build_object(
        'modo', v_modo,
        'id_cotizacion', v_row.id_cotizacion,
        'valor', v_row.valor,
        'fecha', v_row.fecha,
        'fecha_valor', v_row.fecha_valor,
        'origen', v_row.origen,
        'desactualizada', v_row.desactualizada
      );
    else
      -- Si no hay fila de hoy con origen 'bcra', busca la última disponible con origen 'bcra' marcada con desactualizada = true
      select id_cotizacion, valor, fecha, fecha_valor, origen
        into v_row
        from cotizacion_dolar
       where id_tenant = v_tenant
         and origen = 'bcra'
       order by fecha desc, created_at desc
       limit 1;

      if found then
        return jsonb_build_object(
          'modo', v_modo,
          'id_cotizacion', v_row.id_cotizacion,
          'valor', v_row.valor,
          'fecha', v_row.fecha,
          'fecha_valor', v_row.fecha_valor,
          'origen', v_row.origen,
          'desactualizada', true
        );
      else
        return jsonb_build_object(
          'modo', v_modo,
          'id_cotizacion', null,
          'valor', null,
          'fecha', null,
          'fecha_valor', null,
          'origen', null,
          'desactualizada', true
        );
      end if;
    end if;
  end if;
end;
$$;

revoke all on function sp_get_cotizacion_vigente() from public, anon;
grant execute on function sp_get_cotizacion_vigente() to authenticated;

-- 4.2. sp_set_cotizacion_manual
create or replace function sp_set_cotizacion_manual(
  p_valor numeric,
  p_ip inet
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor uuid := auth.uid();
  v_hoy date;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'cotizacion-manual-invalida' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(zona_horaria, 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from tenant
   where id_tenant = v_tenant;

  insert into cotizacion_config (
    id_tenant,
    modo,
    updated_at,
    id_usuario_modificacion
  ) values (
    v_tenant,
    'manual',
    now(),
    v_actor
  )
  on conflict (id_tenant)
  do update set modo = 'manual',
                updated_at = now(),
                id_usuario_modificacion = v_actor;

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
    'manual',
    v_hoy,
    false,
    v_actor,
    now()
  )
  on conflict (id_tenant, fecha, origen)
  do update set valor = excluded.valor,
                fecha_valor = excluded.fecha_valor,
                desactualizada = excluded.desactualizada,
                id_usuario = excluded.id_usuario,
                created_at = excluded.created_at;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'cotizacion_dolar',
    v_hoy::text || ':manual',
    'actualizar',
    jsonb_build_object('valor', p_valor, 'modo', 'manual'),
    p_ip
  );
end;
$$;

revoke all on function sp_set_cotizacion_manual(numeric, inet) from public, anon;
grant execute on function sp_set_cotizacion_manual(numeric, inet) to authenticated;

-- 4.3. sp_set_modo_cotizacion
create or replace function sp_set_modo_cotizacion(
  p_modo text,
  p_ip inet
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor uuid := auth.uid();
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_modo is null or p_modo not in ('automatica', 'manual') then
    raise exception 'modo-cotizacion-invalido' using errcode = '22023';
  end if;

  insert into cotizacion_config (
    id_tenant,
    modo,
    updated_at,
    id_usuario_modificacion
  ) values (
    v_tenant,
    p_modo,
    now(),
    v_actor
  )
  on conflict (id_tenant)
  do update set modo = p_modo,
                updated_at = now(),
                id_usuario_modificacion = v_actor;

  insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (
    v_tenant,
    v_actor,
    'cotizacion_config',
    v_tenant::text,
    'actualizar',
    jsonb_build_object('modo', p_modo),
    p_ip
  );
end;
$$;

revoke all on function sp_set_modo_cotizacion(text, inet) from public, anon;
grant execute on function sp_set_modo_cotizacion(text, inet) to authenticated;

-- 4.4. sp_registrar_cotizacion_bcra
create or replace function sp_registrar_cotizacion_bcra(
  p_fecha date,
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
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_fecha is null then
    raise exception 'fecha-invalida' using errcode = '22023';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor-invalido' using errcode = '22023';
  end if;

  if p_fecha_valor is null then
    raise exception 'fecha-invalida' using errcode = '22023';
  end if;

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
    p_fecha,
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

revoke all on function sp_registrar_cotizacion_bcra(date, numeric, date, boolean) from public, anon;
grant execute on function sp_registrar_cotizacion_bcra(date, numeric, date, boolean) to authenticated;
