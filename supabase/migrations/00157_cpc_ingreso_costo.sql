-- 00157_cpc_ingreso_costo.sql
-- Fase 3E.3 costos-por-columna (REQ-CPC.md §11, §6.1, §6.2, D-CPC-02, D-CPC-03, D-CPC-05, D-CPC-08):
--   1. Tabla satélite: ingreso_detalle_costo con RLS idéntica a item_costo en 00156.
--   2. Inmutabilidad en ingreso_detalle_costo y preservación de chequeo NaN.
--   3. Backfill desde columnas viejas y verificación de conteos en DO $$.
--   4. Sellador DEFINER: fn_sellar_costo_ingreso.
--   5. Recreación de escritores y lectores + DROP COLUMN sin CASCADE.
--
-- DOWN:
-- alter table ingreso_mercaderia_detalle add column if not exists costo_unitario numeric(14, 2);
-- alter table ingreso_mercaderia_detalle add column if not exists costo_original_usd numeric(14, 2);
-- alter table ingreso_mercaderia_detalle add column if not exists cotizacion_aplicada numeric(14, 4);
-- alter table ingreso_mercaderia_detalle add column if not exists cotizacion_fecha_valor date;
--
-- alter table ingreso_mercaderia_detalle disable trigger ingreso_detalle_inmutable;
-- update ingreso_mercaderia_detalle imd
--    set costo_unitario = idc.costo_unitario,
--        costo_original_usd = idc.costo_original_usd,
--        cotizacion_aplicada = idc.cotizacion_aplicada,
--        cotizacion_fecha_valor = idc.cotizacion_fecha_valor
--   from ingreso_detalle_costo idc
--  where idc.id_detalle = imd.id_detalle;
-- alter table ingreso_mercaderia_detalle enable trigger ingreso_detalle_inmutable;
--
-- alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_costo_unitario_check;
-- alter table ingreso_mercaderia_detalle add constraint ingreso_mercaderia_detalle_costo_unitario_check
--   check (costo_unitario is null or costo_unitario >= 0);
-- alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_detalle_costo_no_nan;
-- alter table ingreso_mercaderia_detalle add constraint ingreso_detalle_costo_no_nan
--   check (costo_unitario <> 'NaN'::numeric);
-- alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_costo_original_usd_check;
-- alter table ingreso_mercaderia_detalle add constraint ingreso_mercaderia_detalle_costo_original_usd_check
--   check (costo_original_usd is null or costo_original_usd >= 0);
-- alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_cotizacion_aplicada_check;
-- alter table ingreso_mercaderia_detalle add constraint ingreso_mercaderia_detalle_cotizacion_aplicada_check
--   check (cotizacion_aplicada is null or cotizacion_aplicada > 0);
--
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle;
-- create policy rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle
--   as restrictive for update to authenticated
--   using ((select auth_tiene_permiso('inventario', 'cargar_costos')))
--   with check (costo_unitario is null or (select auth_tiene_permiso('inventario', 'cargar_costos')));
-- create policy rlsp_ingreso_mercaderia_detalle_costo_insert on ingreso_mercaderia_detalle
--   as restrictive for insert to authenticated
--   with check (costo_unitario is null or (select auth_tiene_permiso('inventario', 'cargar_costos')));
-- grant update (costo_unitario) on ingreso_mercaderia_detalle to authenticated;
--
-- drop trigger if exists ingreso_detalle_costo_inmutable on ingreso_detalle_costo;
-- revoke all on function fn_sellar_costo_ingreso(uuid) from authenticated;
-- drop function if exists fn_sellar_costo_ingreso(uuid);
-- drop table if exists ingreso_detalle_costo;
--
-- NOTE: Restaura las definiciones vigentes anteriores, copiadas sin cambios.
--
-- NOTE: ingreso_detalle_bloquea_confirmado (00153_cpc_costo_pendiente.sql:180)
-- create or replace function ingreso_detalle_bloquea_confirmado()
-- returns trigger language plpgsql as $$
-- declare
--   v_confirmado boolean;
-- begin
--   if tg_op in ('INSERT', 'UPDATE') then
--     select confirmado into v_confirmado
--       from ingreso_mercaderia
--      where id_ingreso = new.id_ingreso;
--     if v_confirmado then
--       if tg_op = 'UPDATE'
--          and old.costo_unitario is null
--          and new.costo_unitario is not null
--          and new.id_detalle = old.id_detalle
--          and new.id_tenant = old.id_tenant
--          and new.id_ingreso = old.id_ingreso
--          and new.id_producto = old.id_producto
--          and new.cantidad = old.cantidad
--          and new.talle is not distinct from old.talle then
--       else
--         raise exception
--           'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
--           using errcode = '22023';
--       end if;
--     end if;
--   end if;
--
--   if tg_op = 'DELETE'
--      and not exists (select 1 from tenant where id_tenant = old.id_tenant) then
--     return old;
--   end if;
--
--   if tg_op in ('UPDATE', 'DELETE') then
--     select confirmado into v_confirmado
--       from ingreso_mercaderia
--      where id_ingreso = old.id_ingreso;
--     if v_confirmado then
--       if tg_op = 'UPDATE'
--          and old.costo_unitario is null
--          and new.costo_unitario is not null
--          and new.id_detalle = old.id_detalle
--          and new.id_tenant = old.id_tenant
--          and new.id_ingreso = old.id_ingreso
--          and new.id_producto = old.id_producto
--          and new.cantidad = old.cantidad
--          and new.talle is not distinct from old.talle then
--       else
--         raise exception
--           'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
--           using errcode = '22023';
--       end if;
--     end if;
--   end if;
--
--   if tg_op = 'DELETE' then
--     return old;
--   end if;
--   return new;
-- end $$;
--
-- NOTE: sp_importar_remito (00153_cpc_costo_pendiente.sql:415)
-- create or replace function sp_importar_remito(
--   p_id_ingreso            uuid,
--   p_moneda                text default 'ARS',
--   p_lineas                jsonb default '[]',
--   p_ip                    inet default null,
--   p_cotizacion_aplicada    numeric default null,
--   p_cotizacion_fecha_valor date default null
-- ) returns jsonb
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant             uuid := auth_tenant_id();
--   v_actor              uuid := auth.uid();
--   v_linea              jsonb;
--   v_parte              jsonb;
--   v_es_nuevo           boolean;
--   v_id_producto        uuid;
--   v_id_categoria       uuid;
--   v_nombre             text;
--   v_sku                text;
--   v_costo              numeric;
--   v_costo_original_usd numeric;
--   v_talle              text;
--   v_cant               integer;
--   v_id_detalle         uuid;
--   v_creados            integer := 0;
--   v_vinculados         integer := 0;
--   v_detalles           jsonb := '[]'::jsonb;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   if not exists (
--     select 1 from ingreso_mercaderia
--      where id_ingreso = p_id_ingreso and id_tenant = v_tenant
--   ) then
--     raise exception 'ingreso-not-found' using errcode = '42704';
--   end if;
--
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
--   loop
--     v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
--     v_nombre   := trim(v_linea->>'nombre');
--     v_costo    := nullif(trim(v_linea->>'costoUnitario'), '')::numeric;
--
--     if v_costo is not null and not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
--       raise exception 'no-permission' using errcode = '42501';
--     end if;
--
--     if p_moneda = 'USD' and v_costo is not null then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
--         v_costo := round(v_costo * p_cotizacion_aplicada, 2);
--       end if;
--     end if;
--
--     if exists (
--       select 1
--         from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) other
--        where (
--          (v_id_producto is not null and nullif(other->>'idProducto', '')::uuid = v_id_producto)
--          or (v_id_producto is null and trim(other->>'nombre') = v_nombre)
--        )
--        and (
--          case when p_moneda = 'USD' and nullif(other->>'costoOriginalUsd', '') is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 and nullif(trim(other->>'costoUnitario'), '') is not null
--               then round(nullif(trim(other->>'costoUnitario'), '')::numeric * p_cotizacion_aplicada, 2)
--               else nullif(trim(other->>'costoUnitario'), '')::numeric
--          end
--        ) is distinct from v_costo
--     ) then
--       raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
--     end if;
--   end loop;
--
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
--   loop
--     v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false);
--     v_nombre   := trim(v_linea->>'nombre');
--     v_costo    := nullif(trim(v_linea->>'costoUnitario'), '')::numeric;
--
--     if v_nombre is null or v_nombre = '' then
--       raise exception 'linea-sin-nombre' using errcode = '22023';
--     end if;
--
--     if p_moneda = 'USD' and v_costo is not null then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
--         v_costo_original_usd := v_costo;
--         v_costo := round(v_costo * p_cotizacion_aplicada, 2);
--       end if;
--     else
--       v_costo_original_usd := null;
--     end if;
--
--     if v_es_nuevo then
--       v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
--       if v_id_categoria is null then
--         raise exception 'falta-categoria: %', v_nombre using errcode = '22023';
--       end if;
--
--       v_sku := sp_gen_sku(v_id_categoria);
--
--       insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo)
--       values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true)
--       returning id_producto into v_id_producto;
--
--       insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--       values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear',
--               jsonb_build_object('nombre', v_nombre, 'sku', v_sku,
--                                  'id_categoria', v_id_categoria,
--                                  'origen', 'import-remito'),
--               p_ip);
--
--       if v_costo is not null and v_costo > 0 then
--         perform sp_aplicar_ultimo_costo(
--           v_id_producto,
--           v_costo,
--           coalesce(p_moneda, 'ARS'),
--           case when p_moneda = 'USD' then v_costo_original_usd else null end,
--           case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--           case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end,
--           'costo inicial (import remito)',
--           p_ip,
--           true
--         );
--       end if;
--
--       v_creados := v_creados + 1;
--     else
--       v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
--       if v_id_producto is null then
--         raise exception 'falta-producto: %', v_nombre using errcode = '22023';
--       end if;
--       if not exists (
--         select 1 from producto where id_producto = v_id_producto and id_tenant = v_tenant
--       ) then
--         raise exception 'producto-not-found: %', v_nombre using errcode = '42704';
--       end if;
--       v_vinculados := v_vinculados + 1;
--     end if;
--
--     for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb))
--     loop
--       v_talle := nullif(trim(v_parte->>'talle'), '');
--       v_cant  := coalesce((v_parte->>'cantidad')::integer, 0);
--       if v_cant <= 0 then
--         continue;
--       end if;
--
--       insert into ingreso_mercaderia_detalle(
--         id_tenant, id_ingreso, id_producto,
--         cantidad, costo_unitario, talle,
--         costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--       )
--       values (
--         v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle,
--         case when p_moneda = 'USD' then v_costo_original_usd else null end,
--         case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
--         case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
--       )
--       returning id_detalle into v_id_detalle;
--
--       v_detalles := v_detalles || jsonb_build_object(
--         'id_detalle', v_id_detalle,
--         'id_producto', v_id_producto,
--         'nombre', v_nombre,
--         'cantidad', v_cant,
--         'costo_unitario', v_costo,
--         'talle', v_talle,
--         'costo_original_usd', v_costo_original_usd
--       );
--     end loop;
--   end loop;
--
--   return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
-- end;
-- $$;
--
-- NOTE: rf_finanzas_flujo (00155_cpc_policies_y_herencia.sql:2512)
-- create or replace function rf_finanzas_flujo(p_desde date, p_hasta date)
-- returns table (
--   cobrado numeric,
--   devuelto_clientes numeric,
--   costo_cobro numeric,
--   neto_cobros numeric,
--   compras_mercaderia numeric,
--   pagos_proveedores numeric,
--   gastos numeric,
--   flujo_neto numeric,
--   por_acreditar jsonb
-- )
-- language plpgsql
-- security invoker
-- as $$
-- declare
--   v_tenant_id uuid;
--   v_ver_costos boolean;
--   v_cobrado numeric := 0;
--   v_devuelto_clientes numeric := 0;
--   v_costo_cobro numeric := 0;
--   v_compras_mercaderia numeric := 0;
--   v_pagos_proveedores numeric := 0;
--   v_gastos numeric := 0;
--   v_por_acreditar jsonb;
--   v_zona text;
-- begin
--   if not (select auth_tiene_permiso('reportes', 'ver')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
--   v_tenant_id := auth_tenant_id();
--   select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;
--
--   select
--     coalesce(sum(pv.monto), 0) into v_cobrado
--   from pago_venta pv
--   where pv.id_tenant = v_tenant_id
--     and pv.medio <> 'cuenta_revendedora'
--     and (pv.created_at at time zone v_zona)::date >= p_desde and (pv.created_at at time zone v_zona)::date <= p_hasta;
--
--   declare
--     v_cobrado_revendedora numeric := 0;
--   begin
--     select coalesce(sum(pr.monto), 0) into v_cobrado_revendedora
--     from pago_revendedora pr
--     where pr.id_tenant = v_tenant_id
--       and (pr.fecha at time zone v_zona)::date >= p_desde
--       and (pr.fecha at time zone v_zona)::date <= p_hasta;
--
--     v_cobrado := v_cobrado + v_cobrado_revendedora;
--   end;
--
--   select
--     coalesce(sum(rc.monto), 0) into v_devuelto_clientes
--   from reintegro_cliente rc
--   where rc.id_tenant = v_tenant_id
--     and rc.medio <> 'cuenta_revendedora'
--     and (rc.fecha at time zone v_zona)::date >= p_desde and (rc.fecha at time zone v_zona)::date <= p_hasta;
--
--   select
--     coalesce(sum(pv.costo_cobro), 0) into v_costo_cobro
--   from pago_venta pv
--   where pv.id_tenant = v_tenant_id
--     and pv.medio <> 'cuenta_revendedora'
--     and (pv.created_at at time zone v_zona)::date >= p_desde and (pv.created_at at time zone v_zona)::date <= p_hasta;
--
--   if v_ver_costos then
--     select
--       coalesce(sum(cantidad * costo_unitario), 0) into v_compras_mercaderia
--     from ingreso_mercaderia_detalle d
--     join ingreso_mercaderia i on i.id_ingreso = d.id_ingreso
--     where i.id_tenant = v_tenant_id
--       and i.tipo_ingreso = 'compra'
--       and i.confirmado = true
--       and i.cancelado_at is null
--       and (i.fecha at time zone v_zona)::date >= p_desde and (i.fecha at time zone v_zona)::date <= p_hasta;
--
--     select
--       coalesce(sum(rp.monto_total), 0) into v_pagos_proveedores
--     from rendicion_proveedor rp
--     where rp.id_tenant = v_tenant_id and rp.estado = 'pagada' and (rp.fecha_pago at time zone v_zona)::date >= p_desde and (rp.fecha_pago at time zone v_zona)::date <= p_hasta;
--   end if;
--
--   select
--     coalesce(sum(gn.monto), 0) into v_gastos
--   from gasto_negocio gn
--   where gn.id_tenant = v_tenant_id and (gn.fecha at time zone v_zona)::date >= p_desde and (gn.fecha at time zone v_zona)::date <= p_hasta;
--
--   select jsonb_object_agg(t.tipo, coalesce(t.total, 0)) into v_por_acreditar
--   from (
--     select cd.tipo, sum(p.neto_acreditado) as total
--     from pago_venta p
--     join cuenta_destino cd on cd.id_cuenta_destino = p.id_cuenta_destino
--     where p.id_tenant = v_tenant_id
--       and p.medio <> 'cuenta_revendedora'
--       and (p.fecha_acreditacion at time zone v_zona)::date > (now() at time zone v_zona)::date
--     group by cd.tipo
--   ) t;
--
--   if v_por_acreditar is null then
--     v_por_acreditar := '{}'::jsonb;
--   end if;
--
--   return query select
--     v_cobrado,
--     v_devuelto_clientes,
--     v_costo_cobro,
--     v_cobrado - v_devuelto_clientes - v_costo_cobro as neto_cobros,
--     case when v_ver_costos then v_compras_mercaderia else null::numeric end as compras_mercaderia,
--     case when v_ver_costos then v_pagos_proveedores else null::numeric end as pagos_proveedores,
--     v_gastos,
--     case when v_ver_costos then (v_cobrado - v_devuelto_clientes - v_costo_cobro) - v_compras_mercaderia - v_pagos_proveedores - v_gastos else null::numeric end as flujo_neto,
--     v_por_acreditar;
-- end;
-- $$;
--
-- NOTE: sp_confirmar_ingreso (00156_cpc_item_venta_devolucion_costo.sql:2779)
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
--     return 0;
--   end if;
--
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
--     v_ids_her := array[]::uuid[];
--
--     for v_i in 1 .. v_detalle.cantidad loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
--                                 qr_code, estado_item, tipo_ingreso, talle)
--       values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
--               v_qr, 'disponible', v_tipo, v_detalle.talle)
--       returning id_item into v_new_item;
--
--       if v_detalle.costo_unitario is not null then
--         insert into item_costo(id_item, id_tenant, costo_ingreso)
--         values (v_new_item, v_tenant, v_detalle.costo_unitario);
--       else
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
--     if v_detalle.costo_unitario is null and coalesce(array_length(v_ids_her, 1), 0) > 0 then
--       perform fn_sellar_costo_herencia_items(v_detalle.id_producto, v_ids_her);
--     end if;
--   end loop;
--
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
-- NOTE: sp_completar_costo_ingreso (00156_cpc_item_venta_devolucion_costo.sql:3138)
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
--     if v_det.costo_unitario is null then
--       if v_costo is null or v_costo <= 0 then
--         raise exception 'costo-invalido' using errcode = '22023';
--       end if;
--
--       update ingreso_mercaderia_detalle
--          set costo_unitario = v_costo
--        where id_detalle = v_det.id_detalle;
--
--       with upserted as (
--         insert into item_costo(id_item, id_tenant, costo_ingreso)
--         select ip.id_item, v_tenant, v_costo
--           from item_producto ip
--          where ip.id_ingreso_detalle = v_det.id_detalle
--            and ip.id_tenant = v_tenant
--            and ip.estado_item <> 'vendido'
--         on conflict (id_item) do update
--           set costo_ingreso = excluded.costo_ingreso,
--               updated_at = now()
--         returning id_item
--       )
--       select count(*) into v_items_actualizados from upserted;
--
--       v_total_items_actualizados := v_total_items_actualizados + v_items_actualizados;
--     end if;
--   end loop;
--
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
-- NOTE: rf_finanzas_posicion (00156_cpc_item_venta_devolucion_costo.sql:4887)
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
--       coalesce(sum(ic.costo_ingreso), 0) into v_capital_propio
--     from item_producto ip
--     join item_costo ic on ic.id_item = ip.id_item
--     where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'compra' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--     select
--       coalesce(sum(ic.costo_ingreso), 0) into v_mercaderia_terceros
--     from item_producto ip
--     join item_costo ic on ic.id_item = ip.id_item
--     where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'consignacion' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--     select
--       coalesce(sum(ic.costo_ingreso), 0) into v_devueltos_clientes
--     from item_producto ip
--     join item_costo ic on ic.id_item = ip.id_item
--     where ip.id_tenant = v_tenant_id and ip.estado_item = 'devuelto_cliente';
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
-- 1. Tabla satélite ingreso_detalle_costo con RLS y aislamiento
-- =====================================================================

