-- 00162_codigo_ean.sql
-- UP: Código EAN-13 interno para unidades físicas (REQ-ETQ-02).
--     1. fn_ean13_digito(text): función pura e inmutable que calcula el dígito verificador GS1.
--     2. item_producto.codigo_ean: columna nullable inicialmente para permitir backfill.
--     3. item_ean_seq: contador correlativo por tenant con RLS estricta.
--     4. fn_asignar_codigo_ean(): trigger before insert que asigna EAN correlativo con prefijo '20' y valida inmutabilidad en update.
--     5. Backfill de filas existentes de item_producto (desactivando triggers durante el backfill para no mutar updated_at ni romper por módulos opcionales).
--     6. Constraint not null e índice único (id_tenant, codigo_ean).
--
-- DOWN:
--   drop trigger if exists item_producto_codigo_ean_tr on item_producto;
--   drop function if exists fn_asignar_codigo_ean();
--   drop policy if exists item_ean_seq_rlsp_delete on item_ean_seq;
--   drop policy if exists item_ean_seq_rlsp_update on item_ean_seq;
--   drop policy if exists item_ean_seq_rlsp_insert on item_ean_seq;
--   drop policy if exists item_ean_seq_rlsp_select on item_ean_seq;
--   drop policy if exists item_ean_seq_restrict_revendedora on item_ean_seq;
--   drop policy if exists item_ean_seq_tenant_isolation on item_ean_seq;
--   drop table if exists item_ean_seq;
--   drop index if exists item_producto_tenant_codigo_ean_uk;
--   alter table item_producto drop column if exists codigo_ean;
--   drop function if exists fn_ean13_digito(text);

-- ─── 1. fn_ean13_digito ──────────────────────────────────────────────
create or replace function fn_ean13_digito(p_12 text)
returns integer
language plpgsql
immutable
strict
as $$
declare
  v_sum integer := 0;
  v_d   integer;
  v_i   integer;
begin
  if length(p_12) <> 12 or p_12 !~ '^[0-9]{12}$' then
    raise exception 'formato-ean12-invalido' using errcode = '22023';
  end if;

  for v_i in 1..12 loop
    v_d := substr(p_12, v_i, 1)::integer;
    if (v_i % 2) = 1 then
      v_sum := v_sum + v_d;
    else
      v_sum := v_sum + (v_d * 3);
    end if;
  end loop;

  return (10 - (v_sum % 10)) % 10;
end;
$$;

revoke all on function fn_ean13_digito(text) from public, anon;
grant execute on function fn_ean13_digito(text) to authenticated;

-- ─── 2. Columna codigo_ean en item_producto ──────────────────────────
alter table item_producto add column if not exists codigo_ean text;

-- ─── 3. Tabla item_ean_seq (contador correlativo por tenant) ─────────
create table if not exists item_ean_seq (
  id_tenant uuid primary key references tenant(id_tenant) on delete cascade,
  ultimo    bigint not null default 0
);

alter table item_ean_seq enable row level security;

-- Permissive tenant isolation
create policy item_ean_seq_tenant_isolation on item_ean_seq
  for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

-- Restrictiva de revendedora (REQ-ETQ-08 N2)
create policy item_ean_seq_restrict_revendedora on item_ean_seq as restrictive
  for all to authenticated
  using (auth_revendedora_id() is null);

-- Restrictiva por comando con auth_tiene_permiso (REQ-ETQ-08, §2.2, §4)
-- Quienes insertan en item_producto son sp_confirmar_ingreso y sp_crear_stock_directo ('inventario', 'crear').
create policy item_ean_seq_rlsp_select on item_ean_seq as restrictive
  for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'crear')));

create policy item_ean_seq_rlsp_insert on item_ean_seq as restrictive
  for insert to authenticated
  with check ((select auth_tiene_permiso('inventario', 'crear')));

