-- 00156_cpc_item_venta_devolucion_costo.sql
-- Fase 3E.2 costos-por-columna (REQ-CPC.md §11, §6.1, §6.2, D-CPC-02, D-CPC-03, D-CPC-07, D-CPC-08):
--   1. Tablas satélite: item_costo, detalle_venta_costo, detalle_venta_rendicion, devolucion_venta_costo.
--   2. Triggers de inmutabilidad en las 3 satélites de venta/devolución + tg_detalle_venta_inmutable.
--   3. Backfill desde columnas viejas y verificación de conteos en DO $$.
--   4. Selladores DEFINER: fn_sellar_costo_herencia_items, fn_sellar_costo_venta,
--      fn_sellar_costo_cambio, fn_sellar_costo_devolucion.
--   5. Recreación de escritores, lectores y vistas + DROP COLUMN sin CASCADE.
--
-- DOWN:
-- alter table item_producto add column if not exists costo_ingreso numeric(14, 2) check (costo_ingreso is null or costo_ingreso >= 0);
-- alter table detalle_venta add column if not exists costo_snapshot numeric(14, 2) check (costo_snapshot >= 0);
-- alter table detalle_venta add column if not exists monto_proveedor numeric(14, 2) default 0;
-- alter table detalle_venta add column if not exists monto_ganancia numeric(14, 2);
-- alter table devolucion_venta add column if not exists costo_recuperado numeric(14, 2);
--
-- update item_producto ip set costo_ingreso = ic.costo_ingreso from item_costo ic where ic.id_item = ip.id_item;
-- update detalle_venta dv set costo_snapshot = dvc.costo_snapshot, monto_ganancia = dvc.monto_ganancia from detalle_venta_costo dvc where dvc.id_detalle_venta = dv.id_detalle_venta;
-- update detalle_venta dv set monto_proveedor = dvr.monto_proveedor from detalle_venta_rendicion dvr where dvr.id_detalle_venta = dv.id_detalle_venta;
-- update devolucion_venta dev set costo_recuperado = devc.costo_recuperado from devolucion_venta_costo devc where devc.id_devolucion = dev.id_devolucion;
--
-- update detalle_venta set costo_snapshot = 0 where costo_snapshot is null;
-- update detalle_venta set monto_ganancia = precio_venta where monto_ganancia is null;
-- update detalle_venta set monto_proveedor = 0 where monto_proveedor is null;
-- update devolucion_venta set costo_recuperado = 0 where costo_recuperado is null;
--
-- alter table detalle_venta alter column costo_snapshot set not null;
-- alter table detalle_venta alter column monto_proveedor set not null;
-- alter table detalle_venta alter column monto_ganancia set not null;
-- alter table devolucion_venta alter column costo_recuperado set not null;
--
-- drop index if exists detalle_venta_rendicion_pendiente_idx;
-- create index if not exists detalle_venta_rendicion_pendiente_idx
--   on detalle_venta(id_tenant, id_proveedor)
--   where id_rendicion is null and excluida_rendicion = false and monto_proveedor > 0;
--
-- revoke all on function fn_sellar_costo_venta(uuid) from authenticated;
-- drop function if exists fn_sellar_costo_venta(uuid);
-- revoke all on function fn_sellar_costo_cambio(uuid) from authenticated;
-- drop function if exists fn_sellar_costo_cambio(uuid);
-- revoke all on function fn_sellar_costo_devolucion(uuid) from authenticated;
-- drop function if exists fn_sellar_costo_devolucion(uuid);
--
-- create or replace function fn_sellar_costo_herencia_items(p_id_producto uuid, p_ids_items uuid[]) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
-- declare v_tenant uuid := auth_tenant_id(); v_costo numeric;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then raise exception 'no-permission' using errcode = '42501'; end if;
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if auth_revendedora_id() is not null then raise exception 'no-permission' using errcode = '42501'; end if;
--   if p_ids_items is null or coalesce(array_length(p_ids_items, 1), 0) = 0 then return; end if;
--   select costo into v_costo from costo_producto where id_tenant = v_tenant and id_producto = p_id_producto and vigente_hasta is null limit 1;
--   if v_costo is null then return; end if;
--   update item_producto set costo_ingreso = v_costo where id_tenant = v_tenant and id_producto = p_id_producto and id_item = any(p_ids_items) and costo_ingreso is null;
-- end;
-- $$;
--
-- create or replace function tg_detalle_venta_inmutable() returns trigger language plpgsql as $$
-- begin
--   if tg_op = 'DELETE' then
--     if not exists (select 1 from tenant where id_tenant = old.id_tenant) then return old; end if;
--     raise exception 'detalle-venta-inmutable: no se puede eliminar directamente' using errcode = '22023';
--   end if;
--   if tg_op = 'UPDATE' then
--     if old.id_liquidacion is not null then
--       if new.id_liquidacion is distinct from old.id_liquidacion or new.monto_comision <> old.monto_comision or new.excluida_liquidacion <> old.excluida_liquidacion then
--         raise exception 'detalle-venta-inmutable: linea ya liquidada no se puede modificar' using errcode = '22023';
--       end if;
--     end if;
--     if new.id_tenant <> old.id_tenant or new.id_venta <> old.id_venta or new.id_item <> old.id_item or new.id_producto <> old.id_producto or new.id_proveedor is distinct from old.id_proveedor or new.precio_venta <> old.precio_venta or new.costo_snapshot <> old.costo_snapshot or new.monto_proveedor <> old.monto_proveedor or new.monto_gasto <> old.monto_gasto or new.monto_ganancia <> old.monto_ganancia or new.tipo_ingreso_snapshot <> old.tipo_ingreso_snapshot or new.desglose_reglas is distinct from old.desglose_reglas or new.porcentaje_comision_preview <> old.porcentaje_comision_preview then
--       raise exception 'detalle-venta-inmutable: solo se puede modificar comision/liquidacion y rendicion' using errcode = '22023';
--     end if;
--     return new;
--   end if;
-- end $$;
--
-- create or replace view v_linea_venta with (security_invoker = true) as
-- select v.id_tenant, v.id_venta, dv.id_producto,
--   case when cv_nuevo.id_cambio is not null then cv_nuevo.created_at else v.fecha end as fecha_venta,
--   v.estado_venta, v.fecha_anulacion, p.precio_venta as precio_venta,
--   dv.costo_snapshot as costo, dv.monto_ganancia as margen, dv.tipo_ingreso_snapshot,
--   dv.id_proveedor, dv.monto_proveedor, dv.id_rendicion, dv.excluida_rendicion,
--   (dev.id_devolucion is not null or cv_orig.id_cambio is not null) as devuelta,
--   coalesce(dev.fecha, cv_orig.created_at) as fecha_devolucion,
--   coalesce(dev.costo_recuperado, case when cv_orig.id_cambio is not null then dv.costo_snapshot else null end)::numeric(14,2) as costo_recuperado,
--   case when v.estado_venta = 'registrada' and dev.id_devolucion is null and cv_orig.id_cambio is null and dv.id_liquidacion is not null then dv.monto_comision else 0::numeric(14, 2) end as comision,
--   case when v.estado_venta = 'registrada' and dev.id_devolucion is null and cv_orig.id_cambio is null and dv.id_liquidacion is null and v.canal = 'revendedora' then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2) else 0::numeric(14, 2) end as comision_estimada,
--   liq.fecha_liquidacion
-- from detalle_venta dv join venta v on v.id_venta = dv.id_venta join producto p on p.id_producto = dv.id_producto
-- left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
-- left join cambio_venta cv_orig on cv_orig.id_detalle_original = dv.id_detalle_venta and cv_orig.id_tenant = dv.id_tenant
-- left join cambio_venta cv_nuevo on cv_nuevo.id_item_entregado = dv.id_item and cv_nuevo.id_venta_original = dv.id_venta and cv_nuevo.id_tenant = dv.id_tenant
-- left join liquidacion_revendedora liq on liq.id_liquidacion = dv.id_liquidacion and liq.id_tenant = dv.id_tenant;
--
-- create or replace view v_perfil_proveedor with (security_invoker = on) as
-- select prov.id_tenant, prov.id_proveedor, prov.nombre, prov.tipo, prov.telefono, prov.dias_rotacion,
--   (select count(*) from item_producto ip join ingreso_mercaderia im on im.id_ingreso = ip.id_ingreso where im.id_proveedor = prov.id_proveedor and ip.id_tenant = prov.id_tenant and ip.estado_item = 'disponible' and ip.tipo_ingreso = 'consignacion')::bigint as items_disponibles,
--   (select count(*) from consignacion c where c.id_proveedor = prov.id_proveedor and c.id_tenant = prov.id_tenant and c.estado = 'activa')::bigint as consignaciones_activas,
--   (select coalesce(sum(dv.monto_proveedor), 0) from detalle_venta dv join venta v on v.id_venta = dv.id_venta left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta where dv.id_proveedor = prov.id_proveedor and dv.id_tenant = prov.id_tenant and dv.id_rendicion is null and dv.excluida_rendicion = false and dv.monto_proveedor > 0 and v.estado_venta = 'registrada' and dev.id_devolucion is null)::numeric as monto_pendiente_rendicion,
--   (select count(*) from detalle_venta dv join venta v on v.id_venta = dv.id_venta left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta where dv.id_proveedor = prov.id_proveedor and dv.id_tenant = prov.id_tenant and dv.id_rendicion is null and dv.excluida_rendicion = false and dv.monto_proveedor > 0 and v.estado_venta = 'registrada' and dev.id_devolucion is null)::bigint as lineas_pendientes_rendicion,
--   (select coalesce(sum(r.monto_total), 0) from rendicion_proveedor r where r.id_proveedor = prov.id_proveedor and r.id_tenant = prov.id_tenant)::numeric as monto_rendido_historico,
--   (select count(*) from rendicion_proveedor r where r.id_proveedor = prov.id_proveedor and r.id_tenant = prov.id_tenant and r.estado = 'pendiente')::bigint as rendiciones_pendientes_pago
-- from proveedor prov where prov.activo = true;
--
-- drop trigger if exists tr_detalle_venta_costo_inmutable on detalle_venta_costo;
-- drop function if exists tg_detalle_venta_costo_inmutable();
-- drop trigger if exists tr_detalle_venta_rendicion_inmutable on detalle_venta_rendicion;
-- drop function if exists tg_detalle_venta_rendicion_inmutable();
-- drop trigger if exists tr_devolucion_venta_costo_inmutable on devolucion_venta_costo;
-- drop function if exists tg_devolucion_venta_costo_inmutable();
-- drop table if exists devolucion_venta_costo;
-- drop table if exists detalle_venta_rendicion;
-- drop table if exists detalle_venta_costo;
-- drop table if exists item_costo;
--
-- alter table detalle_venta drop constraint if exists detalle_venta_monto_ganancia_check;
-- alter table detalle_venta add constraint detalle_venta_monto_ganancia_check
--   check (monto_ganancia = precio_venta - costo_snapshot);
-- alter table detalle_venta drop constraint if exists detalle_venta_monto_proveedor_check;
-- alter table detalle_venta add constraint detalle_venta_monto_proveedor_check
--   check (
--     (tipo_ingreso_snapshot = 'compra' and monto_proveedor = 0) or
--     (tipo_ingreso_snapshot = 'consignacion' and monto_proveedor = costo_snapshot)
--   ) not valid;
--
-- NOTE: Restaura las definiciones vigentes anteriores, copiadas sin cambios.
--
-- NOTE: sp_confirmar_ingreso (00155_cpc_policies_y_herencia.sql:1521)
-- create or replace function sp_confirmar_ingreso(
--   p_id_ingreso uuid,
--   p_ip         inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_confirmado boolean;
--   v_tipo       tipo_ingreso;
--   v_count      integer := 0;
--   v_detalle    record;
--   v_costo_item numeric;
--   v_i          integer;
--   v_qr         text;
--   v_new_item   uuid;
--   v_ids_her    uuid[];
--   v_prod       record;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select confirmado, tipo_ingreso into v_confirmado, v_tipo
--     from ingreso_mercaderia
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--    for update;
--
--   if v_confirmado is null then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--
--   if v_confirmado then
--     return 0;  -- idempotente
--   end if;
--
--   -- D3: si dos líneas del mismo producto traen costos distintos o mezcla de valor y null, rechazar
--   if exists (
--     select 1
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--      group by id_producto
--     having count(distinct costo_unitario) > 1
--         or (bool_or(costo_unitario is null) and bool_or(costo_unitario is not null))
--   ) then
--     raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
--   end if;
--
--   for v_detalle in
--     select id_detalle, id_producto, cantidad, costo_unitario, talle
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   loop
--     v_costo_item := v_detalle.costo_unitario;
--     v_ids_her := array[]::uuid[];
--
--     for v_i in 1 .. v_detalle.cantidad loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
--       values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
--               v_qr, 'disponible', v_costo_item, v_tipo, v_detalle.talle)
--       returning id_item into v_new_item;
--
--       if v_detalle.costo_unitario is null then
--         v_ids_her := array_append(v_ids_her, v_new_item);
--       end if;
--
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id, id_usuario)
--       values (v_tenant, v_new_item, 'alta',
--               null, 'disponible',
--               'ingreso', p_id_ingreso, v_actor);
--
--       v_count := v_count + 1;
--     end loop;
--
--     -- Sin costo en el detalle: el sellador DEFINER hereda el costo vigente sin exponerlo por RLS
--     if v_detalle.costo_unitario is null and coalesce(array_length(v_ids_her, 1), 0) > 0 then
--       perform fn_sellar_costo_herencia_items(v_detalle.id_producto, v_ids_her);
--     end if;
--   end loop;
--
--   -- D2: llamar a D1 una vez por producto del ingreso.
--   -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
--   -- Líneas con costo_unitario null no llaman a sp_aplicar_ultimo_costo.
--   for v_prod in
--     select id_producto,
--            costo_unitario,
--            costo_original_usd,
--            cotizacion_aplicada,
--            cotizacion_fecha_valor,
--            case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
--       from (
--         select distinct on (id_producto)
--                id_producto,
--                costo_unitario,
--                costo_original_usd,
--                cotizacion_aplicada,
--                cotizacion_fecha_valor
--           from ingreso_mercaderia_detalle
--          where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--          order by id_producto, id_detalle
--       ) s
--   loop
--     if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
--       perform sp_aplicar_ultimo_costo(
--         v_prod.id_producto,
--         v_prod.costo_unitario,
--         v_prod.moneda,
--         v_prod.costo_original_usd,
--         v_prod.cotizacion_aplicada,
--         v_prod.cotizacion_fecha_valor,
--         'ingreso mercaderia',
--         p_ip,
--         v_tipo <> 'consignacion'
--       );
--     end if;
--   end loop;
--
--   update ingreso_mercaderia
--      set confirmado = true
--    where id_ingreso = p_id_ingreso;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar',
--           jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo),
--           p_ip);
--
--   return v_count;
-- end;
-- $$;
--
-- NOTE: sp_crear_stock_directo (00155_cpc_policies_y_herencia.sql:1663)
-- create or replace function sp_crear_stock_directo(
--   p_id_producto  uuid,
--   p_costo        numeric default null,
--   p_tipo_ingreso tipo_ingreso default 'compra',
--   p_items        jsonb default '[]',
--   p_ip           inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_count      integer := 0;
--   v_costo_item numeric;
--   v_item       jsonb;
--   v_talle      text;
--   v_cant       integer;
--   v_i          integer;
--   v_qr         text;
--   v_new_item   uuid;
--   v_ids_her    uuid[] := array[]::uuid[];
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   -- Si p_costo no es null, exige cargar_costos
--   if p_costo is not null and not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from producto where id_producto = p_id_producto and id_tenant = v_tenant
--   ) then
--     raise exception 'producto-not-found' using errcode = '42704';
--   end if;
--
--   v_costo_item := p_costo;
--
--   for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
--   loop
--     v_talle := nullif(trim(v_item->>'talle'), '');
--     v_cant := coalesce((v_item->>'cantidad')::integer, 0);
--     if v_cant <= 0 then
--       continue;
--     end if;
--
--     for v_i in 1 .. v_cant loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
--       values (v_tenant, p_id_producto, null, null,
--               v_qr, 'disponible', v_costo_item,
--               coalesce(p_tipo_ingreso, 'compra'), v_talle)
--       returning id_item into v_new_item;
--
--       if p_costo is null then
--         v_ids_her := array_append(v_ids_her, v_new_item);
--       end if;
--
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id, id_usuario)
--       values (v_tenant, v_new_item, 'alta', null, 'disponible',
--               'alta-directa', p_id_producto, v_actor);
--
--       v_count := v_count + 1;
--     end loop;
--   end loop;
--
--   if p_costo is null and coalesce(array_length(v_ids_her, 1), 0) > 0 then
--     perform fn_sellar_costo_herencia_items(p_id_producto, v_ids_her);
--   end if;
--
--   if p_costo is not null and p_costo > 0 then
--     perform sp_aplicar_ultimo_costo(
--       p_id_producto,
--       p_costo,
--       'ARS',
--       null,
--       null,
--       null,
--       'alta directa stock',
--       p_ip,
--       coalesce(p_tipo_ingreso, 'compra') <> 'consignacion'
--     );
--   end if;
--
--   if v_count > 0 then
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (v_tenant, v_actor, 'item_producto', p_id_producto::text, 'alta-directa',
--             jsonb_build_object('items_generados', v_count, 'costo', p_costo), p_ip);
--   end if;
--
--   return v_count;
-- end;
-- $$;
--
-- NOTE: sp_aplicar_ultimo_costo (00155_cpc_policies_y_herencia.sql:1943)
-- create or replace function sp_aplicar_ultimo_costo(
--   p_id_producto            uuid,
--   p_costo                  numeric,
--   p_moneda                 text default 'ARS',
--   p_costo_original_usd     numeric default null,
--   p_cotizacion_aplicada    numeric default null,
--   p_cotizacion_fecha_valor date default null,
--   p_motivo                 text default null,
--   p_ip                     inet default null,
--   p_sincronizar_unidades   boolean default true
-- ) returns uuid
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_vigente      record;
--   v_id           uuid;
--   v_es_igual     boolean := false;
-- begin
--   -- Permisos: 'inventario.cargar_costos' (implica ver_costos por D-CPC-05)
--   -- o 'precios.editar_cotizacion' junto con 'inventario.ver_costos' (evita duplicar vigentes bajo RLS).
--   if not (
--     (select auth_tiene_permiso('inventario', 'cargar_costos'))
--     or (
--       (select auth_tiene_permiso('precios', 'editar_cotizacion'))
--       and (select auth_tiene_permiso('inventario', 'ver_costos'))
--     )
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if p_costo is null or p_costo <= 0 then
--     return null;
--   end if;
--
--   select id_costo, costo, moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--     into v_vigente
--     from costo_producto
--    where id_tenant = v_tenant
--      and id_producto = p_id_producto
--      and vigente_hasta is null
--    for update;
--
--   if v_vigente.id_costo is not null then
--     if v_vigente.costo = p_costo then
--       v_es_igual := true;
--     end if;
--   end if;
--
--   if v_es_igual then
--     return v_vigente.id_costo;
--   end if;
--
--   if v_vigente.id_costo is not null then
--     update costo_producto
--        set vigente_hasta = now()
--      where id_costo = v_vigente.id_costo;
--   end if;
--
--   insert into costo_producto(
--     id_tenant, id_producto, costo, moneda,
--     id_usuario_alta, motivo,
--     costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--   )
--   values (
--     v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
--     v_actor, p_motivo,
--     case when p_moneda = 'USD' then p_costo_original_usd else null end,
--     case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--     case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
--   )
--   returning id_costo into v_id;
--
--   if coalesce(p_sincronizar_unidades, true) then
--     update item_producto
--        set costo_ingreso = p_costo
--      where id_tenant = v_tenant
--        and id_producto = p_id_producto
--        and tipo_ingreso = 'compra'
--        and estado_item in ('disponible', 'reservado', 'en_revendedora');
--   end if;
--
--   perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
--           jsonb_build_object('id_producto', p_id_producto,
--                              'costo_anterior', v_vigente.costo,
--                              'costo_nuevo', p_costo,
--                              'moneda', coalesce(p_moneda, 'ARS'),
--                              'motivo', p_motivo,
--                              'costo_original_usd', p_costo_original_usd,
--                              'cotizacion_aplicada', p_cotizacion_aplicada,
--                              'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
--           p_ip);
--
--   return v_id;
-- end;
-- $$;
--
-- NOTE: sp_completar_costo_ingreso (00153_cpc_costo_pendiente.sql:714)
-- create or replace function sp_completar_costo_ingreso(
--   p_id_ingreso uuid,
--   p_lineas     jsonb,
--   p_ip         inet default null
-- ) returns integer
-- language plpgsql
-- security invoker
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant                   uuid := auth_tenant_id();
--   v_actor                    uuid := auth.uid();
--   v_confirmado               boolean;
--   v_tipo                     tipo_ingreso;
--   v_linea                    jsonb;
--   v_id_detalle               uuid;
--   v_costo                    numeric;
--   v_det                      record;
--   v_items_actualizados       integer := 0;
--   v_total_items_actualizados integer := 0;
--   v_prod                     record;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select confirmado, tipo_ingreso into v_confirmado, v_tipo
--     from ingreso_mercaderia
--    where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--    for update;
--
--   if v_confirmado is null then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--
--   if not v_confirmado then
--     raise exception 'ingreso-no-confirmado' using errcode = '22023';
--   end if;
--
--   if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
--     return 0;
--   end if;
--
--   -- Iterar y completar cada línea indicada
--   for v_linea in select * from jsonb_array_elements(p_lineas)
--   loop
--     v_id_detalle := coalesce(v_linea->>'id_detalle', v_linea->>'idDetalle')::uuid;
--     v_costo      := coalesce(v_linea->>'costo_unitario', v_linea->>'costoUnitario')::numeric;
--
--     if v_id_detalle is null then
--       continue;
--     end if;
--
--     select id_detalle, id_producto, costo_unitario
--       into v_det
--       from ingreso_mercaderia_detalle
--      where id_detalle = v_id_detalle
--        and id_ingreso = p_id_ingreso
--        and id_tenant = v_tenant
--      for update;
--
--     if v_det.id_detalle is null then
--       raise exception 'detalle-not-found: %', v_id_detalle using errcode = '42704';
--     end if;
--
--     -- Solo completa líneas con costo null
--     if v_det.costo_unitario is null then
--       if v_costo is null or v_costo <= 0 then
--         raise exception 'costo-invalido' using errcode = '22023';
--       end if;
--
--       update ingreso_mercaderia_detalle
--          set costo_unitario = v_costo
--        where id_detalle = v_det.id_detalle;
--
--       with updated as (
--         update item_producto
--            set costo_ingreso = v_costo
--          where id_ingreso_detalle = v_det.id_detalle
--            and id_tenant = v_tenant
--            and estado_item <> 'vendido'
--         returning id_item
--       )
--       select count(*) into v_items_actualizados from updated;
--
--       v_total_items_actualizados := v_total_items_actualizados + v_items_actualizados;
--     end if;
--   end loop;
--
--   -- Validar que no queden costos distintos o inconsistentes para un mismo producto
--   if exists (
--     select 1
--       from ingreso_mercaderia_detalle
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--      group by id_producto
--     having count(distinct costo_unitario) > 1
--         or (bool_or(costo_unitario is null) and bool_or(costo_unitario is not null))
--   ) then
--     raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
--   end if;
--
--   -- Llamar a sp_aplicar_ultimo_costo una vez por producto de las líneas completadas
--   for v_prod in
--     select id_producto,
--            costo_unitario,
--            costo_original_usd,
--            cotizacion_aplicada,
--            cotizacion_fecha_valor,
--            case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
--       from (
--         select distinct on (id_producto)
--                id_producto,
--                costo_unitario,
--                costo_original_usd,
--                cotizacion_aplicada,
--                cotizacion_fecha_valor
--           from ingreso_mercaderia_detalle
--          where id_ingreso = p_id_ingreso
--            and id_tenant = v_tenant
--            and id_detalle in (
--              select coalesce(l->>'id_detalle', l->>'idDetalle')::uuid
--                from jsonb_array_elements(p_lineas) l
--            )
--          order by id_producto, id_detalle
--       ) s
--   loop
--     if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
--       perform sp_aplicar_ultimo_costo(
--         v_prod.id_producto,
--         v_prod.costo_unitario,
--         v_prod.moneda,
--         v_prod.costo_original_usd,
--         v_prod.cotizacion_aplicada,
--         v_prod.cotizacion_fecha_valor,
--         'completar costo ingreso',
--         p_ip,
--         v_tipo <> 'consignacion'
--       );
--     end if;
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'completar_costo',
--           jsonb_build_object('items_actualizados', v_total_items_actualizados,
--                              'lineas_enviadas', jsonb_array_length(p_lineas)),
--           p_ip);
--
--   return v_total_items_actualizados;
-- end;
-- $$;
--
-- NOTE: sp_registrar_venta (00153_cpc_costo_pendiente.sql:872)
-- create or replace function sp_registrar_venta(
--   p_lineas         jsonb,
--   p_forma_pago     forma_pago default 'efectivo',
--   p_id_cliente     uuid default null,
--   p_id_reserva     uuid default null,
--   p_observaciones  text default null,
--   p_ip             inet default null,
--   p_pagos          jsonb default null,
--   p_financiacion   jsonb default null,
--   p_financiador    jsonb default null,
--   p_canal          canal_venta default 'local',
--   p_id_revendedora uuid default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_id_venta   uuid := gen_random_uuid();
--   v_total      numeric(14, 2) := 0;
--   v_lineas_procesadas jsonb := '[]'::jsonb;
--   v_linea      jsonb;
--   v_id_item    uuid;
--   v_ids_desc   uuid[];
--   v_item       item_producto;
--   v_producto   producto;
--   v_snap       jsonb;
--   v_precio     numeric(14, 2);
--   v_costo      numeric(14, 2);
--   v_id_prov    uuid;
--   v_monto_prov numeric(14, 2);
--   v_monto_gan  numeric(14, 2);
--   v_reserva_estado estado_reserva;
--   v_dr_activa  uuid;
--   v_pago       jsonb;
--   v_id_cuenta  uuid;
--   v_fin_cuenta uuid;
--   v_fin_medio  medio_pago;
--   v_fin_propia boolean;
--   v_monto_pago numeric(14, 2);
--   v_pagado     numeric(14, 2) := 0;
--   v_medio      medio_pago;
--   v_cuotas     smallint;
--   v_cobro      jsonb;
--   v_costo_cobro numeric(14, 2);
--   v_fin_cuotas smallint;
--   v_fin_desde  date;
--   v_a_financiar numeric(14, 2) := 0;
--   v_cuota_base numeric(14, 2);
--   v_acumulado  numeric(14, 2) := 0;
--   v_monto_cuota numeric(14, 2);
--   v_i          smallint;
--   v_venc       date;
--
--   -- Variables específicas para canal y comisiones
--   v_canal      canal_venta := coalesce(p_canal, 'local');
--   v_pct_preview numeric(5, 2) := 0;
--   v_id_dcr     uuid;
-- begin
--   if not (
--     (select auth_tiene_permiso('ventas', 'crear'))
--     or (select auth_tiene_permiso('revendedoras', 'crear'))
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Seguridad (ACC-07 punto 5): una sesión con rol Revendedora no puede vender directamente
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
--     raise exception 'lineas-vacias' using errcode = '22023';
--   end if;
--
--   if v_canal = 'online' then
--     raise exception 'canal-no-disponible' using errcode = '22023';
--   end if;
--
--   -- Validaciones específicas del canal revendedora
--   if v_canal = 'revendedora' then
--     if not exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--     end if;
--
--     if p_id_revendedora is null then
--       raise exception 'venta-revendedora-sin-id' using errcode = '22023';
--     end if;
--
--     if not exists (
--       select 1 from revendedora
--       where id_tenant = v_tenant and id_revendedora = p_id_revendedora and activo = true
--     ) then
--       raise exception 'revendedora-not-found' using errcode = '42704';
--     end if;
--
--     -- Obtener el snapshot informativo de comisión según la regla vigente
--     select coalesce(porcentaje, 0) into v_pct_preview
--       from fn_resolver_comision(p_id_revendedora, fn_hoy_tenant(), 0, 'revendedora')
--      limit 1;
--     v_pct_preview := coalesce(v_pct_preview, 0);
--   end if;
--
--   if p_financiacion is not null then
--     v_fin_cuotas := (p_financiacion->>'cuotas')::smallint;
--     v_fin_desde  := (p_financiacion->>'primer_vencimiento')::date;
--
--     if p_id_cliente is null then
--       raise exception 'financiacion-sin-cliente' using errcode = '22023';
--     end if;
--     if v_fin_cuotas is null or v_fin_cuotas < 1 or v_fin_cuotas > 24 then
--       raise exception 'financiacion-cuotas-invalidas: %', v_fin_cuotas
--         using errcode = '22023';
--     end if;
--     if v_fin_desde is null then
--       raise exception 'financiacion-sin-vencimiento' using errcode = '22023';
--     end if;
--   end if;
--
--   if p_id_reserva is not null then
--     select estado_reserva into v_reserva_estado
--       from reserva
--      where id_reserva = p_id_reserva and id_tenant = v_tenant
--      for update;
--     if v_reserva_estado is null then
--       raise exception 'reserva-not-found' using errcode = '42704';
--     end if;
--     if v_reserva_estado <> 'activa' then
--       raise exception 'reserva-no-activa: %', v_reserva_estado using errcode = '22023';
--     end if;
--   end if;
--
--   v_fin_propia := coalesce((p_financiador->>'propia')::boolean,
--                            p_financiacion is not null, false);
--   v_fin_cuenta := case when v_fin_propia then null
--                        else (p_financiador->>'id_cuenta_destino')::uuid end;
--   v_fin_medio  := case when v_fin_propia then null
--                        else nullif(p_financiador->>'medio','')::medio_pago end;
--
--   if v_fin_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
--     raise exception 'medio-solo-revendedora' using errcode = '22023';
--   end if;
--
--
--   for v_linea in select * from jsonb_array_elements(p_lineas) loop
--     v_id_item := (v_linea->>'id_item')::uuid;
--     if v_id_item is null then
--       raise exception 'linea-sin-id-item' using errcode = '22023';
--     end if;
--
--     v_ids_desc := coalesce(
--       (select array_agg(e::uuid)
--          from jsonb_array_elements_text(coalesce(v_linea->'descuentos', '[]'::jsonb)) e),
--       '{}'::uuid[]
--     );
--
--     select * into v_item
--       from item_producto
--      where id_item = v_id_item and id_tenant = v_tenant
--      for update;
--     if v_item.id_item is null then
--       raise exception 'item-not-found: %', v_id_item using errcode = '42704';
--     end if;
--
--     -- Guarda: ítem con costo pendiente no puede ser vendido
--     if v_item.costo_ingreso is null then
--       raise exception 'item-costo-pendiente' using errcode = 'P0001';
--     end if;
--
--     v_id_dcr := null;
--
--     if v_canal = 'revendedora' then
--       if v_item.estado_item <> 'en_revendedora' then
--         raise exception 'item-no-en-revendedora: % (estado=%)',
--           v_id_item, v_item.estado_item using errcode = '22023';
--       end if;
--
--       select crd.id_consignacion_revendedora_detalle into v_id_dcr
--         from consignacion_revendedora_detalle crd
--         join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
--        where crd.id_item = v_id_item
--          and cr.id_tenant = v_tenant
--          and cr.id_revendedora = p_id_revendedora
--          and cr.confirmada = true
--          and cr.estado = 'abierta'
--          and crd.estado_detalle = 'en_poder'
--        for update of crd;
--
--       if v_id_dcr is null then
--         raise exception 'item-no-en-revendedora: %', v_id_item using errcode = '22023';
--       end if;
--     else
--       if v_item.estado_item <> 'disponible' then
--         raise exception 'item-no-disponible: % (estado=%)',
--           v_id_item, v_item.estado_item using errcode = '22023';
--       end if;
--     end if;
--
--     select id_detalle_reserva into v_dr_activa
--       from detalle_reserva
--      where id_item = v_id_item and estado = 'activa';
--     if v_dr_activa is not null then
--       if p_id_reserva is null then
--         raise exception 'item-en-reserva: % (usa la reserva o cancelala primero)',
--           v_id_item using errcode = '22023';
--       end if;
--       if not exists (
--         select 1 from detalle_reserva
--          where id_detalle_reserva = v_dr_activa
--            and id_reserva = p_id_reserva
--       ) then
--         raise exception 'item-en-otra-reserva: %', v_id_item using errcode = '22023';
--       end if;
--       update detalle_reserva set estado = 'convertida_venta'
--        where id_detalle_reserva = v_dr_activa;
--     end if;
--
--     select * into v_producto from producto
--      where id_producto = v_item.id_producto and id_tenant = v_tenant;
--
--     v_snap := sp_calcular_precio_venta_snapshot(
--                 v_item.id_producto, p_forma_pago, v_ids_desc,
--                 v_fin_cuenta, v_fin_medio, v_fin_propia);
--     if not (v_snap->>'ok')::boolean then
--       raise exception 'precio-no-resoluble: producto % (%)',
--         v_item.id_producto, v_snap->>'reason' using errcode = '22023';
--     end if;
--     v_precio := (v_snap->>'precio_final')::numeric;
--     v_costo  := v_item.costo_ingreso;
--
--     if v_item.tipo_ingreso = 'compra' then
--       v_monto_prov := 0;
--       v_id_prov := null;
--     else
--       v_monto_prov := v_costo;
--       select id_proveedor into v_id_prov
--         from ingreso_mercaderia
--        where id_ingreso = v_item.id_ingreso;
--     end if;
--
--     v_monto_gan := v_precio - v_costo;
--
--     v_lineas_procesadas := v_lineas_procesadas || jsonb_build_object(
--       'id_item', v_id_item, 'id_producto', v_item.id_producto,
--       'id_prov', coalesce(v_id_prov::text, ''), 'precio', v_precio, 'costo', v_costo,
--       'monto_prov', v_monto_prov,
--       'monto_gan', v_monto_gan, 'tipo_ingreso', v_item.tipo_ingreso,
--       'desglose', coalesce(v_snap->'desglose', '{}'::jsonb),
--       'id_dcr', v_id_dcr
--     );
--
--     v_total := v_total + v_precio;
--   end loop;
--
--   insert into venta(id_venta, id_tenant, id_cliente, id_usuario_alta, forma_pago,
--                     total, observaciones, financiacion,
--                     id_cuenta_recargo, medio_recargo,
--                     canal, id_revendedora)
--   values (v_id_venta, v_tenant, p_id_cliente, v_actor, p_forma_pago, v_total, p_observaciones,
--           case
--             when p_financiacion is not null then 'propia'::tipo_financiacion
--             when p_forma_pago::text ~ '^cuotas_\d+$' then 'externa'::tipo_financiacion
--             else 'ninguna'::tipo_financiacion
--           end,
--           v_fin_cuenta, v_fin_medio,
--           v_canal, p_id_revendedora);
--
--   for v_linea in select * from jsonb_array_elements(v_lineas_procesadas) loop
--     insert into detalle_venta(
--       id_tenant, id_venta, id_item, id_producto, id_proveedor,
--       precio_venta, costo_snapshot, monto_proveedor, monto_gasto, monto_ganancia,
--       tipo_ingreso_snapshot, desglose_reglas,
--       porcentaje_comision_preview
--     ) values (
--       v_tenant, v_id_venta, (v_linea->>'id_item')::uuid, (v_linea->>'id_producto')::uuid, nullif(v_linea->>'id_prov', '')::uuid,
--       (v_linea->>'precio')::numeric, (v_linea->>'costo')::numeric, (v_linea->>'monto_prov')::numeric, 0, (v_linea->>'monto_gan')::numeric,
--       (v_linea->>'tipo_ingreso')::tipo_ingreso, (v_linea->'desglose'),
--       v_pct_preview
--     );
--
--     perform sp_transicion_item_producto(
--       (v_linea->>'id_item')::uuid, 'vendido', 'venta', v_id_venta, 'venta', p_ip
--     );
--
--     if v_canal = 'revendedora' and (v_linea->>'id_dcr') is not null then
--       update consignacion_revendedora_detalle
--          set estado_detalle = 'vendido'
--        where id_consignacion_revendedora_detalle = (v_linea->>'id_dcr')::uuid;
--     end if;
--   end loop;
--
--   if p_id_reserva is not null then
--     update reserva
--        set estado_reserva = 'convertida_venta',
--            fecha_cierre = now()
--      where id_reserva = p_id_reserva;
--   end if;
--
--   -- ─── Cobranza y registro de pagos (DR-14) ──────────────────────────
--   if v_canal = 'revendedora' then
--     if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
--       raise exception 'venta-revendedora-con-pagos' using errcode = '22023';
--     end if;
--     if v_total > 0 then
--       insert into pago_venta(
--         id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
--         costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
--       ) values (
--         v_tenant, v_id_venta, null, 'cuenta_revendedora'::medio_pago, v_total, null,
--         0, v_total, null, '{}'::jsonb
--       );
--       v_pagado := v_total;
--     end if;
--
--   elsif p_pagos is null or jsonb_array_length(p_pagos) = 0 then
--     if v_total > 0 and p_financiacion is null then
--       select id_cuenta_destino into v_id_cuenta
--         from cuenta_destino
--        where id_tenant = v_tenant
--          and id_cuenta_destino = coalesce(v_fin_cuenta, id_cuenta_destino)
--          and (v_fin_cuenta is not null or es_predeterminada)
--          and activo
--        limit 1;
--       if v_id_cuenta is null then
--         raise exception 'sin-cuenta-predeterminada' using errcode = '22023';
--       end if;
--
--       v_medio := coalesce(v_fin_medio, case p_forma_pago::text
--                    when 'efectivo' then 'efectivo'::medio_pago
--                    when 'transferencia' then 'transferencia'::medio_pago
--                    else 'tarjeta_credito'::medio_pago
--                  end);
--       v_cuotas := nullif(substring(p_forma_pago::text from '^cuotas_(\d+)$'), '')::smallint;
--
--       v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_total);
--       v_costo_cobro := (v_cobro->>'costo_total')::numeric;
--
--       insert into pago_venta(
--         id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
--         costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
--       ) values (
--         v_tenant, v_id_venta, v_id_cuenta, v_medio, v_total, v_cuotas,
--         v_costo_cobro, v_total - v_costo_cobro,
--         fn_hoy_tenant() + (v_cobro->>'dias_acreditacion')::int,
--         v_cobro
--       );
--       v_pagado := v_total;
--     end if;
--
--   else
--     for v_pago in select * from jsonb_array_elements(p_pagos) loop
--       v_id_cuenta  := (v_pago->>'id_cuenta_destino')::uuid;
--       v_monto_pago := (v_pago->>'monto')::numeric;
--       v_medio      := (v_pago->>'medio')::medio_pago;
--       v_cuotas     := nullif(v_pago->>'cuotas', '')::smallint;
--
--       if v_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
--         raise exception 'medio-solo-revendedora' using errcode = '22023';
--       end if;
--
--       if v_id_cuenta is null then
--         raise exception 'pago-sin-cuenta' using errcode = '22023';
--       end if;
--       if v_monto_pago is null or v_monto_pago <= 0 then
--         raise exception 'pago-monto-invalido: %', v_monto_pago using errcode = '22023';
--       end if;
--       if not exists (
--         select 1 from cuenta_destino
--          where id_cuenta_destino = v_id_cuenta
--            and id_tenant = v_tenant
--            and activo
--       ) then
--         raise exception 'cuenta-destino-invalida: %', v_id_cuenta using errcode = '22023';
--       end if;
--       if v_medio = 'tarjeta_credito' and v_cuotas is null then
--         raise exception 'pago-credito-sin-cuotas' using errcode = '22023';
--       end if;
--       if v_medio <> 'tarjeta_credito' and v_cuotas is not null then
--         raise exception 'pago-cuotas-medio-invalido: %', v_medio using errcode = '22023';
--       end if;
--
--       v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_monto_pago);
--       v_costo_cobro := (v_cobro->>'costo_total')::numeric;
--
--       insert into pago_venta(
--         id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
--         monto_recibido, referencia,
--         costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
--       ) values (
--         v_tenant, v_id_venta, v_id_cuenta, v_medio, v_monto_pago, v_cuotas,
--         nullif(v_pago->>'monto_recibido', '')::numeric,
--         nullif(v_pago->>'referencia', ''),
--         v_costo_cobro, v_monto_pago - v_costo_cobro,
--         fn_hoy_tenant() + (v_cobro->>'dias_acreditacion')::int,
--         v_cobro
--       );
--
--       v_pagado := v_pagado + v_monto_pago;
--     end loop;
--   end if;
--
--   if p_financiacion is not null then
--     v_a_financiar := v_total - v_pagado;
--     if v_a_financiar <= 0 then
--       raise exception 'financiacion-sin-saldo: pagado % contra total %',
--         v_pagado, v_total using errcode = '22023';
--     end if;
--
--     v_cuota_base := round(v_a_financiar / v_fin_cuotas, 2);
--
--     v_i := 0;
--     for v_venc in select * from fn_vencimientos_cuotas(v_fin_desde, v_fin_cuotas) loop
--       v_i := v_i + 1;
--       if v_i = v_fin_cuotas then
--         v_monto_cuota := v_a_financiar - v_acumulado;
--       else
--         v_monto_cuota := v_cuota_base;
--       end if;
--       v_acumulado := v_acumulado + v_monto_cuota;
--
--       insert into cuota_financiada(
--         id_tenant, id_venta, id_cliente, numero, monto, fecha_vencimiento
--       ) values (
--         v_tenant, v_id_venta, p_id_cliente, v_i, v_monto_cuota, v_venc
--       );
--     end loop;
--
--     if v_pagado + v_acumulado <> v_total then
--       raise exception 'financiacion-no-cuadra: % + % contra %',
--         v_pagado, v_acumulado, v_total using errcode = '22023';
--     end if;
--
--   elsif p_pagos is not null and jsonb_array_length(p_pagos) > 0 and v_canal <> 'revendedora' then
--     if v_pagado <> v_total then
--       raise exception 'pagos-no-cuadran: pagado % contra total %',
--         v_pagado, v_total using errcode = '22023';
--     end if;
--   end if;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'venta', v_id_venta::text, 'crear',
--           jsonb_build_object('total', v_total,
--                              'lineas', jsonb_array_length(p_lineas),
--                              'forma_pago', p_forma_pago,
--                              'id_cliente', p_id_cliente,
--                              'id_reserva', p_id_reserva,
--                              'canal', v_canal,
--                              'id_revendedora', p_id_revendedora,
--                              'pagado', v_pagado,
--                              'pagos', coalesce(jsonb_array_length(p_pagos), 1),
--                              'financiado', v_acumulado,
--                              'cuotas_financiadas', coalesce(v_fin_cuotas, 0)),
--           p_ip);
--
--   return v_id_venta;
-- end $$;
--
-- NOTE: sp_registrar_cambio (00153_cpc_costo_pendiente.sql:1337)
-- create or replace function sp_registrar_cambio(
--   p_id_detalle_original   uuid,
--   p_id_item_entregado     uuid,
--   p_motivo                text default null,
--   p_medio_cobro           medio_pago default null,
--   p_id_cuenta_destino     uuid default null,
--   p_ip                    inet default null
-- ) returns jsonb
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant                  uuid := auth_tenant_id();
--   v_actor                   uuid := auth.uid();
--   v_id_venta                uuid;
--   v_id_item_original        uuid;
--   v_id_prod_original        uuid;
--   v_precio_original         numeric(14,2);
--   v_costo_original          numeric(14,2);
--   v_porcentaje_preview_orig numeric(5,2);
--   v_id_rendicion            uuid;
--   v_id_liquidacion          uuid;
--   v_canal                   canal_venta;
--   v_id_revendedora          uuid;
--   v_estado_venta            estado_venta;
--   v_estado_item_orig        estado_item;
--   v_estado_item_nuevo       estado_item;
--   v_id_prod_nuevo           uuid;
--   v_costo_nuevo             numeric(14,2);
--   v_tipo_ingreso_nuevo      tipo_ingreso;
--   v_precio_nuevo            numeric(14,2);
--   v_diferencia              numeric(14,2);
--   v_id_det_nuevo            uuid;
--   v_id_cambio               uuid;
-- begin
--   if not (select auth_tiene_permiso('ventas', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   -- 1. Leer y bloquear detalle_venta y venta originales
--   select
--     dv.id_venta,
--     dv.id_item,
--     dv.id_producto,
--     dv.precio_venta,
--     dv.costo_snapshot,
--     dv.porcentaje_comision_preview,
--     dv.id_rendicion,
--     dv.id_liquidacion,
--     v.canal,
--     v.id_revendedora,
--     v.estado_venta
--   into
--     v_id_venta,
--     v_id_item_original,
--     v_id_prod_original,
--     v_precio_original,
--     v_costo_original,
--     v_porcentaje_preview_orig,
--     v_id_rendicion,
--     v_id_liquidacion,
--     v_canal,
--     v_id_revendedora,
--     v_estado_venta
--   from detalle_venta dv
--   join venta v on v.id_venta = dv.id_venta
--   where dv.id_detalle_venta = p_id_detalle_original
--     and dv.id_tenant = v_tenant
--     and v.id_tenant = v_tenant
--   for update of dv, v;
--
--   if v_id_venta is null then
--     raise exception 'detalle-venta-not-found' using errcode = '42704';
--   end if;
--
--   -- 2. Guardas de estado de venta y liquidación
--   if v_estado_venta = 'anulada' then
--     raise exception 'venta-anulada' using errcode = '22023';
--   end if;
--
--   if v_id_liquidacion is not null then
--     raise exception 'venta-liquidada' using errcode = '22023';
--   end if;
--
--   if v_id_rendicion is not null then
--     raise exception 'detalle-ya-rendido' using errcode = '22023';
--   end if;
--
--   if exists (select 1 from devolucion_venta where id_detalle_venta = p_id_detalle_original) then
--     raise exception 'detalle-ya-devuelto' using errcode = '22023';
--   end if;
--
--   if exists (select 1 from cambio_venta where id_detalle_original = p_id_detalle_original) then
--     raise exception 'detalle-ya-cambiado' using errcode = '22023';
--   end if;
--
--   if exists (
--     select 1 from cuota_financiada
--      where id_venta = v_id_venta and estado in ('pendiente', 'parcial')
--   ) then
--     raise exception 'cambio-venta-con-cuotas-abiertas' using errcode = '22023';
--   end if;
--
--   -- 3. Guardas de módulo si canal revendedora
--   if v_canal = 'revendedora' then
--     if not exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--     end if;
--   end if;
--
--   -- 4. Bloquear y verificar estado del ítem original
--   select estado_item into v_estado_item_orig
--   from item_producto
--   where id_item = v_id_item_original and id_tenant = v_tenant
--   for update;
--
--   if v_estado_item_orig <> 'vendido' then
--     raise exception 'item-no-esta-vendido: estado=%', v_estado_item_orig using errcode = '22023';
--   end if;
--
--   -- 5. Bloquear y verificar ítem entregado
--   select
--     ip.estado_item,
--     ip.id_producto,
--     ip.costo_ingreso,
--     ip.tipo_ingreso,
--     p.precio_venta
--   into
--     v_estado_item_nuevo,
--     v_id_prod_nuevo,
--     v_costo_nuevo,
--     v_tipo_ingreso_nuevo,
--     v_precio_nuevo
--   from item_producto ip
--   join producto p on p.id_producto = ip.id_producto
--   where ip.id_item = p_id_item_entregado
--     and ip.id_tenant = v_tenant
--     and p.id_tenant = v_tenant
--   for update of ip;
--
--   if v_estado_item_nuevo is null then
--     raise exception 'item-not-found' using errcode = '42704';
--   end if;
--
--   -- Guarda: ítem entregado con costo pendiente no puede ser entregado en cambio
--   if v_costo_nuevo is null then
--     raise exception 'item-costo-pendiente' using errcode = 'P0001';
--   end if;
--
--   if v_canal = 'local' then
--     if v_estado_item_nuevo <> 'disponible' then
--       raise exception 'item-no-disponible: estado=%', v_estado_item_nuevo using errcode = '22023';
--     end if;
--   elsif v_canal = 'revendedora' then
--     if v_estado_item_nuevo <> 'en_revendedora' then
--       raise exception 'item-no-disponible: estado=%', v_estado_item_nuevo using errcode = '22023';
--     end if;
--
--     if not exists (
--       select 1
--       from consignacion_revendedora_detalle crd
--       join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
--       where cr.id_tenant = v_tenant
--         and cr.id_revendedora = v_id_revendedora
--         and cr.confirmada = true
--         and cr.estado = 'abierta'
--         and crd.id_item = p_id_item_entregado
--         and crd.estado_detalle = 'en_poder'
--     ) then
--       raise exception 'item-no-en-poder-revendedora' using errcode = '22023';
--     end if;
--   end if;
--
--   -- 6. Calcular diferencia
--   v_diferencia := v_precio_nuevo - v_precio_original;
--
--   if v_diferencia < 0 then
--     raise exception 'diferencia-negativa-no-permitida' using errcode = '22023';
--   end if;
--
--   -- 7. Registrar cobro de diferencia si corresponde
--   if v_diferencia > 0 then
--     if v_canal = 'local' then
--       if p_medio_cobro is null or p_id_cuenta_destino is null then
--         raise exception 'diferencia-requiere-medio-y-cuenta' using errcode = '22023';
--       end if;
--
--       if not exists (
--         select 1 from cuenta_destino
--         where id_tenant = v_tenant and id_cuenta_destino = p_id_cuenta_destino
--       ) then
--         raise exception 'cuenta-destino-invalida' using errcode = '22023';
--       end if;
--
--       insert into pago_venta (
--         id_tenant, id_venta, id_cuenta_destino, medio, monto, created_at
--       ) values (
--         v_tenant, v_id_venta, p_id_cuenta_destino, p_medio_cobro, v_diferencia, now()
--       );
--     elsif v_canal = 'revendedora' then
--       insert into pago_venta (
--         id_tenant, id_venta, id_cuenta_destino, medio, monto, created_at
--       ) values (
--         v_tenant, v_id_venta, null, 'cuenta_revendedora', v_diferencia, now()
--       );
--     end if;
--   end if;
--
--   -- 8. Transicionar ítems usando is_transicion_item_valida
--   if v_canal = 'revendedora' then
--     if not is_transicion_item_valida('vendido', 'en_revendedora') then
--       raise exception 'invalid-transition' using errcode = '22023';
--     end if;
--     perform sp_transicion_item_producto(
--       v_id_item_original, 'en_revendedora', 'ajuste', v_id_venta, 'cambio_producto', p_ip
--     );
--     update consignacion_revendedora_detalle
--        set estado_detalle = 'en_poder'
--      where id_item = v_id_item_original and estado_detalle = 'vendido';
--
--     if not is_transicion_item_valida('en_revendedora', 'vendido') then
--       raise exception 'invalid-transition' using errcode = '22023';
--     end if;
--     perform sp_transicion_item_producto(
--       p_id_item_entregado, 'vendido', 'venta', v_id_venta, 'cambio_producto', p_ip
--     );
--     update consignacion_revendedora_detalle
--        set estado_detalle = 'vendido'
--      where id_item = p_id_item_entregado and estado_detalle = 'en_poder';
--   else
--     if not is_transicion_item_valida('vendido', 'disponible') then
--       raise exception 'invalid-transition' using errcode = '22023';
--     end if;
--     perform sp_transicion_item_producto(
--       v_id_item_original, 'disponible', 'ajuste', v_id_venta, 'cambio_producto', p_ip
--     );
--
--     if not is_transicion_item_valida('disponible', 'vendido') then
--       raise exception 'invalid-transition' using errcode = '22023';
--     end if;
--     perform sp_transicion_item_producto(
--       p_id_item_entregado, 'vendido', 'venta', v_id_venta, 'cambio_producto', p_ip
--     );
--   end if;
--
--   -- 9. Marcar línea original excluida de liquidación
--   update detalle_venta
--      set excluida_liquidacion = true
--    where id_detalle_venta = p_id_detalle_original;
--
--   -- 10. Crear nueva línea en detalle_venta para el ítem entregado
--   -- precio_venta se congela en v_precio_original (base de liquidación original, DR-5)
--   insert into detalle_venta (
--     id_tenant, id_venta, id_item, id_producto,
--     precio_venta, costo_snapshot, monto_proveedor, monto_gasto,
--     monto_ganancia, tipo_ingreso_snapshot, desglose_reglas,
--     id_rendicion, excluida_rendicion, porcentaje_comision_preview,
--     monto_comision, id_liquidacion, excluida_liquidacion
--   ) values (
--     v_tenant, v_id_venta, p_id_item_entregado, v_id_prod_nuevo,
--     v_precio_original, v_costo_nuevo, 0, 0,
--     v_precio_original - v_costo_nuevo, v_tipo_ingreso_nuevo, '{}'::jsonb,
--     null, false, v_porcentaje_preview_orig,
--     0, null, false
--   ) returning id_detalle_venta into v_id_det_nuevo;
--
--   -- 11. Registrar en cambio_venta
--   insert into cambio_venta (
--     id_tenant, id_venta_original, id_detalle_original, id_item_entregado,
--     diferencia, motivo, origen, id_usuario_alta
--   ) values (
--     v_tenant, v_id_venta, p_id_detalle_original, p_id_item_entregado,
--     v_diferencia, p_motivo, v_canal, v_actor
--   ) returning id_cambio into v_id_cambio;
--
--   -- 12. Auditoría
--   insert into auditoria (
--     id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip
--   ) values (
--     v_tenant, v_actor, 'cambio_venta', v_id_cambio::text, 'registrar_cambio',
--     jsonb_build_object(
--       'id_venta', v_id_venta,
--       'id_detalle_original', p_id_detalle_original,
--       'id_item_entregado', p_id_item_entregado,
--       'id_detalle_nuevo', v_id_det_nuevo,
--       'diferencia', v_diferencia,
--       'motivo', p_motivo
--     ),
--     p_ip
--   );
--
--   return jsonb_build_object(
--     'id_cambio', v_id_cambio,
--     'id_detalle_nuevo', v_id_det_nuevo,
--     'diferencia', v_diferencia
--   );
-- end;
-- $$;
--
-- NOTE: sp_registrar_devolucion_cliente (00144_rlsp_sp_ventas.sql:632)
-- create or replace function sp_registrar_devolucion_cliente(
--   p_id_detalle_venta    uuid,
--   p_motivo              text default null,
--   p_id_cuenta_reintegro uuid default null,
--   p_medio_reintegro     medio_pago default null,
--   p_ip                  inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant            uuid := auth_tenant_id();
--   v_actor             uuid := auth.uid();
--   v_id_item           uuid;
--   v_id_venta          uuid;
--   v_id_devolucion     uuid;
--   v_canal             canal_venta;
--   v_estado_item       estado_item;
--   v_estado_venta      estado_venta;
--   v_total_venta       numeric(14,2);
--   v_precio_venta      numeric(14,2);
--   v_costo_snapshot    numeric(14,2);
--   v_sum_pagos         numeric(14,2);
--   v_sum_dev_previas   numeric(14,2);
--   v_sum_reint_previos numeric(14,2);
--   v_reintegro         numeric(14,2) := 0;
--   v_cuotas_abiertas   boolean;
--   v_ya_devuelta       boolean;
--   v_ya_rendida        boolean;
--   v_id_liquidacion    uuid;
-- begin
--   if not (select auth_tiene_permiso('ventas', 'editar')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Lock del item_producto y lectura de detalle_venta
--   select dv.id_item, ip.estado_item, dv.id_venta, dv.precio_venta, dv.costo_snapshot,
--          dv.id_rendicion is not null, dv.id_liquidacion
--     into v_id_item, v_estado_item, v_id_venta, v_precio_venta, v_costo_snapshot,
--          v_ya_rendida, v_id_liquidacion
--     from detalle_venta dv
--     join item_producto ip on ip.id_item = dv.id_item
--    where dv.id_detalle_venta = p_id_detalle_venta
--      and dv.id_tenant = v_tenant
--    for update of ip;
--
--   if v_id_item is null then
--     raise exception 'detalle-venta-not-found' using errcode = '42704';
--   end if;
--
--   if v_id_liquidacion is not null then
--     raise exception 'venta-liquidada' using errcode = '22023';
--   end if;
--
--   if exists (
--     select 1 from cambio_venta
--     where id_detalle_original = p_id_detalle_venta
--       and id_tenant = v_tenant
--   ) then
--     raise exception 'detalle-ya-cambiado' using errcode = '22023';
--   end if;
--
--   if v_estado_item <> 'vendido' then
--     raise exception 'item-no-esta-vendido: estado=%', v_estado_item using errcode = '22023';
--   end if;
--
--   if v_ya_rendida then
--     raise exception 'detalle-ya-rendido' using errcode = '22023';
--   end if;
--
--   select exists(
--     select 1 from devolucion_venta
--      where id_detalle_venta = p_id_detalle_venta
--   ) into v_ya_devuelta;
--
--   if v_ya_devuelta then
--     raise exception 'detalle-ya-devuelto' using errcode = '22023';
--   end if;
--
--   select estado_venta, total, canal into v_estado_venta, v_total_venta, v_canal
--     from venta
--    where id_venta = v_id_venta for update;
--
--   if v_canal = 'revendedora' then
--     raise exception 'devolucion-venta-revendedora' using errcode = '22023';
--   end if;
--
--   if v_estado_venta = 'anulada' then
--     raise exception 'venta-anulada' using errcode = '22023';
--   end if;
--
--   select exists(
--     select 1 from cuota_financiada
--      where id_venta = v_id_venta and estado in ('pendiente', 'parcial')
--   ) into v_cuotas_abiertas;
--
--   if v_cuotas_abiertas then
--     raise exception 'devolucion-venta-con-cuotas-abiertas' using errcode = '22023';
--   end if;
--
--   -- Calcular reintegro (excluye pagos cuenta_revendedora)
--   select coalesce(sum(monto), 0) into v_sum_pagos
--     from pago_venta
--    where id_venta = v_id_venta
--      and medio <> 'cuenta_revendedora';
--
--   select coalesce(sum(dv.precio_venta), 0) into v_sum_dev_previas
--     from devolucion_venta dev
--     join detalle_venta dv on dv.id_detalle_venta = dev.id_detalle_venta
--    where dev.id_venta = v_id_venta;
--
--   select coalesce(sum(monto), 0) into v_sum_reint_previos
--     from reintegro_cliente
--    where id_venta = v_id_venta;
--
--   v_reintegro := greatest(0::numeric, v_sum_pagos - (v_total_venta - v_sum_dev_previas - v_precio_venta) - v_sum_reint_previos);
--
--   if v_reintegro > 0 and (p_id_cuenta_reintegro is null or p_medio_reintegro is null) then
--     raise exception 'reintegro-requiere-cuenta-y-medio' using errcode = '22023';
--   end if;
--
--   -- Insertar devolucion_venta
--   insert into devolucion_venta (
--     id_tenant, id_venta, id_detalle_venta, id_item,
--     monto, costo_recuperado, motivo, id_usuario
--   ) values (
--     v_tenant, v_id_venta, p_id_detalle_venta, v_id_item,
--     v_precio_venta, v_costo_snapshot, p_motivo, v_actor
--   ) returning id_devolucion into v_id_devolucion;
--
--   -- Insertar reintegro_cliente si corresponde
--   if v_reintegro > 0 then
--     insert into reintegro_cliente (
--       id_tenant, id_venta, id_devolucion, id_cuenta_destino,
--       medio, monto, origen, motivo, id_usuario
--     ) values (
--       v_tenant, v_id_venta, v_id_devolucion, p_id_cuenta_reintegro,
--       p_medio_reintegro, v_reintegro, 'devolucion', p_motivo, v_actor
--     );
--   end if;
--
--   -- Transicionar item
--   perform sp_transicion_item_producto(
--     v_id_item, 'devuelto_cliente', 'ajuste',
--     p_id_detalle_venta, 'devolucion_cliente', p_ip
--   );
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'detalle_venta', p_id_detalle_venta::text, 'devolucion_cliente',
--           jsonb_build_object('motivo', p_motivo, 'reintegro', v_reintegro), p_ip);
--
--   return jsonb_build_object('reintegro', v_reintegro);
-- end;
-- $$;
--
-- NOTE: sp_generar_rendicion (00155_cpc_policies_y_herencia.sql:2113)
-- create or replace function sp_generar_rendicion(
--   p_id_proveedor  uuid,
--   p_observaciones text default null,
--   p_ip            inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id       uuid;
--   v_total    numeric(14, 2);
--   v_count    integer;
--   v_desde    timestamptz;
--   v_hasta    timestamptz;
-- begin
--   if not (
--     (select auth_tiene_permiso('rendiciones', 'crear'))
--     and (select auth_tiene_permiso('rendiciones', 'ver'))
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   -- Modificado para excluir devueltos
--   select
--     coalesce(sum(dv.monto_proveedor), 0),
--     count(*),
--     min(v.fecha),
--     max(v.fecha)
--   into v_total, v_count, v_desde, v_hasta
--   from detalle_venta dv
--   join venta v on v.id_venta = dv.id_venta
--   left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--   where dv.id_tenant = v_tenant
--     and dv.id_proveedor = p_id_proveedor
--     and dv.id_rendicion is null
--     and dv.excluida_rendicion = false
--     and dv.monto_proveedor > 0
--     and v.estado_venta = 'registrada'
--     and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS
--
--   if v_count = 0 then
--     raise exception 'sin-lineas-pendientes' using errcode = '22023';
--   end if;
--
--   insert into rendicion_proveedor(
--     id_tenant, id_proveedor, id_usuario_alta,
--     periodo_desde, periodo_hasta,
--     monto_total, cantidad_lineas, observaciones
--   ) values (
--     v_tenant, p_id_proveedor, v_actor,
--     v_desde, v_hasta,
--     v_total, v_count, p_observaciones
--   ) returning id_rendicion into v_id;
--
--   update detalle_venta dv
--      set id_rendicion = v_id
--     from venta v
--    where v.id_venta = dv.id_venta
--      and dv.id_tenant = v_tenant
--      and dv.id_proveedor = p_id_proveedor
--      and dv.id_rendicion is null
--      and dv.excluida_rendicion = false
--      and dv.monto_proveedor > 0
--      and v.estado_venta = 'registrada'
--      and not exists (select 1 from devolucion_venta dev
--                       where dev.id_detalle_venta = dv.id_detalle_venta); -- EXCLUIR DEVUELTOS
--
--   select coalesce(sum(monto_proveedor), 0), count(*)
--     into v_total, v_count
--     from detalle_venta
--    where id_rendicion = v_id;
--
--   update rendicion_proveedor
--      set monto_total = v_total, cantidad_lineas = v_count
--    where id_rendicion = v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rendicion_proveedor', v_id::text, 'generar',
--           jsonb_build_object('id_proveedor', p_id_proveedor,
--                              'monto_total', v_total,
--                              'cantidad_lineas', v_count,
--                              'periodo_desde', v_desde,
--                              'periodo_hasta', v_hasta),
--           p_ip);
--   return v_id;
-- end $$;
--
-- NOTE: preview_rendicion (00155_cpc_policies_y_herencia.sql:2258)
-- create or replace function preview_rendicion(
--   p_id_proveedor uuid
-- ) returns table (
--   id_detalle_venta uuid,
--   id_venta         uuid,
--   fecha            timestamptz,
--   producto_nombre  text,
--   producto_sku     text,
--   qr_code          text,
--   precio_venta     numeric,
--   costo_snapshot   numeric,
--   monto_proveedor  numeric,
--   cliente_nombre   text
-- ) language plpgsql stable as $$
-- begin
--   if not (select auth_tiene_permiso('rendiciones', 'ver')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(auth_tenant_id(), 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   return query
--   select
--     dv.id_detalle_venta,
--     v.id_venta,
--     v.fecha,
--     p.nombre  as producto_nombre,
--     p.sku     as producto_sku,
--     ip.qr_code,
--     dv.precio_venta,
--     dv.costo_snapshot,
--     dv.monto_proveedor,
--     c.nombre  as cliente_nombre
--   from detalle_venta dv
--   join venta v          on v.id_venta = dv.id_venta
--   join producto p       on p.id_producto = dv.id_producto
--   join item_producto ip on ip.id_item = dv.id_item
--   left join cliente c   on c.id_cliente = v.id_cliente
--   left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
--   where dv.id_tenant = auth_tenant_id()
--     and dv.id_proveedor = p_id_proveedor
--     and dv.id_rendicion is null
--     and dv.excluida_rendicion = false
--     and dv.monto_proveedor > 0
--     and v.estado_venta = 'registrada'
--     and dev.id_devolucion is null -- EXCLUIR DEVUELTOS
--   order by v.fecha asc;
-- end $$;
--
-- NOTE: sp_perdida_incobrable_venta (00155_cpc_policies_y_herencia.sql:2899)
-- create or replace function sp_perdida_incobrable_venta(p_id_venta uuid)
-- returns jsonb
-- language plpgsql
-- stable
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_ver_costos boolean;
--   v_adeudado   numeric(14, 2);
--   v_cobrado    numeric(14, 2);
--   v_costo      numeric(14, 2);
--   v_no_cub     numeric(14, 2);
--   v_ratio      numeric;
--   v_detalle    jsonb := '[]'::jsonb;
--   v_acum       numeric(14, 2) := 0;
--   v_linea_no_cub numeric(14, 2);
--   v_lineas     integer;
--   v_i          integer := 0;
--   r            record;
-- begin
--   if not (select auth_tiene_permiso('ventas', 'ver')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
--
--   select coalesce(sum(monto - monto_pagado), 0) into v_adeudado
--     from cuota_financiada
--    where id_venta = p_id_venta and id_tenant = v_tenant
--      and estado = 'incobrable';
--
--   select coalesce(sum(monto), 0) into v_cobrado
--     from pago_venta
--    where id_venta = p_id_venta and id_tenant = v_tenant;
--
--   if not v_ver_costos then
--     return jsonb_build_object(
--       'monto_adeudado',    v_adeudado,
--       'total_cobrado',     v_cobrado,
--       'costo_total',       null,
--       'costo_no_cubierto', null,
--       'detalle',           '[]'::jsonb
--     );
--   end if;
--
--   select coalesce(sum(
--            case when tipo_ingreso_snapshot = 'compra'
--                 then costo_snapshot
--                 else monto_proveedor
--            end), 0),
--          count(*)
--     into v_costo, v_lineas
--     from detalle_venta
--    where id_venta = p_id_venta and id_tenant = v_tenant;
--
--   v_no_cub := greatest(0, v_costo - v_cobrado);
--
--   -- Proporción del costo que quedó SIN cubrir. Con costo 0 (todo compra
--   -- propia ya amortizada, o una venta sin costo) no hay nada que repartir.
--   v_ratio := case when v_costo > 0 then v_no_cub / v_costo else 0 end;
--
--   if v_no_cub > 0 then
--     for r in
--       select dv.id_detalle_venta,
--              dv.tipo_ingreso_snapshot,
--              dv.excluida_rendicion,
--              dv.id_rendicion,
--              p.nombre as producto_nombre,
--              p.sku    as producto_sku,
--              pr.id_proveedor,
--              pr.nombre as proveedor_nombre,
--              case when dv.tipo_ingreso_snapshot = 'compra'
--                   then dv.costo_snapshot
--                   else dv.monto_proveedor
--              end as costo_linea
--         from detalle_venta dv
--         left join producto  p  on p.id_producto  = dv.id_producto
--         left join proveedor pr on pr.id_proveedor = dv.id_proveedor
--        where dv.id_venta = p_id_venta and dv.id_tenant = v_tenant
--        order by dv.created_at, dv.id_detalle_venta
--     loop
--       v_i := v_i + 1;
--       if v_i = v_lineas then
--         v_linea_no_cub := v_no_cub - v_acum;
--       else
--         v_linea_no_cub := round(r.costo_linea * v_ratio, 2);
--       end if;
--       v_acum := v_acum + v_linea_no_cub;
--
--       v_detalle := v_detalle || jsonb_build_object(
--         'id_detalle_venta',      r.id_detalle_venta,
--         'producto_nombre',       r.producto_nombre,
--         'producto_sku',          r.producto_sku,
--         'tipo_ingreso_snapshot', r.tipo_ingreso_snapshot,
--         'id_proveedor',          r.id_proveedor,
--         'proveedor_nombre',      r.proveedor_nombre,
--         'costo_linea',           r.costo_linea,
--         'costo_cubierto',        r.costo_linea - v_linea_no_cub,
--         'costo_no_cubierto',     v_linea_no_cub,
--         -- DECISIÓN DE NEGOCIO (confirmada): al proveedor se le paga SIEMPRE,
--         -- cobre o no cobre el cliente. Así que `costo_no_cubierto` es plata que
--         -- sale del bolsillo sin vuelta, y `excluida_rendicion` NO se usa para
--         -- tapar incobrables. Se informa igual porque una línea excluida a mano
--         -- por otro motivo cambiaría la lectura, y la UI tiene que poder verlo.
--         'excluida_rendicion',    r.excluida_rendicion,
--         'rendida',               r.id_rendicion is not null
--       );
--     end loop;
--   end if;
--
--   return jsonb_build_object(
--     'monto_adeudado',    v_adeudado,
--     'total_cobrado',     v_cobrado,
--     'costo_total',       v_costo,
--     'costo_no_cubierto', v_no_cub,
--     'detalle',           v_detalle
--   );
-- end $$;
--
-- NOTE: fn_modulo_tiene_estado_vivo (00122_guardas_consignacion_ingreso_proveedor.sql:164)
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
--     -- N1: ítems en consignación disponibles, reservados o en revendedora
--     if exists (
--       select 1 from item_producto
--        where id_tenant = p_tenant
--          and tipo_ingreso = 'consignacion'
--          and estado_item in ('disponible', 'reservado', 'en_revendedora')
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
--
-- NOTE: rf_finanzas_resultados (00155_cpc_policies_y_herencia.sql:2311)
-- create or replace function rf_finanzas_resultados(p_desde date, p_hasta date)
-- returns table (
--   ventas_brutas numeric,
--   anulaciones numeric,
--   devoluciones numeric,
--   ventas_netas numeric,
--   costo_mercaderia numeric,
--   ganancia_sobre_ventas numeric,
--   costo_cobro numeric,
--   incobrables numeric,
--   bajas_inventario numeric,
--   ganancia_despues_de_costos numeric,
--   gastos numeric,
--   comision_liquidada numeric,
--   comision_pendiente_estimada numeric,
--   ganancia_final numeric,
--   cantidad_ventas bigint,
--   ticket_promedio numeric
-- )
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant_id uuid;
--   v_ver_costos boolean;
--   v_ventas_brutas numeric := 0;
--   v_anulaciones numeric := 0;
--   v_devoluciones numeric := 0;
--   v_costo_mercaderia numeric := 0;
--   v_costo_cobro numeric := 0;
--   v_incobrables numeric := 0;
--   v_bajas_inventario numeric := 0;
--   v_gastos numeric := 0;
--   v_comision_liquidada numeric := 0;
--   v_comision_pendiente_estimada numeric := 0;
--   v_cantidad_ventas bigint := 0;
--   v_zona text;
--   v_diferencias_cambio numeric := 0;
-- begin
--   if not (select auth_tiene_permiso('reportes', 'ver')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
--   v_tenant_id := auth_tenant_id();
--   select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;
--
--   -- Ventas brutas: ventas registradas del período + diferencias cobradas en cambios del período
--   select
--     coalesce(sum(v.total), 0) into v_ventas_brutas
--   from venta v
--   where v.id_tenant = v_tenant_id
--     and (v.fecha at time zone v_zona)::date >= p_desde
--     and (v.fecha at time zone v_zona)::date <= p_hasta;
--
--   select
--     coalesce(sum(cv.diferencia), 0) into v_diferencias_cambio
--   from cambio_venta cv
--   where cv.id_tenant = v_tenant_id
--     and (cv.created_at at time zone v_zona)::date >= p_desde
--     and (cv.created_at at time zone v_zona)::date <= p_hasta;
--
--   v_ventas_brutas := v_ventas_brutas + v_diferencias_cambio;
--
--   -- Anulaciones: suma total de ventas anuladas en el período + diferencias de cambios de esas ventas
--   select
--     coalesce(sum(v.total), 0) + coalesce((
--       select sum(cv.diferencia)
--       from cambio_venta cv
--       join venta va on va.id_venta = cv.id_venta_original
--       where va.id_tenant = v_tenant_id
--         and (va.fecha_anulacion at time zone v_zona)::date >= p_desde
--         and (va.fecha_anulacion at time zone v_zona)::date <= p_hasta
--     ), 0) into v_anulaciones
--   from venta v
--   where v.id_tenant = v_tenant_id
--     and (v.fecha_anulacion at time zone v_zona)::date >= p_desde
--     and (v.fecha_anulacion at time zone v_zona)::date <= p_hasta;
--
--   select
--     coalesce(sum(dv.monto), 0) into v_devoluciones
--   from devolucion_venta dv
--   where dv.id_tenant = v_tenant_id
--     and (dv.fecha at time zone v_zona)::date >= p_desde
--     and (dv.fecha at time zone v_zona)::date <= p_hasta;
--
--   if v_ver_costos then
--     select
--       coalesce(sum(vl.costo), 0) into v_costo_mercaderia
--     from v_linea_venta vl
--     where vl.id_tenant = v_tenant_id
--       and (vl.fecha_venta at time zone v_zona)::date >= p_desde
--       and (vl.fecha_venta at time zone v_zona)::date <= p_hasta;
--
--     declare
--       v_costo_anuladas numeric := 0;
--       v_costo_devueltas numeric := 0;
--     begin
--       select coalesce(sum(vl.costo), 0) into v_costo_anuladas
--       from v_linea_venta vl
--       where vl.id_tenant = v_tenant_id
--         and (vl.fecha_anulacion at time zone v_zona)::date >= p_desde
--         and (vl.fecha_anulacion at time zone v_zona)::date <= p_hasta;
--
--       select coalesce(sum(vl.costo_recuperado), 0) into v_costo_devueltas
--       from v_linea_venta vl
--       where vl.id_tenant = v_tenant_id
--         and (vl.fecha_devolucion at time zone v_zona)::date >= p_desde
--         and (vl.fecha_devolucion at time zone v_zona)::date <= p_hasta;
--
--       v_costo_mercaderia := v_costo_mercaderia - v_costo_anuladas - v_costo_devueltas;
--     end;
--   end if;
--
--   select
--     coalesce(sum(pv.costo_cobro), 0) into v_costo_cobro
--   from pago_venta pv
--   where pv.id_tenant = v_tenant_id 
--     and pv.medio <> 'cuenta_revendedora'
--     and (pv.created_at at time zone v_zona)::date >= p_desde
--     and (pv.created_at at time zone v_zona)::date <= p_hasta;
--
--   select
--     coalesce(sum(cf.monto - cf.monto_pagado), 0) into v_incobrables
--   from cuota_financiada cf
--   where cf.id_tenant = v_tenant_id
--     and cf.estado = 'incobrable'
--     and (cf.fecha_incobrable at time zone v_zona)::date >= p_desde
--     and (cf.fecha_incobrable at time zone v_zona)::date <= p_hasta;
--
--   if v_ver_costos then
--     select
--       coalesce(sum(ip.costo_ingreso), 0) into v_bajas_inventario
--     from item_producto ip
--     where ip.id_tenant = v_tenant_id
--       and ip.estado_item = 'baja'
--       and (ip.updated_at at time zone v_zona)::date >= p_desde
--       and (ip.updated_at at time zone v_zona)::date <= p_hasta;
--   end if;
--
--   select
--     coalesce(sum(gn.monto), 0) into v_gastos
--   from gasto_negocio gn
--   where gn.id_tenant = v_tenant_id
--     and (gn.fecha at time zone v_zona)::date >= p_desde
--     and (gn.fecha at time zone v_zona)::date <= p_hasta;
--
--   -- DR-2: comision_liquidada se devenga por fecha de liquidación, uniendo con liquidacion_revendedora
--   select
--     coalesce(sum(vl.comision), 0) into v_comision_liquidada
--   from v_linea_venta vl
--   where vl.id_tenant = v_tenant_id
--     and vl.comision > 0
--     and vl.fecha_liquidacion is not null
--     and vl.fecha_liquidacion >= p_desde
--     and vl.fecha_liquidacion <= p_hasta;
--
--   select
--     coalesce(sum(vl.comision_estimada), 0) into v_comision_pendiente_estimada
--   from v_linea_venta vl
--   where vl.id_tenant = v_tenant_id
--     and (vl.fecha_venta at time zone v_zona)::date >= p_desde
--     and (vl.fecha_venta at time zone v_zona)::date <= p_hasta;
--
--   -- Si el módulo revendedoras está apagado, las comisiones no aplican
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant_id and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     v_comision_liquidada := 0;
--     v_comision_pendiente_estimada := 0;
--   end if;
--
--   select count(*) into v_cantidad_ventas
--   from venta v
--   where v.id_tenant = v_tenant_id
--     and v.estado_venta = 'registrada'
--     and (v.fecha at time zone v_zona)::date >= p_desde
--     and (v.fecha at time zone v_zona)::date <= p_hasta;
--
--   return query select
--     v_ventas_brutas,
--     v_anulaciones,
--     v_devoluciones,
--     v_ventas_brutas - v_anulaciones - v_devoluciones as ventas_netas,
--     case when v_ver_costos then v_costo_mercaderia else null::numeric end as costo_mercaderia,
--     case when v_ver_costos then (v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia else null::numeric end as ganancia_sobre_ventas,
--     v_costo_cobro,
--     v_incobrables,
--     case when v_ver_costos then v_bajas_inventario else null::numeric end as bajas_inventario,
--     case when v_ver_costos then ((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario else null::numeric end as ganancia_despues_de_costos,
--     v_gastos,
--     v_comision_liquidada,
--     v_comision_pendiente_estimada,
--     case when v_ver_costos then (((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario) - v_gastos - v_comision_liquidada else null::numeric end as ganancia_final,
--     v_cantidad_ventas,
--     case when v_cantidad_ventas > 0 then (v_ventas_brutas - v_anulaciones - v_devoluciones) / v_cantidad_ventas else null::numeric end as ticket_promedio;
-- end;
-- $$;
--
-- NOTE: rf_finanzas_posicion (00155_cpc_policies_y_herencia.sql:2631)
-- create or replace function rf_finanzas_posicion()
-- returns table (
--   capital_propio numeric,
--   mercaderia_terceros numeric,
--   devueltos_clientes numeric,
--   valor_venta_potencial numeric,
--   productos_sin_precio bigint,
--   por_cobrar jsonb,
--   deuda_proveedores numeric
-- )
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant_id uuid;
--   v_ver_costos boolean;
--   v_capital_propio numeric := 0;
--   v_mercaderia_terceros numeric := 0;
--   v_devueltos_clientes numeric := 0;
--   v_valor_venta_potencial numeric := 0;
--   v_productos_sin_precio bigint := 0;
--   v_deuda_proveedores numeric := 0;
--   v_por_cobrar jsonb;
--   v_zona text;
-- begin
--   if not (select auth_tiene_permiso('reportes', 'ver')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
--   v_tenant_id := auth_tenant_id();
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;
--
--   if v_ver_costos then
--     select
--       coalesce(sum(costo_ingreso), 0) into v_capital_propio
--     from item_producto
--     where id_tenant = v_tenant_id and tipo_ingreso = 'compra' and estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--     select
--       coalesce(sum(costo_ingreso), 0) into v_mercaderia_terceros
--     from item_producto
--     where id_tenant = v_tenant_id and tipo_ingreso = 'consignacion' and estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--     select
--       coalesce(sum(costo_ingreso), 0) into v_devueltos_clientes
--     from item_producto
--     where id_tenant = v_tenant_id and estado_item = 'devuelto_cliente';
--   end if;
--
--   select
--     coalesce(sum(p.precio_venta), 0) into v_valor_venta_potencial
--   from item_producto ip
--   join producto p on p.id_producto = ip.id_producto
--   where ip.id_tenant = v_tenant_id and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--   select
--     count(*) into v_productos_sin_precio
--   from producto
--   where id_tenant = v_tenant_id and precio_venta = 0 and activo = true;
--
--   -- por_cobrar: (a cobrar, vence este mes, vencido, cuotas vencidas, clientes con deuda)
--   declare
--     v_a_cobrar numeric := 0;
--     v_vence_este_mes numeric := 0;
--     v_vencido numeric := 0;
--     v_cuotas_vencidas bigint := 0;
--     v_clientes_con_deuda bigint := 0;
--     v_hoy date;
--     v_vendido_rev numeric := 0;
--     v_comision_liq_rev numeric := 0;
--     v_pagado_rev numeric := 0;
--     v_deuda_rev numeric := 0;
--   begin
--     v_hoy := (now() at time zone v_zona)::date;
--
--     select
--       coalesce(sum(monto - monto_pagado), 0) into v_a_cobrar
--     from cuota_financiada
--     where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial');
--
--     select
--       coalesce(sum(monto - monto_pagado), 0) into v_vence_este_mes
--     from cuota_financiada
--     where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
--       and date_trunc('month', (fecha_vencimiento at time zone v_zona)::timestamp)::date = date_trunc('month', v_hoy::timestamp)::date;
--
--     select
--       coalesce(sum(monto - monto_pagado), 0) into v_vencido
--     from cuota_financiada
--     where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
--       and (fecha_vencimiento at time zone v_zona)::date < v_hoy;
--
--     select
--       count(*) into v_cuotas_vencidas
--     from cuota_financiada
--     where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
--       and (fecha_vencimiento at time zone v_zona)::date < v_hoy;
--
--     select
--       count(distinct v.id_cliente) into v_clientes_con_deuda
--     from cuota_financiada cf
--     join venta v on v.id_venta = cf.id_venta
--     where cf.id_tenant = v_tenant_id and cf.estado in ('pendiente', 'parcial') and v.id_cliente is not null;
--
--     -- Deuda adeudada por revendedoras: total_vendido - comisiones_liquidadas - total_pagado
--     if exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant_id and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       select coalesce(sum(dv.precio_venta), 0) into v_vendido_rev
--       from detalle_venta dv
--       join venta v on v.id_venta = dv.id_venta
--       where v.id_tenant = v_tenant_id
--         and v.canal = 'revendedora'
--         and v.estado_venta = 'registrada';
--
--       select coalesce(sum(monto_comision), 0) into v_comision_liq_rev
--       from liquidacion_revendedora
--       where id_tenant = v_tenant_id;
--
--       select coalesce(sum(monto), 0) into v_pagado_rev
--       from pago_revendedora
--       where id_tenant = v_tenant_id;
--
--       v_deuda_rev := greatest(0, v_vendido_rev - v_comision_liq_rev - v_pagado_rev);
--       v_a_cobrar := v_a_cobrar + v_deuda_rev;
--     end if;
--
--     v_por_cobrar := jsonb_build_object(
--       'a_cobrar', v_a_cobrar,
--       'vence_este_mes', v_vence_este_mes,
--       'vencido', v_vencido,
--       'cuotas_vencidas', v_cuotas_vencidas,
--       'clientes_con_deuda', v_clientes_con_deuda
--     );
--   end;
--
--   if v_ver_costos then
--     select
--       coalesce(sum(d.costo_unitario), 0) into v_deuda_proveedores
--     from item_producto ip
--     join ingreso_mercaderia_detalle d on d.id_ingreso = ip.id_ingreso and d.id_producto = ip.id_producto
--     where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'consignacion' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
--   end if;
--
--   return query select
--     case when v_ver_costos then v_capital_propio else null::numeric end as capital_propio,
--     case when v_ver_costos then v_mercaderia_terceros else null::numeric end as mercaderia_terceros,
--     case when v_ver_costos then v_devueltos_clientes else null::numeric end as devueltos_clientes,
--     v_valor_venta_potencial,
--     v_productos_sin_precio,
--     v_por_cobrar,
--     case when v_ver_costos then v_deuda_proveedores else null::numeric end as deuda_proveedores;
-- end;
-- $$;

-- =====================================================================
-- 1. Tablas satélite con RLS, aislamiento de tenant y revendedoras
-- =====================================================================

create table item_costo (
  id_item       uuid primary key references item_producto(id_item) on delete cascade,
  id_tenant     uuid not null references tenant(id_tenant) on delete cascade,
  costo_ingreso numeric(14, 2) not null check (costo_ingreso >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index item_costo_tenant_idx on item_costo(id_tenant);

alter table item_costo enable row level security;
revoke all on table item_costo from anon;
grant select, insert, update on table item_costo to authenticated;

create policy item_costo_own_tenant on item_costo for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

create policy restrict_revendedora_item_costo on item_costo as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy rlsp_item_costo_select on item_costo as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver_costos')));

create policy rlsp_item_costo_insert on item_costo as restrictive for insert to authenticated
  with check (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  );

create policy rlsp_item_costo_update on item_costo as restrictive for update to authenticated
  using (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  )
  with check (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  );

create policy rlsp_item_costo_delete on item_costo as restrictive for delete to authenticated
  using (false);

-- ---------------------------------------------------------------------

create table detalle_venta_costo (
  id_detalle_venta uuid primary key references detalle_venta(id_detalle_venta) on delete cascade,
  id_tenant        uuid not null references tenant(id_tenant) on delete cascade,
  costo_snapshot   numeric(14, 2) not null check (costo_snapshot >= 0),
  monto_ganancia   numeric(14, 2) not null,
  created_at       timestamptz not null default now()
);

create index detalle_venta_costo_tenant_idx on detalle_venta_costo(id_tenant);

alter table detalle_venta_costo enable row level security;
revoke all on table detalle_venta_costo from anon;
grant select on table detalle_venta_costo to authenticated;

create policy detalle_venta_costo_own_tenant on detalle_venta_costo for select to authenticated
  using (id_tenant = auth_tenant_id());

create policy restrict_revendedora_detalle_venta_costo on detalle_venta_costo as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy rlsp_detalle_venta_costo_select on detalle_venta_costo as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver_costos')));

-- ---------------------------------------------------------------------

create table detalle_venta_rendicion (
  id_detalle_venta uuid primary key references detalle_venta(id_detalle_venta) on delete cascade,
  id_tenant        uuid not null references tenant(id_tenant) on delete cascade,
  monto_proveedor  numeric(14, 2) not null default 0 check (monto_proveedor >= 0),
  created_at       timestamptz not null default now()
);

create index detalle_venta_rendicion_tenant_idx on detalle_venta_rendicion(id_tenant);

alter table detalle_venta_rendicion enable row level security;
revoke all on table detalle_venta_rendicion from anon;
grant select on table detalle_venta_rendicion to authenticated;

create policy detalle_venta_rendicion_own_tenant on detalle_venta_rendicion for select to authenticated
  using (id_tenant = auth_tenant_id());

create policy restrict_revendedora_detalle_venta_rendicion on detalle_venta_rendicion as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy rlsp_detalle_venta_rendicion_select on detalle_venta_rendicion as restrictive for select to authenticated
  using (
    (select auth_tiene_permiso('inventario', 'ver_costos'))
    or (select auth_tiene_permiso('rendiciones', 'ver'))
  );

-- ---------------------------------------------------------------------

create table devolucion_venta_costo (
  id_devolucion    uuid primary key references devolucion_venta(id_devolucion) on delete cascade,
  id_tenant        uuid not null references tenant(id_tenant) on delete cascade,
  costo_recuperado numeric(14, 2) not null check (costo_recuperado >= 0),
  created_at       timestamptz not null default now()
);

create index devolucion_venta_costo_tenant_idx on devolucion_venta_costo(id_tenant);

alter table devolucion_venta_costo enable row level security;
revoke all on table devolucion_venta_costo from anon;
grant select on table devolucion_venta_costo to authenticated;

create policy devolucion_venta_costo_own_tenant on devolucion_venta_costo for select to authenticated
  using (id_tenant = auth_tenant_id());

create policy restrict_revendedora_devolucion_venta_costo on devolucion_venta_costo as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy rlsp_devolucion_venta_costo_select on devolucion_venta_costo as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver_costos')));

-- =====================================================================
-- 2. Triggers de inmutabilidad en satélites
-- =====================================================================

create or replace function tg_detalle_venta_costo_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from tenant where id_tenant = old.id_tenant) then
      return old;
    end if;
    raise exception 'detalle-venta-costo-inmutable: no se puede eliminar' using errcode = '22023';
  end if;
  raise exception 'detalle-venta-costo-inmutable: no se puede modificar' using errcode = '22023';
end $$;

create trigger tr_detalle_venta_costo_inmutable
  before update or delete on detalle_venta_costo
  for each row execute function tg_detalle_venta_costo_inmutable();

create or replace function tg_detalle_venta_rendicion_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from tenant where id_tenant = old.id_tenant) then
      return old;
    end if;
    raise exception 'detalle-venta-rendicion-inmutable: no se puede eliminar' using errcode = '22023';
  end if;
  raise exception 'detalle-venta-rendicion-inmutable: no se puede modificar' using errcode = '22023';
end $$;

create trigger tr_detalle_venta_rendicion_inmutable
  before update or delete on detalle_venta_rendicion
  for each row execute function tg_detalle_venta_rendicion_inmutable();

create or replace function tg_devolucion_venta_costo_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from tenant where id_tenant = old.id_tenant) then
      return old;
    end if;
    raise exception 'devolucion-venta-costo-inmutable: no se puede eliminar' using errcode = '22023';
  end if;
  raise exception 'devolucion-venta-costo-inmutable: no se puede modificar' using errcode = '22023';
end $$;

create trigger tr_devolucion_venta_costo_inmutable
  before update or delete on devolucion_venta_costo
  for each row execute function tg_devolucion_venta_costo_inmutable();

-- =====================================================================
-- 3. Backfill y verificación de conteos
-- =====================================================================

insert into item_costo(id_item, id_tenant, costo_ingreso)
select id_item, id_tenant, costo_ingreso
  from item_producto
 where costo_ingreso is not null
on conflict (id_item) do nothing;

insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
select id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia
  from detalle_venta
on conflict (id_detalle_venta) do nothing;

insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
select id_detalle_venta, id_tenant, monto_proveedor
  from detalle_venta
on conflict (id_detalle_venta) do nothing;

insert into devolucion_venta_costo(id_devolucion, id_tenant, costo_recuperado)
select id_devolucion, id_tenant, costo_recuperado
  from devolucion_venta
 where costo_recuperado is not null
on conflict (id_devolucion) do nothing;

do $$
declare
  v_src bigint;
  v_dst bigint;
begin
  select count(*) into v_src from item_producto where costo_ingreso is not null;
  select count(*) into v_dst from item_costo;
  if v_src <> v_dst then
    raise exception 'backfill item_costo mismatch: origen=% destino=%', v_src, v_dst;
  end if;

  select count(*) into v_src from detalle_venta;
  select count(*) into v_dst from detalle_venta_costo;
  if v_src <> v_dst then
    raise exception 'backfill detalle_venta_costo mismatch: origen=% destino=%', v_src, v_dst;
  end if;

  select count(*) into v_dst from detalle_venta_rendicion;
  if v_src <> v_dst then
    raise exception 'backfill detalle_venta_rendicion mismatch: origen=% destino=%', v_src, v_dst;
  end if;

  select count(*) into v_src from devolucion_venta where costo_recuperado is not null;
  select count(*) into v_dst from devolucion_venta_costo;
  if v_src <> v_dst then
    raise exception 'backfill devolucion_venta_costo mismatch: origen=% destino=%', v_src, v_dst;
  end if;
end $$;

-- =====================================================================
-- 4. Selladores DEFINER (§6.1 / §6.2)
-- =====================================================================

create or replace function fn_sellar_costo_herencia_items(
  p_id_producto uuid,
  p_ids_items   uuid[]
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_costo  numeric;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_ids_items is null or coalesce(array_length(p_ids_items, 1), 0) = 0 then
    return;
  end if;

  select costo into v_costo
    from costo_producto
   where id_tenant = v_tenant
     and id_producto = p_id_producto
     and vigente_hasta is null
   limit 1;

  if v_costo is null then
    return;
  end if;

  insert into item_costo(id_item, id_tenant, costo_ingreso)
  select ip.id_item, v_tenant, v_costo
    from item_producto ip
   where ip.id_tenant = v_tenant
     and ip.id_producto = p_id_producto
     and ip.id_item = any(p_ids_items)
  on conflict (id_item) do nothing;
end;
$$;

revoke all on function fn_sellar_costo_herencia_items(uuid, uuid[]) from public, anon;
grant execute on function fn_sellar_costo_herencia_items(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------

create or replace function fn_sellar_costo_venta(
  p_id_venta uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_dv         record;
  v_costo      numeric(14, 2);
  v_monto_prov numeric(14, 2);
  v_monto_gan  numeric(14, 2);
begin
  if not (
    (select auth_tiene_permiso('ventas', 'crear'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  for v_dv in
    select dv.id_detalle_venta, dv.id_item, dv.precio_venta, dv.tipo_ingreso_snapshot
      from detalle_venta dv
     where dv.id_venta = p_id_venta
       and dv.id_tenant = v_tenant
       and (
         not exists (select 1 from detalle_venta_costo dvc where dvc.id_detalle_venta = dv.id_detalle_venta)
         or not exists (select 1 from detalle_venta_rendicion dvr where dvr.id_detalle_venta = dv.id_detalle_venta)
       )
  loop
    select ic.costo_ingreso into v_costo
      from item_costo ic
     where ic.id_item = v_dv.id_item
       and ic.id_tenant = v_tenant;

    if v_costo is null then
      raise exception 'item-costo-pendiente' using errcode = 'P0001';
    end if;

    if v_dv.tipo_ingreso_snapshot = 'compra' then
      v_monto_prov := 0;
    else
      v_monto_prov := v_costo;
    end if;

    v_monto_gan := v_dv.precio_venta - v_costo;

    insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
    values (v_dv.id_detalle_venta, v_tenant, v_costo, v_monto_gan)
    on conflict (id_detalle_venta) do nothing;

    insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
    values (v_dv.id_detalle_venta, v_tenant, v_monto_prov)
    on conflict (id_detalle_venta) do nothing;
  end loop;
end;
$$;

revoke all on function fn_sellar_costo_venta(uuid) from public, anon;
grant execute on function fn_sellar_costo_venta(uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function fn_sellar_costo_cambio(
  p_id_detalle_venta uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_id_item      uuid;
  v_precio_venta numeric(14, 2);
  v_costo        numeric(14, 2);
begin
  if not (
    (select auth_tiene_permiso('ventas', 'crear'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select dv.id_item, dv.precio_venta
    into v_id_item, v_precio_venta
    from detalle_venta dv
   where dv.id_detalle_venta = p_id_detalle_venta
     and dv.id_tenant = v_tenant;

  if v_id_item is null then
    raise exception 'detalle-venta-not-found' using errcode = '42704';
  end if;

  if exists (select 1 from detalle_venta_costo where id_detalle_venta = p_id_detalle_venta)
     and exists (select 1 from detalle_venta_rendicion where id_detalle_venta = p_id_detalle_venta) then
    return;
  end if;

  select ic.costo_ingreso into v_costo
    from item_costo ic
   where ic.id_item = v_id_item
     and ic.id_tenant = v_tenant;

  if v_costo is null then
    raise exception 'item-costo-pendiente' using errcode = 'P0001';
  end if;

  insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
  values (p_id_detalle_venta, v_tenant, v_costo, v_precio_venta - v_costo)
  on conflict (id_detalle_venta) do nothing;

  insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
  values (p_id_detalle_venta, v_tenant, 0)
  on conflict (id_detalle_venta) do nothing;
end;
$$;

revoke all on function fn_sellar_costo_cambio(uuid) from public, anon;
grant execute on function fn_sellar_costo_cambio(uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function fn_sellar_costo_devolucion(
  p_id_devolucion uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant           uuid := auth_tenant_id();
  v_id_detalle_venta uuid;
  v_costo_snapshot   numeric(14, 2);
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select dev.id_detalle_venta into v_id_detalle_venta
    from devolucion_venta dev
   where dev.id_devolucion = p_id_devolucion
     and dev.id_tenant = v_tenant;

  if v_id_detalle_venta is null then
    raise exception 'devolucion-not-found' using errcode = '42704';
  end if;

  if exists (select 1 from devolucion_venta_costo where id_devolucion = p_id_devolucion) then
    return;
  end if;

  select dvc.costo_snapshot into v_costo_snapshot
    from detalle_venta_costo dvc
   where dvc.id_detalle_venta = v_id_detalle_venta
     and dvc.id_tenant = v_tenant;

  if v_costo_snapshot is not null then
    insert into devolucion_venta_costo(id_devolucion, id_tenant, costo_recuperado)
    values (p_id_devolucion, v_tenant, v_costo_snapshot)
    on conflict (id_devolucion) do nothing;
  end if;
end;
$$;

revoke all on function fn_sellar_costo_devolucion(uuid) from public, anon;
grant execute on function fn_sellar_costo_devolucion(uuid) to authenticated;

-- =====================================================================
-- 5. Escritores de ítems (usan item_costo)
-- =====================================================================

create or replace function sp_confirmar_ingreso(
  p_id_ingreso uuid,
  p_ip         inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_confirmado boolean;
  v_tipo       tipo_ingreso;
  v_count      integer := 0;
  v_detalle    record;
  v_i          integer;
  v_qr         text;
  v_new_item   uuid;
  v_ids_her    uuid[];
  v_prod       record;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select confirmado, tipo_ingreso into v_confirmado, v_tipo
    from ingreso_mercaderia
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant
   for update;

  if v_confirmado is null then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;

  if v_confirmado then
    return 0;  -- idempotente
  end if;

  -- D3: si dos líneas del mismo producto traen costos distintos o mezcla de valor y null, rechazar
  if exists (
    select 1
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
     group by id_producto
    having count(distinct costo_unitario) > 1
        or (bool_or(costo_unitario is null) and bool_or(costo_unitario is not null))
  ) then
    raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
  end if;

  for v_detalle in
    select id_detalle, id_producto, cantidad, costo_unitario, talle
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  loop
    v_ids_her := array[]::uuid[];

    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_tipo, v_detalle.talle)
      returning id_item into v_new_item;

      if v_detalle.costo_unitario is not null then
        insert into item_costo(id_item, id_tenant, costo_ingreso)
        values (v_new_item, v_tenant, v_detalle.costo_unitario);
      else
        v_ids_her := array_append(v_ids_her, v_new_item);
      end if;

      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id, id_usuario)
      values (v_tenant, v_new_item, 'alta',
              null, 'disponible',
              'ingreso', p_id_ingreso, v_actor);

      v_count := v_count + 1;
    end loop;

    -- Sin costo en el detalle: el sellador DEFINER hereda el costo vigente sin exponerlo por RLS
    if v_detalle.costo_unitario is null and coalesce(array_length(v_ids_her, 1), 0) > 0 then
      perform fn_sellar_costo_herencia_items(v_detalle.id_producto, v_ids_her);
    end if;
  end loop;

  -- D2: llamar a D1 una vez por producto del ingreso.
  -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
  -- Líneas con costo_unitario null no llaman a sp_aplicar_ultimo_costo.
  for v_prod in
    select id_producto,
           costo_unitario,
           costo_original_usd,
           cotizacion_aplicada,
           cotizacion_fecha_valor,
           case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
      from (
        select distinct on (id_producto)
               id_producto,
               costo_unitario,
               costo_original_usd,
               cotizacion_aplicada,
               cotizacion_fecha_valor
          from ingreso_mercaderia_detalle
         where id_ingreso = p_id_ingreso and id_tenant = v_tenant
         order by id_producto, id_detalle
      ) s
  loop
    if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
      perform sp_aplicar_ultimo_costo(
        v_prod.id_producto,
        v_prod.costo_unitario,
        v_prod.moneda,
        v_prod.costo_original_usd,
        v_prod.cotizacion_aplicada,
        v_prod.cotizacion_fecha_valor,
        'ingreso mercaderia',
        p_ip,
        v_tipo <> 'consignacion'
      );
    end if;
  end loop;

  update ingreso_mercaderia
     set confirmado = true
   where id_ingreso = p_id_ingreso;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar',
          jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo),
          p_ip);

  return v_count;
end;
$$;

create or replace function sp_crear_stock_directo(
  p_id_producto  uuid,
  p_costo        numeric default null,
  p_tipo_ingreso tipo_ingreso default 'compra',
  p_items        jsonb default '[]',
  p_ip           inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_count    integer := 0;
  v_item     jsonb;
  v_talle    text;
  v_cant     integer;
  v_i        integer;
  v_qr       text;
  v_new_item uuid;
  v_ids_her  uuid[] := array[]::uuid[];
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Si p_costo no es null, exige cargar_costos
  if p_costo is not null and not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from producto where id_producto = p_id_producto and id_tenant = v_tenant
  ) then
    raise exception 'producto-not-found' using errcode = '42704';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_talle := nullif(trim(v_item->>'talle'), '');
    v_cant := coalesce((v_item->>'cantidad')::integer, 0);
    if v_cant <= 0 then
      continue;
    end if;

    for v_i in 1 .. v_cant loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, tipo_ingreso, talle)
      values (v_tenant, p_id_producto, null, null,
              v_qr, 'disponible',
              coalesce(p_tipo_ingreso, 'compra'), v_talle)
      returning id_item into v_new_item;

      if p_costo is not null then
        insert into item_costo(id_item, id_tenant, costo_ingreso)
        values (v_new_item, v_tenant, p_costo);
      else
        v_ids_her := array_append(v_ids_her, v_new_item);
      end if;

      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id, id_usuario)
      values (v_tenant, v_new_item, 'alta', null, 'disponible',
              'alta-directa', p_id_producto, v_actor);

      v_count := v_count + 1;
    end loop;
  end loop;

  if p_costo is null and coalesce(array_length(v_ids_her, 1), 0) > 0 then
    perform fn_sellar_costo_herencia_items(p_id_producto, v_ids_her);
  end if;

  if p_costo is not null and p_costo > 0 then
    perform sp_aplicar_ultimo_costo(
      p_id_producto,
      p_costo,
      'ARS',
      null,
      null,
      null,
      'alta directa stock',
      p_ip,
      coalesce(p_tipo_ingreso, 'compra') <> 'consignacion'
    );
  end if;

  if v_count > 0 then
    insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
    values (v_tenant, v_actor, 'item_producto', p_id_producto::text, 'alta-directa',
            jsonb_build_object('items_generados', v_count, 'costo', p_costo), p_ip);
  end if;

  return v_count;
end;
$$;

create or replace function sp_aplicar_ultimo_costo(
  p_id_producto            uuid,
  p_costo                  numeric,
  p_moneda                 text default 'ARS',
  p_costo_original_usd     numeric default null,
  p_cotizacion_aplicada    numeric default null,
  p_cotizacion_fecha_valor date default null,
  p_motivo                 text default null,
  p_ip                     inet default null,
  p_sincronizar_unidades   boolean default true
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_vigente  record;
  v_id       uuid;
  v_es_igual boolean := false;
begin
  -- Permisos: 'inventario.cargar_costos' (implica ver_costos por D-CPC-05)
  -- o 'precios.editar_cotizacion' junto con 'inventario.ver_costos' (evita duplicar vigentes bajo RLS).
  if not (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_costo is null or p_costo <= 0 then
    return null;
  end if;

  select id_costo, costo, moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
    into v_vigente
    from costo_producto
   where id_tenant = v_tenant
     and id_producto = p_id_producto
     and vigente_hasta is null
   for update;

  if v_vigente.id_costo is not null then
    if v_vigente.costo = p_costo then
      v_es_igual := true;
    end if;
  end if;

  if v_es_igual then
    return v_vigente.id_costo;
  end if;

  if v_vigente.id_costo is not null then
    update costo_producto
       set vigente_hasta = now()
     where id_costo = v_vigente.id_costo;
  end if;

  insert into costo_producto(
    id_tenant, id_producto, costo, moneda,
    id_usuario_alta, motivo,
    costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
  )
  values (
    v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'),
    v_actor, p_motivo,
    case when p_moneda = 'USD' then p_costo_original_usd else null end,
    case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
    case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
  )
  returning id_costo into v_id;

  if coalesce(p_sincronizar_unidades, true) then
    insert into item_costo(id_item, id_tenant, costo_ingreso)
    select ip.id_item, v_tenant, p_costo
      from item_producto ip
     where ip.id_tenant = v_tenant
       and ip.id_producto = p_id_producto
       and ip.tipo_ingreso = 'compra'
       and ip.estado_item in ('disponible', 'reservado', 'en_revendedora')
    on conflict (id_item) do update
      set costo_ingreso = excluded.costo_ingreso,
          updated_at = now();
  end if;

  perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear',
          jsonb_build_object('id_producto', p_id_producto,
                             'costo_anterior', v_vigente.costo,
                             'costo_nuevo', p_costo,
                             'moneda', coalesce(p_moneda, 'ARS'),
                             'motivo', p_motivo,
                             'costo_original_usd', p_costo_original_usd,
                             'cotizacion_aplicada', p_cotizacion_aplicada,
                             'cotizacion_fecha_valor', p_cotizacion_fecha_valor),
          p_ip);

  return v_id;
end;
$$;

create or replace function sp_completar_costo_ingreso(
  p_id_ingreso uuid,
  p_lineas     jsonb,
  p_ip         inet default null
) returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant                   uuid := auth_tenant_id();
  v_actor                    uuid := auth.uid();
  v_confirmado               boolean;
  v_tipo                     tipo_ingreso;
  v_linea                    jsonb;
  v_id_detalle               uuid;
  v_costo                    numeric;
  v_det                      record;
  v_items_actualizados       integer := 0;
  v_total_items_actualizados integer := 0;
  v_prod                     record;
begin
  if not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select confirmado, tipo_ingreso into v_confirmado, v_tipo
    from ingreso_mercaderia
   where id_ingreso = p_id_ingreso and id_tenant = v_tenant
   for update;

  if v_confirmado is null then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;

  if not v_confirmado then
    raise exception 'ingreso-no-confirmado' using errcode = '22023';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    return 0;
  end if;

  -- Iterar y completar cada línea indicada
  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_id_detalle := coalesce(v_linea->>'id_detalle', v_linea->>'idDetalle')::uuid;
    v_costo      := coalesce(v_linea->>'costo_unitario', v_linea->>'costoUnitario')::numeric;

    if v_id_detalle is null then
      continue;
    end if;

    select id_detalle, id_producto, costo_unitario
      into v_det
      from ingreso_mercaderia_detalle
     where id_detalle = v_id_detalle
       and id_ingreso = p_id_ingreso
       and id_tenant = v_tenant
     for update;

    if v_det.id_detalle is null then
      raise exception 'detalle-not-found: %', v_id_detalle using errcode = '42704';
    end if;

    -- Solo completa líneas con costo null
    if v_det.costo_unitario is null then
      if v_costo is null or v_costo <= 0 then
        raise exception 'costo-invalido' using errcode = '22023';
      end if;

      update ingreso_mercaderia_detalle
         set costo_unitario = v_costo
       where id_detalle = v_det.id_detalle;

      with upserted as (
        insert into item_costo(id_item, id_tenant, costo_ingreso)
        select ip.id_item, v_tenant, v_costo
          from item_producto ip
         where ip.id_ingreso_detalle = v_det.id_detalle
           and ip.id_tenant = v_tenant
           and ip.estado_item <> 'vendido'
        on conflict (id_item) do update
          set costo_ingreso = excluded.costo_ingreso,
              updated_at = now()
        returning id_item
      )
      select count(*) into v_items_actualizados from upserted;

      v_total_items_actualizados := v_total_items_actualizados + v_items_actualizados;
    end if;
  end loop;

  -- Validar que no queden costos distintos o inconsistentes para un mismo producto
  if exists (
    select 1
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
     group by id_producto
    having count(distinct costo_unitario) > 1
        or (bool_or(costo_unitario is null) and bool_or(costo_unitario is not null))
  ) then
    raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
  end if;

  -- Llamar a sp_aplicar_ultimo_costo una vez por producto de las líneas completadas
  for v_prod in
    select id_producto,
           costo_unitario,
           costo_original_usd,
           cotizacion_aplicada,
           cotizacion_fecha_valor,
           case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
      from (
        select distinct on (id_producto)
               id_producto,
               costo_unitario,
               costo_original_usd,
               cotizacion_aplicada,
               cotizacion_fecha_valor
          from ingreso_mercaderia_detalle
         where id_ingreso = p_id_ingreso
           and id_tenant = v_tenant
           and id_detalle in (
             select coalesce(l->>'id_detalle', l->>'idDetalle')::uuid
               from jsonb_array_elements(p_lineas) l
           )
         order by id_producto, id_detalle
      ) s
  loop
    if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
      perform sp_aplicar_ultimo_costo(
        v_prod.id_producto,
        v_prod.costo_unitario,
        v_prod.moneda,
        v_prod.costo_original_usd,
        v_prod.cotizacion_aplicada,
        v_prod.cotizacion_fecha_valor,
        'completar costo ingreso',
        p_ip,
        v_tipo <> 'consignacion'
      );
    end if;
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'completar_costo',
          jsonb_build_object('items_actualizados', v_total_items_actualizados,
                             'lineas_enviadas', jsonb_array_length(p_lineas)),
          p_ip);

  return v_total_items_actualizados;
end;
$$;

-- =====================================================================
-- 6. Ventas, cambios y devoluciones (delegan sellado en DEFINER)
-- =====================================================================

create or replace function sp_registrar_venta(
  p_lineas         jsonb,
  p_forma_pago     forma_pago default 'efectivo',
  p_id_cliente     uuid default null,
  p_id_reserva     uuid default null,
  p_observaciones  text default null,
  p_ip             inet default null,
  p_pagos          jsonb default null,
  p_financiacion   jsonb default null,
  p_financiador    jsonb default null,
  p_canal          canal_venta default 'local',
  p_id_revendedora uuid default null
) returns uuid language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_id_venta   uuid := gen_random_uuid();
  v_total      numeric(14, 2) := 0;
  v_lineas_procesadas jsonb := '[]'::jsonb;
  v_linea      jsonb;
  v_id_item    uuid;
  v_ids_desc   uuid[];
  v_item       item_producto;
  v_producto   producto;
  v_snap       jsonb;
  v_precio     numeric(14, 2);
  v_id_prov    uuid;
  v_reserva_estado estado_reserva;
  v_dr_activa  uuid;
  v_pago       jsonb;
  v_id_cuenta  uuid;
  v_fin_cuenta uuid;
  v_fin_medio  medio_pago;
  v_fin_propia boolean;
  v_monto_pago numeric(14, 2);
  v_pagado     numeric(14, 2) := 0;
  v_medio      medio_pago;
  v_cuotas     smallint;
  v_cobro      jsonb;
  v_costo_cobro numeric(14, 2);
  v_fin_cuotas smallint;
  v_fin_desde  date;
  v_a_financiar numeric(14, 2) := 0;
  v_cuota_base numeric(14, 2);
  v_acumulado  numeric(14, 2) := 0;
  v_monto_cuota numeric(14, 2);
  v_i          smallint;
  v_venc       date;

  -- Variables específicas para canal y comisiones
  v_canal      canal_venta := coalesce(p_canal, 'local');
  v_pct_preview numeric(5, 2) := 0;
  v_id_dcr     uuid;
begin
  if not (
    (select auth_tiene_permiso('ventas', 'crear'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Seguridad (ACC-07 punto 5): una sesión con rol Revendedora no puede vender directamente
  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'lineas-vacias' using errcode = '22023';
  end if;

  if v_canal = 'online' then
    raise exception 'canal-no-disponible' using errcode = '22023';
  end if;

  -- Validaciones específicas del canal revendedora
  if v_canal = 'revendedora' then
    if not exists (
      select 1 from tenant_modulo tm
      join modulo m on m.id_modulo = tm.id_modulo
      where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
    ) then
      raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
    end if;

    if p_id_revendedora is null then
      raise exception 'venta-revendedora-sin-id' using errcode = '22023';
    end if;

    if not exists (
      select 1 from revendedora
      where id_tenant = v_tenant and id_revendedora = p_id_revendedora and activo = true
    ) then
      raise exception 'revendedora-not-found' using errcode = '42704';
    end if;

    -- Obtener el snapshot informativo de comisión según la regla vigente
    select coalesce(porcentaje, 0) into v_pct_preview
      from fn_resolver_comision(p_id_revendedora, fn_hoy_tenant(), 0, 'revendedora')
     limit 1;
    v_pct_preview := coalesce(v_pct_preview, 0);
  end if;

  if p_financiacion is not null then
    v_fin_cuotas := (p_financiacion->>'cuotas')::smallint;
    v_fin_desde  := (p_financiacion->>'primer_vencimiento')::date;

    if p_id_cliente is null then
      raise exception 'financiacion-sin-cliente' using errcode = '22023';
    end if;
    if v_fin_cuotas is null or v_fin_cuotas < 1 or v_fin_cuotas > 24 then
      raise exception 'financiacion-cuotas-invalidas: %', v_fin_cuotas using errcode = '22023';
    end if;
    if v_fin_desde is null then
      raise exception 'financiacion-sin-vencimiento' using errcode = '22023';
    end if;
  end if;

  if p_id_reserva is not null then
    select estado_reserva into v_reserva_estado
      from reserva
     where id_reserva = p_id_reserva and id_tenant = v_tenant
     for update;
    if v_reserva_estado is null then
      raise exception 'reserva-not-found' using errcode = '42704';
    end if;
    if v_reserva_estado <> 'activa' then
      raise exception 'reserva-no-activa: %', v_reserva_estado using errcode = '22023';
    end if;
  end if;

  v_fin_propia := coalesce((p_financiador->>'propia')::boolean,
                           p_financiacion is not null, false);
  v_fin_cuenta := case when v_fin_propia then null
                       else (p_financiador->>'id_cuenta_destino')::uuid end;
  v_fin_medio  := case when v_fin_propia then null
                       else nullif(p_financiador->>'medio','')::medio_pago end;

  if v_fin_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
    raise exception 'medio-solo-revendedora' using errcode = '22023';
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_id_item := (v_linea->>'id_item')::uuid;
    if v_id_item is null then
      raise exception 'linea-sin-id-item' using errcode = '22023';
    end if;

    v_ids_desc := coalesce(
      (select array_agg(e::uuid)
         from jsonb_array_elements_text(coalesce(v_linea->'descuentos', '[]'::jsonb)) e),
      '{}'::uuid[]
    );

    select * into v_item
      from item_producto
     where id_item = v_id_item and id_tenant = v_tenant
     for update;
    if v_item.id_item is null then
      raise exception 'item-not-found: %', v_id_item using errcode = '42704';
    end if;

    v_id_dcr := null;

    if v_canal = 'revendedora' then
      if v_item.estado_item <> 'en_revendedora' then
        raise exception 'item-no-en-revendedora: % (estado=%)',
          v_id_item, v_item.estado_item using errcode = '22023';
      end if;

      select crd.id_consignacion_revendedora_detalle into v_id_dcr
        from consignacion_revendedora_detalle crd
        join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
       where crd.id_item = v_id_item
         and cr.id_tenant = v_tenant
         and cr.id_revendedora = p_id_revendedora
         and cr.confirmada = true
         and cr.estado = 'abierta'
         and crd.estado_detalle = 'en_poder'
       for update of crd;

      if v_id_dcr is null then
        raise exception 'item-no-en-revendedora: %', v_id_item using errcode = '22023';
      end if;
    else
      if v_item.estado_item <> 'disponible' then
        raise exception 'item-no-disponible: % (estado=%)',
          v_id_item, v_item.estado_item using errcode = '22023';
      end if;
    end if;

    select id_detalle_reserva into v_dr_activa
      from detalle_reserva
     where id_item = v_id_item and estado = 'activa';
    if v_dr_activa is not null then
      if p_id_reserva is null then
        raise exception 'item-en-reserva: % (usa la reserva o cancelala primero)',
          v_id_item using errcode = '22023';
      end if;
      if not exists (
        select 1 from detalle_reserva
         where id_detalle_reserva = v_dr_activa
           and id_reserva = p_id_reserva
      ) then
        raise exception 'item-en-otra-reserva: %', v_id_item using errcode = '22023';
      end if;
      update detalle_reserva set estado = 'convertida_venta'
       where id_detalle_reserva = v_dr_activa;
    end if;

    select * into v_producto from producto
     where id_producto = v_item.id_producto and id_tenant = v_tenant;

    v_snap := sp_calcular_precio_venta_snapshot(
                v_item.id_producto, p_forma_pago, v_ids_desc,
                v_fin_cuenta, v_fin_medio, v_fin_propia);
    if not (v_snap->>'ok')::boolean then
      raise exception 'precio-no-resoluble: producto % (%)',
        v_item.id_producto, v_snap->>'reason' using errcode = '22023';
    end if;
    v_precio := (v_snap->>'precio_final')::numeric;

    if v_item.tipo_ingreso = 'compra' then
      v_id_prov := null;
    else
      select id_proveedor into v_id_prov
        from ingreso_mercaderia
       where id_ingreso = v_item.id_ingreso;
    end if;

    v_lineas_procesadas := v_lineas_procesadas || jsonb_build_object(
      'id_item', v_id_item, 'id_producto', v_item.id_producto,
      'id_prov', coalesce(v_id_prov::text, ''), 'precio', v_precio,
      'tipo_ingreso', v_item.tipo_ingreso,
      'desglose', coalesce(v_snap->'desglose', '{}'::jsonb),
      'id_dcr', v_id_dcr
    );

    v_total := v_total + v_precio;
  end loop;

  insert into venta(id_venta, id_tenant, id_cliente, id_usuario_alta, forma_pago,
                    total, observaciones, financiacion,
                    id_cuenta_recargo, medio_recargo,
                    canal, id_revendedora)
  values (v_id_venta, v_tenant, p_id_cliente, v_actor, p_forma_pago, v_total, p_observaciones,
          case
            when p_financiacion is not null then 'propia'::tipo_financiacion
            when p_forma_pago::text ~ '^cuotas_\d+$' then 'externa'::tipo_financiacion
            else 'ninguna'::tipo_financiacion
          end,
          v_fin_cuenta, v_fin_medio,
          v_canal, p_id_revendedora);

  for v_linea in select * from jsonb_array_elements(v_lineas_procesadas) loop
    insert into detalle_venta(
      id_tenant, id_venta, id_item, id_producto, id_proveedor,
      precio_venta, monto_gasto,
      tipo_ingreso_snapshot, desglose_reglas,
      porcentaje_comision_preview
    ) values (
      v_tenant, v_id_venta, (v_linea->>'id_item')::uuid, (v_linea->>'id_producto')::uuid, nullif(v_linea->>'id_prov', '')::uuid,
      (v_linea->>'precio')::numeric, 0,
      (v_linea->>'tipo_ingreso')::tipo_ingreso, (v_linea->'desglose'),
      v_pct_preview
    );

    perform sp_transicion_item_producto(
      (v_linea->>'id_item')::uuid, 'vendido', 'venta', v_id_venta, 'venta', p_ip
    );

    if v_canal = 'revendedora' and (v_linea->>'id_dcr') is not null then
      update consignacion_revendedora_detalle
         set estado_detalle = 'vendido'
       where id_consignacion_revendedora_detalle = (v_linea->>'id_dcr')::uuid;
    end if;
  end loop;

  -- Sellador DEFINER: lee item_costo (guarda item-costo-pendiente) y persiste
  -- detalle_venta_costo + detalle_venta_rendicion en la misma transacción.
  perform fn_sellar_costo_venta(v_id_venta);

  if p_id_reserva is not null then
    update reserva
       set estado_reserva = 'convertida_venta',
           fecha_cierre = now()
     where id_reserva = p_id_reserva;
  end if;

  -- ─── Cobranza y registro de pagos (DR-14) ──────────────────────────
  if v_canal = 'revendedora' then
    if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
      raise exception 'venta-revendedora-con-pagos' using errcode = '22023';
    end if;
    if v_total > 0 then
      insert into pago_venta(
        id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
        costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
      ) values (
        v_tenant, v_id_venta, null, 'cuenta_revendedora'::medio_pago, v_total, null,
        0, v_total, null, '{}'::jsonb
      );
      v_pagado := v_total;
    end if;

  elsif p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    if v_total > 0 and p_financiacion is null then
      select id_cuenta_destino into v_id_cuenta
        from cuenta_destino
       where id_tenant = v_tenant
         and id_cuenta_destino = coalesce(v_fin_cuenta, id_cuenta_destino)
         and (v_fin_cuenta is not null or es_predeterminada)
         and activo
       limit 1;
      if v_id_cuenta is null then
        raise exception 'sin-cuenta-predeterminada' using errcode = '22023';
      end if;

      v_medio := coalesce(v_fin_medio, case p_forma_pago::text
                   when 'efectivo' then 'efectivo'::medio_pago
                   when 'transferencia' then 'transferencia'::medio_pago
                   else 'tarjeta_credito'::medio_pago
                 end);
      v_cuotas := nullif(substring(p_forma_pago::text from '^cuotas_(\d+)$'), '')::smallint;

      v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_total);
      v_costo_cobro := (v_cobro->>'costo_total')::numeric;

      insert into pago_venta(
        id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
        costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
      ) values (
        v_tenant, v_id_venta, v_id_cuenta, v_medio, v_total, v_cuotas,
        v_costo_cobro, v_total - v_costo_cobro,
        fn_hoy_tenant() + (v_cobro->>'dias_acreditacion')::int,
        v_cobro
      );
      v_pagado := v_total;
    end if;

  else
    for v_pago in select * from jsonb_array_elements(p_pagos) loop
      v_id_cuenta  := (v_pago->>'id_cuenta_destino')::uuid;
      v_monto_pago := (v_pago->>'monto')::numeric;
      v_medio      := (v_pago->>'medio')::medio_pago;
      v_cuotas     := nullif(v_pago->>'cuotas', '')::smallint;

      if v_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
        raise exception 'medio-solo-revendedora' using errcode = '22023';
      end if;

      if v_id_cuenta is null then
        raise exception 'pago-sin-cuenta' using errcode = '22023';
      end if;
      if v_monto_pago is null or v_monto_pago <= 0 then
        raise exception 'pago-monto-invalido: %', v_monto_pago using errcode = '22023';
      end if;
      if not exists (
        select 1 from cuenta_destino
         where id_cuenta_destino = v_id_cuenta
           and id_tenant = v_tenant
           and activo
      ) then
        raise exception 'cuenta-destino-invalida: %', v_id_cuenta using errcode = '22023';
      end if;
      if v_medio = 'tarjeta_credito' and v_cuotas is null then
        raise exception 'pago-credito-sin-cuotas' using errcode = '22023';
      end if;
      if v_medio <> 'tarjeta_credito' and v_cuotas is not null then
        raise exception 'pago-cuotas-medio-invalido: %', v_medio using errcode = '22023';
      end if;

      v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_monto_pago);
      v_costo_cobro := (v_cobro->>'costo_total')::numeric;

      insert into pago_venta(
        id_tenant, id_venta, id_cuenta_destino, medio, monto, cuotas,
        monto_recibido, referencia,
        costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
      ) values (
        v_tenant, v_id_venta, v_id_cuenta, v_medio, v_monto_pago, v_cuotas,
        nullif(v_pago->>'monto_recibido', '')::numeric,
        nullif(v_pago->>'referencia', ''),
        v_costo_cobro, v_monto_pago - v_costo_cobro,
        fn_hoy_tenant() + (v_cobro->>'dias_acreditacion')::int,
        v_cobro
      );

      v_pagado := v_pagado + v_monto_pago;
    end loop;
  end if;

  if p_financiacion is not null then
    v_a_financiar := v_total - v_pagado;
    if v_a_financiar <= 0 then
      raise exception 'financiacion-sin-saldo: pagado % contra total %',
        v_pagado, v_total using errcode = '22023';
    end if;

    v_cuota_base := round(v_a_financiar / v_fin_cuotas, 2);

    v_i := 0;
    for v_venc in select * from fn_vencimientos_cuotas(v_fin_desde, v_fin_cuotas) loop
      v_i := v_i + 1;
      if v_i = v_fin_cuotas then
        v_monto_cuota := v_a_financiar - v_acumulado;
      else
        v_monto_cuota := v_cuota_base;
      end if;
      v_acumulado := v_acumulado + v_monto_cuota;

      insert into cuota_financiada(
        id_tenant, id_venta, id_cliente, numero, monto, fecha_vencimiento
      ) values (
        v_tenant, v_id_venta, p_id_cliente, v_i, v_monto_cuota, v_venc
      );
    end loop;

    if v_pagado + v_acumulado <> v_total then
      raise exception 'financiacion-no-cuadra: % + % contra %',
        v_pagado, v_acumulado, v_total using errcode = '22023';
    end if;

  elsif p_pagos is not null and jsonb_array_length(p_pagos) > 0 and v_canal <> 'revendedora' then
    if v_pagado <> v_total then
      raise exception 'pagos-no-cuadran: pagado % contra total %',
        v_pagado, v_total using errcode = '22023';
    end if;
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'venta', v_id_venta::text, 'crear',
          jsonb_build_object('total', v_total,
                             'lineas', jsonb_array_length(p_lineas),
                             'forma_pago', p_forma_pago,
                             'id_cliente', p_id_cliente,
                             'id_reserva', p_id_reserva,
                             'canal', v_canal,
                             'id_revendedora', p_id_revendedora,
                             'pagado', v_pagado,
                             'pagos', coalesce(jsonb_array_length(p_pagos), 1),
                             'financiado', v_acumulado,
                             'cuotas_financiadas', coalesce(v_fin_cuotas, 0)),
          p_ip);

  return v_id_venta;
end $$;

create or replace function sp_registrar_cambio(
  p_id_detalle_original   uuid,
  p_id_item_entregado     uuid,
  p_motivo                text default null,
  p_medio_cobro           medio_pago default null,
  p_id_cuenta_destino     uuid default null,
  p_ip                    inet default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_tenant                  uuid := auth_tenant_id();
  v_actor                   uuid := auth.uid();
  v_id_venta                uuid;
  v_id_item_original        uuid;
  v_id_prod_original        uuid;
  v_precio_original         numeric(14,2);
  v_porcentaje_preview_orig numeric(5,2);
  v_id_rendicion            uuid;
  v_id_liquidacion          uuid;
  v_canal                   canal_venta;
  v_id_revendedora          uuid;
  v_estado_venta            estado_venta;
  v_estado_item_orig        estado_item;
  v_estado_item_nuevo       estado_item;
  v_id_prod_nuevo           uuid;
  v_tipo_ingreso_nuevo      tipo_ingreso;
  v_precio_nuevo            numeric(14,2);
  v_diferencia              numeric(14,2);
  v_id_det_nuevo            uuid;
  v_id_cambio               uuid;
begin
  if not (select auth_tiene_permiso('ventas', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- 1. Leer y bloquear detalle_venta y venta originales
  select
    dv.id_venta,
    dv.id_item,
    dv.id_producto,
    dv.precio_venta,
    dv.porcentaje_comision_preview,
    dv.id_rendicion,
    dv.id_liquidacion,
    v.canal,
    v.id_revendedora,
    v.estado_venta
  into
    v_id_venta,
    v_id_item_original,
    v_id_prod_original,
    v_precio_original,
    v_porcentaje_preview_orig,
    v_id_rendicion,
    v_id_liquidacion,
    v_canal,
    v_id_revendedora,
    v_estado_venta
  from detalle_venta dv
  join venta v on v.id_venta = dv.id_venta
  where dv.id_detalle_venta = p_id_detalle_original
    and dv.id_tenant = v_tenant
    and v.id_tenant = v_tenant
  for update of dv, v;

  if v_id_venta is null then
    raise exception 'detalle-venta-not-found' using errcode = '42704';
  end if;

  -- 2. Guardas de estado de venta y liquidación
  if v_estado_venta = 'anulada' then
    raise exception 'venta-anulada' using errcode = '22023';
  end if;

  if v_id_liquidacion is not null then
    raise exception 'venta-liquidada' using errcode = '22023';
  end if;

  if v_id_rendicion is not null then
    raise exception 'detalle-ya-rendido' using errcode = '22023';
  end if;

  if exists (select 1 from devolucion_venta where id_detalle_venta = p_id_detalle_original) then
    raise exception 'detalle-ya-devuelto' using errcode = '22023';
  end if;

  if exists (select 1 from cambio_venta where id_detalle_original = p_id_detalle_original) then
    raise exception 'detalle-ya-cambiado' using errcode = '22023';
  end if;

  if exists (
    select 1 from cuota_financiada
     where id_venta = v_id_venta and estado in ('pendiente', 'parcial')
  ) then
    raise exception 'cambio-venta-con-cuotas-abiertas' using errcode = '22023';
  end if;

  -- 3. Guardas de módulo si canal revendedora
  if v_canal = 'revendedora' then
    if not exists (
      select 1 from tenant_modulo tm
      join modulo m on m.id_modulo = tm.id_modulo
      where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
    ) then
      raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
    end if;
  end if;

  -- 4. Bloquear y verificar estado del ítem original
  select estado_item into v_estado_item_orig
  from item_producto
  where id_item = v_id_item_original and id_tenant = v_tenant
  for update;

  if v_estado_item_orig <> 'vendido' then
    raise exception 'item-no-esta-vendido: estado=%', v_estado_item_orig using errcode = '22023';
  end if;

  -- 5. Bloquear y verificar ítem entregado
  select
    ip.estado_item,
    ip.id_producto,
    ip.tipo_ingreso,
    p.precio_venta
  into
    v_estado_item_nuevo,
    v_id_prod_nuevo,
    v_tipo_ingreso_nuevo,
    v_precio_nuevo
  from item_producto ip
  join producto p on p.id_producto = ip.id_producto
  where ip.id_item = p_id_item_entregado
    and ip.id_tenant = v_tenant
    and p.id_tenant = v_tenant
  for update of ip;

  if v_estado_item_nuevo is null then
    raise exception 'item-not-found' using errcode = '42704';
  end if;

  if v_canal = 'local' then
    if v_estado_item_nuevo <> 'disponible' then
      raise exception 'item-no-disponible: estado=%', v_estado_item_nuevo using errcode = '22023';
    end if;
  elsif v_canal = 'revendedora' then
    if v_estado_item_nuevo <> 'en_revendedora' then
      raise exception 'item-no-disponible: estado=%', v_estado_item_nuevo using errcode = '22023';
    end if;

    if not exists (
      select 1
      from consignacion_revendedora_detalle crd
      join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
      where cr.id_tenant = v_tenant
        and cr.id_revendedora = v_id_revendedora
        and cr.confirmada = true
        and cr.estado = 'abierta'
        and crd.id_item = p_id_item_entregado
        and crd.estado_detalle = 'en_poder'
    ) then
      raise exception 'item-no-en-poder-revendedora' using errcode = '22023';
    end if;
  end if;

  -- 6. Calcular diferencia
  v_diferencia := v_precio_nuevo - v_precio_original;

  if v_diferencia < 0 then
    raise exception 'diferencia-negativa-no-permitida' using errcode = '22023';
  end if;

  -- 7. Registrar cobro de diferencia si corresponde
  if v_diferencia > 0 then
    if v_canal = 'local' then
      if p_medio_cobro is null or p_id_cuenta_destino is null then
        raise exception 'diferencia-requiere-medio-y-cuenta' using errcode = '22023';
      end if;

      if not exists (
        select 1 from cuenta_destino
        where id_tenant = v_tenant and id_cuenta_destino = p_id_cuenta_destino
      ) then
        raise exception 'cuenta-destino-invalida' using errcode = '22023';
      end if;

      insert into pago_venta (
        id_tenant, id_venta, id_cuenta_destino, medio, monto, created_at
      ) values (
        v_tenant, v_id_venta, p_id_cuenta_destino, p_medio_cobro, v_diferencia, now()
      );
    elsif v_canal = 'revendedora' then
      insert into pago_venta (
        id_tenant, id_venta, id_cuenta_destino, medio, monto, created_at
      ) values (
        v_tenant, v_id_venta, null, 'cuenta_revendedora', v_diferencia, now()
      );
    end if;
  end if;

  -- 8. Transicionar ítems usando is_transicion_item_valida
  if v_canal = 'revendedora' then
    if not is_transicion_item_valida('vendido', 'en_revendedora') then
      raise exception 'invalid-transition' using errcode = '22023';
    end if;
    perform sp_transicion_item_producto(
      v_id_item_original, 'en_revendedora', 'ajuste', v_id_venta, 'cambio_producto', p_ip
    );
    update consignacion_revendedora_detalle
       set estado_detalle = 'en_poder'
     where id_item = v_id_item_original and estado_detalle = 'vendido';

    if not is_transicion_item_valida('en_revendedora', 'vendido') then
      raise exception 'invalid-transition' using errcode = '22023';
    end if;
    perform sp_transicion_item_producto(
      p_id_item_entregado, 'vendido', 'venta', v_id_venta, 'cambio_producto', p_ip
    );
    update consignacion_revendedora_detalle
       set estado_detalle = 'vendido'
     where id_item = p_id_item_entregado and estado_detalle = 'en_poder';
  else
    if not is_transicion_item_valida('vendido', 'disponible') then
      raise exception 'invalid-transition' using errcode = '22023';
    end if;
    perform sp_transicion_item_producto(
      v_id_item_original, 'disponible', 'ajuste', v_id_venta, 'cambio_producto', p_ip
    );

    if not is_transicion_item_valida('disponible', 'vendido') then
      raise exception 'invalid-transition' using errcode = '22023';
    end if;
    perform sp_transicion_item_producto(
      p_id_item_entregado, 'vendido', 'venta', v_id_venta, 'cambio_producto', p_ip
    );
  end if;

  -- 9. Marcar línea original excluida de liquidación
  update detalle_venta
     set excluida_liquidacion = true
   where id_detalle_venta = p_id_detalle_original;

  -- 10. Crear nueva línea en detalle_venta para el ítem entregado
  -- precio_venta se congela en v_precio_original (base de liquidación original, DR-5)
  insert into detalle_venta (
    id_tenant, id_venta, id_item, id_producto,
    precio_venta, monto_gasto,
    tipo_ingreso_snapshot, desglose_reglas,
    id_rendicion, excluida_rendicion, porcentaje_comision_preview,
    monto_comision, id_liquidacion, excluida_liquidacion
  ) values (
    v_tenant, v_id_venta, p_id_item_entregado, v_id_prod_nuevo,
    v_precio_original, 0,
    v_tipo_ingreso_nuevo, '{}'::jsonb,
    null, false, v_porcentaje_preview_orig,
    0, null, false
  ) returning id_detalle_venta into v_id_det_nuevo;

  -- Sellador DEFINER: lee item_costo (guarda item-costo-pendiente) y sella satélites
  perform fn_sellar_costo_cambio(v_id_det_nuevo);

  -- 11. Registrar en cambio_venta
  insert into cambio_venta (
    id_tenant, id_venta_original, id_detalle_original, id_item_entregado,
    diferencia, motivo, origen, id_usuario_alta
  ) values (
    v_tenant, v_id_venta, p_id_detalle_original, p_id_item_entregado,
    v_diferencia, p_motivo, v_canal, v_actor
  ) returning id_cambio into v_id_cambio;

  -- 12. Auditoría
  insert into auditoria (
    id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip
  ) values (
    v_tenant, v_actor, 'cambio_venta', v_id_cambio::text, 'registrar_cambio',
    jsonb_build_object(
      'id_venta', v_id_venta,
      'id_detalle_original', p_id_detalle_original,
      'id_item_entregado', p_id_item_entregado,
      'id_detalle_nuevo', v_id_det_nuevo,
      'diferencia', v_diferencia,
      'motivo', p_motivo
    ),
    p_ip
  );

  return jsonb_build_object(
    'id_cambio', v_id_cambio,
    'id_detalle_nuevo', v_id_det_nuevo,
    'diferencia', v_diferencia
  );
end;
$$;

create or replace function sp_registrar_devolucion_cliente(
  p_id_detalle_venta    uuid,
  p_motivo              text default null,
  p_id_cuenta_reintegro uuid default null,
  p_medio_reintegro     medio_pago default null,
  p_ip                  inet default null
) returns jsonb language plpgsql as $$
declare
  v_tenant            uuid := auth_tenant_id();
  v_actor             uuid := auth.uid();
  v_id_item           uuid;
  v_id_venta          uuid;
  v_id_devolucion     uuid;
  v_canal             canal_venta;
  v_estado_item       estado_item;
  v_estado_venta      estado_venta;
  v_total_venta       numeric(14,2);
  v_precio_venta      numeric(14,2);
  v_sum_pagos         numeric(14,2);
  v_sum_dev_previas   numeric(14,2);
  v_sum_reint_previos numeric(14,2);
  v_reintegro         numeric(14,2) := 0;
  v_cuotas_abiertas   boolean;
  v_ya_devuelta       boolean;
  v_ya_rendida        boolean;
  v_id_liquidacion    uuid;
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Lock del item_producto y lectura de detalle_venta
  select dv.id_item, ip.estado_item, dv.id_venta, dv.precio_venta,
         dv.id_rendicion is not null, dv.id_liquidacion
    into v_id_item, v_estado_item, v_id_venta, v_precio_venta,
         v_ya_rendida, v_id_liquidacion
    from detalle_venta dv
    join item_producto ip on ip.id_item = dv.id_item
   where dv.id_detalle_venta = p_id_detalle_venta
     and dv.id_tenant = v_tenant
   for update of ip;

  if v_id_item is null then
    raise exception 'detalle-venta-not-found' using errcode = '42704';
  end if;

  if v_id_liquidacion is not null then
    raise exception 'venta-liquidada' using errcode = '22023';
  end if;

  if exists (
    select 1 from cambio_venta
    where id_detalle_original = p_id_detalle_venta
      and id_tenant = v_tenant
  ) then
    raise exception 'detalle-ya-cambiado' using errcode = '22023';
  end if;

  if v_estado_item <> 'vendido' then
    raise exception 'item-no-esta-vendido: estado=%', v_estado_item using errcode = '22023';
  end if;

  if v_ya_rendida then
    raise exception 'detalle-ya-rendido' using errcode = '22023';
  end if;

  select exists(
    select 1 from devolucion_venta
     where id_detalle_venta = p_id_detalle_venta
  ) into v_ya_devuelta;

  if v_ya_devuelta then
    raise exception 'detalle-ya-devuelto' using errcode = '22023';
  end if;

  select estado_venta, total, canal into v_estado_venta, v_total_venta, v_canal
    from venta
   where id_venta = v_id_venta for update;

  if v_canal = 'revendedora' then
    raise exception 'devolucion-venta-revendedora' using errcode = '22023';
  end if;

  if v_estado_venta = 'anulada' then
    raise exception 'venta-anulada' using errcode = '22023';
  end if;

  select exists(
    select 1 from cuota_financiada
     where id_venta = v_id_venta and estado in ('pendiente', 'parcial')
  ) into v_cuotas_abiertas;

  if v_cuotas_abiertas then
    raise exception 'devolucion-venta-con-cuotas-abiertas' using errcode = '22023';
  end if;

  -- Calcular reintegro (excluye pagos cuenta_revendedora)
  select coalesce(sum(monto), 0) into v_sum_pagos
    from pago_venta
   where id_venta = v_id_venta
     and medio <> 'cuenta_revendedora';

  select coalesce(sum(dv.precio_venta), 0) into v_sum_dev_previas
    from devolucion_venta dev
    join detalle_venta dv on dv.id_detalle_venta = dev.id_detalle_venta
   where dev.id_venta = v_id_venta;

  select coalesce(sum(monto), 0) into v_sum_reint_previos
    from reintegro_cliente
   where id_venta = v_id_venta;

  v_reintegro := greatest(0::numeric, v_sum_pagos - (v_total_venta - v_sum_dev_previas - v_precio_venta) - v_sum_reint_previos);

  if v_reintegro > 0 and (p_id_cuenta_reintegro is null or p_medio_reintegro is null) then
    raise exception 'reintegro-requiere-cuenta-y-medio' using errcode = '22023';
  end if;

  -- Insertar devolucion_venta
  insert into devolucion_venta (
    id_tenant, id_venta, id_detalle_venta, id_item,
    monto, motivo, id_usuario
  ) values (
    v_tenant, v_id_venta, p_id_detalle_venta, v_id_item,
    v_precio_venta, p_motivo, v_actor
  ) returning id_devolucion into v_id_devolucion;

  -- Sellador DEFINER: copia costo_snapshot de detalle_venta_costo a devolucion_venta_costo
  perform fn_sellar_costo_devolucion(v_id_devolucion);

  -- Insertar reintegro_cliente si corresponde
  if v_reintegro > 0 then
    insert into reintegro_cliente (
      id_tenant, id_venta, id_devolucion, id_cuenta_destino,
      medio, monto, origen, motivo, id_usuario
    ) values (
      v_tenant, v_id_venta, v_id_devolucion, p_id_cuenta_reintegro,
      p_medio_reintegro, v_reintegro, 'devolucion', p_motivo, v_actor
    );
  end if;

  -- Transicionar item
  perform sp_transicion_item_producto(
    v_id_item, 'devuelto_cliente', 'ajuste',
    p_id_detalle_venta, 'devolucion_cliente', p_ip
  );

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'detalle_venta', p_id_detalle_venta::text, 'devolucion_cliente',
          jsonb_build_object('motivo', p_motivo, 'reintegro', v_reintegro), p_ip);

  return jsonb_build_object('reintegro', v_reintegro);
end;
$$;

-- =====================================================================
-- 7. Lectores, vistas y trigger de inmutabilidad
-- =====================================================================

create or replace function sp_generar_rendicion(
  p_id_proveedor  uuid,
  p_observaciones text default null,
  p_ip            inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_total    numeric(14, 2);
  v_count    integer;
  v_desde    timestamptz;
  v_hasta    timestamptz;
begin
  if not (
    (select auth_tiene_permiso('rendiciones', 'crear'))
    and (select auth_tiene_permiso('rendiciones', 'ver'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  -- Modificado para excluir devueltos; lee detalle_venta_rendicion
  select
    coalesce(sum(dvr.monto_proveedor), 0),
    count(*),
    min(v.fecha),
    max(v.fecha)
  into v_total, v_count, v_desde, v_hasta
  from detalle_venta dv
  join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
  join venta v on v.id_venta = dv.id_venta
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = v_tenant
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dvr.monto_proveedor > 0
    and v.estado_venta = 'registrada'
    and dev.id_devolucion is null; -- EXCLUIR DEVUELTOS

  if v_count = 0 then
    raise exception 'sin-lineas-pendientes' using errcode = '22023';
  end if;

  insert into rendicion_proveedor(
    id_tenant, id_proveedor, id_usuario_alta,
    periodo_desde, periodo_hasta,
    monto_total, cantidad_lineas, observaciones
  ) values (
    v_tenant, p_id_proveedor, v_actor,
    v_desde, v_hasta,
    v_total, v_count, p_observaciones
  ) returning id_rendicion into v_id;

  update detalle_venta dv
     set id_rendicion = v_id
    from venta v, detalle_venta_rendicion dvr
   where v.id_venta = dv.id_venta
     and dvr.id_detalle_venta = dv.id_detalle_venta
     and dv.id_tenant = v_tenant
     and dv.id_proveedor = p_id_proveedor
     and dv.id_rendicion is null
     and dv.excluida_rendicion = false
     and dvr.monto_proveedor > 0
     and v.estado_venta = 'registrada'
     and not exists (select 1 from devolucion_venta dev
                      where dev.id_detalle_venta = dv.id_detalle_venta); -- EXCLUIR DEVUELTOS

  select coalesce(sum(dvr.monto_proveedor), 0), count(*)
    into v_total, v_count
    from detalle_venta dv
    join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
   where dv.id_rendicion = v_id;

  update rendicion_proveedor
     set monto_total = v_total, cantidad_lineas = v_count
   where id_rendicion = v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rendicion_proveedor', v_id::text, 'generar',
          jsonb_build_object('id_proveedor', p_id_proveedor,
                             'monto_total', v_total,
                             'cantidad_lineas', v_count,
                             'periodo_desde', v_desde,
                             'periodo_hasta', v_hasta),
          p_ip);
  return v_id;
end $$;

create or replace function preview_rendicion(
  p_id_proveedor uuid
) returns table (
  id_detalle_venta uuid,
  id_venta         uuid,
  fecha            timestamptz,
  producto_nombre  text,
  producto_sku     text,
  qr_code          text,
  precio_venta     numeric,
  costo_snapshot   numeric,
  monto_proveedor  numeric,
  cliente_nombre   text
) language plpgsql stable as $$
begin
  if not (select auth_tiene_permiso('rendiciones', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(auth_tenant_id(), 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  return query
  select
    dv.id_detalle_venta,
    v.id_venta,
    v.fecha,
    p.nombre  as producto_nombre,
    p.sku     as producto_sku,
    ip.qr_code,
    dv.precio_venta,
    dvc.costo_snapshot,
    dvr.monto_proveedor,
    c.nombre  as cliente_nombre
  from detalle_venta dv
  join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
  left join detalle_venta_costo dvc on dvc.id_detalle_venta = dv.id_detalle_venta
  join venta v          on v.id_venta = dv.id_venta
  join producto p       on p.id_producto = dv.id_producto
  join item_producto ip on ip.id_item = dv.id_item
  left join cliente c   on c.id_cliente = v.id_cliente
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = auth_tenant_id()
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dvr.monto_proveedor > 0
    and v.estado_venta = 'registrada'
    and dev.id_devolucion is null -- EXCLUIR DEVUELTOS
  order by v.fecha asc;
end $$;

create or replace function sp_perdida_incobrable_venta(p_id_venta uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_ver_costos boolean;
  v_adeudado   numeric(14, 2);
  v_cobrado    numeric(14, 2);
  v_costo      numeric(14, 2);
  v_no_cub     numeric(14, 2);
  v_ratio      numeric;
  v_detalle    jsonb := '[]'::jsonb;
  v_acum       numeric(14, 2) := 0;
  v_linea_no_cub numeric(14, 2);
  v_lineas     integer;
  v_i          integer := 0;
  r            record;
begin
  if not (select auth_tiene_permiso('ventas', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));

  select coalesce(sum(monto - monto_pagado), 0) into v_adeudado
    from cuota_financiada
   where id_venta = p_id_venta and id_tenant = v_tenant
     and estado = 'incobrable';

  select coalesce(sum(monto), 0) into v_cobrado
    from pago_venta
   where id_venta = p_id_venta and id_tenant = v_tenant;

  if not v_ver_costos then
    return jsonb_build_object(
      'monto_adeudado',    v_adeudado,
      'total_cobrado',     v_cobrado,
      'costo_total',       null,
      'costo_no_cubierto', null,
      'detalle',           '[]'::jsonb
    );
  end if;

  select coalesce(sum(
           case when dv.tipo_ingreso_snapshot = 'compra'
                then dvc.costo_snapshot
                else dvr.monto_proveedor
           end), 0),
         count(*)
    into v_costo, v_lineas
    from detalle_venta dv
    left join detalle_venta_costo dvc on dvc.id_detalle_venta = dv.id_detalle_venta
    left join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
   where dv.id_venta = p_id_venta and dv.id_tenant = v_tenant;

  v_no_cub := greatest(0, v_costo - v_cobrado);

  -- Proporción del costo que quedó SIN cubrir. Con costo 0 (todo compra
  -- propia ya amortizada, o una venta sin costo) no hay nada que repartir.
  v_ratio := case when v_costo > 0 then v_no_cub / v_costo else 0 end;

  if v_no_cub > 0 then
    for r in
      select dv.id_detalle_venta,
             dv.tipo_ingreso_snapshot,
             dv.excluida_rendicion,
             dv.id_rendicion,
             p.nombre as producto_nombre,
             p.sku    as producto_sku,
             pr.id_proveedor,
             pr.nombre as proveedor_nombre,
             case when dv.tipo_ingreso_snapshot = 'compra'
                  then dvc.costo_snapshot
                  else dvr.monto_proveedor
             end as costo_linea
        from detalle_venta dv
        left join detalle_venta_costo dvc on dvc.id_detalle_venta = dv.id_detalle_venta
        left join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
        left join producto  p  on p.id_producto  = dv.id_producto
        left join proveedor pr on pr.id_proveedor = dv.id_proveedor
       where dv.id_venta = p_id_venta and dv.id_tenant = v_tenant
       order by dv.created_at, dv.id_detalle_venta
    loop
      v_i := v_i + 1;
      if v_i = v_lineas then
        v_linea_no_cub := v_no_cub - v_acum;
      else
        v_linea_no_cub := round(r.costo_linea * v_ratio, 2);
      end if;
      v_acum := v_acum + v_linea_no_cub;

      v_detalle := v_detalle || jsonb_build_object(
        'id_detalle_venta',      r.id_detalle_venta,
        'producto_nombre',       r.producto_nombre,
        'producto_sku',          r.producto_sku,
        'tipo_ingreso_snapshot', r.tipo_ingreso_snapshot,
        'id_proveedor',          r.id_proveedor,
        'proveedor_nombre',      r.proveedor_nombre,
        'costo_linea',           r.costo_linea,
        'costo_cubierto',        r.costo_linea - v_linea_no_cub,
        'costo_no_cubierto',     v_linea_no_cub,
        -- DECISIÓN DE NEGOCIO (confirmada): al proveedor se le paga SIEMPRE,
        -- cobre o no cobre el cliente. Así que `costo_no_cubierto` es plata que
        -- sale del bolsillo sin vuelta, y `excluida_rendicion` NO se usa para
        -- tapar incobrables. Se informa igual porque una línea excluida a mano
        -- por otro motivo cambiaría la lectura, y la UI tiene que poder verlo.
        'excluida_rendicion',    r.excluida_rendicion,
        'rendida',               r.id_rendicion is not null
      );
    end loop;
  end if;

  return jsonb_build_object(
    'monto_adeudado',    v_adeudado,
    'total_cobrado',     v_cobrado,
    'costo_total',       v_costo,
    'costo_no_cubierto', v_no_cub,
    'detalle',           v_detalle
  );
end $$;

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
        join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
        join venta v on v.id_venta = dv.id_venta
        left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
       where dv.id_tenant = p_tenant
         and dv.id_rendicion is null
         and dv.excluida_rendicion = false
         and dvr.monto_proveedor > 0
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

create or replace view v_linea_venta with (security_invoker = true) as
select
  v.id_tenant,
  v.id_venta,
  dv.id_producto,
  case
    when cv_nuevo.id_cambio is not null then cv_nuevo.created_at
    else v.fecha
  end as fecha_venta,
  v.estado_venta,
  v.fecha_anulacion,
  p.precio_venta as precio_venta,
  dvc.costo_snapshot as costo,
  dvc.monto_ganancia as margen,
  dv.tipo_ingreso_snapshot,
  dv.id_proveedor,
  dvr.monto_proveedor,
  dv.id_rendicion,
  dv.excluida_rendicion,
  (dev.id_devolucion is not null or cv_orig.id_cambio is not null) as devuelta,
  coalesce(dev.fecha, cv_orig.created_at) as fecha_devolucion,
  coalesce(devc.costo_recuperado, case when cv_orig.id_cambio is not null then dvc.costo_snapshot else null end)::numeric(14,2) as costo_recuperado,
  case
    when v.estado_venta = 'registrada' and dev.id_devolucion is null and cv_orig.id_cambio is null and dv.id_liquidacion is not null
      then dv.monto_comision
    else 0::numeric(14, 2)
  end as comision,
  case
    when v.estado_venta = 'registrada'
     and dev.id_devolucion is null
     and cv_orig.id_cambio is null
     and dv.id_liquidacion is null
     and v.canal = 'revendedora'
      then round((dv.porcentaje_comision_preview * dv.precio_venta / 100.0), 2)
    else 0::numeric(14, 2)
  end as comision_estimada,
  liq.fecha_liquidacion
from detalle_venta dv
join venta v on v.id_venta = dv.id_venta
join producto p on p.id_producto = dv.id_producto
left join detalle_venta_costo dvc on dvc.id_detalle_venta = dv.id_detalle_venta
left join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
left join devolucion_venta_costo devc on devc.id_devolucion = dev.id_devolucion
left join cambio_venta cv_orig on cv_orig.id_detalle_original = dv.id_detalle_venta and cv_orig.id_tenant = dv.id_tenant
left join cambio_venta cv_nuevo on cv_nuevo.id_item_entregado = dv.id_item and cv_nuevo.id_venta_original = dv.id_venta and cv_nuevo.id_tenant = dv.id_tenant
left join liquidacion_revendedora liq on liq.id_liquidacion = dv.id_liquidacion and liq.id_tenant = dv.id_tenant;

create or replace view v_perfil_proveedor
with (security_invoker = on) as
select
  prov.id_tenant,
  prov.id_proveedor,
  prov.nombre,
  prov.tipo,
  prov.telefono,
  prov.dias_rotacion,
  -- Items disponibles del proveedor (stock actual de consignación)
  (select count(*)
     from item_producto ip
     join ingreso_mercaderia im on im.id_ingreso = ip.id_ingreso
    where im.id_proveedor = prov.id_proveedor
      and ip.id_tenant = prov.id_tenant
      and ip.estado_item = 'disponible'
      and ip.tipo_ingreso = 'consignacion'
  )::bigint as items_disponibles,
  -- Consignaciones (lotes de devolución) activas
  (select count(*)
     from consignacion c
    where c.id_proveedor = prov.id_proveedor
      and c.id_tenant = prov.id_tenant
      and c.estado = 'activa'
  )::bigint as consignaciones_activas,
  -- Ventas pendientes de rendir a este proveedor (EXCLUYE DEVUELTOS)
  (select coalesce(sum(dvr.monto_proveedor), 0)
     from detalle_venta dv
     join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
     join venta v on v.id_venta = dv.id_venta
     left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
    where dv.id_proveedor = prov.id_proveedor
      and dv.id_tenant = prov.id_tenant
      and dv.id_rendicion is null
      and dv.excluida_rendicion = false
      and dvr.monto_proveedor > 0
      and v.estado_venta = 'registrada'
      and dev.id_devolucion is null
  )::numeric as monto_pendiente_rendicion,
  (select count(*)
     from detalle_venta dv
     join detalle_venta_rendicion dvr on dvr.id_detalle_venta = dv.id_detalle_venta
     join venta v on v.id_venta = dv.id_venta
     left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
    where dv.id_proveedor = prov.id_proveedor
      and dv.id_tenant = prov.id_tenant
      and dv.id_rendicion is null
      and dv.excluida_rendicion = false
      and dvr.monto_proveedor > 0
      and v.estado_venta = 'registrada'
      and dev.id_devolucion is null
  )::bigint as lineas_pendientes_rendicion,
  -- Rendiciones históricas
  (select coalesce(sum(r.monto_total), 0)
     from rendicion_proveedor r
    where r.id_proveedor = prov.id_proveedor
      and r.id_tenant = prov.id_tenant
  )::numeric as monto_rendido_historico,
  (select count(*)
     from rendicion_proveedor r
    where r.id_proveedor = prov.id_proveedor
      and r.id_tenant = prov.id_tenant
      and r.estado = 'pendiente'
  )::bigint as rendiciones_pendientes_pago
from proveedor prov
where prov.activo = true;

create or replace function rf_finanzas_resultados(p_desde date, p_hasta date)
returns table (
  ventas_brutas numeric,
  anulaciones numeric,
  devoluciones numeric,
  ventas_netas numeric,
  costo_mercaderia numeric,
  ganancia_sobre_ventas numeric,
  costo_cobro numeric,
  incobrables numeric,
  bajas_inventario numeric,
  ganancia_despues_de_costos numeric,
  gastos numeric,
  comision_liquidada numeric,
  comision_pendiente_estimada numeric,
  ganancia_final numeric,
  cantidad_ventas bigint,
  ticket_promedio numeric
)
language plpgsql
security invoker
as $$
declare
  v_tenant_id uuid;
  v_ver_costos boolean;
  v_ventas_brutas numeric := 0;
  v_anulaciones numeric := 0;
  v_devoluciones numeric := 0;
  v_costo_mercaderia numeric := 0;
  v_costo_cobro numeric := 0;
  v_incobrables numeric := 0;
  v_bajas_inventario numeric := 0;
  v_gastos numeric := 0;
  v_comision_liquidada numeric := 0;
  v_comision_pendiente_estimada numeric := 0;
  v_cantidad_ventas bigint := 0;
  v_zona text;
  v_diferencias_cambio numeric := 0;
begin
  if not (select auth_tiene_permiso('reportes', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
  v_tenant_id := auth_tenant_id();
  select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;

  -- Ventas brutas: ventas registradas del período + diferencias cobradas en cambios del período
  select
    coalesce(sum(v.total), 0) into v_ventas_brutas
  from venta v
  where v.id_tenant = v_tenant_id
    and (v.fecha at time zone v_zona)::date >= p_desde
    and (v.fecha at time zone v_zona)::date <= p_hasta;

  select
    coalesce(sum(cv.diferencia), 0) into v_diferencias_cambio
  from cambio_venta cv
  where cv.id_tenant = v_tenant_id
    and (cv.created_at at time zone v_zona)::date >= p_desde
    and (cv.created_at at time zone v_zona)::date <= p_hasta;

  v_ventas_brutas := v_ventas_brutas + v_diferencias_cambio;

  -- Anulaciones: suma total de ventas anuladas en el período + diferencias de cambios de esas ventas
  select
    coalesce(sum(v.total), 0) + coalesce((
      select sum(cv.diferencia)
      from cambio_venta cv
      join venta va on va.id_venta = cv.id_venta_original
      where va.id_tenant = v_tenant_id
        and (va.fecha_anulacion at time zone v_zona)::date >= p_desde
        and (va.fecha_anulacion at time zone v_zona)::date <= p_hasta
    ), 0) into v_anulaciones
  from venta v
  where v.id_tenant = v_tenant_id
    and (v.fecha_anulacion at time zone v_zona)::date >= p_desde
    and (v.fecha_anulacion at time zone v_zona)::date <= p_hasta;

  select
    coalesce(sum(dv.monto), 0) into v_devoluciones
  from devolucion_venta dv
  where dv.id_tenant = v_tenant_id
    and (dv.fecha at time zone v_zona)::date >= p_desde
    and (dv.fecha at time zone v_zona)::date <= p_hasta;

  if v_ver_costos then
    select
      coalesce(sum(vl.costo), 0) into v_costo_mercaderia
    from v_linea_venta vl
    where vl.id_tenant = v_tenant_id
      and (vl.fecha_venta at time zone v_zona)::date >= p_desde
      and (vl.fecha_venta at time zone v_zona)::date <= p_hasta;

    declare
      v_costo_anuladas numeric := 0;
      v_costo_devueltas numeric := 0;
    begin
      select coalesce(sum(vl.costo), 0) into v_costo_anuladas
      from v_linea_venta vl
      where vl.id_tenant = v_tenant_id
        and (vl.fecha_anulacion at time zone v_zona)::date >= p_desde
        and (vl.fecha_anulacion at time zone v_zona)::date <= p_hasta;

      select coalesce(sum(vl.costo_recuperado), 0) into v_costo_devueltas
      from v_linea_venta vl
      where vl.id_tenant = v_tenant_id
        and (vl.fecha_devolucion at time zone v_zona)::date >= p_desde
        and (vl.fecha_devolucion at time zone v_zona)::date <= p_hasta;

      v_costo_mercaderia := v_costo_mercaderia - v_costo_anuladas - v_costo_devueltas;
    end;
  end if;

  select
    coalesce(sum(pv.costo_cobro), 0) into v_costo_cobro
  from pago_venta pv
  where pv.id_tenant = v_tenant_id 
    and pv.medio <> 'cuenta_revendedora'
    and (pv.created_at at time zone v_zona)::date >= p_desde
    and (pv.created_at at time zone v_zona)::date <= p_hasta;

  select
    coalesce(sum(cf.monto - cf.monto_pagado), 0) into v_incobrables
  from cuota_financiada cf
  where cf.id_tenant = v_tenant_id
    and cf.estado = 'incobrable'
    and (cf.fecha_incobrable at time zone v_zona)::date >= p_desde
    and (cf.fecha_incobrable at time zone v_zona)::date <= p_hasta;

  if v_ver_costos then
    select
      coalesce(sum(ic.costo_ingreso), 0) into v_bajas_inventario
    from item_producto ip
    join item_costo ic on ic.id_item = ip.id_item
    where ip.id_tenant = v_tenant_id
      and ip.estado_item = 'baja'
      and (ip.updated_at at time zone v_zona)::date >= p_desde
      and (ip.updated_at at time zone v_zona)::date <= p_hasta;
  end if;

  select
    coalesce(sum(gn.monto), 0) into v_gastos
  from gasto_negocio gn
  where gn.id_tenant = v_tenant_id
    and (gn.fecha at time zone v_zona)::date >= p_desde
    and (gn.fecha at time zone v_zona)::date <= p_hasta;

  -- DR-2: comision_liquidada se devenga por fecha de liquidación, uniendo con liquidacion_revendedora
  select
    coalesce(sum(vl.comision), 0) into v_comision_liquidada
  from v_linea_venta vl
  where vl.id_tenant = v_tenant_id
    and vl.comision > 0
    and vl.fecha_liquidacion is not null
    and vl.fecha_liquidacion >= p_desde
    and vl.fecha_liquidacion <= p_hasta;

  select
    coalesce(sum(vl.comision_estimada), 0) into v_comision_pendiente_estimada
  from v_linea_venta vl
  where vl.id_tenant = v_tenant_id
    and (vl.fecha_venta at time zone v_zona)::date >= p_desde
    and (vl.fecha_venta at time zone v_zona)::date <= p_hasta;

  -- Si el módulo revendedoras está apagado, las comisiones no aplican
  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant_id and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    v_comision_liquidada := 0;
    v_comision_pendiente_estimada := 0;
  end if;

  select count(*) into v_cantidad_ventas
  from venta v
  where v.id_tenant = v_tenant_id
    and v.estado_venta = 'registrada'
    and (v.fecha at time zone v_zona)::date >= p_desde
    and (v.fecha at time zone v_zona)::date <= p_hasta;

  return query select
    v_ventas_brutas,
    v_anulaciones,
    v_devoluciones,
    v_ventas_brutas - v_anulaciones - v_devoluciones as ventas_netas,
    case when v_ver_costos then v_costo_mercaderia else null::numeric end as costo_mercaderia,
    case when v_ver_costos then (v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia else null::numeric end as ganancia_sobre_ventas,
    v_costo_cobro,
    v_incobrables,
    case when v_ver_costos then v_bajas_inventario else null::numeric end as bajas_inventario,
    case when v_ver_costos then ((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario else null::numeric end as ganancia_despues_de_costos,
    v_gastos,
    v_comision_liquidada,
    v_comision_pendiente_estimada,
    case when v_ver_costos then (((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario) - v_gastos - v_comision_liquidada else null::numeric end as ganancia_final,
    v_cantidad_ventas,
    case when v_cantidad_ventas > 0 then (v_ventas_brutas - v_anulaciones - v_devoluciones) / v_cantidad_ventas else null::numeric end as ticket_promedio;
end;
$$;

create or replace function rf_finanzas_posicion()
returns table (
  capital_propio numeric,
  mercaderia_terceros numeric,
  devueltos_clientes numeric,
  valor_venta_potencial numeric,
  productos_sin_precio bigint,
  por_cobrar jsonb,
  deuda_proveedores numeric
)
language plpgsql
security invoker
as $$
declare
  v_tenant_id uuid;
  v_ver_costos boolean;
  v_capital_propio numeric := 0;
  v_mercaderia_terceros numeric := 0;
  v_devueltos_clientes numeric := 0;
  v_valor_venta_potencial numeric := 0;
  v_productos_sin_precio bigint := 0;
  v_deuda_proveedores numeric := 0;
  v_por_cobrar jsonb;
  v_zona text;
begin
  if not (select auth_tiene_permiso('reportes', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
  v_tenant_id := auth_tenant_id();

  if auth_revendedora_id() is not null then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;

  if v_ver_costos then
    select
      coalesce(sum(ic.costo_ingreso), 0) into v_capital_propio
    from item_producto ip
    join item_costo ic on ic.id_item = ip.id_item
    where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'compra' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');

    select
      coalesce(sum(ic.costo_ingreso), 0) into v_mercaderia_terceros
    from item_producto ip
    join item_costo ic on ic.id_item = ip.id_item
    where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'consignacion' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');

    select
      coalesce(sum(ic.costo_ingreso), 0) into v_devueltos_clientes
    from item_producto ip
    join item_costo ic on ic.id_item = ip.id_item
    where ip.id_tenant = v_tenant_id and ip.estado_item = 'devuelto_cliente';
  end if;

  select
    coalesce(sum(p.precio_venta), 0) into v_valor_venta_potencial
  from item_producto ip
  join producto p on p.id_producto = ip.id_producto
  where ip.id_tenant = v_tenant_id and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');

  select
    count(*) into v_productos_sin_precio
  from producto
  where id_tenant = v_tenant_id and precio_venta = 0 and activo = true;

  -- por_cobrar: (a cobrar, vence este mes, vencido, cuotas vencidas, clientes con deuda)
  declare
    v_a_cobrar numeric := 0;
    v_vence_este_mes numeric := 0;
    v_vencido numeric := 0;
    v_cuotas_vencidas bigint := 0;
    v_clientes_con_deuda bigint := 0;
    v_hoy date;
    v_vendido_rev numeric := 0;
    v_comision_liq_rev numeric := 0;
    v_pagado_rev numeric := 0;
    v_deuda_rev numeric := 0;
  begin
    v_hoy := (now() at time zone v_zona)::date;

    select
      coalesce(sum(monto - monto_pagado), 0) into v_a_cobrar
    from cuota_financiada
    where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial');

    select
      coalesce(sum(monto - monto_pagado), 0) into v_vence_este_mes
    from cuota_financiada
    where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
      and date_trunc('month', (fecha_vencimiento at time zone v_zona)::timestamp)::date = date_trunc('month', v_hoy::timestamp)::date;

    select
      coalesce(sum(monto - monto_pagado), 0) into v_vencido
    from cuota_financiada
    where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
      and (fecha_vencimiento at time zone v_zona)::date < v_hoy;

    select
      count(*) into v_cuotas_vencidas
    from cuota_financiada
    where id_tenant = v_tenant_id and estado in ('pendiente', 'parcial')
      and (fecha_vencimiento at time zone v_zona)::date < v_hoy;

    select
      count(distinct v.id_cliente) into v_clientes_con_deuda
    from cuota_financiada cf
    join venta v on v.id_venta = cf.id_venta
    where cf.id_tenant = v_tenant_id and cf.estado in ('pendiente', 'parcial') and v.id_cliente is not null;

    -- Deuda adeudada por revendedoras: total_vendido - comisiones_liquidadas - total_pagado
    if exists (
      select 1 from tenant_modulo tm
      join modulo m on m.id_modulo = tm.id_modulo
      where tm.id_tenant = v_tenant_id and m.codigo = 'revendedoras' and tm.habilitado = true
    ) then
      select coalesce(sum(dv.precio_venta), 0) into v_vendido_rev
      from detalle_venta dv
      join venta v on v.id_venta = dv.id_venta
      where v.id_tenant = v_tenant_id
        and v.canal = 'revendedora'
        and v.estado_venta = 'registrada';

      select coalesce(sum(monto_comision), 0) into v_comision_liq_rev
      from liquidacion_revendedora
      where id_tenant = v_tenant_id;

      select coalesce(sum(monto), 0) into v_pagado_rev
      from pago_revendedora
      where id_tenant = v_tenant_id;

      v_deuda_rev := greatest(0, v_vendido_rev - v_comision_liq_rev - v_pagado_rev);
      v_a_cobrar := v_a_cobrar + v_deuda_rev;
    end if;

    v_por_cobrar := jsonb_build_object(
      'a_cobrar', v_a_cobrar,
      'vence_este_mes', v_vence_este_mes,
      'vencido', v_vencido,
      'cuotas_vencidas', v_cuotas_vencidas,
      'clientes_con_deuda', v_clientes_con_deuda
    );
  end;

  if v_ver_costos then
    select
      coalesce(sum(d.costo_unitario), 0) into v_deuda_proveedores
    from item_producto ip
    join ingreso_mercaderia_detalle d on d.id_ingreso = ip.id_ingreso and d.id_producto = ip.id_producto
    where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'consignacion' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
  end if;

  return query select
    case when v_ver_costos then v_capital_propio else null::numeric end as capital_propio,
    case when v_ver_costos then v_mercaderia_terceros else null::numeric end as mercaderia_terceros,
    case when v_ver_costos then v_devueltos_clientes else null::numeric end as devueltos_clientes,
    v_valor_venta_potencial,
    v_productos_sin_precio,
    v_por_cobrar,
    case when v_ver_costos then v_deuda_proveedores else null::numeric end as deuda_proveedores;
end;
$$;

create or replace function tg_detalle_venta_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from tenant where id_tenant = old.id_tenant) then
      return old;
    end if;
    raise exception 'detalle-venta-inmutable: no se puede eliminar directamente' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    -- Si la línea ya está liquidada, no se puede alterar su liquidación ni su comisión
    if old.id_liquidacion is not null then
      if new.id_liquidacion is distinct from old.id_liquidacion or
         new.monto_comision <> old.monto_comision or
         new.excluida_liquidacion <> old.excluida_liquidacion then
        raise exception 'detalle-venta-inmutable: linea ya liquidada no se puede modificar' using errcode = '22023';
      end if;
    end if;

    -- Campos estrictamente congelados (precio, preview comision, etc.; costos viven en satélites)
    if new.id_tenant <> old.id_tenant or
       new.id_venta <> old.id_venta or
       new.id_item <> old.id_item or
       new.id_producto <> old.id_producto or
       new.id_proveedor is distinct from old.id_proveedor or
       new.precio_venta <> old.precio_venta or
       new.monto_gasto <> old.monto_gasto or
       new.tipo_ingreso_snapshot <> old.tipo_ingreso_snapshot or
       new.desglose_reglas is distinct from old.desglose_reglas or
       new.porcentaje_comision_preview <> old.porcentaje_comision_preview then
      raise exception 'detalle-venta-inmutable: solo se puede modificar comision/liquidacion y rendicion' using errcode = '22023';
    end if;

    return new;
  end if;
end $$;

-- =====================================================================
-- 8. DROP COLUMN de columnas migradas (sin CASCADE)
-- =====================================================================

drop index if exists detalle_venta_rendicion_pendiente_idx;
create index if not exists detalle_venta_rendicion_pendiente_idx
  on detalle_venta(id_tenant, id_proveedor)
  where id_rendicion is null and excluida_rendicion = false;

alter table item_producto drop column costo_ingreso;
alter table detalle_venta drop column costo_snapshot;
alter table detalle_venta drop column monto_ganancia;
alter table detalle_venta drop column monto_proveedor;
alter table devolucion_venta drop column costo_recuperado;
