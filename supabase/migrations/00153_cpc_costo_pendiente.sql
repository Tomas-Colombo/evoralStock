-- 00153_cpc_costo_pendiente.sql
-- Fase 3C.1 de costos-por-columna (REQ-CPC-04, D-CPC-01, D-CPC-03, D-CPC-05):
-- Costo pendiente en SQL:
-- 1. item_producto.costo_ingreso e ingreso_mercaderia_detalle.costo_unitario admiten NULL.
-- 2. Policy restrictiva de insert/update en ingreso_mercaderia_detalle y permiso de UPDATE acotado a costo_unitario.
-- 3. sp_confirmar_ingreso: remito sin costo hereda costo vigente (vía helper fn_costo_vigente_producto) o queda null.
-- 4. sp_importar_remito: rechaza costos si no tiene cargar_costos; líneas sin costo quedan null.
-- 5. sp_aplicar_ultimo_costo: exige cargar_costos o editar_cotizacion.
-- 6. sp_completar_costo_ingreso: completa costos de líneas pendientes en ingresos confirmados.
-- 7. sp_registrar_venta y sp_registrar_cambio: rechazan venta/cambio de ítem con costo pendiente.

-- DOWN:
-- NOTE: Los datos van primero, mientras sigue el trigger de esta migración (deja
-- NOTE: pasar de null a un valor en líneas confirmadas); el de 00065 los rechaza.
-- NOTE: Con pérdida: un costo pendiente pasa a 0 porque la columna vuelve a ser not null.
-- update item_producto set costo_ingreso = 0 where costo_ingreso is null;
-- alter table item_producto alter column costo_ingreso set not null;
-- update ingreso_mercaderia_detalle set costo_unitario = 0 where costo_unitario is null;
-- alter table ingreso_mercaderia_detalle alter column costo_unitario set not null;
-- drop function if exists sp_completar_costo_ingreso(uuid, jsonb, inet);
-- drop function if exists fn_costo_vigente_producto(uuid);
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_costo_insert on ingreso_mercaderia_detalle;
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle;
-- grant update on ingreso_mercaderia_detalle to authenticated;
-- create policy rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle as restrictive for update to authenticated using (false) with check (false);
-- NOTE: Restaura definicion previa de ingreso_detalle_bloquea_confirmado (00065)
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
--       raise exception
--         'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
--         using errcode = '22023';
--     end if;
--   end if;
--   if tg_op = 'DELETE'
--      and not exists (select 1 from tenant where id_tenant = old.id_tenant) then
--     return old;
--   end if;
--   if tg_op in ('UPDATE', 'DELETE') then
--     select confirmado into v_confirmado
--       from ingreso_mercaderia
--      where id_ingreso = old.id_ingreso;
--     if v_confirmado then
--       raise exception
--         'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
--         using errcode = '22023';
--     end if;
--   end if;
--   if tg_op = 'DELETE' then
--     return old;
--   end if;
--   return new;
-- end $$;
-- NOTE: Restaura definicion previa de sp_confirmar_ingreso (00145)
-- create or replace function sp_confirmar_ingreso(p_id_ingreso uuid, p_ip inet default null) returns integer language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id(); v_actor uuid := auth.uid(); v_confirmado boolean; v_tipo tipo_ingreso; v_count integer := 0; v_detalle record; v_i integer; v_qr text; v_new_item uuid; v_prod record;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then raise exception 'no-permission' using errcode = '42501'; end if;
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   select confirmado, tipo_ingreso into v_confirmado, v_tipo from ingreso_mercaderia where id_ingreso = p_id_ingreso and id_tenant = v_tenant for update;
--   if v_confirmado is null then raise exception 'ingreso-not-found' using errcode = '42704'; end if;
--   if v_confirmado then return 0; end if;
--   if exists (select 1 from ingreso_mercaderia_detalle where id_ingreso = p_id_ingreso and id_tenant = v_tenant group by id_producto having count(distinct costo_unitario) > 1) then raise exception 'costos-distintos-mismo-producto' using errcode = '22023'; end if;
--   for v_detalle in select id_detalle, id_producto, cantidad, costo_unitario, talle from ingreso_mercaderia_detalle where id_ingreso = p_id_ingreso and id_tenant = v_tenant loop
--     for v_i in 1 .. v_detalle.cantidad loop
--       v_qr := encode(gen_random_bytes(12), 'hex');
--       insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle, qr_code, estado_item, costo_ingreso, tipo_ingreso, talle) values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle, v_qr, 'disponible', v_detalle.costo_unitario, v_tipo, v_detalle.talle) returning id_item into v_new_item;
--       insert into movimiento_item(id_tenant, id_item, tipo_movimiento, estado_desde, estado_hasta, referencia_tipo, referencia_id, id_usuario) values (v_tenant, v_new_item, 'alta', null, 'disponible', 'ingreso', p_id_ingreso, v_actor);
--       v_count := v_count + 1;
--     end loop;
--   end loop;
--   for v_prod in select id_producto, costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor, case when costo_original_usd is not null or cotizacion_aplicada is not null then 'USD' else 'ARS' end as moneda from (select distinct on (id_producto) id_producto, costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor from ingreso_mercaderia_detalle where id_ingreso = p_id_ingreso and id_tenant = v_tenant order by id_producto, id_detalle) s loop
--     if v_prod.costo_unitario is not null and v_prod.costo_unitario > 0 then
--       perform sp_aplicar_ultimo_costo(v_prod.id_producto, v_prod.costo_unitario, v_prod.moneda, v_prod.costo_original_usd, v_prod.cotizacion_aplicada, v_prod.cotizacion_fecha_valor, 'ingreso mercaderia', p_ip, v_tipo <> 'consignacion');
--     end if;
--   end loop;
--   update ingreso_mercaderia set confirmado = true where id_ingreso = p_id_ingreso;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip) values (v_tenant, v_actor, 'ingreso_mercaderia', p_id_ingreso::text, 'confirmar', jsonb_build_object('items_generados', v_count, 'tipo_ingreso', v_tipo), p_ip);
--   return v_count;
-- end;
-- $$;
-- NOTE: Restaura definicion previa de sp_importar_remito (00145)
-- create or replace function sp_importar_remito(p_id_ingreso uuid, p_moneda text default 'ARS', p_lineas jsonb default '[]', p_ip inet default null, p_cotizacion_aplicada numeric default null, p_cotizacion_fecha_valor date default null) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id(); v_actor uuid := auth.uid(); v_linea jsonb; v_parte jsonb; v_es_nuevo boolean; v_id_producto uuid; v_id_categoria uuid; v_nombre text; v_sku text; v_costo numeric; v_costo_original_usd numeric; v_talle text; v_cant integer; v_id_detalle uuid; v_creados integer := 0; v_vinculados integer := 0; v_detalles jsonb := '[]'::jsonb;
-- begin
--   if not (select auth_tiene_permiso('inventario', 'crear')) then raise exception 'no-permission' using errcode = '42501'; end if;
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if not exists (select 1 from ingreso_mercaderia where id_ingreso = p_id_ingreso and id_tenant = v_tenant) then raise exception 'ingreso-not-found' using errcode = '42704'; end if;
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
--     v_id_producto := nullif(v_linea->>'idProducto', '')::uuid; v_nombre := trim(v_linea->>'nombre'); v_costo := coalesce((v_linea->>'costoUnitario')::numeric, 0);
--     if p_moneda = 'USD' then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then v_costo := round(v_costo * p_cotizacion_aplicada, 2); end if;
--     end if;
--     if exists (select 1 from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) other where ((v_id_producto is not null and nullif(other->>'idProducto', '')::uuid = v_id_producto) or (v_id_producto is null and trim(other->>'nombre') = v_nombre)) and (case when p_moneda = 'USD' and nullif(other->>'costoOriginalUsd', '') is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then round(coalesce((other->>'costoUnitario')::numeric, 0) * p_cotizacion_aplicada, 2) else coalesce((other->>'costoUnitario')::numeric, 0) end) <> v_costo) then raise exception 'costos-distintos-mismo-producto' using errcode = '22023'; end if;
--   end loop;
--   for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
--     v_es_nuevo := coalesce((v_linea->>'esNuevo')::boolean, false); v_nombre := trim(v_linea->>'nombre'); v_costo := coalesce((v_linea->>'costoUnitario')::numeric, 0);
--     if v_nombre is null or v_nombre = '' then raise exception 'linea-sin-nombre' using errcode = '22023'; end if;
--     if p_moneda = 'USD' then
--       v_costo_original_usd := nullif(v_linea->>'costoOriginalUsd', '')::numeric;
--       if v_costo_original_usd is null and p_cotizacion_aplicada is not null and p_cotizacion_aplicada > 0 then v_costo_original_usd := v_costo; v_costo := round(v_costo * p_cotizacion_aplicada, 2); end if;
--     else v_costo_original_usd := null; end if;
--     if v_es_nuevo then
--       v_id_categoria := nullif(v_linea->>'idCategoria', '')::uuid;
--       if v_id_categoria is null then raise exception 'falta-categoria: %', v_nombre using errcode = '22023'; end if;
--       v_sku := sp_gen_sku(v_id_categoria);
--       insert into producto(id_tenant, id_categoria, nombre, sku, stock_minimo, es_nuevo) values (v_tenant, v_id_categoria, v_nombre, v_sku, 0, true) returning id_producto into v_id_producto;
--       insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip) values (v_tenant, v_actor, 'producto', v_id_producto::text, 'crear', jsonb_build_object('nombre', v_nombre, 'sku', v_sku, 'id_categoria', v_id_categoria, 'origen', 'import-remito'), p_ip);
--       if v_costo > 0 then perform sp_aplicar_ultimo_costo(v_id_producto, v_costo, coalesce(p_moneda, 'ARS'), case when p_moneda = 'USD' then v_costo_original_usd else null end, case when p_moneda = 'USD' then p_cotizacion_aplicada else null end, case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end, 'costo inicial (import remito)', p_ip, true); end if;
--       v_creados := v_creados + 1;
--     else
--       v_id_producto := nullif(v_linea->>'idProducto', '')::uuid;
--       if v_id_producto is null then raise exception 'falta-producto: %', v_nombre using errcode = '22023'; end if;
--       if not exists (select 1 from producto where id_producto = v_id_producto and id_tenant = v_tenant) then raise exception 'producto-not-found: %', v_nombre using errcode = '42704'; end if;
--       v_vinculados := v_vinculados + 1;
--     end if;
--     for v_parte in select * from jsonb_array_elements(coalesce(v_linea->'partes', '[]'::jsonb)) loop
--       v_talle := nullif(trim(v_parte->>'talle'), ''); v_cant := coalesce((v_parte->>'cantidad')::integer, 0);
--       if v_cant <= 0 then continue; end if;
--       insert into ingreso_mercaderia_detalle(id_tenant, id_ingreso, id_producto, cantidad, costo_unitario, talle, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor) values (v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle, case when p_moneda = 'USD' then v_costo_original_usd else null end, case when p_moneda = 'USD' then p_cotizacion_aplicada else null end, case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end) returning id_detalle into v_id_detalle;
--       v_detalles := v_detalles || jsonb_build_object('id_detalle', v_id_detalle, 'id_producto', v_id_producto, 'nombre', v_nombre, 'cantidad', v_cant, 'costo_unitario', v_costo, 'talle', v_talle, 'costo_original_usd', v_costo_original_usd);
--     end loop;
--   end loop;
--   return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'detalles', v_detalles);
-- end;
-- $$;
-- NOTE: Restaura definicion previa de sp_aplicar_ultimo_costo (00145)
-- create or replace function sp_aplicar_ultimo_costo(p_id_producto uuid, p_costo numeric, p_moneda text default 'ARS', p_costo_original_usd numeric default null, p_cotizacion_aplicada numeric default null, p_cotizacion_fecha_valor date default null, p_motivo text default null, p_ip inet default null, p_sincronizar_unidades boolean default true) returns uuid language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
-- declare
--   v_tenant uuid := auth_tenant_id(); v_actor uuid := auth.uid(); v_vigente record; v_id uuid; v_es_igual boolean := false;
-- begin
--   if not ((select auth_tiene_permiso('inventario', 'crear')) or (select auth_tiene_permiso('precios', 'editar_cotizacion'))) then raise exception 'no-permission' using errcode = '42501'; end if;
--   if v_tenant is null then raise exception 'no-tenant' using errcode = '42501'; end if;
--   if p_costo is null or p_costo <= 0 then return null; end if;
--   select id_costo, costo, moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor into v_vigente from costo_producto where id_tenant = v_tenant and id_producto = p_id_producto and vigente_hasta is null for update;
--   if v_vigente.id_costo is not null and v_vigente.costo = p_costo then v_es_igual := true; end if;
--   if v_es_igual then return v_vigente.id_costo; end if;
--   if v_vigente.id_costo is not null then update costo_producto set vigente_hasta = now() where id_costo = v_vigente.id_costo; end if;
--   insert into costo_producto(id_tenant, id_producto, costo, moneda, id_usuario_alta, motivo, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor) values (v_tenant, p_id_producto, p_costo, coalesce(p_moneda, 'ARS'), v_actor, p_motivo, case when p_moneda = 'USD' then p_costo_original_usd else null end, case when p_moneda = 'USD' then p_cotizacion_aplicada else null end, case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end) returning id_costo into v_id;
--   if coalesce(p_sincronizar_unidades, true) then update item_producto set costo_ingreso = p_costo where id_tenant = v_tenant and id_producto = p_id_producto and tipo_ingreso = 'compra' and estado_item in ('disponible', 'reservado', 'en_revendedora'); end if;
--   perform sp_marcar_precio_desactualizado_by_producto(p_id_producto);
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip) values (v_tenant, v_actor, 'costo_producto', v_id::text, 'crear', jsonb_build_object('id_producto', p_id_producto, 'costo_anterior', v_vigente.costo, 'costo_nuevo', p_costo, 'moneda', coalesce(p_moneda, 'ARS'), 'motivo', p_motivo, 'costo_original_usd', p_costo_original_usd, 'cotizacion_aplicada', p_cotizacion_aplicada, 'cotizacion_fecha_valor', p_cotizacion_fecha_valor), p_ip);
--   return v_id;
-- end;
-- $$;
-- NOTE: sp_registrar_venta y sp_registrar_cambio no se recrean: con costo_ingreso
-- NOTE: otra vez not null, su guarda item-costo-pendiente nunca dispara. Para volver
-- NOTE: al texto exacto, re-aplicar sus definiciones de 00144.

