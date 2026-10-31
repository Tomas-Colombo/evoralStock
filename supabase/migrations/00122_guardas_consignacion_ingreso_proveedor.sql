-- 00122_guardas_consignacion_ingreso_proveedor.sql
-- Blindaje del paquete opcional consignaciones + rendiciones sobre tablas del núcleo:
--   - ingreso_mercaderia: bloquea tipo_ingreso = 'consignacion' sin el paquete (REQ-MODOP-05 N2).
--   - proveedor: bloquea tipo = 'consignatario' en alta o cambio de tipo sin el paquete (REQ-MODOP-06 N2, N3).
--   - fn_modulo_tiene_estado_vivo: suma ítems en consignación en estado 'en_revendedora' a la guarda de estado vivo (REQ-MODOP-03 N1).
--
-- UP:
--   1. fn_ingreso_mercaderia_consignacion(): función de trigger para ingreso_mercaderia.
--   2. tr_ingreso_mercaderia_consignacion: trigger before insert or update on ingreso_mercaderia.
--   3. fn_proveedor_consignatario(): función de trigger para proveedor.
--   4. tr_proveedor_consignatario: trigger before insert or update on proveedor.
--   5. fn_modulo_tiene_estado_vivo(p_tenant uuid, p_codigo text): fix forward de 00118 sumando 'en_revendedora' a N1.
--
-- DOWN:
-- drop trigger if exists tr_proveedor_consignatario on proveedor;
-- drop function if exists fn_proveedor_consignatario();
-- drop trigger if exists tr_ingreso_mercaderia_consignacion on ingreso_mercaderia;
-- drop function if exists fn_ingreso_mercaderia_consignacion();
-- create or replace function fn_modulo_tiene_estado_vivo(
--   p_tenant uuid,
--   p_codigo text
-- ) returns boolean
-- language plpgsql
-- stable
-- security invoker
-- set search_path = public
-- as $$
-- begin
--   if p_codigo in ('consignaciones', 'rendiciones') then
--     -- N1: ítems en consignación disponibles o reservados en el local
--     if exists (
--       select 1 from item_producto
--        where id_tenant = p_tenant
--          and tipo_ingreso = 'consignacion'
--          and estado_item in ('disponible', 'reservado')
--     ) then
--       return true;
--     end if;
-- 
--     -- N2: devolución a proveedor abierta (consignacion.estado = 'activa')
--     if exists (
--       select 1 from consignacion
--        where id_tenant = p_tenant
--          and estado = 'activa'
--     ) then
--       return true;
--     end if;
-- 
--     -- N3: ventas de ítems en consignación sin rendir o rendición generada sin pagar
--     if exists (
--       select 1
--         from detalle_venta dv
--         join venta v on v.id_venta = dv.id_venta
--         left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--        where dv.id_tenant = p_tenant
--          and dv.id_rendicion is null
--          and dv.excluida_rendicion = false
--          and dv.monto_proveedor > 0
--          and v.estado_venta = 'registrada'
--          and dev.id_devolucion is null
--     ) or exists (
--       select 1
--         from rendicion_proveedor
--        where id_tenant = p_tenant
--          and estado = 'pendiente'
--     ) then
--       return true;
--     end if;
-- 
--   elsif p_codigo = 'revendedoras' then
--     -- N4: revendedoras (stock en revendedora, consignación abierta, liquidación o declaración pendiente)
--     if exists (
--       select 1 from item_producto
--        where id_tenant = p_tenant
--          and estado_item = 'en_revendedora'
--     ) or exists (
--       select 1 from consignacion_revendedora
--        where id_tenant = p_tenant
--          and estado = 'abierta'
--     ) or exists (
--       select 1 from liquidacion_revendedora
--        where id_tenant = p_tenant
--          and estado = 'pendiente'
--     ) or exists (
--       select 1 from declaracion_venta_revendedora
--        where id_tenant = p_tenant
--          and estado = 'pendiente'
--     ) then
--       return true;
--     end if;
--   end if;
-- 
--   return false;
-- end;
-- $$;
-- revoke execute on function fn_modulo_tiene_estado_vivo(uuid, text) from public, anon;
-- grant execute on function fn_modulo_tiene_estado_vivo(uuid, text) to authenticated;

-- ─── 1. GUARDA EN ingreso_mercaderia (REQ-MODOP-05 N2) ───────────────
create or replace function fn_ingreso_mercaderia_consignacion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if NEW.tipo_ingreso = 'consignacion' then
    if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.tipo_ingreso is distinct from NEW.tipo_ingreso) then
      if not (
        fn_modulo_habilitado(NEW.id_tenant, 'consignaciones') and
        fn_modulo_habilitado(NEW.id_tenant, 'rendiciones')
      ) then
        raise exception 'module-disabled' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function fn_ingreso_mercaderia_consignacion() from public, anon;
grant execute on function fn_ingreso_mercaderia_consignacion() to authenticated;

drop trigger if exists tr_ingreso_mercaderia_consignacion on ingreso_mercaderia;
create trigger tr_ingreso_mercaderia_consignacion
  before insert or update on ingreso_mercaderia
  for each row
  execute function fn_ingreso_mercaderia_consignacion();

-- ─── 2. GUARDA EN proveedor (REQ-MODOP-06 N2, N3) ───────────────────
create or replace function fn_proveedor_consignatario()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if NEW.tipo = 'consignatario' then
    if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.tipo is distinct from NEW.tipo) then
      if not (
        fn_modulo_habilitado(NEW.id_tenant, 'consignaciones') and
        fn_modulo_habilitado(NEW.id_tenant, 'rendiciones')
      ) then
        raise exception 'module-disabled' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function fn_proveedor_consignatario() from public, anon;
grant execute on function fn_proveedor_consignatario() to authenticated;

drop trigger if exists tr_proveedor_consignatario on proveedor;
create trigger tr_proveedor_consignatario
  before insert or update on proveedor
  for each row
  execute function fn_proveedor_consignatario();

-- ─── 3. fn_modulo_tiene_estado_vivo (REQ-MODOP-03 N1) ─────────────────
-- Fix forward de 00118: suma 'en_revendedora' a los ítems en consignación que
-- siguen representando deuda viva con el proveedor.
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
    -- N1: ítems en consignación disponibles, reservados o en revendedora
    if exists (
      select 1 from item_producto
       where id_tenant = p_tenant
         and tipo_ingreso = 'consignacion'
         and estado_item in ('disponible', 'reservado', 'en_revendedora')
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