create table ingreso_detalle_costo (
  id_detalle             uuid primary key references ingreso_mercaderia_detalle(id_detalle) on delete cascade,
  id_tenant              uuid not null references tenant(id_tenant) on delete cascade,
  costo_unitario         numeric(14, 2) not null check (costo_unitario >= 0 and costo_unitario <> 'NaN'::numeric),
  costo_original_usd     numeric(14, 2) check (costo_original_usd is null or (costo_original_usd >= 0 and costo_original_usd <> 'NaN'::numeric)),
  cotizacion_aplicada    numeric(14, 4) check (cotizacion_aplicada is null or (cotizacion_aplicada > 0 and cotizacion_aplicada <> 'NaN'::numeric)),
  cotizacion_fecha_valor date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index ingreso_detalle_costo_tenant_idx on ingreso_detalle_costo(id_tenant);

alter table ingreso_detalle_costo enable row level security;
revoke all on table ingreso_detalle_costo from anon;
grant select, insert, update on table ingreso_detalle_costo to authenticated;

create policy ingreso_detalle_costo_own_tenant on ingreso_detalle_costo for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

create policy restrict_revendedora_ingreso_detalle_costo on ingreso_detalle_costo as restrictive for all to authenticated
  using (auth_revendedora_id() is null);

create policy rlsp_ingreso_detalle_costo_select on ingreso_detalle_costo as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver_costos')));

create policy rlsp_ingreso_detalle_costo_insert on ingreso_detalle_costo as restrictive for insert to authenticated
  with check (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (
      (select auth_tiene_permiso('precios', 'editar_cotizacion'))
      and (select auth_tiene_permiso('inventario', 'ver_costos'))
    )
  );

create policy rlsp_ingreso_detalle_costo_update on ingreso_detalle_costo as restrictive for update to authenticated
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

create policy rlsp_ingreso_detalle_costo_delete on ingreso_detalle_costo as restrictive for delete to authenticated
  using (false);

-- =====================================================================
-- 2. Backfill y verificación de conteos
-- =====================================================================

insert into ingreso_detalle_costo(
  id_detalle, id_tenant, costo_unitario,
  costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
)
select id_detalle, id_tenant, costo_unitario,
       costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
  from ingreso_mercaderia_detalle
 where costo_unitario is not null
on conflict (id_detalle) do nothing;

do $$
declare
  v_src bigint;
  v_dst bigint;
begin
  select count(*) into v_src from ingreso_mercaderia_detalle where costo_unitario is not null;
  select count(*) into v_dst from ingreso_detalle_costo;
  if v_src <> v_dst then
    raise exception 'backfill ingreso_detalle_costo mismatch: origen=% destino=%', v_src, v_dst;
  end if;
end $$;

-- =====================================================================
-- 3. Inmutabilidad y adaptación de trigger
-- =====================================================================

create or replace function ingreso_detalle_bloquea_confirmado()
returns trigger language plpgsql as $$
declare
  v_confirmado boolean;
begin
  if tg_table_name = 'ingreso_detalle_costo' then
    if tg_op = 'DELETE'
       and not exists (select 1 from tenant where id_tenant = old.id_tenant) then
      return old;
    end if;

    select im.confirmado into v_confirmado
      from ingreso_mercaderia im
      join ingreso_mercaderia_detalle imd on imd.id_ingreso = im.id_ingreso
     where imd.id_detalle = (case when tg_op = 'DELETE' then old.id_detalle else new.id_detalle end);

    if v_confirmado is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;

    if v_confirmado then
      if tg_op in ('UPDATE', 'DELETE') then
        raise exception
          'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
          using errcode = '22023';
      end if;
    end if;

    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select confirmado into v_confirmado
      from ingreso_mercaderia
     where id_ingreso = new.id_ingreso;
    if v_confirmado then
      raise exception
        'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'DELETE'
     and not exists (select 1 from tenant where id_tenant = old.id_tenant) then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select confirmado into v_confirmado
      from ingreso_mercaderia
     where id_ingreso = old.id_ingreso;
    if v_confirmado then
      raise exception
        'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists ingreso_detalle_costo_inmutable on ingreso_detalle_costo;
create trigger ingreso_detalle_costo_inmutable
  before insert or update or delete on ingreso_detalle_costo
  for each row execute function ingreso_detalle_bloquea_confirmado();

-- =====================================================================
-- 4. Sellador DEFINER fn_sellar_costo_ingreso
-- =====================================================================

create or replace function fn_sellar_costo_ingreso(
  p_id_ingreso uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
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

  -- D3: si dos líneas del mismo producto traen costos distintos o mezcla de valor y null, rechazar
  if exists (
    select 1
      from ingreso_mercaderia_detalle d
      left join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
     where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
     group by d.id_producto
    having count(distinct c.costo_unitario) > 1
        or (bool_or(c.costo_unitario is null) and bool_or(c.costo_unitario is not null))
  ) then
    raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
  end if;

  -- 1) Para las líneas que SÍ tienen costo en ingreso_detalle_costo:
  insert into item_costo(id_item, id_tenant, costo_ingreso)
  select ip.id_item, v_tenant, c.costo_unitario
    from item_producto ip
    join ingreso_detalle_costo c on c.id_detalle = ip.id_ingreso_detalle
   where ip.id_ingreso = p_id_ingreso
     and ip.id_tenant = v_tenant
     and c.costo_unitario is not null
  on conflict (id_item) do nothing;

  -- 2) Para las líneas que NO tienen costo en ingreso_detalle_costo: hereda el costo vigente si existe
  insert into item_costo(id_item, id_tenant, costo_ingreso)
  select ip.id_item, v_tenant, cp.costo
    from item_producto ip
    join ingreso_mercaderia_detalle d on d.id_detalle = ip.id_ingreso_detalle
    join costo_producto cp on cp.id_producto = ip.id_producto
                          and cp.id_tenant = v_tenant
                          and cp.vigente_hasta is null
    left join ingreso_detalle_costo c on c.id_detalle = ip.id_ingreso_detalle
   where ip.id_ingreso = p_id_ingreso
     and ip.id_tenant = v_tenant
     and c.id_detalle is null
     and cp.costo is not null
  on conflict (id_item) do nothing;