-- 1. Modificación de columnas: drop NOT NULL (checks >= 0 se conservan y admiten null)
alter table item_producto alter column costo_ingreso drop not null;
alter table ingreso_mercaderia_detalle alter column costo_unitario drop not null;

-- 2. Privilegios de UPDATE por columna y policies restrictivas en ingreso_mercaderia_detalle
revoke update on ingreso_mercaderia_detalle from authenticated;
grant update (costo_unitario) on ingreso_mercaderia_detalle to authenticated;

create policy rlsp_ingreso_mercaderia_detalle_costo_insert on ingreso_mercaderia_detalle
  as restrictive for insert to authenticated
  with check (costo_unitario is null or (select auth_tiene_permiso('inventario', 'cargar_costos')));

drop policy if exists rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle;

create policy rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle
  as restrictive for update to authenticated
  using ((select auth_tiene_permiso('inventario', 'cargar_costos')))
  with check (costo_unitario is null or (select auth_tiene_permiso('inventario', 'cargar_costos')));

-- Adaptación del trigger de inmutabilidad (00065) para permitir completar costo pendiente en confirmados
create or replace function ingreso_detalle_bloquea_confirmado()
returns trigger language plpgsql as $$
declare
  v_confirmado boolean;
begin
  -- En UPDATE se miran las DOS puntas: mover una línea desde o hacia un
  -- ingreso confirmado rompe la invariante igual que insertar o borrar.
  if tg_op in ('INSERT', 'UPDATE') then
    select confirmado into v_confirmado
      from ingreso_mercaderia
     where id_ingreso = new.id_ingreso;
    if v_confirmado then
      if tg_op = 'UPDATE'
         and old.costo_unitario is null
         and new.costo_unitario is not null
         and new.id_detalle = old.id_detalle
         and new.id_tenant = old.id_tenant
         and new.id_ingreso = old.id_ingreso
         and new.id_producto = old.id_producto
         and new.cantidad = old.cantidad
         and new.talle is not distinct from old.talle then
         -- Permitido: completar costo pendiente en línea confirmada
      else
        raise exception
          'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
          using errcode = '22023';
      end if;
    end if;
  end if;

  -- Agregado en 00065: el tenant ya no está, o sea que este DELETE viene en
  -- cascada desde `tenant`. No hay ingreso que proteger porque no hay comercio.
  if tg_op = 'DELETE'
     and not exists (select 1 from tenant where id_tenant = old.id_tenant) then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    -- `v_confirmado` queda null si la cabecera ya no está: eso pasa cuando el
    -- delete viene en cascada desde `ingreso_mercaderia`. Ahí no hay nada que
    -- proteger y se deja pasar.
    select confirmado into v_confirmado
      from ingreso_mercaderia
     where id_ingreso = old.id_ingreso;
    if v_confirmado then
      if tg_op = 'UPDATE'
         and old.costo_unitario is null
         and new.costo_unitario is not null
         and new.id_detalle = old.id_detalle
         and new.id_tenant = old.id_tenant
         and new.id_ingreso = old.id_ingreso
         and new.id_producto = old.id_producto
         and new.cantidad = old.cantidad
         and new.talle is not distinct from old.talle then
         -- Permitido: completar costo pendiente en línea confirmada
      else
        raise exception
          'ingreso-confirmado: el detalle de un ingreso confirmado es inmutable'
          using errcode = '22023';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- 3. Helper de costo vigente (INVOKER)
