-- 00118_guarda_tenant_modulo.sql
-- Guarda de tenant_modulo: protección del núcleo, paquete consignación en par,
-- estado vivo al deshabilitar opcionales y restricción de sp_reactivar_acceso_revendedora.
-- REQ-MODOP-01, REQ-MODOP-02, REQ-MODOP-03, REQ-MODOP-10.
--
-- UP:
--   1. fn_modulo_es_nucleo(p_codigo text) returns boolean, immutable.
--   2. Backfill: asegurar que todo tenant existente tenga las 6 filas del núcleo habilitadas.
--   3. fn_modulo_habilitado(p_tenant, p_codigo) INVOKER, stable.
--   4. fn_modulo_tiene_estado_vivo(p_tenant, p_codigo) INVOKER, stable.
--   5. Trigger tr_tenant_modulo_guarda:
--      - El núcleo no se inserta deshabilitado, no se apaga ni se borra (modulo-nucleo).
--      - Opcional con estado vivo no se apaga ni se borra (modulo-con-estado-vivo).
--   6. Constraint trigger diferido tr_tenant_modulo_paquete_consignacion:
--      - consignaciones y rendiciones deben tener el mismo habilitado al cerrar la transacción (modulo-paquete-incompleto).
--   7. revoke execute on sp_reactivar_acceso_revendedora from public, anon, authenticated.
--
-- DOWN:
--   grant execute on function sp_reactivar_acceso_revendedora(uuid, uuid, uuid, text, uuid) to authenticated;
--   drop trigger if exists tr_tenant_modulo_paquete_consignacion on tenant_modulo;
--   drop function if exists tr_check_paquete_consignacion();
--   drop trigger if exists tr_tenant_modulo_guarda on tenant_modulo;
--   drop function if exists fn_tenant_modulo_guarda();
--   drop function if exists fn_modulo_tiene_estado_vivo(uuid, text);
--   drop function if exists fn_modulo_es_nucleo(text);
--   drop function if exists fn_modulo_habilitado(uuid, text);

