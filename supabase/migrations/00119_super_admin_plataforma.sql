-- 00119_super_admin_plataforma.sql
-- Panel de administración de plataforma (super admin).
-- Migración para gestión de cuenta corriente de tenants, módulos por paquete y aislamiento estricto.
-- REQ-SA-03, REQ-SA-04, REQ-SA-05, REQ-SA-06, REQ-SA-07, REQ-SA-08. DR-SA-01..05.
--
-- UP:
--   1. Tabla superadmin (allowlist de IDs de auth.users con RLS y sin policies).
--   2. Tabla tenant_cargo (append-only de cargos a tenants).
--   3. Tabla tenant_pago (append-only de pagos de tenants, sin check inmutable de fecha).
--   4. Vista tenant_saldo (with security_invoker = on, cálculo dinámico de saldo).
--   5. Trigger tr_semilla_comision_revendedoras (semilla 0% local al activar revendedoras, 00086:241-260).
--   6. Funciones y procedimientos:
--      - fn_codigos_paquete(p_paquete text) returns text[]
--      - sp_registrar_cargo_tenant(p_id_tenant, p_periodo, p_monto, p_concepto, p_created_by)
--      - sp_registrar_pago_tenant(p_id_tenant, p_fecha, p_monto, p_medio, p_nota, p_created_by)
--      - sp_anular_movimiento_tenant(p_tipo, p_id_movimiento, p_anulado_por)
--      - sp_toggle_tenant_modulo_admin(p_id_tenant, p_paquete, p_habilitado, p_actor, p_ip)
--   7. RLS y revocación de permisos a authenticated, anon y public.
--
-- DOWN:
-- drop function if exists sp_toggle_tenant_modulo_admin(uuid, text, boolean, uuid, inet);
-- drop function if exists fn_codigos_paquete(text);
-- drop function if exists sp_anular_movimiento_tenant(text, uuid, uuid);
-- drop function if exists sp_registrar_pago_tenant(uuid, date, numeric, text, text, uuid);
-- drop function if exists sp_registrar_cargo_tenant(uuid, date, numeric, text, uuid);
-- drop trigger if exists tr_semilla_comision_revendedoras on tenant_modulo;
-- drop function if exists fn_semilla_comision_revendedoras();
-- drop view if exists tenant_saldo;
-- drop table if exists tenant_pago;
-- drop table if exists tenant_cargo;
-- drop table if exists superadmin;

-- ─── 1. TABLA superadmin ─────────────────────────────────────────────
create table if not exists superadmin (
  id_auth_user uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table superadmin enable row level security;
revoke all on superadmin from authenticated, anon, public;

-- ─── 2. TABLA tenant_cargo ───────────────────────────────────────────
create table if not exists tenant_cargo (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null references tenant(id_tenant) on delete cascade,
  periodo date not null check (periodo = date_trunc('month', periodo)::date),
  monto numeric(12,2) not null check (monto > 0),
  concepto text not null check (trim(concepto) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id),
  check ((anulado_at is null and anulado_por is null) or (anulado_at is not null and anulado_por is not null))
);

create index if not exists idx_tenant_cargo_tenant_periodo on tenant_cargo(id_tenant, periodo);
create index if not exists idx_tenant_cargo_anulado on tenant_cargo(id_tenant) where anulado_at is null;

alter table tenant_cargo enable row level security;
revoke all on tenant_cargo from authenticated, anon, public;

-- ─── 3. TABLA tenant_pago ────────────────────────────────────────────
create table if not exists tenant_pago (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null references tenant(id_tenant) on delete cascade,
  fecha date not null,
  monto numeric(12,2) not null check (monto > 0),
  medio text not null check (medio in ('transferencia', 'efectivo', 'mercadopago', 'otro')),
  nota text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id),
  check ((anulado_at is null and anulado_por is null) or (anulado_at is not null and anulado_por is not null))
);

create index if not exists idx_tenant_pago_tenant_fecha on tenant_pago(id_tenant, fecha);
create index if not exists idx_tenant_pago_anulado on tenant_pago(id_tenant) where anulado_at is null;

alter table tenant_pago enable row level security;
revoke all on tenant_pago from authenticated, anon, public;

-- ─── 4. VISTA tenant_saldo ───────────────────────────────────────────
create or replace view tenant_saldo
with (security_invoker = on) as
select
  t.id_tenant,
  coalesce(c.total_cargos, 0) - coalesce(p.total_pagos, 0) as saldo,
  coalesce(c.total_cargos, 0) as total_cargos,
  coalesce(p.total_pagos, 0) as total_pagos