-- Al ser INVOKER, cuando un procedimiento INVOKER como sp_confirmar_ingreso es llamado por una sesión
-- authenticated, PostgreSQL valida que 'authenticated' tenga permiso de EXECUTE. Si se revocara de authenticated,
-- cualquier llamada fallaría con error 42501 (permission denied). Se revoca de anon y public.
create or replace function fn_costo_vigente_producto(p_id_producto uuid)
returns numeric
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_costo numeric;
begin
  select costo into v_costo
    from costo_producto
   where id_tenant = auth_tenant_id()
     and id_producto = p_id_producto
     and vigente_hasta is null;

  return v_costo;
end;
$$;

revoke execute on function fn_costo_vigente_producto(uuid) from public, anon;
grant execute on function fn_costo_vigente_producto(uuid) to authenticated;

-- 3. sp_confirmar_ingreso adaptado
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
    -- Si la línea no tiene costo_unitario, hereda el costo vigente del producto (o null si no hay vigente)
    if v_detalle.costo_unitario is null then
      v_costo_item := fn_costo_vigente_producto(v_detalle.id_producto);
    else
      v_costo_item := v_detalle.costo_unitario;
    end if;

    for v_i in 1 .. v_detalle.cantidad loop
      v_qr := encode(gen_random_bytes(12), 'hex');

      insert into item_producto(id_tenant, id_producto, id_ingreso, id_ingreso_detalle,
                                qr_code, estado_item, costo_ingreso, tipo_ingreso, talle)
      values (v_tenant, v_detalle.id_producto, p_id_ingreso, v_detalle.id_detalle,
              v_qr, 'disponible', v_costo_item, v_tipo, v_detalle.talle)
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