-- ─── 1. fn_modulo_es_nucleo ──────────────────────────────────────────
-- Fuente única de verdad para los códigos del núcleo.
create or replace function fn_modulo_es_nucleo(p_codigo text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_codigo in ('administracion', 'inventario', 'ventas', 'precios', 'gastos', 'reportes');
$$;

revoke execute on function fn_modulo_es_nucleo(text) from public, anon;
grant execute on function fn_modulo_es_nucleo(text) to authenticated;

-- ─── 2. BACKFILL NÚCLEO ──────────────────────────────────────────────
-- Todo tenant existente debe tener las 6 filas del núcleo habilitadas.
insert into tenant_modulo (id_tenant, id_modulo, habilitado)
select t.id_tenant, m.id_modulo, true
  from tenant t
 cross join modulo m
 where fn_modulo_es_nucleo(m.codigo)
on conflict (id_tenant, id_modulo) do update set habilitado = true;

-- ─── 3. fn_modulo_habilitado ─────────────────────────────────────────
create or replace function fn_modulo_habilitado(
  p_tenant uuid,
  p_codigo text
) returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_habilitado boolean;
begin
  select tm.habilitado into v_habilitado
    from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
   where tm.id_tenant = p_tenant
     and m.codigo = p_codigo;
  return coalesce(v_habilitado, false);
end;
$$;

revoke execute on function fn_modulo_habilitado(uuid, text) from public, anon;
grant execute on function fn_modulo_habilitado(uuid, text) to authenticated;

-- ─── 4. fn_modulo_tiene_estado_vivo ──────────────────────────────────
-- Fuente única de verdad para chequeos de estado vivo (N1–N4).
create or replace function fn_modulo_tiene_estado_vivo(
  p_tenant uuid,
  p_codigo text
) returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_codigo in ('consignaciones', 'rendiciones') then
    -- N1: ítems en consignación disponibles o reservados en el local
    if exists (
      select 1 from item_producto
       where id_tenant = p_tenant
         and tipo_ingreso = 'consignacion'
         and estado_item in ('disponible', 'reservado')
    ) then
      return true;
    end if;

    -- N2: devolución a proveedor abierta (consignacion.estado = 'activa')
    if exists (
      select 1 from consignacion
       where id_tenant = p_tenant
         and estado = 'activa'
    ) then
      return true;
    end if;

    -- N3: ventas de ítems en consignación sin rendir o rendición generada sin pagar
    if exists (
      select 1
        from detalle_venta dv
        join venta v on v.id_venta = dv.id_venta
        left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
       where dv.id_tenant = p_tenant
         and dv.id_rendicion is null
         and dv.excluida_rendicion = false
         and dv.monto_proveedor > 0
         and v.estado_venta = 'registrada'
         and dev.id_devolucion is null
    ) or exists (
      select 1
        from rendicion_proveedor
       where id_tenant = p_tenant
         and estado = 'pendiente'
    ) then
      return true;
    end if;

  elsif p_codigo = 'revendedoras' then
    -- N4: revendedoras (stock en revendedora, consignación abierta, liquidación o declaración pendiente)
    if exists (
      select 1 from item_producto
       where id_tenant = p_tenant
         and estado_item = 'en_revendedora'
    ) or exists (
      select 1 from consignacion_revendedora
       where id_tenant = p_tenant
         and estado = 'abierta'
    ) or exists (
      select 1 from liquidacion_revendedora
       where id_tenant = p_tenant
         and estado = 'pendiente'
    ) or exists (
      select 1 from declaracion_venta_revendedora
       where id_tenant = p_tenant
         and estado = 'pendiente'
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke execute on function fn_modulo_tiene_estado_vivo(uuid, text) from public, anon;
grant execute on function fn_modulo_tiene_estado_vivo(uuid, text) to authenticated;

-- ─── 5. TRIGGER DE GUARDA: NÚCLEO Y ESTADO VIVO ─────────────────────
create or replace function fn_tenant_modulo_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codigo text;
  v_tenant uuid;
begin
  if TG_OP = 'INSERT' then
    if NEW.habilitado = false then
      select codigo into v_codigo from modulo where id_modulo = NEW.id_modulo;
      if fn_modulo_es_nucleo(v_codigo) then
        raise exception 'modulo-nucleo' using errcode = 'P0001';
      end if;
    end if;
    return NEW;

  elsif TG_OP = 'UPDATE' then
    v_tenant := NEW.id_tenant;
    if OLD.habilitado = true and NEW.habilitado = false then
      select codigo into v_codigo from modulo where id_modulo = NEW.id_modulo;

      -- REQ-MODOP-01: El núcleo no se apaga
      if fn_modulo_es_nucleo(v_codigo) then
        raise exception 'modulo-nucleo' using errcode = 'P0001';
      end if;

      -- REQ-MODOP-03: No apagar opcional con estado vivo
      if fn_modulo_tiene_estado_vivo(v_tenant, v_codigo) then
        raise exception 'modulo-con-estado-vivo' using errcode = 'P0001';
      end if;
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    v_tenant := OLD.id_tenant;

    -- Si el tenant completo está siendo borrado en cascada, permitir delete
    if not exists (select 1 from tenant where id_tenant = v_tenant) then
      return OLD;
    end if;

    select codigo into v_codigo from modulo where id_modulo = OLD.id_modulo;

    -- REQ-MODOP-01: El núcleo no se borra
    if fn_modulo_es_nucleo(v_codigo) then
      raise exception 'modulo-nucleo' using errcode = 'P0001';
    end if;

    -- REQ-MODOP-03: Si estaba habilitado, no permitir borrarlo si tiene estado vivo
    if OLD.habilitado = true and fn_modulo_tiene_estado_vivo(v_tenant, v_codigo) then
      raise exception 'modulo-con-estado-vivo' using errcode = 'P0001';
    end if;

    return OLD;
  end if;
end;
$$;

create trigger tr_tenant_modulo_guarda
  before insert or update or delete on tenant_modulo
  for each row
  execute function fn_tenant_modulo_guarda();

-- ─── 6. CONSTRAINT TRIGGER DIFERIDO: PAQUETE DE A PAR ───────────────
create or replace function tr_check_paquete_consignacion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_cons boolean;
  v_rend boolean;
begin
  v_tenant := coalesce(NEW.id_tenant, OLD.id_tenant);

  -- Si el tenant está siendo borrado, no evaluar el constraint
  if not exists (select 1 from tenant where id_tenant = v_tenant) then
    return coalesce(NEW, OLD);
  end if;

  select tm.habilitado into v_cons
    from modulo m
    left join tenant_modulo tm on tm.id_modulo = m.id_modulo and tm.id_tenant = v_tenant
   where m.codigo = 'consignaciones';

  select tm.habilitado into v_rend
    from modulo m
    left join tenant_modulo tm on tm.id_modulo = m.id_modulo and tm.id_tenant = v_tenant
   where m.codigo = 'rendiciones';

  if coalesce(v_cons, false) <> coalesce(v_rend, false) then
    raise exception 'modulo-paquete-incompleto' using errcode = 'P0001';
  end if;

  return coalesce(NEW, OLD);
end;
$$;

create constraint trigger tr_tenant_modulo_paquete_consignacion
  after insert or update or delete on tenant_modulo
  deferrable initially deferred
  for each row
  execute function tr_check_paquete_consignacion();

-- ─── 7. REVOKE SP DE SERVICE-ROLE NO EXPUESTO (REQ-MODOP-10) ─────────
revoke execute on function sp_reactivar_acceso_revendedora(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