end;
$$;

revoke all on function fn_sellar_costo_ingreso(uuid) from public, anon;
grant execute on function fn_sellar_costo_ingreso(uuid) to authenticated;

-- =====================================================================
-- 5. Recreación de funciones que leen/escriben ingreso_detalle_costo
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

  for v_detalle in
    select id_detalle, id_producto, cantidad, talle
      from ingreso_mercaderia_detalle
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  loop
    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_tipo, v_detalle.talle)
      returning id_item into v_new_item;

      insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                                  estado_desde, estado_hasta,
                                  referencia_tipo, referencia_id, id_usuario)
      values (v_tenant, v_new_item, 'alta',
              null, 'disponible',
              'ingreso', p_id_ingreso, v_actor);

      v_count := v_count + 1;
    end loop;
  end loop;

  -- El sellador DEFINER valida D3 y traslada los costos del detalle a item_costo
  -- (o hereda el costo vigente si no tenía costo) sin exponerlos por RLS
  perform fn_sellar_costo_ingreso(p_id_ingreso);

  -- D2: llamar a D1 una vez por producto del ingreso si el usuario tiene cargar_costos.
  -- Si es consignación, actualiza el costo vigente pero no sincroniza unidades.
  -- Líneas sin costo no llaman a sp_aplicar_ultimo_costo.
  if (select auth_tiene_permiso('inventario', 'cargar_costos')) then
    for v_prod in
      select id_producto,
             costo_unitario,
             costo_original_usd,
             cotizacion_aplicada,
             cotizacion_fecha_valor,
             case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda
        from (
          select distinct on (d.id_producto)
                 d.id_producto,
                 c.costo_unitario,
                 c.costo_original_usd,
                 c.cotizacion_aplicada,
                 c.cotizacion_fecha_valor
            from ingreso_mercaderia_detalle d
            join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
           where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
           order by d.id_producto, d.id_detalle
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
  end if;

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

create or replace function sp_importar_remito(
  p_id_ingreso            uuid,
  p_moneda                text default 'ARS',
  p_lineas                jsonb default '[]',
  p_ip                    inet default null,
  p_cotizacion_aplicada    numeric default null,
  p_cotizacion_fecha_valor date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant             uuid := auth_tenant_id();
  v_actor              uuid := auth.uid();
  v_linea              jsonb;
  v_parte              jsonb;
  v_es_nuevo           boolean;
  v_id_producto        uuid;
  v_id_categoria       uuid;
  v_nombre             text;
  v_sku                text;
  v_costo              numeric;
  v_costo_original_usd numeric;
  v_talle              text;
  v_cant               integer;
  v_id_detalle         uuid;
  v_creados            integer := 0;
  v_vinculados         integer := 0;
  v_detalles           jsonb := '[]'::jsonb;
begin
  if not (select auth_tiene_permiso('inventario', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from ingreso_mercaderia
     where id_ingreso = p_id_ingreso and id_tenant = v_tenant
  ) then
    raise exception 'ingreso-not-found' using errcode = '42704';
  end if;

  -- Validar permisos de costo y consistencia de costos en p_lineas
  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
    v_nombre   := trim(v_linea->>'nombre');
    v_costo    := nullif(trim(v_linea->>'costoUnitario'), '')::numeric;

    -- Si viene costo sin cargar_costos: raise 'no-permission' (42501)
    if v_costo is not null and not (select auth_tiene_permiso('inventario', 'cargar_costos')) then
      raise exception 'no-permission' using errcode = '42501';
    end if;

    if p_moneda = 'USD' and v_costo is not null then
      v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
      if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
        v_costo := round(v_costo * p_cotizacion_aplicada, 2);
      end if;
    end if;

    -- Comparar contra otras líneas de p_lineas
    if exists (
      select 1
        from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) other
       where (
         (v_id_producto is not null and nullif(other->>'idProducto', '')::uuid = v_id_producto)
         or (v_id_producto is null and trim(other->>'nombre') = v_nombre)
       )
       and (
         case when p_moneda = 'USD' and nullif(other->>'costoOriginalUsd', '') is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 and nullif(trim(other->>'costoUnitario'), '') is not null
              then round(nullif(trim(other->>'costoUnitario'), '')::numeric * p_cotizacion_aplicada, 2)
              else nullif(trim(other->>'costoUnitario'), '')::numeric
         end
       ) is distinct from v_costo
    ) then
      raise exception 'costos-distintos-mismo-producto' using errcode = '22023';
    end if;
  end loop;

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false);
    v_nombre   := trim(v_linea->>'nombre');
    v_costo    := nullif(trim(v_linea->>'costoUnitario'), '')::numeric;

    if v_nombre is null or v_nombre = '' then
      raise exception 'linea-sin-nombre' using errcode = '22023';
    end if;

    if p_moneda = 'USD' and v_costo is not null then
      v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
      if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then
        v_costo_original_usd := v_costo;
        v_costo := round(v_costo * p_cotizacion_aplicada, 2);
      end if;
    else
      v_costo_original_usd := null;
    end if;

    if v_es_nuevo then
      v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
      if v_id_categoria is null then
        raise exception 'falta-categoria: %', v_nombre using errcode = '22023';
      end if;

      v_sku := sp_gen_sku(v_id_categoria);

      insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo)
      values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true)
      returning id_producto into v_id_producto;

      insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
      values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear',
              jsonb_build_object('nombre', v_nombre, 'sku', v_sku,
                                 'id_categoria', v_id_categoria,
                                 'origen', 'import-remito'),
              p_ip);

      if v_costo is not null and v_costo > 0 then
        perform sp_aplicar_ultimo_costo(
          v_id_producto,
          v_costo,
          coalesce(p_moneda, 'ARS'),
          case when p_moneda = 'USD' then v_costo_original_usd else null end,
          case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
          case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end,
          'costo inicial (import remito)',
          p_ip,
          true
        );
      end if;

      v_creados := v_creados + 1;
    else
      v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
      if v_id_producto is null then
        raise exception 'falta-producto: %', v_nombre using errcode = '22023';
      end if;
      if not exists (
        select 1 from producto where id_producto = v_id_producto and id_tenant = v_tenant
      ) then
        raise exception 'producto-not-found: %', v_nombre using errcode = '42704';
      end if;
      v_vinculados := v_vinculados + 1;
    end if;

    for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb))
    loop
      v_talle := nullif(trim(v_parte->>'talle'), '');
      v_cant  := coalesce((v_parte->>'cantidad')::integer, 0);
      if v_cant <= 0 then
        continue;
      end if;

      insert into ingreso_mercaderia_detalle(
        id_tenant, id_ingreso, id_producto, cantidad, talle
      )
      values (
        v_tenant, p_id_ingreso, v_id_producto, v_cant, v_talle
      )
      returning id_detalle into v_id_detalle;

      if v_costo is not null then
        insert into ingreso_detalle_costo(
          id_detalle, id_tenant, costo_unitario,
          costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
        )
        values (
          v_id_detalle, v_tenant, v_costo,
          case when p_moneda = 'USD' then v_costo_original_usd else null end,
          case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
          case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
        );
      end if;

      v_detalles := v_detalles || jsonb_build_object(
        'id_detalle', v_id_detalle,
        'id_producto', v_id_producto,
        'nombre', v_nombre,
        'cantidad', v_cant,
        'costo_unitario', v_costo,
        'talle', v_talle,
        'costo_original_usd', v_costo_original_usd
      );
    end loop;
  end loop;

  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
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

    select id_detalle, id_producto
      into v_det
      from ingreso_mercaderia_detalle
     where id_detalle = v_id_detalle
       and id_ingreso = p_id_ingreso
       and id_tenant = v_tenant;

    if v_det.id_detalle is null then
      raise exception 'detalle-not-found: %', v_id_detalle using errcode = '42704';
    end if;

    -- Solo completa líneas con costo pendiente (sin fila en ingreso_detalle_costo)
    if not exists (
      select 1 from ingreso_detalle_costo where id_detalle = v_det.id_detalle
    ) then
      if v_costo is null or v_costo <= 0 then
        raise exception 'costo-invalido' using errcode = '22023';
      end if;

      insert into ingreso_detalle_costo(id_detalle, id_tenant, costo_unitario)
      values (v_det.id_detalle, v_tenant, v_costo);

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
      from ingreso_mercaderia_detalle d
      left join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
     where d.id_ingreso = p_id_ingreso and d.id_tenant = v_tenant
     group by d.id_producto
    having count(distinct c.costo_unitario) > 1
        or (bool_or(c.costo_unitario is null) and bool_or(c.costo_unitario is not null))
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
        select distinct on (d.id_producto)
               d.id_producto,
               c.costo_unitario,
               c.costo_original_usd,
               c.cotizacion_aplicada,
               c.cotizacion_fecha_valor
          from ingreso_mercaderia_detalle d
          join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
         where d.id_ingreso = p_id_ingreso
           and d.id_tenant = v_tenant
           and d.id_detalle in (
             select coalesce(l->>'id_detalle', l->>'idDetalle')::uuid
               from jsonb_array_elements(p_lineas) l
           )
         order by d.id_producto, d.id_detalle
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

