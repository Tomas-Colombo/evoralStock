-- 00123_guarda_item_producto_consignacion.sql
-- Blindaje del paquete opcional consignaciones + rendiciones sobre item_producto:
--   - item_producto: bloquea tipo_ingreso = 'consignacion' en altas o cambio de tipo
--     si el tenant no tiene habilitado el paquete (REQ-MODOP-05 N5).
--   - Cubre los caminos que generan stock de terceros sin tocar ingreso_mercaderia:
--     1) sp_crear_stock_directo con p_tipo_ingreso = 'consignacion'
--     2) sp_confirmar_ingreso de un borrador creado previamente si el módulo fue apagado
--     3) insert directo en item_producto
--
-- UP:
--   1. fn_item_producto_consignacion(): función de trigger para item_producto.
--   2. tr_item_producto_consignacion: trigger before insert or update on item_producto.
--
-- DOWN:
-- drop trigger if exists tr_item_producto_consignacion on item_producto;
-- drop function if exists fn_item_producto_consignacion();

-- ─── 1. GUARDA EN item_producto (REQ-MODOP-05 N5) ────────────────────
create or replace function fn_item_producto_consignacion()
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

revoke execute on function fn_item_producto_consignacion() from public, anon;
grant execute on function fn_item_producto_consignacion() to authenticated;

drop trigger if exists tr_item_producto_consignacion on item_producto;
create trigger tr_item_producto_consignacion
  before insert or update on item_producto
  for each row
  execute function fn_item_producto_consignacion();