create policy item_ean_seq_rlsp_update on item_ean_seq as restrictive
  for update to authenticated
  using ((select auth_tiene_permiso('inventario', 'crear')))
  with check ((select auth_tiene_permiso('inventario', 'crear')));

-- DELETE solo DEFINER (nadie)
create policy item_ean_seq_rlsp_delete on item_ean_seq as restrictive
  for delete to authenticated
  using (false);

revoke all on item_ean_seq from anon, public;
grant select, insert, update on item_ean_seq to authenticated;

-- ─── 4. Trigger de asignación e inmutabilidad ────────────────────────
create or replace function fn_asignar_codigo_ean()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_seq  bigint;
  v_base text;
begin
  if TG_OP = 'UPDATE' then
    if OLD.codigo_ean is distinct from NEW.codigo_ean then
      raise exception 'codigo-ean-inmutable' using errcode = '22023';
    end if;
    return NEW;
  end if;

  -- TG_OP = 'INSERT'
  if NEW.codigo_ean is null then
    insert into item_ean_seq (id_tenant, ultimo)
    values (NEW.id_tenant, 1)
    on conflict (id_tenant)
    do update set ultimo = item_ean_seq.ultimo + 1
    returning ultimo into v_seq;

    v_base := '20' || lpad(v_seq::text, 10, '0');
    NEW.codigo_ean := v_base || fn_ean13_digito(v_base)::text;
  end if;

  return NEW;
end;
$$;

revoke all on function fn_asignar_codigo_ean() from anon, public;
grant execute on function fn_asignar_codigo_ean() to authenticated;

drop trigger if exists item_producto_codigo_ean_tr on item_producto;
create trigger item_producto_codigo_ean_tr
  before insert or update on item_producto
  for each row execute function fn_asignar_codigo_ean();

-- ─── 5. Backfill de ítems existentes ─────────────────────────────────
-- El backfill dispara item_producto_touch (00015) y tr_item_producto_consignacion (00123).
-- Deshabilitamos ambos triggers durante el backfill para:
-- 1) Preservar el valor histórico de updated_at sin alterarlo artificialmente.
-- 2) Evitar fallos por 'module-disabled' si algún ítem fue creado como consignación y el módulo está deshabilitado en este momento.
alter table item_producto disable trigger item_producto_touch;
alter table item_producto disable trigger tr_item_producto_consignacion;

do $$
declare
  v_tenant record;
  v_item   record;
  v_seq    bigint;
  v_base   text;
  v_ean    text;
begin
  for v_tenant in select distinct id_tenant from item_producto where codigo_ean is null loop
    v_seq := 0;

    -- Si ya hubiera secuencia creada para el tenant, arrancar desde allí
    select coalesce(ultimo, 0) into v_seq
      from item_ean_seq
     where id_tenant = v_tenant.id_tenant;

    for v_item in
      select id_item
        from item_producto
       where id_tenant = v_tenant.id_tenant and codigo_ean is null
       order by created_at asc, id_item asc
    loop
      v_seq := v_seq + 1;
      v_base := '20' || lpad(v_seq::text, 10, '0');
      v_ean := v_base || fn_ean13_digito(v_base)::text;

      update item_producto
         set codigo_ean = v_ean
       where id_item = v_item.id_item;
    end loop;

    insert into item_ean_seq (id_tenant, ultimo)
    values (v_tenant.id_tenant, v_seq)
    on conflict (id_tenant)
    do update set ultimo = greatest(item_ean_seq.ultimo, excluded.ultimo);
  end loop;
end;
$$;

alter table item_producto enable trigger tr_item_producto_consignacion;
alter table item_producto enable trigger item_producto_touch;

-- ─── 6. Not null y unique index ──────────────────────────────────────
alter table item_producto alter column codigo_ean set not null;

create unique index if not exists item_producto_tenant_codigo_ean_uk
  on item_producto(id_tenant, codigo_ean);