create or replace function rf_finanzas_flujo(p_desde date, p_hasta date)
returns table (
  cobrado numeric,
  devuelto_clientes numeric,
  costo_cobro numeric,
  neto_cobros numeric,
  compras_mercaderia numeric,
  pagos_proveedores numeric,
  gastos numeric,
  flujo_neto numeric,
  por_acreditar jsonb
)
language plpgsql
security invoker
as $$
declare
  v_tenant_id uuid;
  v_ver_costos boolean;
  v_cobrado numeric := 0;
  v_devuelto_clientes numeric := 0;
  v_costo_cobro numeric := 0;
  v_compras_mercaderia numeric := 0;
  v_pagos_proveedores numeric := 0;
  v_gastos numeric := 0;
  v_por_acreditar jsonb;
  v_zona text;
begin
  if not (select auth_tiene_permiso('reportes', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
  v_tenant_id := auth_tenant_id();
  select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;

  select
    coalesce(sum(pv.monto), 0) into v_cobrado
  from pago_venta pv
  where pv.id_tenant = v_tenant_id
    and pv.medio <> 'cuenta_revendedora'
    and (pv.created_at at time zone v_zona)::date >= p_desde and (pv.created_at at time zone v_zona)::date <= p_hasta;

  declare
    v_cobrado_revendedora numeric := 0;
  begin
    select coalesce(sum(pr.monto), 0) into v_cobrado_revendedora
    from pago_revendedora pr
    where pr.id_tenant = v_tenant_id
      and (pr.fecha at time zone v_zona)::date >= p_desde
      and (pr.fecha at time zone v_zona)::date <= p_hasta;

    v_cobrado := v_cobrado + v_cobrado_revendedora;
  end;

  select
    coalesce(sum(rc.monto), 0) into v_devuelto_clientes
  from reintegro_cliente rc
  where rc.id_tenant = v_tenant_id
    and rc.medio <> 'cuenta_revendedora'
    and (rc.fecha at time zone v_zona)::date >= p_desde and (rc.fecha at time zone v_zona)::date <= p_hasta;

  select
    coalesce(sum(pv.costo_cobro), 0) into v_costo_cobro
  from pago_venta pv
  where pv.id_tenant = v_tenant_id
    and pv.medio <> 'cuenta_revendedora'
    and (pv.created_at at time zone v_zona)::date >= p_desde and (pv.created_at at time zone v_zona)::date <= p_hasta;

  if v_ver_costos then
    select
      coalesce(sum(d.cantidad * c.costo_unitario), 0) into v_compras_mercaderia
    from ingreso_mercaderia_detalle d
    join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
    join ingreso_mercaderia i on i.id_ingreso = d.id_ingreso
    where i.id_tenant = v_tenant_id
      and i.tipo_ingreso = 'compra'
      and i.confirmado = true
      and i.cancelado_at is null
      and (i.fecha at time zone v_zona)::date >= p_desde and (i.fecha at time zone v_zona)::date <= p_hasta;

    select
      coalesce(sum(rp.monto_total), 0) into v_pagos_proveedores
    from rendicion_proveedor rp
    where rp.id_tenant = v_tenant_id and rp.estado = 'pagada' and (rp.fecha_pago at time zone v_zona)::date >= p_desde and (rp.fecha_pago at time zone v_zona)::date <= p_hasta;
  end if;

  select
    coalesce(sum(gn.monto), 0) into v_gastos
  from gasto_negocio gn
  where gn.id_tenant = v_tenant_id and (gn.fecha at time zone v_zona)::date >= p_desde and (gn.fecha at time zone v_zona)::date <= p_hasta;

  select jsonb_object_agg(t.tipo, coalesce(t.total, 0)) into v_por_acreditar
  from (
    select cd.tipo, sum(p.neto_acreditado) as total
    from pago_venta p
    join cuenta_destino cd on cd.id_cuenta_destino = p.id_cuenta_destino
    where p.id_tenant = v_tenant_id
      and p.medio <> 'cuenta_revendedora'
      and (p.fecha_acreditacion at time zone v_zona)::date > (now() at time zone v_zona)::date
    group by cd.tipo
  ) t;

  if v_por_acreditar is null then
    v_por_acreditar := '{}'::jsonb;
  end if;

  return query select
    v_cobrado,
    v_devuelto_clientes,
    v_costo_cobro,
    v_cobrado - v_devuelto_clientes - v_costo_cobro as neto_cobros,
    case when v_ver_costos then v_compras_mercaderia else null::numeric end as compras_mercaderia,
    case when v_ver_costos then v_pagos_proveedores else null::numeric end as pagos_proveedores,
    v_gastos,
    case when v_ver_costos then (v_cobrado - v_devuelto_clientes - v_costo_cobro) - v_compras_mercaderia - v_pagos_proveedores - v_gastos else null::numeric end as flujo_neto,
    v_por_acreditar;
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
      coalesce(sum(c.costo_unitario), 0) into v_deuda_proveedores
    from item_producto ip
    join ingreso_mercaderia_detalle d on d.id_ingreso = ip.id_ingreso and d.id_producto = ip.id_producto
    join ingreso_detalle_costo c on c.id_detalle = d.id_detalle
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

-- =====================================================================
-- 6. DROP COLUMN de las 4 columnas (sin CASCADE)
-- =====================================================================

drop policy if exists rlsp_ingreso_mercaderia_detalle_costo_insert on ingreso_mercaderia_detalle;
drop policy if exists rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle;
create policy rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle as restrictive for update to authenticated
  using (false)
  with check (false);
revoke update on ingreso_mercaderia_detalle from authenticated;

alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_detalle_costo_no_nan;
alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_costo_unitario_check;
alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_costo_original_usd_check;
alter table ingreso_mercaderia_detalle drop constraint if exists ingreso_mercaderia_detalle_cotizacion_aplicada_check;

alter table ingreso_mercaderia_detalle drop column costo_unitario;
alter table ingreso_mercaderia_detalle drop column costo_original_usd;
alter table ingreso_mercaderia_detalle drop column cotizacion_aplicada;
alter table ingreso_mercaderia_detalle drop column cotizacion_fecha_valor;
