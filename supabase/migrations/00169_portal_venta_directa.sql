-- 00169_portal_venta_directa.sql
-- Núcleo de venta compartido en schema interno, venta directa desde el portal
-- de revendedora (sp_registrar_venta_revendedora, rvp_resolver_item_stock),
-- renombre revendedoras.declarar -> revendedoras.vender y retiro de SPs de
-- declaraciones de venta.

-- 1. Guardia: abortar si existen declaraciones pendientes
do $$
begin
  if exists (
    select 1 from declaracion_venta_revendedora where estado = 'pendiente'
  ) then
    raise exception 'Existen declaraciones de venta pendientes; confirmalas o rechazalas antes de aplicar esta migración.';
  end if;
end $$;

-- 2. Schema interno (no expuesto en [api] schemas de PostgREST) y núcleos
create schema if not exists interno;
revoke all on schema interno from public, anon;
grant usage on schema interno to authenticated;

create or replace function interno.fn_sellar_costo_venta_nucleo(
  p_id_venta uuid,
  p_tenant   uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_dv         record;
  v_costo      numeric(14, 2);
  v_monto_prov numeric(14, 2);
  v_monto_gan  numeric(14, 2);
begin
  for v_dv in
    select dv.id_detalle_venta, dv.id_item, dv.precio_venta, dv.tipo_ingreso_snapshot
      from detalle_venta dv
     where dv.id_venta = p_id_venta
       and dv.id_tenant = p_tenant
       and (
         not exists (select 1 from detalle_venta_costo dvc where dvc.id_detalle_venta = dv.id_detalle_venta)
         or not exists (select 1 from detalle_venta_rendicion dvr where dvr.id_detalle_venta = dv.id_detalle_venta)
       )
  loop
    select ic.costo_ingreso into v_costo
      from item_costo ic
     where ic.id_item = v_dv.id_item
       and ic.id_tenant = p_tenant;

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
    values (v_dv.id_detalle_venta, p_tenant, v_costo, v_monto_gan)
    on conflict (id_detalle_venta) do nothing;

    insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
    values (v_dv.id_detalle_venta, p_tenant, v_monto_prov)
    on conflict (id_detalle_venta) do nothing;
  end loop;
end;
$$;

revoke all on function interno.fn_sellar_costo_venta_nucleo(uuid, uuid) from public, anon;
grant execute on function interno.fn_sellar_costo_venta_nucleo(uuid, uuid) to authenticated;

create or replace function interno.fn_transicion_item_producto_nucleo(
  p_tenant          uuid,
  p_actor           uuid,
  p_id_item         uuid,
  p_estado_hasta    estado_item,
  p_tipo_movimiento text,
  p_referencia_id   uuid default null,
  p_referencia_tipo text default null,
  p_ip              inet default null
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_desde estado_item;
begin
  select estado_item into v_desde
    from item_producto
   where id_item = p_id_item and id_tenant = p_tenant
   for update;

  if v_desde is null then
    raise exception 'item-not-found' using errcode = '42704';
  end if;

  if not is_transicion_item_valida(v_desde, p_estado_hasta) then
    raise exception 'invalid-transition: % -> %', v_desde, p_estado_hasta
      using errcode = '22023';
  end if;

  update item_producto
     set estado_item = p_estado_hasta,
         fecha_venta = case when p_estado_hasta = 'vendido' then now() else fecha_venta end,
         fecha_devolucion = case when p_estado_hasta in ('devuelto', 'devuelto_cliente')
                                 then now() else fecha_devolucion end
   where id_item = p_id_item;

  insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
                              estado_desde, estado_hasta,
                              referencia_tipo, referencia_id, id_usuario)
  values (p_tenant, p_id_item, p_tipo_movimiento,
          v_desde, p_estado_hasta,
          p_referencia_tipo, p_referencia_id, p_actor);

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (p_tenant, p_actor, 'item_producto', p_id_item::text, p_tipo_movimiento,
          jsonb_build_object('desde', v_desde, 'hasta', p_estado_hasta,
                             'referencia', jsonb_build_object('tipo', p_referencia_tipo,
                                                              'id', p_referencia_id)),
          p_ip);
end;
$$;

revoke all on function interno.fn_transicion_item_producto_nucleo(uuid, uuid, uuid, estado_item, text, uuid, text, inet) from public, anon;
grant execute on function interno.fn_transicion_item_producto_nucleo(uuid, uuid, uuid, estado_item, text, uuid, text, inet) to authenticated;

create or replace function interno.fn_registrar_venta_nucleo(
  p_tenant         uuid,
  p_actor          uuid,
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
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
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
      where tm.id_tenant = p_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
    ) then
      raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
    end if;

    if p_id_revendedora is null then
      raise exception 'venta-revendedora-sin-id' using errcode = '22023';
    end if;

    if not exists (
      select 1 from revendedora
      where id_tenant = p_tenant and id_revendedora = p_id_revendedora and activo = true
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
     where id_reserva = p_id_reserva and id_tenant = p_tenant
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
     where id_item = v_id_item and id_tenant = p_tenant
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
         and cr.id_tenant = p_tenant
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
     where id_producto = v_item.id_producto and id_tenant = p_tenant;

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
  values (v_id_venta, p_tenant, p_id_cliente, p_actor, p_forma_pago, v_total, p_observaciones,
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
      p_tenant, v_id_venta, (v_linea->>'id_item')::uuid, (v_linea->>'id_producto')::uuid, nullif(v_linea->>'id_prov', '')::uuid,
      (v_linea->>'precio')::numeric, 0,
      (v_linea->>'tipo_ingreso')::tipo_ingreso, (v_linea->'desglose'),
      v_pct_preview
    );

    perform interno.fn_transicion_item_producto_nucleo(
      p_tenant, p_actor, (v_linea->>'id_item')::uuid, 'vendido', 'venta', v_id_venta, 'venta', p_ip
    );

    if v_canal = 'revendedora' and (v_linea->>'id_dcr') is not null then
      update consignacion_revendedora_detalle
         set estado_detalle = 'vendido'
       where id_consignacion_revendedora_detalle = (v_linea->>'id_dcr')::uuid;
    end if;
  end loop;

  -- Sellador DEFINER: lee item_costo (guarda item-costo-pendiente) y persiste
  -- detalle_venta_costo + detalle_venta_rendicion en la misma transacción.
  perform interno.fn_sellar_costo_venta_nucleo(v_id_venta, p_tenant);

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
        p_tenant, v_id_venta, null, 'cuenta_revendedora'::medio_pago, v_total, null,
        0, v_total, null, '{}'::jsonb
      );
      v_pagado := v_total;
    end if;

  elsif p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    if v_total > 0 and p_financiacion is null then
      select id_cuenta_destino into v_id_cuenta
        from cuenta_destino
       where id_tenant = p_tenant
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
        p_tenant, v_id_venta, v_id_cuenta, v_medio, v_total, v_cuotas,
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
           and id_tenant = p_tenant
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
        p_tenant, v_id_venta, v_id_cuenta, v_medio, v_monto_pago, v_cuotas,
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
        p_tenant, v_id_venta, p_id_cliente, v_i, v_monto_cuota, v_venc
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
  values (p_tenant, p_actor, 'venta', v_id_venta::text, 'crear',
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

revoke all on function interno.fn_registrar_venta_nucleo(uuid, uuid, jsonb, forma_pago, uuid, uuid, text, inet, jsonb, jsonb, jsonb, canal_venta, uuid) from public, anon;
grant execute on function interno.fn_registrar_venta_nucleo(uuid, uuid, jsonb, forma_pago, uuid, uuid, text, inet, jsonb, jsonb, jsonb, canal_venta, uuid) to authenticated;

-- 3. Redefinir fn_sellar_costo_venta, sp_transicion_item_producto y sp_registrar_venta delegando en interno
create or replace function fn_sellar_costo_venta(
  p_id_venta uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := auth_tenant_id();
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

  perform interno.fn_sellar_costo_venta_nucleo(p_id_venta, v_tenant);
end;
$$;

create or replace function sp_transicion_item_producto(
  p_id_item         uuid,
  p_estado_hasta    estado_item,
  p_tipo_movimiento text,
  p_referencia_id   uuid default null,
  p_referencia_tipo text default null,
  p_ip              inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if not (
    (select auth_tiene_permiso('ventas', 'crear'))
    or (select auth_tiene_permiso('ventas', 'editar'))
    or (select auth_tiene_permiso('inventario', 'editar'))
    or (select auth_tiene_permiso('consignaciones', 'editar'))
    or (select auth_tiene_permiso('consignaciones', 'eliminar'))
    or (select auth_tiene_permiso('revendedoras', 'crear'))
    or (select auth_tiene_permiso('revendedoras', 'editar'))
  ) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  perform interno.fn_transicion_item_producto_nucleo(
    v_tenant, v_actor, p_id_item, p_estado_hasta, p_tipo_movimiento,
    p_referencia_id, p_referencia_tipo, p_ip
  );
end $$;

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
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
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

  return interno.fn_registrar_venta_nucleo(
    v_tenant, v_actor, p_lineas, p_forma_pago, p_id_cliente, p_id_reserva,
    p_observaciones, p_ip, p_pagos, p_financiacion, p_financiador, p_canal, p_id_revendedora
  );
end $$;

-- 4. rvp_resolver_item_stock y rvp_mi_stock con precio de snapshot
create or replace function rvp_resolver_item_stock(
  p_codigo  text,
  p_excluir uuid[] default '{}'
) returns table (
  id_item      uuid,
  id_producto  uuid,
  descripcion  text,
  sku          text,
  talle        text,
  precio_venta numeric
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_codigo         text := nullif(trim(p_codigo), '');
  v_upper          text;
  v_match          text[];
  v_base_sku       text;
  v_talle          text;
  v_busqueda_esc   text;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if not (select auth_tiene_permiso('revendedoras', 'vender')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if v_codigo is null then
    return;
  end if;

  -- 1. Coincidencia exacta por QR / Data Matrix (qr_code) o EAN-13 / Code128 (codigo_ean)
  return query
  select
    ip.id_item,
    p.id_producto,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    case
      when (snap.val->>'ok')::boolean then (snap.val->>'precio_final')::numeric
      else null::numeric
    end as precio_venta
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
  join producto p on p.id_producto = crd.id_producto and p.id_tenant = cr.id_tenant
  left join lateral (
    select sp_calcular_precio_venta_snapshot(p.id_producto, 'efectivo', '{}'::uuid[]) as val
  ) snap on true
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder'
    and ip.estado_item = 'en_revendedora'
    and (p_excluir is null or not (ip.id_item = any(p_excluir)))
    and (lower(ip.qr_code) = lower(v_codigo) or ip.codigo_ean = v_codigo)
  limit 1;

  if found then
    return;
  end if;

  -- 2. SKU (con talle opcional, mismo patrón que parsearSku)
  v_upper := upper(v_codigo);
  v_match := regexp_match(v_upper, '^([A-Z]+-\d+)(?:-(.+))?$');
  if v_match is not null then
    v_base_sku := v_match[1];
    v_talle    := v_match[2];
  else
    v_base_sku := v_upper;
    v_talle    := null;
  end if;

  if v_talle is not null then
    return query
    select
      ip.id_item,
      p.id_producto,
      p.nombre as descripcion,
      coalesce(p.sku, '') as sku,
      coalesce(ip.talle, '') as talle,
      case
        when (snap.val->>'ok')::boolean then (snap.val->>'precio_final')::numeric
        else null::numeric
      end as precio_venta
    from consignacion_revendedora_detalle crd
    join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
    join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
    join producto p on p.id_producto = crd.id_producto and p.id_tenant = cr.id_tenant
    left join lateral (
      select sp_calcular_precio_venta_snapshot(p.id_producto, 'efectivo', '{}'::uuid[]) as val
    ) snap on true
    where cr.id_tenant = v_tenant
      and cr.id_revendedora = v_revendedora_id
      and cr.confirmada = true
      and cr.estado = 'abierta'
      and crd.estado_detalle = 'en_poder'
      and ip.estado_item = 'en_revendedora'
      and (p_excluir is null or not (ip.id_item = any(p_excluir)))
      and upper(coalesce(p.sku, '')) = v_base_sku
      and upper(coalesce(ip.talle, '')) = v_talle
    order by cr.periodo_desde asc, crd.id_consignacion_revendedora_detalle asc
    limit 1;
    return;
  end if;

  -- SKU sin talle: una fila por talle disponible en su poder
  return query
  select distinct on (coalesce(ip.talle, ''))
    ip.id_item,
    p.id_producto,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    case
      when (snap.val->>'ok')::boolean then (snap.val->>'precio_final')::numeric
      else null::numeric
    end as precio_venta
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
  join producto p on p.id_producto = crd.id_producto and p.id_tenant = cr.id_tenant
  left join lateral (
    select sp_calcular_precio_venta_snapshot(p.id_producto, 'efectivo', '{}'::uuid[]) as val
  ) snap on true
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder'
    and ip.estado_item = 'en_revendedora'
    and (p_excluir is null or not (ip.id_item = any(p_excluir)))
    and upper(coalesce(p.sku, '')) = v_base_sku
  order by coalesce(ip.talle, ''), cr.periodo_desde asc, crd.id_consignacion_revendedora_detalle asc;

  if found then
    return;
  end if;

  -- 3. Búsqueda de texto por nombre o SKU parcial (una fila por producto + talle)
  v_busqueda_esc := regexp_replace(v_codigo, '([\\_%])', '\\\1', 'g');

  return query
  select distinct on (p.id_producto, coalesce(ip.talle, ''))
    ip.id_item,
    p.id_producto,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    case
      when (snap.val->>'ok')::boolean then (snap.val->>'precio_final')::numeric
      else null::numeric
    end as precio_venta
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
  join producto p on p.id_producto = crd.id_producto and p.id_tenant = cr.id_tenant
  left join lateral (
    select sp_calcular_precio_venta_snapshot(p.id_producto, 'efectivo', '{}'::uuid[]) as val
  ) snap on true
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder'
    and ip.estado_item = 'en_revendedora'
    and (p_excluir is null or not (ip.id_item = any(p_excluir)))
    and (
      p.nombre ilike ('%' || v_busqueda_esc || '%') escape '\'
      or coalesce(p.sku, '') ilike ('%' || v_busqueda_esc || '%') escape '\'
    )
  order by p.id_producto, coalesce(ip.talle, ''), cr.periodo_desde asc, crd.id_consignacion_revendedora_detalle asc
  limit 20;
end;
$$;

create or replace function rvp_mi_stock(
  p_limit    integer default 50,
  p_offset   integer default 0,
  p_estado   text default null,
  p_busqueda text default null
) returns table (
  id_item             uuid,
  id_producto         uuid,
  descripcion         text,
  sku                 text,
  talle               text,
  color               text,
  precio_venta        numeric,
  fecha_consignacion  date,
  declarado_pendiente boolean,
  total_filas         bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_revendedora_id uuid := auth_revendedora_id();
  v_limit          integer;
  v_offset         integer;
  v_busqueda       text;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('con_pendiente', 'sin_declaracion') then
    raise exception 'estado-filtro-invalido' using errcode = '22023';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_busqueda := nullif(trim(p_busqueda), '');

  return query
  select
    crd.id_item,
    crd.id_producto,
    p.nombre as descripcion,
    coalesce(p.sku, '') as sku,
    coalesce(ip.talle, '') as talle,
    ''::text as color,
    case
      when (snap.val->>'ok')::boolean then (snap.val->>'precio_final')::numeric
      else null::numeric
    end as precio_venta,
    cr.periodo_desde as fecha_consignacion,
    false as declarado_pendiente,
    count(*) over()::bigint as total_filas
  from consignacion_revendedora_detalle crd
  join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
  join producto p on p.id_producto = crd.id_producto
  join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
  left join lateral (
    select sp_calcular_precio_venta_snapshot(p.id_producto, 'efectivo', '{}'::uuid[]) as val
  ) snap on true
  where cr.id_tenant = v_tenant
    and cr.id_revendedora = v_revendedora_id
    and cr.confirmada = true
    and cr.estado = 'abierta'
    and crd.estado_detalle = 'en_poder'
    and ip.estado_item = 'en_revendedora'
    and (
      v_busqueda is null
      or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
      or coalesce(p.sku, '') ilike ('%' || v_busqueda || '%') escape '\'
    )
  order by cr.periodo_desde desc, crd.id_consignacion_revendedora_detalle
  limit v_limit offset v_offset;
end;
$$;

-- 5. sp_registrar_venta_revendedora
create or replace function sp_registrar_venta_revendedora(
  p_items uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant         uuid := auth_tenant_id();
  v_actor          uuid := auth.uid();
  v_revendedora_id uuid := auth_revendedora_id();
  v_items_dedup    uuid[];
  v_id_item        uuid;
  v_id_dcr         uuid;
  v_lineas         jsonb := '[]'::jsonb;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if not exists (
    select 1 from tenant_modulo tm
    join modulo m on m.id_modulo = tm.id_modulo
    where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
  ) then
    raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
  end if;

  if v_revendedora_id is null then
    raise exception 'no-revendedora' using errcode = '42501';
  end if;

  if not (select auth_tiene_permiso('revendedoras', 'vender')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;

  if p_items is null or coalesce(array_length(p_items, 1), 0) = 0 then
    raise exception 'lineas-vacias' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_items) as x where x is null) then
    raise exception 'payload-invalido' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_items_dedup
    from unnest(p_items) as x;

  if coalesce(array_length(v_items_dedup, 1), 0) = 0 then
    raise exception 'lineas-vacias' using errcode = '22023';
  end if;

  if array_length(v_items_dedup, 1) > 50 then
    raise exception 'payload-invalido' using errcode = '22023';
  end if;

  for v_id_item in select unnest(v_items_dedup) order by 1 loop
    select crd.id_consignacion_revendedora_detalle into v_id_dcr
      from item_producto ip
      join consignacion_revendedora_detalle crd on crd.id_item = ip.id_item
      join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
     where ip.id_item = v_id_item
       and ip.id_tenant = v_tenant
       and ip.estado_item = 'en_revendedora'
       and cr.id_tenant = v_tenant
       and cr.id_revendedora = v_revendedora_id
       and cr.confirmada = true
       and cr.estado = 'abierta'
       and crd.estado_detalle = 'en_poder'
     for update of ip, crd;

    if v_id_dcr is null then
      raise exception 'item-no-en-poder' using errcode = '22023';
    end if;

    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('id_item', v_id_item));
  end loop;

  return interno.fn_registrar_venta_nucleo(
    p_tenant         := v_tenant,
    p_actor          := v_actor,
    p_lineas         := v_lineas,
    p_forma_pago     := 'efectivo',
    p_canal          := 'revendedora',
    p_id_revendedora := v_revendedora_id
  );
end;
$$;

-- 6. Renombre del permiso revendedoras.declarar -> revendedoras.vender
update rol
   set permisos = jsonb_set(
         permisos,
         '{revendedoras}',
         (
           select coalesce(
             jsonb_agg(distinct case when elem = 'declarar' then 'vender' else elem end),
             '[]'::jsonb
           )
           from jsonb_array_elements_text(permisos->'revendedoras') as elem
         )
       )
 where permisos ? 'revendedoras'
   and (permisos->'revendedoras') @> '["declarar"]'::jsonb;

create or replace function fn_auto_crear_rol_revendedora() returns trigger as $$
declare
  v_codigo text;
begin
  if NEW.habilitado = true then
    select codigo into v_codigo from modulo where id_modulo = NEW.id_modulo;
    if v_codigo = 'revendedoras' then
      if not exists (select 1 from rol where id_tenant = NEW.id_tenant and nombre = 'Revendedora') then
        insert into rol(id_tenant, nombre, permisos)
        values (NEW.id_tenant, 'Revendedora', '{"revendedoras": ["ver_propio", "vender"]}'::jsonb);
      end if;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

-- 7. DROP de los SPs y rvp de declaraciones
drop function if exists sp_declarar_venta_revendedora(uuid, text);
drop function if exists sp_confirmar_declaracion_venta(uuid);
drop function if exists sp_rechazar_declaracion_venta(uuid, text);
drop function if exists sp_retirar_declaracion(uuid);
drop function if exists rvp_mis_declaraciones(integer, integer, date, date, text, text);

-- 8. Permisos de ejecución explícitos
revoke all on function rvp_resolver_item_stock(text, uuid[]) from public, anon;
grant execute on function rvp_resolver_item_stock(text, uuid[]) to authenticated;

revoke all on function sp_registrar_venta_revendedora(uuid[]) from public, anon;
grant execute on function sp_registrar_venta_revendedora(uuid[]) to authenticated;

-- DOWN:
-- drop function if exists sp_registrar_venta_revendedora(uuid[]);
-- drop function if exists rvp_resolver_item_stock(text, uuid[]);
--
-- update rol
--    set permisos = jsonb_set(
--          permisos,
--          '{revendedoras}',
--          (
--            select coalesce(
--              jsonb_agg(distinct case when elem = 'vender' then 'declarar' else elem end),
--              '[]'::jsonb
--            )
--            from jsonb_array_elements_text(permisos->'revendedoras') as elem
--          )
--        )
--  where permisos ? 'revendedoras'
--    and (permisos->'revendedoras') @> '["vender"]'::jsonb;
--
-- create or replace function fn_auto_crear_rol_revendedora() returns trigger as $$
-- declare
--   v_codigo text;
-- begin
--   if NEW.habilitado = true then
--     select codigo into v_codigo from modulo where id_modulo = NEW.id_modulo;
--     if v_codigo = 'revendedoras' then
--       if not exists (select 1 from rol where id_tenant = NEW.id_tenant and nombre = 'Revendedora') then
--         insert into rol(id_tenant, nombre, permisos)
--         values (NEW.id_tenant, 'Revendedora', '{"revendedoras": ["ver_propio", "declarar"]}'::jsonb);
--       end if;
--     end if;
--   end if;
--   return NEW;
-- end;
-- $$ language plpgsql security definer set search_path = public;
--
-- create or replace function rvp_mi_stock(
--   p_limit    integer default 50,
--   p_offset   integer default 0,
--   p_estado   text default null,
--   p_busqueda text default null
-- ) returns table (
--   id_item             uuid,
--   id_producto         uuid,
--   descripcion         text,
--   sku                 text,
--   talle               text,
--   color               text,
--   precio_venta        numeric,
--   fecha_consignacion  date,
--   declarado_pendiente boolean,
--   total_filas         bigint
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit          integer;
--   v_offset         integer;
--   v_busqueda       text;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--   if v_revendedora_id is null then
--     raise exception 'no-revendedora' using errcode = '42501';
--   end if;
--   if p_estado is not null and p_estado not in ('con_pendiente', 'sin_declaracion') then
--     raise exception 'estado-filtro-invalido' using errcode = '22023';
--   end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   v_busqueda := nullif(trim(p_busqueda), '');
--   return query
--   select
--     crd.id_item,
--     crd.id_producto,
--     p.nombre as descripcion,
--     coalesce(p.sku, '') as sku,
--     coalesce(ip.talle, '') as talle,
--     ''::text as color,
--     p.precio_venta,
--     cr.periodo_desde as fecha_consignacion,
--     exists (
--       select 1 from declaracion_venta_revendedora dvr
--       where dvr.id_tenant = v_tenant
--         and dvr.id_item = crd.id_item
--         and dvr.estado = 'pendiente'
--     ) as declarado_pendiente,
--     count(*) over()::bigint as total_filas
--   from consignacion_revendedora_detalle crd
--   join consignacion_revendedora cr on cr.id_consignacion_revendedora = crd.id_consignacion_revendedora
--   join producto p on p.id_producto = crd.id_producto
--   join item_producto ip on ip.id_item = crd.id_item and ip.id_tenant = cr.id_tenant
--   where cr.id_tenant = v_tenant
--     and cr.id_revendedora = v_revendedora_id
--     and cr.confirmada = true
--     and cr.estado = 'abierta'
--     and crd.estado_detalle = 'en_poder'
--     and ip.estado_item = 'en_revendedora'
--     and (
--       p_estado is null
--       or (
--         p_estado = 'con_pendiente'
--         and exists (
--           select 1 from declaracion_venta_revendedora dvr
--           where dvr.id_tenant = v_tenant
--             and dvr.id_item = crd.id_item
--             and dvr.estado = 'pendiente'
--         )
--       )
--       or (
--         p_estado = 'sin_declaracion'
--         and not exists (
--           select 1 from declaracion_venta_revendedora dvr
--           where dvr.id_tenant = v_tenant
--             and dvr.id_item = crd.id_item
--             and dvr.estado = 'pendiente'
--         )
--       )
--     )
--     and (
--       v_busqueda is null
--       or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
--       or coalesce(p.sku, '') ilike ('%' || v_busqueda || '%') escape '\'
--     )
--   order by cr.periodo_desde desc, crd.id_consignacion_revendedora_detalle
--   limit v_limit offset v_offset;
-- end;
-- $$;
--
-- create or replace function fn_sellar_costo_venta(
--   p_id_venta uuid
-- ) returns void
-- language plpgsql
-- security definer
-- set search_path = public, extensions, pg_temp
-- as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_dv         record;
--   v_costo      numeric(14, 2);
--   v_monto_prov numeric(14, 2);
--   v_monto_gan  numeric(14, 2);
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
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   for v_dv in
--     select dv.id_detalle_venta, dv.id_item, dv.precio_venta, dv.tipo_ingreso_snapshot
--       from detalle_venta dv
--      where dv.id_venta = p_id_venta
--        and dv.id_tenant = v_tenant
--        and (
--          not exists (select 1 from detalle_venta_costo dvc where dvc.id_detalle_venta = dv.id_detalle_venta)
--          or not exists (select 1 from detalle_venta_rendicion dvr where dvr.id_detalle_venta = dv.id_detalle_venta)
--        )
--   loop
--     select ic.costo_ingreso into v_costo
--       from item_costo ic
--      where ic.id_item = v_dv.id_item
--        and ic.id_tenant = v_tenant;
--     if v_costo is null then
--       raise exception 'item-costo-pendiente' using errcode = 'P0001';
--     end if;
--     if v_dv.tipo_ingreso_snapshot = 'compra' then
--       v_monto_prov := 0;
--     else
--       v_monto_prov := v_costo;
--     end if;
--     v_monto_gan := v_dv.precio_venta - v_costo;
--     insert into detalle_venta_costo(id_detalle_venta, id_tenant, costo_snapshot, monto_ganancia)
--     values (v_dv.id_detalle_venta, v_tenant, v_costo, v_monto_gan)
--     on conflict (id_detalle_venta) do nothing;
--     insert into detalle_venta_rendicion(id_detalle_venta, id_tenant, monto_proveedor)
--     values (v_dv.id_detalle_venta, v_tenant, v_monto_prov)
--     on conflict (id_detalle_venta) do nothing;
--   end loop;
-- end;
-- $$;
--
-- create or replace function sp_transicion_item_producto(
--   p_id_item        uuid,
--   p_estado_hasta   estado_item,
--   p_tipo_movimiento text,
--   p_referencia_id  uuid default null,
--   p_referencia_tipo text default null,
--   p_ip             inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant  uuid := auth_tenant_id();
--   v_actor   uuid := auth.uid();
--   v_desde   estado_item;
-- begin
--   if not (
--     (select auth_tiene_permiso('ventas', 'crear'))
--     or (select auth_tiene_permiso('ventas', 'editar'))
--     or (select auth_tiene_permiso('inventario', 'editar'))
--     or (select auth_tiene_permiso('consignaciones', 'editar'))
--     or (select auth_tiene_permiso('consignaciones', 'eliminar'))
--     or (select auth_tiene_permiso('revendedoras', 'crear'))
--     or (select auth_tiene_permiso('revendedoras', 'editar'))
--   ) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   select estado_item into v_desde
--     from item_producto
--    where id_item = p_id_item and id_tenant = v_tenant
--    for update;
--   if v_desde is null then
--     raise exception 'item-not-found' using errcode = '42704';
--   end if;
--   if not is_transicion_item_valida(v_desde, p_estado_hasta) then
--     raise exception 'invalid-transition: % -> %', v_desde, p_estado_hasta
--       using errcode = '22023';
--   end if;
--   update item_producto
--      set estado_item = p_estado_hasta,
--          fecha_venta = case when p_estado_hasta = 'vendido' then now() else fecha_venta end,
--          fecha_devolucion = case when p_estado_hasta in ('devuelto', 'devuelto_cliente')
--                                  then now() else fecha_devolucion end
--    where id_item = p_id_item;
--   insert into movimiento_item(id_tenant, id_item, tipo_movimiento,
--                               estado_desde, estado_hasta,
--                               referencia_tipo, referencia_id, id_usuario)
--   values (v_tenant, p_id_item, p_tipo_movimiento,
--           v_desde, p_estado_hasta,
--           p_referencia_tipo, p_referencia_id, v_actor);
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'item_producto', p_id_item::text, p_tipo_movimiento,
--           jsonb_build_object('desde', v_desde, 'hasta', p_estado_hasta,
--                              'referencia', jsonb_build_object('tipo', p_referencia_tipo,
--                                                               'id', p_referencia_id)),
--           p_ip);
-- end $$;
--
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
--   v_id_prov    uuid;
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
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
--     raise exception 'lineas-vacias' using errcode = '22023';
--   end if;
--   if v_canal = 'online' then
--     raise exception 'canal-no-disponible' using errcode = '22023';
--   end if;
--   if v_canal = 'revendedora' then
--     if not exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--     end if;
--     if p_id_revendedora is null then
--       raise exception 'venta-revendedora-sin-id' using errcode = '22023';
--     end if;
--     if not exists (
--       select 1 from revendedora
--       where id_tenant = v_tenant and id_revendedora = p_id_revendedora and activo = true
--     ) then
--       raise exception 'revendedora-not-found' using errcode = '42704';
--     end if;
--     select coalesce(porcentaje, 0) into v_pct_preview
--       from fn_resolver_comision(p_id_revendedora, fn_hoy_tenant(), 0, 'revendedora')
--      limit 1;
--     v_pct_preview := coalesce(v_pct_preview, 0);
--   end if;
--   if p_financiacion is not null then
--     v_fin_cuotas := (p_financiacion->>'cuotas')::smallint;
--     v_fin_desde  := (p_financiacion->>'primer_vencimiento')::date;
--     if p_id_cliente is null then
--       raise exception 'financiacion-sin-cliente' using errcode = '22023';
--     end if;
--     if v_fin_cuotas is null or v_fin_cuotas < 1 or v_fin_cuotas > 24 then
--       raise exception 'financiacion-cuotas-invalidas: %', v_fin_cuotas using errcode = '22023';
--     end if;
--     if v_fin_desde is null then
--       raise exception 'financiacion-sin-vencimiento' using errcode = '22023';
--     end if;
--   end if;
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
--   v_fin_propia := coalesce((p_financiador->>'propia')::boolean,
--                            p_financiacion is not null, false);
--   v_fin_cuenta := case when v_fin_propia then null
--                        else (p_financiador->>'id_cuenta_destino')::uuid end;
--   v_fin_medio  := case when v_fin_propia then null
--                        else nullif(p_financiador->>'medio','')::medio_pago end;
--   if v_fin_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
--     raise exception 'medio-solo-revendedora' using errcode = '22023';
--   end if;
--   for v_linea in select * from jsonb_array_elements(p_lineas) loop
--     v_id_item := (v_linea->>'id_item')::uuid;
--     if v_id_item is null then
--       raise exception 'linea-sin-id-item' using errcode = '22023';
--     end if;
--     v_ids_desc := coalesce(
--       (select array_agg(e::uuid)
--          from jsonb_array_elements_text(coalesce(v_linea->'descuentos', '[]'::jsonb)) e),
--       '{}'::uuid[]
--     );
--     select * into v_item
--       from item_producto
--      where id_item = v_id_item and id_tenant = v_tenant
--      for update;
--     if v_item.id_item is null then
--       raise exception 'item-not-found: %', v_id_item using errcode = '42704';
--     end if;
--     v_id_dcr := null;
--     if v_canal = 'revendedora' then
--       if v_item.estado_item <> 'en_revendedora' then
--         raise exception 'item-no-en-revendedora: % (estado=%)',
--           v_id_item, v_item.estado_item using errcode = '22023';
--       end if;
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
--       if v_id_dcr is null then
--         raise exception 'item-no-en-revendedora: %', v_id_item using errcode = '22023';
--       end if;
--     else
--       if v_item.estado_item <> 'disponible' then
--         raise exception 'item-no-disponible: % (estado=%)',
--           v_id_item, v_item.estado_item using errcode = '22023';
--       end if;
--     end if;
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
--     select * into v_producto from producto
--      where id_producto = v_item.id_producto and id_tenant = v_tenant;
--     v_snap := sp_calcular_precio_venta_snapshot(
--                 v_item.id_producto, p_forma_pago, v_ids_desc,
--                 v_fin_cuenta, v_fin_medio, v_fin_propia);
--     if not (v_snap->>'ok')::boolean then
--       raise exception 'precio-no-resoluble: producto % (%)',
--         v_item.id_producto, v_snap->>'reason' using errcode = '22023';
--     end if;
--     v_precio := (v_snap->>'precio_final')::numeric;
--     if v_item.tipo_ingreso = 'compra' then
--       v_id_prov := null;
--     else
--       select id_proveedor into v_id_prov
--         from ingreso_mercaderia
--        where id_ingreso = v_item.id_ingreso;
--     end if;
--     v_lineas_procesadas := v_lineas_procesadas || jsonb_build_object(
--       'id_item', v_id_item, 'id_producto', v_item.id_producto,
--       'id_prov', coalesce(v_id_prov::text, ''), 'precio', v_precio,
--       'tipo_ingreso', v_item.tipo_ingreso,
--       'desglose', coalesce(v_snap->'desglose', '{}'::jsonb),
--       'id_dcr', v_id_dcr
--     );
--     v_total := v_total + v_precio;
--   end loop;
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
--   for v_linea in select * from jsonb_array_elements(v_lineas_procesadas) loop
--     insert into detalle_venta(
--       id_tenant, id_venta, id_item, id_producto, id_proveedor,
--       precio_venta, monto_gasto,
--       tipo_ingreso_snapshot, desglose_reglas,
--       porcentaje_comision_preview
--     ) values (
--       v_tenant, v_id_venta, (v_linea->>'id_item')::uuid, (v_linea->>'id_producto')::uuid, nullif(v_linea->>'id_prov', '')::uuid,
--       (v_linea->>'precio')::numeric, 0,
--       (v_linea->>'tipo_ingreso')::tipo_ingreso, (v_linea->'desglose'),
--       v_pct_preview
--     );
--     perform sp_transicion_item_producto(
--       (v_linea->>'id_item')::uuid, 'vendido', 'venta', v_id_venta, 'venta', p_ip
--     );
--     if v_canal = 'revendedora' and (v_linea->>'id_dcr') is not null then
--       update consignacion_revendedora_detalle
--          set estado_detalle = 'vendido'
--        where id_consignacion_revendedora_detalle = (v_linea->>'id_dcr')::uuid;
--     end if;
--   end loop;
--   perform fn_sellar_costo_venta(v_id_venta);
--   if p_id_reserva is not null then
--     update reserva
--        set estado_reserva = 'convertida_venta',
--            fecha_cierre = now()
--      where id_reserva = p_id_reserva;
--   end if;
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
--       v_medio := coalesce(v_fin_medio, case p_forma_pago::text
--                    when 'efectivo' then 'efectivo'::medio_pago
--                    when 'transferencia' then 'transferencia'::medio_pago
--                    else 'tarjeta_credito'::medio_pago
--                  end);
--       v_cuotas := nullif(substring(p_forma_pago::text from '^cuotas_(\d+)$'), '')::smallint;
--       v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_total);
--       v_costo_cobro := (v_cobro->>'costo_total')::numeric;
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
--   else
--     for v_pago in select * from jsonb_array_elements(p_pagos) loop
--       v_id_cuenta  := (v_pago->>'id_cuenta_destino')::uuid;
--       v_monto_pago := (v_pago->>'monto')::numeric;
--       v_medio      := (v_pago->>'medio')::medio_pago;
--       v_cuotas     := nullif(v_pago->>'cuotas', '')::smallint;
--       if v_medio = 'cuenta_revendedora' and v_canal <> 'revendedora' then
--         raise exception 'medio-solo-revendedora' using errcode = '22023';
--       end if;
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
--       v_cobro := sp_calcular_costo_cobro(v_id_cuenta, v_medio, v_cuotas, v_monto_pago);
--       v_costo_cobro := (v_cobro->>'costo_total')::numeric;
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
--       v_pagado := v_pagado + v_monto_pago;
--     end loop;
--   end if;
--   if p_financiacion is not null then
--     v_a_financiar := v_total - v_pagado;
--     if v_a_financiar <= 0 then
--       raise exception 'financiacion-sin-saldo: pagado % contra total %',
--         v_pagado, v_total using errcode = '22023';
--     end if;
--     v_cuota_base := round(v_a_financiar / v_fin_cuotas, 2);
--     v_i := 0;
--     for v_venc in select * from fn_vencimientos_cuotas(v_fin_desde, v_fin_cuotas) loop
--       v_i := v_i + 1;
--       if v_i = v_fin_cuotas then
--         v_monto_cuota := v_a_financiar - v_acumulado;
--       else
--         v_monto_cuota := v_cuota_base;
--       end if;
--       v_acumulado := v_acumulado + v_monto_cuota;
--       insert into cuota_financiada(
--         id_tenant, id_venta, id_cliente, numero, monto, fecha_vencimiento
--       ) values (
--         v_tenant, v_id_venta, p_id_cliente, v_i, v_monto_cuota, v_venc
--       );
--     end loop;
--     if v_pagado + v_acumulado <> v_total then
--       raise exception 'financiacion-no-cuadra: % + % contra %',
--         v_pagado, v_acumulado, v_total using errcode = '22023';
--     end if;
--   elsif p_pagos is not null and jsonb_array_length(p_pagos) > 0 and v_canal <> 'revendedora' then
--     if v_pagado <> v_total then
--       raise exception 'pagos-no-cuadran: pagado % contra total %',
--         v_pagado, v_total using errcode = '22023';
--     end if;
--   end if;
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
--   return v_id_venta;
-- end $$;
-- create or replace function sp_declarar_venta_revendedora(
--   p_id_item uuid,
--   p_nota    text default ''
-- ) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_id_declaracion uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if v_revendedora_id is null then
--     if not exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--     end if;
--     raise exception 'no-revendedora' using errcode = '42501';
--   end if;
--   if p_id_item is null then
--     raise exception 'item-invalido' using errcode = '22023';
--   end if;
--   if not rvp_item_en_mi_poder(p_id_item) then
--     raise exception 'item-no-en-poder' using errcode = '22023';
--   end if;
--   if exists (
--     select 1 from declaracion_venta_revendedora
--     where id_tenant = v_tenant and id_item = p_id_item and estado = 'pendiente'
--   ) then
--     raise exception 'declaracion-duplicada' using errcode = '22023';
--   end if;
--   insert into declaracion_venta_revendedora (
--     id_tenant, id_revendedora, id_item, fecha, nota, estado
--   ) values (
--     v_tenant, v_revendedora_id, p_id_item, current_date, coalesce(p_nota, ''), 'pendiente'
--   ) returning id_declaracion into v_id_declaracion;
--   return v_id_declaracion;
-- end;
-- $$;
--
-- create or replace function sp_confirmar_declaracion_venta(
--   p_id_declaracion uuid
-- ) returns uuid language plpgsql security invoker as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_dec      declaracion_venta_revendedora;
--   v_id_venta uuid;
-- begin
--   if not (select auth_tiene_permiso('revendedoras', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--   select * into v_dec
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_declaracion = p_id_declaracion
--   for update;
--   if v_dec.id_declaracion is null then
--     raise exception 'declaracion-no-encontrada' using errcode = '42704';
--   end if;
--   if v_dec.estado <> 'pendiente' then
--     raise exception 'declaracion-no-pendiente' using errcode = '22023';
--   end if;
--   v_id_venta := sp_registrar_venta(
--     p_lineas := jsonb_build_array(jsonb_build_object('id_item', v_dec.id_item)),
--     p_canal := 'revendedora',
--     p_id_revendedora := v_dec.id_revendedora
--   );
--   update declaracion_venta_revendedora
--   set estado = 'confirmada',
--       id_venta = v_id_venta,
--       confirmada_por = v_actor,
--       updated_at = now()
--   where id_declaracion = p_id_declaracion and id_tenant = v_tenant;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
--   values (
--     v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
--     'confirmar_declaracion_venta',
--     jsonb_build_object('id_venta', v_id_venta, 'id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora)
--   );
--   return v_id_venta;
-- end;
-- $$;
--
-- create or replace function sp_rechazar_declaracion_venta(
--   p_id_declaracion uuid,
--   p_motivo         text
-- ) returns void language plpgsql security invoker as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_dec    declaracion_venta_revendedora;
--   v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
-- begin
--   if not (select auth_tiene_permiso('revendedoras', 'crear')) then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if auth_revendedora_id() is not null then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--   if v_motivo is null then
--     raise exception 'motivo-requerido' using errcode = '22023';
--   end if;
--   select * into v_dec
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_declaracion = p_id_declaracion
--   for update;
--   if v_dec.id_declaracion is null then
--     raise exception 'declaracion-no-encontrada' using errcode = '42704';
--   end if;
--   if v_dec.estado <> 'pendiente' then
--     raise exception 'declaracion-no-pendiente' using errcode = '22023';
--   end if;
--   update declaracion_venta_revendedora
--   set estado = 'rechazada',
--       motivo_rechazo = v_motivo,
--       confirmada_por = v_actor,
--       updated_at = now()
--   where id_declaracion = p_id_declaracion and id_tenant = v_tenant;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
--   values (
--     v_tenant, v_actor, 'declaracion_venta_revendedora', p_id_declaracion::text,
--     'rechazar_declaracion_venta',
--     jsonb_build_object('id_item', v_dec.id_item, 'id_revendedora', v_dec.id_revendedora, 'motivo', v_motivo)
--   );
-- end;
-- $$;
--
-- create or replace function sp_retirar_declaracion(
--   p_id_declaracion uuid
-- ) returns void language plpgsql security invoker set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_dec            declaracion_venta_revendedora;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if v_revendedora_id is null then
--     if not exists (
--       select 1 from tenant_modulo tm
--       join modulo m on m.id_modulo = tm.id_modulo
--       where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--     ) then
--       raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--     end if;
--     raise exception 'no-revendedora' using errcode = '42501';
--   end if;
--   perform rvp_item_en_mi_poder(null);
--   select * into v_dec
--   from declaracion_venta_revendedora
--   where id_tenant = v_tenant and id_declaracion = p_id_declaracion
--   for update;
--   if v_dec.id_declaracion is null then
--     raise exception 'declaracion-no-encontrada' using errcode = '42704';
--   end if;
--   if v_dec.id_revendedora <> v_revendedora_id then
--     raise exception 'no-permission' using errcode = '42501';
--   end if;
--   if v_dec.estado <> 'pendiente' then
--     raise exception 'declaracion-no-pendiente' using errcode = '22023';
--   end if;
--   update declaracion_venta_revendedora
--   set estado = 'retirada'
--   where id_declaracion = p_id_declaracion and id_tenant = v_tenant;
-- end;
-- $$;
--
-- create or replace function rvp_mis_declaraciones(
--   p_limit    integer default 50,
--   p_offset   integer default 0,
--   p_desde    date default null,
--   p_hasta    date default null,
--   p_estado   text default null,
--   p_busqueda text default null
-- ) returns table (
--   id_declaracion uuid,
--   id_item        uuid,
--   descripcion    text,
--   sku            text,
--   talle          text,
--   color          text,
--   precio_venta   numeric,
--   fecha          date,
--   nota           text,
--   estado         text,
--   motivo_rechazo text,
--   created_at     timestamptz,
--   total_filas    bigint
-- ) language plpgsql security definer set search_path = public, pg_temp as $$
-- declare
--   v_tenant         uuid := auth_tenant_id();
--   v_revendedora_id uuid := auth_revendedora_id();
--   v_limit          integer;
--   v_offset         integer;
--   v_busqueda       text;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if not exists (
--     select 1 from tenant_modulo tm
--     join modulo m on m.id_modulo = tm.id_modulo
--     where tm.id_tenant = v_tenant and m.codigo = 'revendedoras' and tm.habilitado = true
--   ) then
--     raise exception 'modulo-revendedoras-deshabilitado' using errcode = '42501';
--   end if;
--   if v_revendedora_id is null then
--     raise exception 'no-revendedora' using errcode = '42501';
--   end if;
--   if p_estado is not null and p_estado not in ('pendiente', 'confirmada', 'rechazada', 'retirada') then
--     raise exception 'estado-filtro-invalido' using errcode = '22023';
--   end if;
--   v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
--   v_offset := greatest(0, coalesce(p_offset, 0));
--   v_busqueda := nullif(trim(p_busqueda), '');
--   return query
--   select
--     dvr.id_declaracion,
--     dvr.id_item,
--     p.nombre as descripcion,
--     coalesce(p.sku, '') as sku,
--     coalesce(ip.talle, '') as talle,
--     ''::text as color,
--     p.precio_venta,
--     dvr.fecha,
--     dvr.nota,
--     dvr.estado::text,
--     dvr.motivo_rechazo,
--     dvr.created_at,
--     count(*) over()::bigint as total_filas
--   from declaracion_venta_revendedora dvr
--   join item_producto ip on ip.id_item = dvr.id_item and ip.id_tenant = dvr.id_tenant
--   join producto p on p.id_producto = ip.id_producto and p.id_tenant = dvr.id_tenant
--   where dvr.id_tenant = v_tenant
--     and dvr.id_revendedora = v_revendedora_id
--     and (p_desde is null or dvr.fecha >= p_desde)
--     and (p_hasta is null or dvr.fecha <= p_hasta)
--     and (p_estado is null or dvr.estado::text = p_estado)
--     and (
--       v_busqueda is null
--       or p.nombre ilike ('%' || v_busqueda || '%') escape '\'
--       or coalesce(p.sku, '') ilike ('%' || v_busqueda || '%') escape '\'
--     )
--   order by dvr.created_at desc, dvr.id_declaracion
--   limit v_limit offset v_offset;
-- end;
-- $$;
--
-- drop schema if exists interno cascade;
