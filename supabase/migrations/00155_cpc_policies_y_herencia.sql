-- 00155_cpc_policies_y_herencia.sql
-- Fase 3E.1 costos-por-columna (REQ-CPC.md §11, D-CPC-06, D-CPC-08, D-CPC-09):
--   1. Policies SELECT restrictivas en costo_producto, regla_precio, auditoria y rendicion_proveedor.
--   2. Sellador SECURITY DEFINER fn_sellar_costo_herencia_items(uuid, uuid[]).
--   3. SPs de ingreso/stock directo con herencia via sellador.
--   4. Blindaje de permisos en sp_recalcular_precio_venta, sp_revaluar_costos_usd_vigentes,
--      sp_aplicar_ultimo_costo, preview_rendicion, sp_create_regla_precio,
--      sp_generar_rendicion y sp_marcar_rendicion_pagada.
--   5. Reportes rf_finanzas_* y sp_perdida_incobrable_venta con D-CPC-08 (8.B).
--
-- DOWN:
-- drop policy if exists rlsp_costo_producto_select on costo_producto;
-- drop policy if exists rlsp_regla_precio_select on regla_precio;
-- drop policy if exists rlsp_auditoria_select on auditoria;
-- drop policy if exists rlsp_rendicion_proveedor_select on rendicion_proveedor;
-- create policy rlsp_rendicion_proveedor_select on rendicion_proveedor as restrictive for select to authenticated
--   using ((select auth_tiene_permiso('rendiciones', 'ver')) or (select auth_tiene_permiso('inventario', 'ver')) or (select auth_tiene_permiso('reportes', 'ver')));
--
-- revoke all on function fn_sellar_costo_herencia_items(uuid, uuid[]) from authenticated;
-- drop function if exists fn_sellar_costo_herencia_items(uuid, uuid[]);
--
-- NOTE: Restaura las definiciones vigentes anteriores, copiadas sin cambios.
--
-- NOTE: sp_confirmar_ingreso (00153_cpc_costo_pendiente.sql:276)
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
--     -- Si la línea no tiene costo_unitario, hereda el costo vigente del producto (o null si no hay vigente)
--     if v_detalle.costo_unitario is null then
--       v_costo_item := fn_costo_vigente_producto(v_detalle.id_producto);
--     else
--       v_costo_item := v_detalle.costo_unitario;
--     end if;
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
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                                   estado_desde, estado_hasta,
--                                   referencia_tipo, referencia_id, id_usuario)
--       values (v_tenant, v_new_item, 'alta',
--               null, 'disponible',
--               'ingreso', p_id_ingreso, v_actor);
--
--       v_count := v_count + 1;
--     end loop;
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
-- NOTE: sp_crear_stock_directo (00154_cpc_stock_directo_costo.sql:101)
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
--   -- Si p_costo es null, hereda fn_costo_vigente_producto o queda null
--   if p_costo is null then
--     v_costo_item := fn_costo_vigente_producto(p_id_producto);
--   else
--     v_costo_item := p_costo;
--   end if;
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
-- NOTE: sp_recalcular_precio_venta (00146_rlsp_sp_precios.sql:159)
-- create or replace function sp_recalcular_precio_venta(
--   p_id_producto uuid,
--   p_ip inet default null
-- ) returns numeric language plpgsql as $$
-- declare
--   v_tenant       uuid := auth_tenant_id();
--   v_actor        uuid := auth.uid();
--   v_costo        numeric;
--   v_regla        regla_precio;
--   v_precio_ant   numeric;
--   v_precio_nuevo numeric;
-- begin
--   if not (select auth_tiene_permiso('precios', 'editar')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select costo into v_costo
--     from costo_producto
--    where id_producto = p_id_producto and vigente_hasta is null;
--
--   if v_costo is null then
--     -- Sin costo vigente no hay precio calculable — marcar desactualizado y salir.
--     update producto
--        set precio_venta = null,
--            id_regla_margen_aplicada = null,
--            precio_venta_resuelto_at = now(),
--            precio_venta_desactualizado = true
--      where id_producto = p_id_producto and id_tenant = v_tenant;
--     return null;
--   end if;
--
--   select * into v_regla from resolver_regla_margen(p_id_producto);
--
--   select precio_venta into v_precio_ant
--     from producto where id_producto = p_id_producto;
--
--   if v_regla.id_regla is null then
--     -- Sin regla de margen: precio = costo (0% margen). Marca desactualizado
--     -- FALSE porque respetó la (no)regla; el operador puede definir la regla
--     -- después y volver a recalcular.
--     v_precio_nuevo := v_costo;
--   elsif v_regla.tipo_valor = 'porcentaje' then
--     v_precio_nuevo := v_costo * (1 + v_regla.valor);
--   else
--     v_precio_nuevo := v_costo + v_regla.valor;
--   end if;
--
--   update producto
--      set precio_venta = v_precio_nuevo,
--          id_regla_margen_aplicada = v_regla.id_regla,
--          precio_venta_resuelto_at = now(),
--          precio_venta_desactualizado = false
--    where id_producto = p_id_producto and id_tenant = v_tenant;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'producto', p_id_producto::text, 'recalcular_precio',
--           jsonb_build_object(
--             'precio_anterior', v_precio_ant,
--             'precio_nuevo', v_precio_nuevo,
--             'costo', v_costo,
--             'id_regla_margen', v_regla.id_regla,
--             'tipo_valor', v_regla.tipo_valor,
--             'valor', v_regla.valor
--           ),
--           p_ip);
--
--   return v_precio_nuevo;
-- end $$;
--
-- NOTE: sp_revaluar_costos_usd_vigentes (00146_rlsp_sp_precios.sql:499)
-- create or replace function sp_revaluar_costos_usd_vigentes(
--   p_ip inet default null
-- ) returns jsonb
-- language plpgsql
-- security invoker
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_tenant                 uuid := auth_tenant_id();
--   v_actor                  uuid := auth.uid();
--   v_cotizacion             jsonb;
--   v_valor                  numeric;
--   v_fecha_valor            date;
--   v_desactualizada         boolean;
--   v_revaluados             integer := 0;
--   v_omitidos_sin_original  integer := 0;
--   v_sin_cambios            integer := 0;
--   r                        record;
--   v_costo_nuevo            numeric;
-- begin
--   if not (select auth_tiene_permiso('precios', 'editar_cotizacion')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   v_cotizacion := sp_get_cotizacion_vigente();
--   v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
--   v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;
--   v_desactualizada := coalesce((v_cotizacion->>'desactualizada')::boolean, true);
--
--   if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
--     raise exception 'sin-cotizacion-dolar' using errcode = '22023';
--   end if;
--
--   if v_desactualizada then
--     raise exception 'cotizacion-desactualizada' using errcode = '22023';
--   end if;
--
--   -- 1. Contar filas vigentes con moneda='USD' pero costo_original_usd nulo (se omiten)
--   select count(*)
--     into v_omitidos_sin_original
--     from costo_producto
--    where id_tenant = v_tenant
--      and vigente_hasta is null
--      and moneda = 'USD'
--      and costo_original_usd is null;
--
--   -- 2. Procesar las filas vigentes con moneda='USD' y costo_original_usd no nulo
--   for r in
--     select id_costo, id_producto, costo, costo_original_usd, cotizacion_aplicada
--       from costo_producto
--      where id_tenant = v_tenant
--        and vigente_hasta is null
--        and moneda = 'USD'
--        and costo_original_usd is not null
--      for update
--   loop
--     -- Si la cotización aplicada ya es igual a la vigente, omitir sin generar historial
--     if r.cotizacion_aplicada is not distinct from v_valor then
--       v_sin_cambios := v_sin_cambios + 1;
--       continue;
--     end if;
--
--     v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);
--
--     perform sp_aplicar_ultimo_costo(
--       r.id_producto,
--       v_costo_nuevo,
--       'USD',
--       r.costo_original_usd,
--       v_valor,
--       v_fecha_valor,
--       'revaluacion masiva usd',
--       p_ip,
--       true
--     );
--
--     v_revaluados := v_revaluados + 1;
--   end loop;
--
--   return jsonb_build_object(
--     'revaluados', v_revaluados,
--     'omitidos_sin_original', v_omitidos_sin_original,
--     'sin_cambios', v_sin_cambios
--   );
-- end;
-- $$;
--
-- NOTE: sp_aplicar_ultimo_costo (00153_cpc_costo_pendiente.sql:606)
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
--   -- Permisos: 'inventario.cargar_costos' para ingresos y altas de costo manuales,
--   -- o 'precios.editar_cotizacion' para recálculo de costos en USD.
--   -- NOTA: La Fase 3E revisará esta última entrada al segregar costos.
--   if not (
--     (select auth_tiene_permiso('inventario', 'cargar_costos'))
--     or (select auth_tiene_permiso('precios', 'editar_cotizacion'))
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
-- NOTE: preview_rendicion (00126_rendicion_modulo.sql:231)
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
-- NOTE: rf_finanzas_resultados (00110_finanzas_cambio_diferencia.sql:69)
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
--   select
--     coalesce(sum(vl.costo), 0) into v_costo_mercaderia
--   from v_linea_venta vl
--   where vl.id_tenant = v_tenant_id
--     and (vl.fecha_venta at time zone v_zona)::date >= p_desde
--     and (vl.fecha_venta at time zone v_zona)::date <= p_hasta;
--
--   declare
--     v_costo_anuladas numeric := 0;
--     v_costo_devueltas numeric := 0;
--   begin
--     select coalesce(sum(vl.costo), 0) into v_costo_anuladas
--     from v_linea_venta vl
--     where vl.id_tenant = v_tenant_id
--       and (vl.fecha_anulacion at time zone v_zona)::date >= p_desde
--       and (vl.fecha_anulacion at time zone v_zona)::date <= p_hasta;
--
--     select coalesce(sum(vl.costo_recuperado), 0) into v_costo_devueltas
--     from v_linea_venta vl
--     where vl.id_tenant = v_tenant_id
--       and (vl.fecha_devolucion at time zone v_zona)::date >= p_desde
--       and (vl.fecha_devolucion at time zone v_zona)::date <= p_hasta;
--
--     v_costo_mercaderia := v_costo_mercaderia - v_costo_anuladas - v_costo_devueltas;
--   end;
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
--   select
--     coalesce(sum(ip.costo_ingreso), 0) into v_bajas_inventario
--   from item_producto ip
--   where ip.id_tenant = v_tenant_id
--     and ip.estado_item = 'baja'
--     and (ip.updated_at at time zone v_zona)::date >= p_desde
--     and (ip.updated_at at time zone v_zona)::date <= p_hasta;
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
--     v_costo_mercaderia,
--     (v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia as ganancia_sobre_ventas,
--     v_costo_cobro,
--     v_incobrables,
--     v_bajas_inventario,
--     ((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario as ganancia_despues_de_costos,
--     v_gastos,
--     v_comision_liquidada,
--     v_comision_pendiente_estimada,
--     (((v_ventas_brutas - v_anulaciones - v_devoluciones) - v_costo_mercaderia) - v_costo_cobro - v_incobrables - v_bajas_inventario) - v_gastos - v_comision_liquidada as ganancia_final,
--     v_cantidad_ventas,
--     case when v_cantidad_ventas > 0 then (v_ventas_brutas - v_anulaciones - v_devoluciones) / v_cantidad_ventas else null::numeric end as ticket_promedio;
-- end;
-- $$;
--
-- NOTE: rf_finanzas_flujo (00095_liquidacion_functions.sql:956)
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
--   v_cobrado numeric := 0;
--   v_devuelto_clientes numeric := 0;
--   v_costo_cobro numeric := 0;
--   v_compras_mercaderia numeric := 0;
--   v_pagos_proveedores numeric := 0;
--   v_gastos numeric := 0;
--   v_por_acreditar jsonb;
--   v_zona text;
-- begin
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
--   -- DR-3/DR-14: Sumar pagos de liquidación de revendedoras a caja física / cuenta del tenant
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
--   select
--     coalesce(sum(cantidad * costo_unitario), 0) into v_compras_mercaderia
--   from ingreso_mercaderia_detalle d
--   join ingreso_mercaderia i on i.id_ingreso = d.id_ingreso
--   where i.id_tenant = v_tenant_id
--     and i.tipo_ingreso = 'compra'
--     and i.confirmado = true
--     and i.cancelado_at is null
--     and (i.fecha at time zone v_zona)::date >= p_desde and (i.fecha at time zone v_zona)::date <= p_hasta;
--
--   select
--     coalesce(sum(rp.monto_total), 0) into v_pagos_proveedores
--   from rendicion_proveedor rp
--   where rp.id_tenant = v_tenant_id and rp.estado = 'pagada' and (rp.fecha_pago at time zone v_zona)::date >= p_desde and (rp.fecha_pago at time zone v_zona)::date <= p_hasta;
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
--     v_compras_mercaderia,
--     v_pagos_proveedores,
--     v_gastos,
--     (v_cobrado - v_devuelto_clientes - v_costo_cobro) - v_compras_mercaderia - v_pagos_proveedores - v_gastos as flujo_neto,
--     v_por_acreditar;
-- end;
-- $$;
--
-- NOTE: rf_finanzas_posicion (00111_seguridad_revendedoras.sql:344)
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
--   v_capital_propio numeric := 0;
--   v_mercaderia_terceros numeric := 0;
--   v_devueltos_clientes numeric := 0;
--   v_valor_venta_potencial numeric := 0;
--   v_productos_sin_precio bigint := 0;
--   v_deuda_proveedores numeric := 0;
--   v_por_cobrar jsonb;
--   v_zona text;
-- begin
--   v_tenant_id := auth_tenant_id();
--
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;
--
--   select
--     coalesce(sum(costo_ingreso), 0) into v_capital_propio
--   from item_producto
--   where id_tenant = v_tenant_id and tipo_ingreso = 'compra' and estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--   select
--     coalesce(sum(costo_ingreso), 0) into v_mercaderia_terceros
--   from item_producto
--   where id_tenant = v_tenant_id and tipo_ingreso = 'consignacion' and estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--   select
--     coalesce(sum(costo_ingreso), 0) into v_devueltos_clientes
--   from item_producto
--   where id_tenant = v_tenant_id and estado_item = 'devuelto_cliente';
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
--   select
--     coalesce(sum(d.costo_unitario), 0) into v_deuda_proveedores
--   from item_producto ip
--   join ingreso_mercaderia_detalle d on d.id_ingreso = ip.id_ingreso and d.id_producto = ip.id_producto
--   where ip.id_tenant = v_tenant_id and ip.tipo_ingreso = 'consignacion' and ip.estado_item in ('disponible', 'reservado', 'en_revendedora');
--
--   return query select
--     v_capital_propio,
--     v_mercaderia_terceros,
--     v_devueltos_clientes,
--     v_valor_venta_potencial,
--     v_productos_sin_precio,
--     v_por_cobrar,
--     v_deuda_proveedores;
-- end;
-- $$;
--
-- NOTE: rf_finanzas_ranking_productos (00073_finanzas_lectura_2.sql:213)
-- CREATE OR REPLACE FUNCTION rf_finanzas_ranking_productos(p_desde date, p_hasta date, p_limite int default 20, p_orden text default 'ganancia')
-- RETURNS TABLE (
--   id_producto uuid,
--   nombre text,
--   unidades bigint,
--   monto numeric,
--   ganancia numeric
-- )
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- AS $$
-- DECLARE
--   v_tenant_id uuid;
--   v_zona text;
-- BEGIN
--   IF p_orden NOT IN ('ganancia', 'unidades', 'monto') THEN
--     RAISE EXCEPTION 'orden-invalido';
--   END IF;
--
--   IF p_limite < 1 OR p_limite > 100 THEN
--     p_limite := 20;
--   END IF;
--
--   v_tenant_id := auth_tenant_id();
--   SELECT zona_horaria INTO v_zona FROM tenant WHERE id_tenant = v_tenant_id;
--
--   RETURN QUERY
--   SELECT
--     p.id_producto,
--     p.nombre,
--     COUNT(vl.id_venta) AS unidades,
--     COALESCE(SUM(vl.precio_venta), 0) AS monto,
--     COALESCE(SUM(vl.margen), 0) AS ganancia
--   FROM v_linea_venta vl
--   JOIN producto p ON p.id_producto = vl.id_producto -- need to join to get nombre, wait, v_linea_venta doesn't have id_producto. Let's check v_linea_venta definition.
--   WHERE vl.id_tenant = v_tenant_id
--     AND vl.estado_venta = 'registrada'
--     AND (vl.fecha_venta AT TIME ZONE v_zona)::date >= p_desde
--     AND (vl.fecha_venta AT TIME ZONE v_zona)::date <= p_hasta
--     AND vl.devuelta = false
--   GROUP BY p.id_producto, p.nombre
--   ORDER BY
--     CASE WHEN p_orden = 'ganancia' THEN COALESCE(SUM(vl.margen), 0) END DESC,
--     CASE WHEN p_orden = 'unidades' THEN COUNT(vl.id_venta) END DESC,
--     CASE WHEN p_orden = 'monto' THEN COALESCE(SUM(vl.precio_venta), 0) END DESC
--   LIMIT p_limite;
-- END;
-- $$;
--
-- NOTE: rf_finanzas_serie_mensual (00073_finanzas_lectura_2.sql:34)
-- CREATE OR REPLACE FUNCTION rf_finanzas_serie_mensual(p_hasta date, p_meses int default 12)
-- RETURNS TABLE (
--   mes date,
--   ventas_netas numeric,
--   ganancia_sobre_ventas numeric,
--   ganancia_final numeric,
--   cobrado_neto numeric
-- )
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- AS $$
-- DECLARE
--   v_tenant_id uuid;
--   v_zona text;
--   v_desde date;
-- BEGIN
--   IF p_meses < 1 OR p_meses > 24 THEN
--     RAISE EXCEPTION 'periodo-invalido';
--   END IF;
--
--   v_tenant_id := auth_tenant_id();
--   SELECT zona_horaria INTO v_zona FROM tenant WHERE id_tenant = v_tenant_id;
--   
--   v_desde := (date_trunc('month', p_hasta::timestamp) - ((p_meses - 1)::text || ' months')::interval)::date;
--
--   RETURN QUERY
--   WITH meses AS (
--     SELECT generate_series(
--       v_desde,
--       date_trunc('month', p_hasta::timestamp)::date,
--       '1 month'::interval
--     )::date AS m
--   )
--   SELECT
--     m.m AS mes,
--     COALESCE(r.ventas_netas, 0) AS ventas_netas,
--     COALESCE(r.ganancia_sobre_ventas, 0) AS ganancia_sobre_ventas,
--     COALESCE(r.ganancia_final, 0) AS ganancia_final,
--     COALESCE(f.neto_cobros, 0) AS cobrado_neto
--   FROM meses m
--   LEFT JOIN LATERAL rf_finanzas_resultados(m.m, (m.m + interval '1 month' - interval '1 day')::date) r ON true
--   LEFT JOIN LATERAL rf_finanzas_flujo(m.m, (m.m + interval '1 month' - interval '1 day')::date) f ON true
--   ORDER BY m.m ASC;
-- END;
-- $$;
--
-- NOTE: sp_perdida_incobrable_venta (00059_financiacion_propia.sql:788)
-- create or replace function sp_perdida_incobrable_venta(p_id_venta uuid)
-- returns jsonb
-- language plpgsql
-- stable
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
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
--   select coalesce(sum(monto - monto_pagado), 0) into v_adeudado
--     from cuota_financiada
--    where id_venta = p_id_venta and id_tenant = v_tenant
--      and estado = 'incobrable';
--
--   select coalesce(sum(monto), 0) into v_cobrado
--     from pago_venta
--    where id_venta = p_id_venta and id_tenant = v_tenant;
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
-- NOTE: sp_create_regla_precio (00146_rlsp_sp_precios.sql:22)
-- create or replace function sp_create_regla_precio(
--   p_nombre       text,
--   p_tipo_regla   tipo_regla,
--   p_tipo_valor   tipo_valor_regla,
--   p_valor        numeric,
--   p_alcance      alcance_regla,
--   p_id_producto  uuid default null,
--   p_id_categoria uuid default null,
--   p_id_proveedor uuid default null,
--   p_forma_pago   forma_pago default null,
--   p_prioridad    integer default 0,
--   p_fecha_inicio timestamptz default null,
--   p_fecha_hasta  timestamptz default null,
--   p_acumulable   boolean default false,
--   p_ip           inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
-- begin
--   if not (select auth_tiene_permiso('precios', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   insert into regla_precio(
--     id_tenant, nombre, tipo_regla, tipo_valor, valor, alcance,
--     id_producto, id_categoria, id_proveedor, forma_pago,
--     prioridad, fecha_inicio, fecha_hasta, acumulable
--   ) values (
--     v_tenant, p_nombre, p_tipo_regla, p_tipo_valor, p_valor, p_alcance,
--     p_id_producto, p_id_categoria, p_id_proveedor, p_forma_pago,
--     coalesce(p_prioridad, 0), p_fecha_inicio, p_fecha_hasta,
--     -- acumulable sólo aplica a descuentos; para margen/recargo se guarda false.
--     case when p_tipo_regla = 'descuento' then coalesce(p_acumulable, false) else false end
--   ) returning id_regla into v_id;
--
--   if p_tipo_regla = 'margen' then
--     perform sp_marcar_precio_desactualizado_by_regla(v_id);
--   end if;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'regla_precio', v_id::text, 'crear',
--           jsonb_build_object('nombre', p_nombre, 'tipo_regla', p_tipo_regla,
--                              'tipo_valor', p_tipo_valor, 'valor', p_valor,
--                              'alcance', p_alcance, 'forma_pago', p_forma_pago,
--                              'prioridad', p_prioridad, 'acumulable', p_acumulable),
--           p_ip);
--   return v_id;
-- end $$;
--
-- NOTE: sp_generar_rendicion (00147_rlsp_sp_consignaciones_rendiciones.sql:698)
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
--   if not (select auth_tiene_permiso('rendiciones', 'crear')) then
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
-- NOTE: sp_marcar_rendicion_pagada (00147_rlsp_sp_consignaciones_rendiciones.sql:797)
-- create or replace function sp_marcar_rendicion_pagada(
--   p_id_rendicion uuid,
--   p_fecha_pago   timestamptz default null,
--   p_ip           inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_estado estado_rendicion;
-- begin
--   if not (select auth_tiene_permiso('rendiciones', 'editar')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--
--   -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
--   -- (REQ-MODOP-07). Va antes de cualquier otra validación.
--   if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
--     raise exception 'module-disabled' using errcode = 'P0001';
--   end if;
--
--   select estado into v_estado
--     from rendicion_proveedor
--    where id_rendicion = p_id_rendicion and id_tenant = v_tenant
--    for update;
--   if v_estado is null then
--     raise exception 'rendicion-not-found' using errcode = '42704';
--   end if;
--   if v_estado = 'pagada' then
--     return; -- idempotente
--   end if;
--
--   update rendicion_proveedor
--      set estado = 'pagada',
--          fecha_pago = coalesce(p_fecha_pago, now())
--    where id_rendicion = p_id_rendicion;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'rendicion_proveedor', p_id_rendicion::text, 'marcar_pagada',
--           jsonb_build_object('fecha_pago', coalesce(p_fecha_pago, now())),
--           p_ip);
-- end $$;

-- =====================================================================
-- 1. Policies RESTRICTIVAS de SELECT
-- =====================================================================

create policy rlsp_costo_producto_select on costo_producto as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver_costos')));

create policy rlsp_regla_precio_select on regla_precio as restrictive for select to authenticated
  using (
    tipo_regla <> 'margen'
    or (select auth_tiene_permiso('precios', 'ver_margenes'))
  );

create policy rlsp_auditoria_select on auditoria as restrictive for select to authenticated
  using (
    (select auth_tiene_permiso('administracion', 'ver'))
    and (select auth_tiene_permiso('inventario', 'ver_costos'))
  );

drop policy if exists rlsp_rendicion_proveedor_select on rendicion_proveedor;
create policy rlsp_rendicion_proveedor_select on rendicion_proveedor as restrictive for select to authenticated
  using (
    (select auth_tiene_permiso('rendiciones', 'ver'))
    or (select auth_tiene_permiso('inventario', 'ver_costos'))
  );

-- =====================================================================
-- 2. Sellador DEFINER chico para herencia de costo vigente (§6.1 / §6.2)
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

  update item_producto
     set costo_ingreso = v_costo
   where id_tenant = v_tenant
     and id_producto = p_id_producto
     and id_item = any(p_ids_items)
     and costo_ingreso is null;
end;
$$;

revoke all on function fn_sellar_costo_herencia_items(uuid, uuid[]) from public, anon;
grant execute on function fn_sellar_costo_herencia_items(uuid, uuid[]) to authenticated;

-- =====================================================================
-- 3. sp_confirmar_ingreso y sp_crear_stock_directo (herencia por sellador)
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
  v_costo_item numeric;
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
    v_costo_item := v_detalle.costo_unitario;
    v_ids_her := array[]::uuid[];

    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_costo_item, v_tipo, v_detalle.talle)
      returning id_item into v_new_item;

      if v_detalle.costo_unitario is null then
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
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_count      integer := 0;
  v_costo_item numeric;
  v_item       jsonb;
  v_talle      text;
  v_cant       integer;
  v_i          integer;
  v_qr         text;
  v_new_item   uuid;
  v_ids_her    uuid[] := array[]::uuid[];
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

  v_costo_item := p_costo;

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
                                qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
      values (v_tenant, p_id_producto, null, null,
              v_qr, 'disponible', v_costo_item,
              coalesce(p_tipo_ingreso, 'compra'), v_talle)
      returning id_item into v_new_item;

      if p_costo is null then
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

-- =====================================================================
-- 4. Precios, cotización y último costo (D-CPC-06 + 4.2 + 4.3)
-- =====================================================================

create or replace function sp_recalcular_precio_venta(
  p_id_producto uuid,
  p_ip inet default null
) returns numeric language plpgsql as $$
declare
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_costo        numeric;
  v_regla        regla_precio;
  v_precio_ant   numeric;
  v_precio_nuevo numeric;
begin
  if not (
    (select auth_tiene_permiso('precios', 'editar'))
    and (select auth_tiene_permiso('inventario', 'ver_costos'))
    and (select auth_tiene_permiso('precios', 'ver_margenes'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select costo into v_costo
    from costo_producto
   where id_producto = p_id_producto and vigente_hasta is null;

  if v_costo is null then
    -- Sin costo vigente no hay precio calculable — marcar desactualizado y salir.
    update producto
       set precio_venta = null,
           id_regla_margen_aplicada = null,
           precio_venta_resuelto_at = now(),
           precio_venta_desactualizado = true
     where id_producto = p_id_producto and id_tenant = v_tenant;
    return null;
  end if;

  select * into v_regla from resolver_regla_margen(p_id_producto);

  select precio_venta into v_precio_ant
    from producto where id_producto = p_id_producto;

  if v_regla.id_regla is null then
    -- Sin regla de margen: precio = costo (0% margen). Marca desactualizado
    -- FALSE porque respetó la (no)regla; el operador puede definir la regla
    -- después y volver a recalcular.
    v_precio_nuevo := v_costo;
  elsif v_regla.tipo_valor = 'porcentaje' then
    v_precio_nuevo := v_costo * (1 + v_regla.valor);
  else
    v_precio_nuevo := v_costo + v_regla.valor;
  end if;

  update producto
     set precio_venta = v_precio_nuevo,
         id_regla_margen_aplicada = v_regla.id_regla,
         precio_venta_resuelto_at = now(),
         precio_venta_desactualizado = false
   where id_producto = p_id_producto and id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'producto', p_id_producto::text, 'recalcular_precio',
          jsonb_build_object(
            'precio_anterior', v_precio_ant,
            'precio_nuevo', v_precio_nuevo,
            'costo', v_costo,
            'id_regla_margen', v_regla.id_regla,
            'tipo_valor', v_regla.tipo_valor,
            'valor', v_regla.valor
          ),
          p_ip);

  return v_precio_nuevo;
end $$;

create or replace function sp_revaluar_costos_usd_vigentes(
  p_ip inet default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant                 uuid := auth_tenant_id();
  v_actor                  uuid := auth.uid();
  v_cotizacion             jsonb;
  v_valor                  numeric;
  v_fecha_valor            date;
  v_desactualizada         boolean;
  v_revaluados             integer := 0;
  v_omitidos_sin_original  integer := 0;
  v_sin_cambios            integer := 0;
  r                        record;
  v_costo_nuevo            numeric;
begin
  if not (
    (select auth_tiene_permiso('precios', 'editar_cotizacion'))
    and (select auth_tiene_permiso('inventario', 'ver_costos'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  v_cotizacion := sp_get_cotizacion_vigente();
  v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
  v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;
  v_desactualizada := coalesce((v_cotizacion->>'desactualizada')::boolean, true);

  if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
    raise exception 'sin-cotizacion-dolar' using errcode = '22023';
  end if;

  if v_desactualizada then
    raise exception 'cotizacion-desactualizada' using errcode = '22023';
  end if;

  -- 1. Contar filas vigentes con moneda='USD' pero costo_original_usd nulo (se omiten)
  select count(*)
    into v_omitidos_sin_original
    from costo_producto
   where id_tenant = v_tenant
     and vigente_hasta is null
     and moneda = 'USD'
     and costo_original_usd is null;

  -- 2. Procesar las filas vigentes con moneda='USD' y costo_original_usd no nulo
  for r in
    select id_costo, id_producto, costo, costo_original_usd, cotizacion_aplicada
      from costo_producto
     where id_tenant = v_tenant
       and vigente_hasta is null
       and moneda = 'USD'
       and costo_original_usd is not null
     for update
  loop
    -- Si la cotización aplicada ya es igual a la vigente, omitir sin generar historial
    if r.cotizacion_aplicada is not distinct from v_valor then
      v_sin_cambios := v_sin_cambios + 1;
      continue;
    end if;

    v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);

    perform sp_aplicar_ultimo_costo(
      r.id_producto,
      v_costo_nuevo,
      'USD',
      r.costo_original_usd,
      v_valor,
      v_fecha_valor,
      'revaluacion masiva usd',
      p_ip,
      true
    );

    v_revaluados := v_revaluados + 1;
  end loop;

  return jsonb_build_object(
    'revaluados', v_revaluados,
    'omitidos_sin_original', v_omitidos_sin_original,
    'sin_cambios', v_sin_cambios
  );
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
  v_tenant       uuid := auth_tenant_id();
  v_actor        uuid := auth.uid();
  v_vigente      record;
  v_id           uuid;
  v_es_igual     boolean := false;
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
    update item_producto
       set costo_ingreso = p_costo
     where id_tenant = v_tenant
       and id_producto = p_id_producto
       and tipo_ingreso = 'compra'
       and estado_item in ('disponible', 'reservado', 'en_revendedora');
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

-- =====================================================================
-- 5. D-CPC-09: escritores sobre regla_precio y rendicion_proveedor
-- =====================================================================

create or replace function sp_create_regla_precio(
  p_nombre       text,
  p_tipo_regla   tipo_regla,
  p_tipo_valor   tipo_valor_regla,
  p_valor        numeric,
  p_alcance      alcance_regla,
  p_id_producto  uuid default null,
  p_id_categoria uuid default null,
  p_id_proveedor uuid default null,
  p_forma_pago   forma_pago default null,
  p_prioridad    integer default 0,
  p_fecha_inicio timestamptz default null,
  p_fecha_hasta  timestamptz default null,
  p_acumulable   boolean default false,
  p_ip           inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('precios', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_tipo_regla = 'margen' and not (select auth_tiene_permiso('precios', 'ver_margenes')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  insert into regla_precio(
    id_tenant, nombre, tipo_regla, tipo_valor, valor, alcance,
    id_producto, id_categoria, id_proveedor, forma_pago,
    prioridad, fecha_inicio, fecha_hasta, acumulable
  ) values (
    v_tenant, p_nombre, p_tipo_regla, p_tipo_valor, p_valor, p_alcance,
    p_id_producto, p_id_categoria, p_id_proveedor, p_forma_pago,
    coalesce(p_prioridad, 0), p_fecha_inicio, p_fecha_hasta,
    -- acumulable sólo aplica a descuentos; para margen/recargo se guarda false.
    case when p_tipo_regla = 'descuento' then coalesce(p_acumulable, false) else false end
  ) returning id_regla into v_id;

  if p_tipo_regla = 'margen' then
    perform sp_marcar_precio_desactualizado_by_regla(v_id);
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'regla_precio', v_id::text, 'crear',
          jsonb_build_object('nombre', p_nombre, 'tipo_regla', p_tipo_regla,
                             'tipo_valor', p_tipo_valor, 'valor', p_valor,
                             'alcance', p_alcance, 'forma_pago', p_forma_pago,
                             'prioridad', p_prioridad, 'acumulable', p_acumulable),
          p_ip);
  return v_id;
end $$;

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

  -- Modificado para excluir devueltos
  select
    coalesce(sum(dv.monto_proveedor), 0),
    count(*),
    min(v.fecha),
    max(v.fecha)
  into v_total, v_count, v_desde, v_hasta
  from detalle_venta dv
  join venta v on v.id_venta = dv.id_venta
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = v_tenant
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dv.monto_proveedor > 0
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
    from venta v
   where v.id_venta = dv.id_venta
     and dv.id_tenant = v_tenant
     and dv.id_proveedor = p_id_proveedor
     and dv.id_rendicion is null
     and dv.excluida_rendicion = false
     and dv.monto_proveedor > 0
     and v.estado_venta = 'registrada'
     and not exists (select 1 from devolucion_venta dev
                      where dev.id_detalle_venta = dv.id_detalle_venta); -- EXCLUIR DEVUELTOS

  select coalesce(sum(monto_proveedor), 0), count(*)
    into v_total, v_count
    from detalle_venta
   where id_rendicion = v_id;

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

create or replace function sp_marcar_rendicion_pagada(
  p_id_rendicion uuid,
  p_fecha_pago   timestamptz default null,
  p_ip           inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_estado estado_rendicion;
begin
  if not (
    (select auth_tiene_permiso('rendiciones', 'editar'))
    and (select auth_tiene_permiso('rendiciones', 'ver'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  -- Paquete opcional apagado: el SP no corre aunque lo llamen por RPC directo
  -- (REQ-MODOP-07). Va antes de cualquier otra validación.
  if not fn_modulo_habilitado(v_tenant, 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  select estado into v_estado
    from rendicion_proveedor
   where id_rendicion = p_id_rendicion and id_tenant = v_tenant
   for update;
  if v_estado is null then
    raise exception 'rendicion-not-found' using errcode = '42704';
  end if;
  if v_estado = 'pagada' then
    return; -- idempotente
  end if;

  update rendicion_proveedor
     set estado = 'pagada',
         fecha_pago = coalesce(p_fecha_pago, now())
   where id_rendicion = p_id_rendicion;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'rendicion_proveedor', p_id_rendicion::text, 'marcar_pagada',
          jsonb_build_object('fecha_pago', coalesce(p_fecha_pago, now())),
          p_ip);
end $$;

-- =====================================================================
-- 6. preview_rendicion + D-CPC-08 (8.B) en rf_finanzas_* y sp_perdida_incobrable_venta
-- =====================================================================

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
    dv.costo_snapshot,
    dv.monto_proveedor,
    c.nombre  as cliente_nombre
  from detalle_venta dv
  join venta v          on v.id_venta = dv.id_venta
  join producto p       on p.id_producto = dv.id_producto
  join item_producto ip on ip.id_item = dv.id_item
  left join cliente c   on c.id_cliente = v.id_cliente
  left join devolucion_venta dev on dev.id_detalle_venta = dv.id_detalle_venta
  where dv.id_tenant = auth_tenant_id()
    and dv.id_proveedor = p_id_proveedor
    and dv.id_rendicion is null
    and dv.excluida_rendicion = false
    and dv.monto_proveedor > 0
    and v.estado_venta = 'registrada'
    and dev.id_devolucion is null -- EXCLUIR DEVUELTOS
  order by v.fecha asc;
end $$;

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
      coalesce(sum(ip.costo_ingreso), 0) into v_bajas_inventario
    from item_producto ip
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

  -- DR-3/DR-14: Sumar pagos de liquidación de revendedoras a caja física / cuenta del tenant
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
      coalesce(sum(cantidad * costo_unitario), 0) into v_compras_mercaderia
    from ingreso_mercaderia_detalle d
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
      coalesce(sum(costo_ingreso), 0) into v_capital_propio
    from item_producto
    where id_tenant = v_tenant_id and tipo_ingreso = 'compra' and estado_item in ('disponible', 'reservado', 'en_revendedora');

    select
      coalesce(sum(costo_ingreso), 0) into v_mercaderia_terceros
    from item_producto
    where id_tenant = v_tenant_id and tipo_ingreso = 'consignacion' and estado_item in ('disponible', 'reservado', 'en_revendedora');

    select
      coalesce(sum(costo_ingreso), 0) into v_devueltos_clientes
    from item_producto
    where id_tenant = v_tenant_id and estado_item = 'devuelto_cliente';
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

create or replace function rf_finanzas_ranking_productos(p_desde date, p_hasta date, p_limite int default 20, p_orden text default 'ganancia')
returns table (
  id_producto uuid,
  nombre text,
  unidades bigint,
  monto numeric,
  ganancia numeric
)
language plpgsql
security invoker
as $$
declare
  v_tenant_id uuid;
  v_ver_costos boolean;
  v_zona text;
begin
  if not (select auth_tiene_permiso('reportes', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_orden not in ('ganancia', 'unidades', 'monto') then
    raise exception 'orden-invalido';
  end if;

  if p_limite < 1 or p_limite > 100 then
    p_limite := 20;
  end if;

  v_ver_costos := (select auth_tiene_permiso('inventario', 'ver_costos'));
  v_tenant_id := auth_tenant_id();
  select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;

  return query
  select
    p.id_producto,
    p.nombre,
    count(vl.id_venta) as unidades,
    coalesce(sum(vl.precio_venta), 0) as monto,
    case when v_ver_costos then coalesce(sum(vl.margen), 0) else null::numeric end as ganancia
  from v_linea_venta vl
  join producto p on p.id_producto = vl.id_producto
  where vl.id_tenant = v_tenant_id
    and vl.estado_venta = 'registrada'
    and (vl.fecha_venta at time zone v_zona)::date >= p_desde
    and (vl.fecha_venta at time zone v_zona)::date <= p_hasta
    and vl.devuelta = false
  group by p.id_producto, p.nombre
  order by
    case when p_orden = 'ganancia' and v_ver_costos then coalesce(sum(vl.margen), 0) end desc,
    case when p_orden = 'unidades' then count(vl.id_venta) end desc,
    case when p_orden = 'monto' then coalesce(sum(vl.precio_venta), 0) end desc
  limit p_limite;
end;
$$;

create or replace function rf_finanzas_serie_mensual(p_hasta date, p_meses int default 12)
returns table (
  mes date,
  ventas_netas numeric,
  ganancia_sobre_ventas numeric,
  ganancia_final numeric,
  cobrado_neto numeric
)
language plpgsql
security invoker
as $$
declare
  v_tenant_id uuid;
  v_zona text;
  v_desde date;
begin
  if not (select auth_tiene_permiso('reportes', 'ver')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_meses < 1 or p_meses > 24 then
    raise exception 'periodo-invalido';
  end if;

  v_tenant_id := auth_tenant_id();
  select zona_horaria into v_zona from tenant where id_tenant = v_tenant_id;
  
  v_desde := (date_trunc('month', p_hasta::timestamp) - ((p_meses - 1)::text || ' months')::interval)::date;

  return query
  with meses as (
    select generate_series(
      v_desde,
      date_trunc('month', p_hasta::timestamp)::date,
      '1 month'::interval
    )::date as m
  )
  select
    m.m as mes,
    coalesce(r.ventas_netas, 0) as ventas_netas,
    r.ganancia_sobre_ventas,
    r.ganancia_final,
    coalesce(f.neto_cobros, 0) as cobrado_neto
  from meses m
  left join lateral rf_finanzas_resultados(m.m, (m.m + interval '1 month' - interval '1 day')::date) r on true
  left join lateral rf_finanzas_flujo(m.m, (m.m + interval '1 month' - interval '1 day')::date) f on true
  order by m.m asc;
end;
$$;

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
           case when tipo_ingreso_snapshot = 'compra'
                then costo_snapshot
                else monto_proveedor
           end), 0),
         count(*)
    into v_costo, v_lineas
    from detalle_venta
   where id_venta = p_id_venta and id_tenant = v_tenant;

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
                  then dv.costo_snapshot
                  else dv.monto_proveedor
             end as costo_linea
        from detalle_venta dv
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