grant execute on function sp_confirmar_ingreso(uuid, inet) to authenticated;

-- 4. sp_importar_remito adaptado
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
        id_tenant, id_ingreso, id_producto,
        cantidad, costo_unitario, talle,
        costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
      )
      values (
        v_tenant, p_id_ingreso, v_id_producto, v_cant, v_costo, v_talle,
        case when p_moneda = 'USD' then v_costo_original_usd else null end,
        case when p_moneda = 'USD' then p_cotizacion_aplicada else null end,
        case when p_moneda = 'USD' then p_cotizacion_fecha_valor else null end
      )
      returning id_detalle into v_id_detalle;

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

grant execute on function sp_importar_remito(uuid, text, jsonb, inet, numeric, date) to authenticated;

-- 5. sp_aplicar_ultimo_costo adaptado
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
  -- Permisos: 'inventario.cargar_costos' para ingresos y altas de costo manuales,
  -- o 'precios.editar_cotizacion' para recálculo de costos en USD.
  -- NOTA: La Fase 3E revisará esta última entrada al segregar costos.
  if not (
    (select auth_tiene_permiso('inventario', 'cargar_costos'))
    or (select auth_tiene_permiso('precios', 'editar_cotizacion'))
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

grant execute on function sp_aplicar_ultimo_costo(uuid, numeric, text, numeric, numeric, date, text, inet, boolean) to authenticated;

-- 6. Nuevo sp_completar_costo_ingreso
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

      with updated as (
        update item_producto
           set costo_ingreso = v_costo
         where id_ingreso_detalle = v_det.id_detalle
           and id_tenant = v_tenant
           and estado_item <> 'vendido'
        returning id_item
      )
      select count(*) into v_items_actualizados from updated;

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

grant execute on function sp_completar_costo_ingreso(uuid, jsonb, inet) to authenticated;

-- 7. sp_registrar_venta (con guarda item-costo-pendiente)
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
  v_costo      numeric(14, 2);
  v_id_prov    uuid;
  v_monto_prov numeric(14, 2);
  v_monto_gan  numeric(14, 2);
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
      raise exception 'financiacion-cuotas-invalidas: %', v_fin_cuotas
        using errcode = '22023';
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

    -- Guarda: ítem con costo pendiente no puede ser vendido
    if v_item.costo_ingreso is null then
      raise exception 'item-costo-pendiente' using errcode = 'P0001';
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
    v_costo  := v_item.costo_ingreso;

    if v_item.tipo_ingreso = 'compra' then
      v_monto_prov := 0;
      v_id_prov := null;
    else
      v_monto_prov := v_costo;
      select id_proveedor into v_id_prov
        from ingreso_mercaderia
       where id_ingreso = v_item.id_ingreso;
    end if;

    v_monto_gan := v_precio - v_costo;

    v_lineas_procesadas := v_lineas_procesadas || jsonb_build_object(
      'id_item', v_id_item, 'id_producto', v_item.id_producto,
      'id_prov', coalesce(v_id_prov::text, ''), 'precio', v_precio, 'costo', v_costo,
      'monto_prov', v_monto_prov,
      'monto_gan', v_monto_gan, 'tipo_ingreso', v_item.tipo_ingreso,
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
      precio_venta, costo_snapshot, monto_proveedor, monto_gasto, monto_ganancia,
      tipo_ingreso_snapshot, desglose_reglas,
      porcentaje_comision_preview
    ) values (
      v_tenant, v_id_venta, (v_linea->>'id_item')::uuid, (v_linea->>'id_producto')::uuid, nullif(v_linea->>'id_prov', '')::uuid,
      (v_linea->>'precio')::numeric, (v_linea->>'costo')::numeric, (v_linea->>'monto_prov')::numeric, 0, (v_linea->>'monto_gan')::numeric,
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

grant execute on function sp_registrar_venta(jsonb, forma_pago, uuid, uuid, text, inet, jsonb, jsonb, jsonb, canal_venta, uuid) to authenticated;

-- 7. sp_registrar_cambio (con guarda item-costo-pendiente)
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
  v_costo_original          numeric(14,2);
  v_porcentaje_preview_orig numeric(5,2);
  v_id_rendicion            uuid;
  v_id_liquidacion          uuid;
  v_canal                   canal_venta;
  v_id_revendedora          uuid;
  v_estado_venta            estado_venta;
  v_estado_item_orig        estado_item;
  v_estado_item_nuevo       estado_item;
  v_id_prod_nuevo           uuid;
  v_costo_nuevo             numeric(14,2);
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
    dv.costo_snapshot,
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
    v_costo_original,
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
    ip.costo_ingreso,
    ip.tipo_ingreso,
    p.precio_venta
  into
    v_estado_item_nuevo,
    v_id_prod_nuevo,
    v_costo_nuevo,
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

  -- Guarda: ítem entregado con costo pendiente no puede ser entregado en cambio
  if v_costo_nuevo is null then
    raise exception 'item-costo-pendiente' using errcode = 'P0001';
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
    precio_venta, costo_snapshot, monto_proveedor, monto_gasto,
    monto_ganancia, tipo_ingreso_snapshot, desglose_reglas,
    id_rendicion, excluida_rendicion, porcentaje_comision_preview,
    monto_comision, id_liquidacion, excluida_liquidacion
  ) values (
    v_tenant, v_id_venta, p_id_item_entregado, v_id_prod_nuevo,
    v_precio_original, v_costo_nuevo, 0, 0,
    v_precio_original - v_costo_nuevo, v_tipo_ingreso_nuevo, '{}'::jsonb,
    null, false, v_porcentaje_preview_orig,
    0, null, false
  ) returning id_detalle_venta into v_id_det_nuevo;

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

grant execute on function sp_registrar_cambio(uuid, uuid, text, medio_pago, uuid, inet) to authenticated;