from tenant t
left join (
  select id_tenant, sum(monto) as total_cargos
  from tenant_cargo
  where anulado_at is null
  group by id_tenant
) c on c.id_tenant = t.id_tenant
left join (
  select id_tenant, sum(monto) as total_pagos
  from tenant_pago
  where anulado_at is null
  group by id_tenant
) p on p.id_tenant = t.id_tenant;

revoke all on tenant_saldo from authenticated, anon, public;

-- ─── 5. TRIGGER SEMILLA COMISIÓN (00086:241-260) ─────────────────────
create or replace function fn_semilla_comision_revendedoras()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codigo   text;
  v_id_regla uuid;
begin
  if NEW.habilitado = true and (TG_OP = 'INSERT' or coalesce(OLD.habilitado, false) = false) then
    select codigo into v_codigo from modulo where id_modulo = NEW.id_modulo;
    if v_codigo = 'revendedoras' then
      -- Semilla de regla general (porcentaje 0 para local, DR-6) al habilitar revendedoras
      -- Copiado fielmente de supabase/migrations/00086_comisiones.sql:241-260
      if not exists (
        select 1 from regla_comision
        where id_tenant = NEW.id_tenant
          and ambito = 'local'
          and id_revendedora is null
      ) then
        insert into regla_comision(id_tenant, ambito, nombre, vigente_desde, activo)
        values (NEW.id_tenant, 'local', 'Comisión Local (Semilla 0%)', current_date, true)
        returning id_regla into v_id_regla;

        insert into escala_comision(id_tenant, id_regla, objetivo_desde, porcentaje)
        values (NEW.id_tenant, v_id_regla, 0, 0);
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function fn_semilla_comision_revendedoras() from authenticated, anon, public;

create trigger tr_semilla_comision_revendedoras
  after insert or update of habilitado on tenant_modulo
  for each row
  execute function fn_semilla_comision_revendedoras();

-- ─── 6. PROCEDIMIENTOS ALMACENADOS ───────────────────────────────────

-- 6.1 Fuente única de verdad para códigos de paquete funcional
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
    else null
  end;
$$;

revoke all on function fn_codigos_paquete(text) from authenticated, anon, public;

-- 6.2 Registro de cargo
create or replace function sp_registrar_cargo_tenant(
  p_id_tenant  uuid,
  p_periodo    date,
  p_monto      numeric,
  p_concepto   text,
  p_created_by uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Validación de actor superadmin
  if p_created_by is null or not exists (
    select 1 from superadmin where id_auth_user = p_created_by
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de existencia del tenant
  if p_id_tenant is null or not exists (
    select 1 from tenant where id_tenant = p_id_tenant
  ) then
    raise exception 'tenant-inexistente' using errcode = 'P0001';
  end if;

  -- Validación de monto positivo
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto-invalido' using errcode = 'P0001';
  end if;

  -- Validación de período (primer día de mes)
  if p_periodo is null or p_periodo <> date_trunc('month', p_periodo)::date then
    raise exception 'periodo-invalido' using errcode = 'P0001';
  end if;

  -- Validación de concepto no vacío
  if p_concepto is null or trim(p_concepto) = '' then
    raise exception 'concepto-invalido' using errcode = 'P0001';
  end if;

  insert into tenant_cargo (
    id_tenant,
    periodo,
    monto,
    concepto,
    created_by
  ) values (
    p_id_tenant,
    p_periodo,
    p_monto,
    trim(p_concepto),
    p_created_by
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function sp_registrar_cargo_tenant(uuid, date, numeric, text, uuid) from authenticated, anon, public;

-- 6.3 Registro de pago
create or replace function sp_registrar_pago_tenant(
  p_id_tenant  uuid,
  p_fecha      date,
  p_monto      numeric,
  p_medio      text,
  p_nota       text,
  p_created_by uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Validación de actor superadmin
  if p_created_by is null or not exists (
    select 1 from superadmin where id_auth_user = p_created_by
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de existencia del tenant
  if p_id_tenant is null or not exists (
    select 1 from tenant where id_tenant = p_id_tenant
  ) then
    raise exception 'tenant-inexistente' using errcode = 'P0001';
  end if;

  -- Validación de monto positivo
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto-invalido' using errcode = 'P0001';
  end if;

  -- Validación de fecha (no futura)
  if p_fecha is null or p_fecha > current_date then
    raise exception 'fecha-invalida' using errcode = 'P0001';
  end if;

  -- Validación de medio de pago contra catálogo cerrado
  if p_medio is null or p_medio not in ('transferencia', 'efectivo', 'mercadopago', 'otro') then
    raise exception 'medio-pago-invalido' using errcode = 'P0001';
  end if;

  insert into tenant_pago (
    id_tenant,
    fecha,
    monto,
    medio,
    nota,
    created_by
  ) values (
    p_id_tenant,
    p_fecha,
    p_monto,
    p_medio,
    nullif(trim(p_nota), ''),
    p_created_by
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function sp_registrar_pago_tenant(uuid, date, numeric, text, text, uuid) from authenticated, anon, public;

-- 6.4 Anulación de movimiento (cargo o pago)
create or replace function sp_anular_movimiento_tenant(
  p_tipo          text,
  p_id_movimiento uuid,
  p_anulado_por   uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_anulado_at timestamptz;
begin
  -- Validación de actor superadmin
  if p_anulado_por is null or not exists (
    select 1 from superadmin where id_auth_user = p_anulado_por
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de tipo de movimiento
  if p_tipo is null or p_tipo not in ('cargo', 'pago') then
    raise exception 'tipo-movimiento-invalido' using errcode = 'P0001';
  end if;

  if p_tipo = 'cargo' then
    select anulado_at into v_anulado_at
      from tenant_cargo
     where id = p_id_movimiento;

    if not found then
      raise exception 'movimiento-inexistente' using errcode = 'P0001';
    end if;

    if v_anulado_at is not null then
      raise exception 'movimiento-ya-anulado' using errcode = 'P0001';
    end if;

    update tenant_cargo
       set anulado_at = now(),
           anulado_por = p_anulado_por
     where id = p_id_movimiento;

  elsif p_tipo = 'pago' then
    select anulado_at into v_anulado_at
      from tenant_pago
     where id = p_id_movimiento;

    if not found then
      raise exception 'movimiento-inexistente' using errcode = 'P0001';
    end if;

    if v_anulado_at is not null then
      raise exception 'movimiento-ya-anulado' using errcode = 'P0001';
    end if;

    update tenant_pago
       set anulado_at = now(),
           anulado_por = p_anulado_por
     where id = p_id_movimiento;
  end if;
end;
$$;

revoke all on function sp_anular_movimiento_tenant(text, uuid, uuid) from authenticated, anon, public;

-- 6.5 Toggle de paquetes opcionales para administración de plataforma
create or replace function sp_toggle_tenant_modulo_admin(
  p_id_tenant  uuid,
  p_paquete    text,
  p_habilitado boolean,
  p_actor      uuid,
  p_ip         inet default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codigos   text[];
  v_codigo    text;
  v_id_modulo uuid;
begin
  -- Validación de actor superadmin
  if p_actor is null or not exists (
    select 1 from superadmin where id_auth_user = p_actor
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Validación de existencia del tenant
  if p_id_tenant is null or not exists (
    select 1 from tenant where id_tenant = p_id_tenant
  ) then
    raise exception 'tenant-inexistente' using errcode = 'P0001';
  end if;

  -- Validación del paquete funcional
  v_codigos := fn_codigos_paquete(p_paquete);
  if v_codigos is null or array_length(v_codigos, 1) is null then
    raise exception 'paquete-invalido' using errcode = 'P0001';
  end if;

  -- Alternar todos los módulos del paquete atómicamente.
  -- Las guardas de integridad (núcleo inmutable, consistencia de a par del paquete consignación,
  -- y estado vivo) son impuestas por los triggers de 00118.
  -- La siembra de comisión al habilitar revendedoras la ejecuta el trigger tr_semilla_comision_revendedoras.
  foreach v_codigo in array v_codigos loop
    select id_modulo into v_id_modulo from modulo where codigo = v_codigo;
    if v_id_modulo is null then
      raise exception 'modulo-desconocido' using errcode = 'P0001';
    end if;

    insert into tenant_modulo (id_tenant, id_modulo, habilitado)
    values (p_id_tenant, v_id_modulo, p_habilitado)
    on conflict (id_tenant, id_modulo)
    do update set habilitado = excluded.habilitado;

    insert into auditoria (
      id_tenant,
      id_usuario,
      entidad,
      entidad_id,
      accion,
      cambios,
      ip
    ) values (
      p_id_tenant,
      p_actor,
      'tenant_modulo',
      v_id_modulo::text,
      case when p_habilitado then 'habilitar' else 'deshabilitar' end,
      jsonb_build_object('habilitado', p_habilitado, 'paquete', p_paquete),
      p_ip
    );
  end loop;
end;
$$;

revoke all on function sp_toggle_tenant_modulo_admin(uuid, text, boolean, uuid, inet) from authenticated, anon, public;
