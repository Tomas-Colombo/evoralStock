-- 00144_rlsp_sp_ventas.sql
-- Fase 5b-M1 de rls-por-permiso: chequeo de permiso en los 10 sp_* de Ventas, Cuotas y Reservas.
--
-- UP:
--   1. sp_registrar_venta: ventas.crear OR revendedoras.crear
--   2. sp_anular_venta: ventas.editar
--   3. sp_registrar_devolucion_cliente: ventas.editar
--   4. sp_registrar_cambio: ventas.crear
--   5. sp_emitir_comprobante: ventas.crear
--   6. sp_cobrar_cuota: ventas.editar
--   7. sp_marcar_cuota_incobrable: ventas.eliminar
--   8. sp_crear_reserva: ventas.crear
--   9. sp_cancelar_reserva: ventas.editar
--   10. sp_vencer_reservas: ventas.editar
--
-- NOTE: el bloque de reversión está al final del archivo.

-- ─────────────────────────────────────────────────────────────────
-- sp_registrar_venta
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- sp_anular_venta
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_anular_venta(
  p_id_venta uuid,
  p_motivo   text default null,
  p_ip       inet default null
) returns jsonb language plpgsql as $$
declare
  v_tenant            uuid := auth_tenant_id();
  v_actor             uuid := auth.uid();
  v_estado            estado_venta;
  v_canal             canal_venta;
  v_rendida           boolean;
  v_liquidada         boolean;
  v_anuladas          integer := 0;
  r_det               record;
  r_pago              record;
  v_total_reintegrado numeric(14,2) := 0;
  v_reintegro_pago    numeric(14,2);
  v_restante          numeric(14,2);
  v_tiene_incobrables boolean;
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  select estado_venta, canal into v_estado, v_canal from venta
    where id_venta = p_id_venta and id_tenant = v_tenant for update;
  
  if v_estado is null then
    raise exception 'venta-not-found' using errcode = '42704';
  end if;
  
  if v_estado = 'anulada' then
    return jsonb_build_object('total_reintegrado', 0); -- idempotente
  end if;

  select exists(
    select 1 from cuota_financiada
     where id_venta = p_id_venta and estado = 'incobrable'
  ) into v_tiene_incobrables;
  
  if v_tiene_incobrables then
    raise exception 'venta-con-incobrables' using errcode = '22023';
  end if;

  select exists(
    select 1 from detalle_venta
     where id_venta = p_id_venta and id_rendicion is not null
  ) into v_rendida;
  
  if v_rendida then
    raise exception 'venta-ya-rendida' using errcode = '22023';
  end if;

  select exists(
    select 1 from detalle_venta
     where id_venta = p_id_venta and id_liquidacion is not null
  ) into v_liquidada;
  
  if v_liquidada then
    raise exception 'venta-liquidada' using errcode = '22023';
  end if;

  for r_det in
    select dv.id_item, ip.estado_item
      from detalle_venta dv
      join item_producto ip on ip.id_item = dv.id_item
     where dv.id_venta = p_id_venta
     for update of ip
  loop
    if r_det.estado_item = 'vendido' then
      if v_canal = 'revendedora' then
        perform sp_transicion_item_producto(
          r_det.id_item, 'en_revendedora', 'ajuste', p_id_venta, 'anulacion_venta', p_ip
        );
        update consignacion_revendedora_detalle
           set estado_detalle = 'en_poder'
         where id_item = r_det.id_item
           and estado_detalle = 'vendido'
           and id_tenant = v_tenant;
      else
        perform sp_transicion_item_producto(
          r_det.id_item, 'disponible', 'ajuste', p_id_venta, 'anulacion_venta', p_ip
        );
      end if;
    end if;
  end loop;

  with anuladas as (
    update cuota_financiada
       set estado = 'anulada'
     where id_venta = p_id_venta
       and estado in ('pendiente', 'parcial')
    returning 1
  )
  select count(*) into v_anuladas from anuladas;

  -- Lo que queda por devolver es lo cobrado menos TODO lo ya reintegrado de la
  -- venta. Excluir pagos de cuenta_revendedora (no mueven fondos de caja).
  v_restante := greatest(0::numeric,
    (select coalesce(sum(monto), 0) from pago_venta where id_venta = p_id_venta and medio <> 'cuenta_revendedora')
    - (select coalesce(sum(monto), 0) from reintegro_cliente where id_venta = p_id_venta)
  );

  for r_pago in
    select id_pago_venta, id_cuenta_destino, medio, monto
      from pago_venta
     where id_venta = p_id_venta
       and medio <> 'cuenta_revendedora'
     order by created_at, id_pago_venta
  loop
    v_reintegro_pago := least(v_restante, r_pago.monto - coalesce((
      select sum(monto) from reintegro_cliente
       where id_pago_venta = r_pago.id_pago_venta
    ), 0));
    
    if v_reintegro_pago > 0 then
      insert into reintegro_cliente (
        id_tenant, id_venta, id_pago_venta, id_cuenta_destino,
        medio, monto, origen, motivo, id_usuario
      ) values (
        v_tenant, p_id_venta, r_pago.id_pago_venta, r_pago.id_cuenta_destino,
        r_pago.medio, v_reintegro_pago, 'anulacion', p_motivo, v_actor
      );
      v_total_reintegrado := v_total_reintegrado + v_reintegro_pago;
      v_restante := v_restante - v_reintegro_pago;
    end if;
  end loop;

  update venta
     set estado_venta     = 'anulada',
         fecha_anulacion  = now(),
         motivo_anulacion = p_motivo
   where id_venta = p_id_venta;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'venta', p_id_venta::text, 'anular',
          jsonb_build_object('motivo', p_motivo, 'cuotas_anuladas', v_anuladas, 'total_reintegrado', v_total_reintegrado),
          p_ip);

  return jsonb_build_object('total_reintegrado', v_total_reintegrado);
end $$;

grant execute on function sp_anular_venta(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_registrar_devolucion_cliente
-- ─────────────────────────────────────────────────────────────────

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
  v_costo_snapshot    numeric(14,2);
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
  select dv.id_item, ip.estado_item, dv.id_venta, dv.precio_venta, dv.costo_snapshot,
         dv.id_rendicion is not null, dv.id_liquidacion
    into v_id_item, v_estado_item, v_id_venta, v_precio_venta, v_costo_snapshot,
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
    monto, costo_recuperado, motivo, id_usuario
  ) values (
    v_tenant, v_id_venta, p_id_detalle_venta, v_id_item,
    v_precio_venta, v_costo_snapshot, p_motivo, v_actor
  ) returning id_devolucion into v_id_devolucion;

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

grant execute on function sp_registrar_devolucion_cliente(uuid, text, uuid, medio_pago, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_registrar_cambio
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- sp_emitir_comprobante
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_emitir_comprobante(
  p_id_venta   uuid,
  p_tipo       tipo_comprobante,
  p_numero     text,
  p_ip         inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_id     uuid;
begin
  if not (select auth_tiene_permiso('ventas', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  insert into comprobante(id_tenant, id_venta, tipo, numero)
  values (v_tenant, p_id_venta, p_tipo, p_numero)
  returning id_comprobante into v_id;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'comprobante', v_id::text, 'emitir',
          jsonb_build_object('id_venta', p_id_venta, 'tipo', p_tipo, 'numero', p_numero),
          p_ip);
  return v_id;
end $$;

grant execute on function sp_emitir_comprobante(uuid, tipo_comprobante, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_cobrar_cuota
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_cobrar_cuota(
  p_id_cuota          uuid,
  p_monto             numeric,
  p_medio             medio_pago,
  p_id_cuenta_destino uuid,
  p_referencia        text default null,
  p_ip                inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_cuota      cuota_financiada;
  v_estado_venta estado_venta;
  v_saldo      numeric(14, 2);
  v_pagado     numeric(14, 2);
  v_estado     estado_cuota;
  v_cobro      jsonb;
  v_costo      numeric(14, 2);
  v_id_pago    uuid;
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  select * into v_cuota from cuota_financiada
   where id_cuota_financiada = p_id_cuota and id_tenant = v_tenant
   for update;
  if v_cuota.id_cuota_financiada is null then
    raise exception 'cuota-not-found' using errcode = '42704';
  end if;

  select estado_venta into v_estado_venta from venta where id_venta = v_cuota.id_venta;
  if v_estado_venta = 'anulada' then
    raise exception 'venta-anulada' using errcode = '22023';
  end if;

  if v_cuota.estado not in ('pendiente', 'parcial') then
    raise exception 'cuota-no-cobrable: %', v_cuota.estado using errcode = '22023';
  end if;

  v_saldo := v_cuota.monto - v_cuota.monto_pagado;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto-invalido: %', p_monto using errcode = '22023';
  end if;
  if p_monto > v_saldo then
    raise exception 'monto-excede-saldo: % contra %', p_monto, v_saldo
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from cuenta_destino
     where id_cuenta_destino = p_id_cuenta_destino
       and id_tenant = v_tenant and activo
  ) then
    raise exception 'cuenta-destino-invalida: %', p_id_cuenta_destino
      using errcode = '22023';
  end if;

  v_cobro := sp_calcular_costo_cobro(p_id_cuenta_destino, p_medio, null, p_monto);
  v_costo := (v_cobro->>'costo_total')::numeric;

  insert into pago_venta(
    id_tenant, id_venta, id_cuenta_destino, id_cuota_financiada,
    medio, monto, referencia,
    costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
  ) values (
    v_tenant, v_cuota.id_venta, p_id_cuenta_destino, p_id_cuota,
    p_medio, p_monto, nullif(trim(coalesce(p_referencia, '')), ''),
    v_costo, p_monto - v_costo,
    current_date + (v_cobro->>'dias_acreditacion')::int,
    v_cobro
  )
  returning id_pago_venta into v_id_pago;

  v_pagado := v_cuota.monto_pagado + p_monto;
  v_estado := case when v_pagado >= v_cuota.monto then 'pagada' else 'parcial' end;

  update cuota_financiada
     set monto_pagado = v_pagado,
         estado       = v_estado,
         fecha_cobro  = case when v_estado = 'pagada' then now() else fecha_cobro end
   where id_cuota_financiada = p_id_cuota;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'cuota_financiada', p_id_cuota::text, 'editar',
          jsonb_build_object('cobrado', p_monto, 'medio', p_medio,
                             'acumulado', v_pagado, 'estado', v_estado),
          p_ip);
  return v_id_pago;
end $$;

grant execute on function sp_cobrar_cuota(uuid, numeric, medio_pago, uuid, text, inet)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_marcar_cuota_incobrable
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_marcar_cuota_incobrable(
  p_id_cuota uuid,
  p_motivo   text,
  p_ip       inet default null
) returns jsonb language plpgsql as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_actor      uuid := auth.uid();
  v_cuota      cuota_financiada;
  v_estado_venta estado_venta;
  v_saldo      numeric(14, 2);
  v_afectadas  integer;
  v_desde      smallint;
  v_hasta      smallint;
  v_ids        uuid[];
begin
  if not (select auth_tiene_permiso('ventas', 'eliminar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'motivo-requerido' using errcode = '22023';
  end if;

  select * into v_cuota from cuota_financiada
   where id_cuota_financiada = p_id_cuota and id_tenant = v_tenant
   for update;
  if v_cuota.id_cuota_financiada is null then
    raise exception 'cuota-not-found' using errcode = '42704';
  end if;

  select estado_venta into v_estado_venta from venta where id_venta = v_cuota.id_venta;
  if v_estado_venta = 'anulada' then
    raise exception 'venta-anulada' using errcode = '22023';
  end if;

  if v_cuota.estado not in ('pendiente', 'parcial') then
    raise exception 'cuota-no-incobrable: %', v_cuota.estado using errcode = '22023';
  end if;

  with actualizadas as (
    update cuota_financiada
       set estado                = 'incobrable',
           fecha_incobrable      = now(),
           id_usuario_incobrable = v_actor,
           motivo_incobrable     = trim(p_motivo)
     where id_tenant = v_tenant
       and id_venta  = v_cuota.id_venta
       and numero   >= v_cuota.numero
       and estado in ('pendiente', 'parcial')
    returning id_cuota_financiada, numero, monto - monto_pagado as saldo
  )
  select coalesce(sum(saldo), 0),
         count(*),
         min(numero),
         max(numero),
         array_agg(id_cuota_financiada)
    into v_saldo, v_afectadas, v_desde, v_hasta, v_ids
    from actualizadas;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'cuota_financiada', p_id_cuota::text, 'editar',
          jsonb_build_object('estado', 'incobrable',
                             'saldo_perdido', v_saldo,
                             'cuotas_afectadas', v_afectadas,
                             'desde', v_desde, 'hasta', v_hasta,
                             'ids', to_jsonb(v_ids),
                             'motivo', trim(p_motivo)),
          p_ip);

  return jsonb_build_object(
    'cuotas_afectadas', v_afectadas,
    'monto_total',      v_saldo,
    'desde',            v_desde,
    'hasta',            v_hasta
  );
end $$;

grant execute on function sp_marcar_cuota_incobrable(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_crear_reserva
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_crear_reserva(
  p_id_cliente        uuid,
  p_items             uuid[],           -- array de id_item
  p_fecha_vencimiento timestamptz,
  p_observaciones     text default null,
  p_ip                inet default null
) returns uuid language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_item_id  uuid;
  v_estado   estado_item;
  v_producto uuid;
  v_precio   numeric;
  v_ya_reservado boolean;
begin
  if not (select auth_tiene_permiso('ventas', 'crear')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  if p_items is null or array_length(p_items, 1) is null then
    raise exception 'items-vacios' using errcode = '22023';
  end if;
  if p_fecha_vencimiento <= now() then
    raise exception 'vencimiento-invalido' using errcode = '22023';
  end if;

  -- Crea reserva primero para tener id
  insert into reserva(id_tenant, id_cliente, id_usuario_alta,
                      fecha_vencimiento, observaciones)
  values (v_tenant, p_id_cliente, v_actor, p_fecha_vencimiento, p_observaciones)
  returning id_reserva into v_id;

  -- Por cada item: lockeo (FOR UPDATE), valido estado, valido no-reservado.
  foreach v_item_id in array p_items loop
    -- Columnas calificadas: `id_producto` existe en las dos tablas del join.
    select ip.estado_item, ip.id_producto, pr.precio_venta
      into v_estado, v_producto, v_precio
      from item_producto ip
      left join producto pr on pr.id_producto = ip.id_producto
     where ip.id_item = v_item_id and ip.id_tenant = v_tenant
     for update of ip;

    if v_estado is null then
      raise exception 'item-not-found: %', v_item_id using errcode = '42704';
    end if;
    if v_estado not in ('disponible') then
      raise exception 'item-no-disponible-para-reserva: % (estado=%)',
        v_item_id, v_estado using errcode = '22023';
    end if;

    -- Chequeo idempotente vía partial unique index (detalle_reserva_item_activa_uk).
    -- Adicional: hacemos SELECT para dar un error mejor que el 23505 del
    -- unique violation.
    select exists (
      select 1 from detalle_reserva dr
       where dr.id_item = v_item_id and dr.estado = 'activa'
    ) into v_ya_reservado;
    if v_ya_reservado then
      raise exception 'item-ya-reservado: %', v_item_id using errcode = '23505';
    end if;

    insert into detalle_reserva(id_tenant, id_reserva, id_item, id_producto,
                                precio_snapshot, estado)
    values (v_tenant, v_id, v_item_id, v_producto,
            coalesce(v_precio, 0), 'activa');
  end loop;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'reserva', v_id::text, 'crear',
          jsonb_build_object('id_cliente', p_id_cliente,
                             'items', to_jsonb(p_items),
                             'fecha_vencimiento', p_fecha_vencimiento),
          p_ip);
  return v_id;
end $$;

grant execute on function sp_crear_reserva(uuid, uuid[], timestamptz, text, inet)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_cancelar_reserva
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_cancelar_reserva(
  p_id_reserva uuid,
  p_motivo     text default null,
  p_ip         inet default null
) returns void language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
  v_estado estado_reserva;
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  select estado_reserva into v_estado
    from reserva
   where id_reserva = p_id_reserva and id_tenant = v_tenant
   for update;

  if v_estado is null then
    raise exception 'reserva-not-found' using errcode = '42704';
  end if;
  if v_estado <> 'activa' then
    raise exception 'reserva-no-activa: estado=%', v_estado using errcode = '22023';
  end if;

  update reserva
     set estado_reserva = 'cancelada',
         fecha_cierre = now()
   where id_reserva = p_id_reserva;

  update detalle_reserva
     set estado = 'cancelada'
   where id_reserva = p_id_reserva and estado = 'activa';

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'reserva', p_id_reserva::text, 'cancelar',
          jsonb_build_object('motivo', p_motivo), p_ip);
end $$;

grant execute on function sp_cancelar_reserva(uuid, text, inet) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- sp_vencer_reservas
-- ─────────────────────────────────────────────────────────────────

create or replace function sp_vencer_reservas() returns integer language plpgsql as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_count  integer := 0;
  r_id     uuid;
begin
  if not (select auth_tiene_permiso('ventas', 'editar')) then
    raise exception 'no-permission' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  for r_id in
    select id_reserva
      from reserva
     where id_tenant = v_tenant
       and estado_reserva = 'activa'
       and fecha_vencimiento < now()
     for update
  loop
    update reserva set estado_reserva = 'vencida', fecha_cierre = now()
     where id_reserva = r_id;
    update detalle_reserva set estado = 'vencida'
     where id_reserva = r_id and estado = 'activa';
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
    values (v_tenant, auth.uid(), 'reserva', null, 'vencer_batch',
            jsonb_build_object('reservas_vencidas', v_count));
  end if;
  return v_count;
end $$;

grant execute on function sp_vencer_reservas() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Reversión a definiciones anteriores
-- ─────────────────────────────────────────────────────────────────

-- DOWN:
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_registrar_venta
-- NOTE: ────────────────────────────────────────────────────────────
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
-- grant execute on function sp_registrar_venta(jsonb, forma_pago, uuid, uuid, text, inet, jsonb, jsonb, jsonb, canal_venta, uuid) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_anular_venta
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_anular_venta(
--   p_id_venta uuid,
--   p_motivo   text default null,
--   p_ip       inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant            uuid := auth_tenant_id();
--   v_actor             uuid := auth.uid();
--   v_estado            estado_venta;
--   v_canal             canal_venta;
--   v_rendida           boolean;
--   v_liquidada         boolean;
--   v_anuladas          integer := 0;
--   r_det               record;
--   r_pago              record;
--   v_total_reintegrado numeric(14,2) := 0;
--   v_reintegro_pago    numeric(14,2);
--   v_restante          numeric(14,2);
--   v_tiene_incobrables boolean;
-- begin
--   select estado_venta, canal into v_estado, v_canal from venta
--     where id_venta = p_id_venta and id_tenant = v_tenant for update;
--
--   if v_estado is null then
--     raise exception 'venta-not-found' using errcode = '42704';
--   end if;
--
--   if v_estado = 'anulada' then
--     return jsonb_build_object('total_reintegrado', 0); -- idempotente
--   end if;
--
--   select exists(
--     select 1 from cuota_financiada
--      where id_venta = p_id_venta and estado = 'incobrable'
--   ) into v_tiene_incobrables;
--
--   if v_tiene_incobrables then
--     raise exception 'venta-con-incobrables' using errcode = '22023';
--   end if;
--
--   select exists(
--     select 1 from detalle_venta
--      where id_venta = p_id_venta and id_rendicion is not null
--   ) into v_rendida;
--
--   if v_rendida then
--     raise exception 'venta-ya-rendida' using errcode = '22023';
--   end if;
--
--   select exists(
--     select 1 from detalle_venta
--      where id_venta = p_id_venta and id_liquidacion is not null
--   ) into v_liquidada;
--
--   if v_liquidada then
--     raise exception 'venta-liquidada' using errcode = '22023';
--   end if;
--
--   for r_det in
--     select dv.id_item, ip.estado_item
--       from detalle_venta dv
--       join item_producto ip on ip.id_item = dv.id_item
--      where dv.id_venta = p_id_venta
--      for update of ip
--   loop
--     if r_det.estado_item = 'vendido' then
--       if v_canal = 'revendedora' then
--         perform sp_transicion_item_producto(
--           r_det.id_item, 'en_revendedora', 'ajuste', p_id_venta, 'anulacion_venta', p_ip
--         );
--         update consignacion_revendedora_detalle
--            set estado_detalle = 'en_poder'
--          where id_item = r_det.id_item
--            and estado_detalle = 'vendido'
--            and id_tenant = v_tenant;
--       else
--         perform sp_transicion_item_producto(
--           r_det.id_item, 'disponible', 'ajuste', p_id_venta, 'anulacion_venta', p_ip
--         );
--       end if;
--     end if;
--   end loop;
--
--   with anuladas as (
--     update cuota_financiada
--        set estado = 'anulada'
--      where id_venta = p_id_venta
--        and estado in ('pendiente', 'parcial')
--     returning 1
--   )
--   select count(*) into v_anuladas from anuladas;
--
--   -- Lo que queda por devolver es lo cobrado menos TODO lo ya reintegrado de la
--   -- venta. Excluir pagos de cuenta_revendedora (no mueven fondos de caja).
--   v_restante := greatest(0::numeric,
--     (select coalesce(sum(monto), 0) from pago_venta where id_venta = p_id_venta and medio <> 'cuenta_revendedora')
--     - (select coalesce(sum(monto), 0) from reintegro_cliente where id_venta = p_id_venta)
--   );
--
--   for r_pago in
--     select id_pago_venta, id_cuenta_destino, medio, monto
--       from pago_venta
--      where id_venta = p_id_venta
--        and medio <> 'cuenta_revendedora'
--      order by created_at, id_pago_venta
--   loop
--     v_reintegro_pago := least(v_restante, r_pago.monto - coalesce((
--       select sum(monto) from reintegro_cliente
--        where id_pago_venta = r_pago.id_pago_venta
--     ), 0));
--
--     if v_reintegro_pago > 0 then
--       insert into reintegro_cliente (
--         id_tenant, id_venta, id_pago_venta, id_cuenta_destino,
--         medio, monto, origen, motivo, id_usuario
--       ) values (
--         v_tenant, p_id_venta, r_pago.id_pago_venta, r_pago.id_cuenta_destino,
--         r_pago.medio, v_reintegro_pago, 'anulacion', p_motivo, v_actor
--       );
--       v_total_reintegrado := v_total_reintegrado + v_reintegro_pago;
--       v_restante := v_restante - v_reintegro_pago;
--     end if;
--   end loop;
--
--   update venta
--      set estado_venta     = 'anulada',
--          fecha_anulacion  = now(),
--          motivo_anulacion = p_motivo
--    where id_venta = p_id_venta;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'venta', p_id_venta::text, 'anular',
--           jsonb_build_object('motivo', p_motivo, 'cuotas_anuladas', v_anuladas, 'total_reintegrado', v_total_reintegrado),
--           p_ip);
--
--   return jsonb_build_object('total_reintegrado', v_total_reintegrado);
-- end $$;
--
-- grant execute on function sp_anular_venta(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_registrar_devolucion_cliente
-- NOTE: ────────────────────────────────────────────────────────────
--
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
-- grant execute on function sp_registrar_devolucion_cliente(uuid, text, uuid, medio_pago, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_registrar_cambio
-- NOTE: ────────────────────────────────────────────────────────────
--
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
-- grant execute on function sp_registrar_cambio(uuid, uuid, text, medio_pago, uuid, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_emitir_comprobante
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_emitir_comprobante(
--   p_id_venta   uuid,
--   p_tipo       tipo_comprobante,
--   p_numero     text,
--   p_ip         inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   insert into comprobante(id_tenant, id_venta, tipo, numero)
--   values (v_tenant, p_id_venta, p_tipo, p_numero)
--   returning id_comprobante into v_id;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'comprobante', v_id::text, 'emitir',
--           jsonb_build_object('id_venta', p_id_venta, 'tipo', p_tipo, 'numero', p_numero),
--           p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_emitir_comprobante(uuid, tipo_comprobante, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_cobrar_cuota
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_cobrar_cuota(
--   p_id_cuota          uuid,
--   p_monto             numeric,
--   p_medio             medio_pago,
--   p_id_cuenta_destino uuid,
--   p_referencia        text default null,
--   p_ip                inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_cuota      cuota_financiada;
--   v_estado_venta estado_venta;
--   v_saldo      numeric(14, 2);
--   v_pagado     numeric(14, 2);
--   v_estado     estado_cuota;
--   v_cobro      jsonb;
--   v_costo      numeric(14, 2);
--   v_id_pago    uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   select * into v_cuota from cuota_financiada
--    where id_cuota_financiada = p_id_cuota and id_tenant = v_tenant
--    for update;
--   if v_cuota.id_cuota_financiada is null then
--     raise exception 'cuota-not-found' using errcode = '42704';
--   end if;
--
--   select estado_venta into v_estado_venta from venta where id_venta = v_cuota.id_venta;
--   if v_estado_venta = 'anulada' then
--     raise exception 'venta-anulada' using errcode = '22023';
--   end if;
--
--   if v_cuota.estado not in ('pendiente', 'parcial') then
--     raise exception 'cuota-no-cobrable: %', v_cuota.estado using errcode = '22023';
--   end if;
--
--   v_saldo := v_cuota.monto - v_cuota.monto_pagado;
--   if p_monto is null or p_monto <= 0 then
--     raise exception 'monto-invalido: %', p_monto using errcode = '22023';
--   end if;
--   if p_monto > v_saldo then
--     raise exception 'monto-excede-saldo: % contra %', p_monto, v_saldo
--       using errcode = '22023';
--   end if;
--   if not exists (
--     select 1 from cuenta_destino
--      where id_cuenta_destino = p_id_cuenta_destino
--        and id_tenant = v_tenant and activo
--   ) then
--     raise exception 'cuenta-destino-invalida: %', p_id_cuenta_destino
--       using errcode = '22023';
--   end if;
--
--   v_cobro := sp_calcular_costo_cobro(p_id_cuenta_destino, p_medio, null, p_monto);
--   v_costo := (v_cobro->>'costo_total')::numeric;
--
--   insert into pago_venta(
--     id_tenant, id_venta, id_cuenta_destino, id_cuota_financiada,
--     medio, monto, referencia,
--     costo_cobro, neto_acreditado, fecha_acreditacion, desglose_costo
--   ) values (
--     v_tenant, v_cuota.id_venta, p_id_cuenta_destino, p_id_cuota,
--     p_medio, p_monto, nullif(trim(coalesce(p_referencia, '')), ''),
--     v_costo, p_monto - v_costo,
--     current_date + (v_cobro->>'dias_acreditacion')::int,
--     v_cobro
--   )
--   returning id_pago_venta into v_id_pago;
--
--   v_pagado := v_cuota.monto_pagado + p_monto;
--   v_estado := case when v_pagado >= v_cuota.monto then 'pagada' else 'parcial' end;
--
--   update cuota_financiada
--      set monto_pagado = v_pagado,
--          estado       = v_estado,
--          fecha_cobro  = case when v_estado = 'pagada' then now() else fecha_cobro end
--    where id_cuota_financiada = p_id_cuota;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'cuota_financiada', p_id_cuota::text, 'editar',
--           jsonb_build_object('cobrado', p_monto, 'medio', p_medio,
--                              'acumulado', v_pagado, 'estado', v_estado),
--           p_ip);
--   return v_id_pago;
-- end $$;
--
-- grant execute on function sp_cobrar_cuota(uuid, numeric, medio_pago, uuid, text, inet)
--   to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_marcar_cuota_incobrable
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_marcar_cuota_incobrable(
--   p_id_cuota uuid,
--   p_motivo   text,
--   p_ip       inet default null
-- ) returns jsonb language plpgsql as $$
-- declare
--   v_tenant     uuid := auth_tenant_id();
--   v_actor      uuid := auth.uid();
--   v_cuota      cuota_financiada;
--   v_estado_venta estado_venta;
--   v_saldo      numeric(14, 2);
--   v_afectadas  integer;
--   v_desde      smallint;
--   v_hasta      smallint;
--   v_ids        uuid[];
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if p_motivo is null or trim(p_motivo) = '' then
--     raise exception 'motivo-requerido' using errcode = '22023';
--   end if;
--
--   select * into v_cuota from cuota_financiada
--    where id_cuota_financiada = p_id_cuota and id_tenant = v_tenant
--    for update;
--   if v_cuota.id_cuota_financiada is null then
--     raise exception 'cuota-not-found' using errcode = '42704';
--   end if;
--
--   select estado_venta into v_estado_venta from venta where id_venta = v_cuota.id_venta;
--   if v_estado_venta = 'anulada' then
--     raise exception 'venta-anulada' using errcode = '22023';
--   end if;
--
--   if v_cuota.estado not in ('pendiente', 'parcial') then
--     raise exception 'cuota-no-incobrable: %', v_cuota.estado using errcode = '22023';
--   end if;
--
--   with actualizadas as (
--     update cuota_financiada
--        set estado                = 'incobrable',
--            fecha_incobrable      = now(),
--            id_usuario_incobrable = v_actor,
--            motivo_incobrable     = trim(p_motivo)
--      where id_tenant = v_tenant
--        and id_venta  = v_cuota.id_venta
--        and numero   >= v_cuota.numero
--        and estado in ('pendiente', 'parcial')
--     returning id_cuota_financiada, numero, monto - monto_pagado as saldo
--   )
--   select coalesce(sum(saldo), 0),
--          count(*),
--          min(numero),
--          max(numero),
--          array_agg(id_cuota_financiada)
--     into v_saldo, v_afectadas, v_desde, v_hasta, v_ids
--     from actualizadas;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'cuota_financiada', p_id_cuota::text, 'editar',
--           jsonb_build_object('estado', 'incobrable',
--                              'saldo_perdido', v_saldo,
--                              'cuotas_afectadas', v_afectadas,
--                              'desde', v_desde, 'hasta', v_hasta,
--                              'ids', to_jsonb(v_ids),
--                              'motivo', trim(p_motivo)),
--           p_ip);
--
--   return jsonb_build_object(
--     'cuotas_afectadas', v_afectadas,
--     'monto_total',      v_saldo,
--     'desde',            v_desde,
--     'hasta',            v_hasta
--   );
-- end $$;
--
-- grant execute on function sp_marcar_cuota_incobrable(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_crear_reserva
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_crear_reserva(
--   p_id_cliente        uuid,
--   p_items             uuid[],           -- array de id_item
--   p_fecha_vencimiento timestamptz,
--   p_observaciones     text default null,
--   p_ip                inet default null
-- ) returns uuid language plpgsql as $$
-- declare
--   v_tenant   uuid := auth_tenant_id();
--   v_actor    uuid := auth.uid();
--   v_id       uuid;
--   v_item_id  uuid;
--   v_estado   estado_item;
--   v_producto uuid;
--   v_precio   numeric;
--   v_ya_reservado boolean;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   if p_items is null or array_length(p_items, 1) is null then
--     raise exception 'items-vacios' using errcode = '22023';
--   end if;
--   if p_fecha_vencimiento <= now() then
--     raise exception 'vencimiento-invalido' using errcode = '22023';
--   end if;
--
--   -- Crea reserva primero para tener id
--   insert into reserva(id_tenant, id_cliente, id_usuario_alta,
--                       fecha_vencimiento, observaciones)
--   values (v_tenant, p_id_cliente, v_actor, p_fecha_vencimiento, p_observaciones)
--   returning id_reserva into v_id;
--
--   -- Por cada item: lockeo (FOR UPDATE), valido estado, valido no-reservado.
--   foreach v_item_id in array p_items loop
--     -- Columnas calificadas: `id_producto` existe en las dos tablas del join.
--     select ip.estado_item, ip.id_producto, pr.precio_venta
--       into v_estado, v_producto, v_precio
--       from item_producto ip
--       left join producto pr on pr.id_producto = ip.id_producto
--      where ip.id_item = v_item_id and ip.id_tenant = v_tenant
--      for update of ip;
--
--     if v_estado is null then
--       raise exception 'item-not-found: %', v_item_id using errcode = '42704';
--     end if;
--     if v_estado not in ('disponible') then
--       raise exception 'item-no-disponible-para-reserva: % (estado=%)',
--         v_item_id, v_estado using errcode = '22023';
--     end if;
--
--     -- Chequeo idempotente vía partial unique index (detalle_reserva_item_activa_uk).
--     -- Adicional: hacemos SELECT para dar un error mejor que el 23505 del
--     -- unique violation.
--     select exists (
--       select 1 from detalle_reserva dr
--        where dr.id_item = v_item_id and dr.estado = 'activa'
--     ) into v_ya_reservado;
--     if v_ya_reservado then
--       raise exception 'item-ya-reservado: %', v_item_id using errcode = '23505';
--     end if;
--
--     insert into detalle_reserva(id_tenant, id_reserva, id_item, id_producto,
--                                 precio_snapshot, estado)
--     values (v_tenant, v_id, v_item_id, v_producto,
--             coalesce(v_precio, 0), 'activa');
--   end loop;
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'reserva', v_id::text, 'crear',
--           jsonb_build_object('id_cliente', p_id_cliente,
--                              'items', to_jsonb(p_items),
--                              'fecha_vencimiento', p_fecha_vencimiento),
--           p_ip);
--   return v_id;
-- end $$;
--
-- grant execute on function sp_crear_reserva(uuid, uuid[], timestamptz, text, inet)
--   to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_cancelar_reserva
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_cancelar_reserva(
--   p_id_reserva uuid,
--   p_motivo     text default null,
--   p_ip         inet default null
-- ) returns void language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
--   v_estado estado_reserva;
-- begin
--   select estado_reserva into v_estado
--     from reserva
--    where id_reserva = p_id_reserva and id_tenant = v_tenant
--    for update;
--
--   if v_estado is null then
--     raise exception 'reserva-not-found' using errcode = '42704';
--   end if;
--   if v_estado <> 'activa' then
--     raise exception 'reserva-no-activa: estado=%', v_estado using errcode = '22023';
--   end if;
--
--   update reserva
--      set estado_reserva = 'cancelada',
--          fecha_cierre = now()
--    where id_reserva = p_id_reserva;
--
--   update detalle_reserva
--      set estado = 'cancelada'
--    where id_reserva = p_id_reserva and estado = 'activa';
--
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'reserva', p_id_reserva::text, 'cancelar',
--           jsonb_build_object('motivo', p_motivo), p_ip);
-- end $$;
--
-- grant execute on function sp_cancelar_reserva(uuid, text, inet) to authenticated;
--
-- NOTE: ────────────────────────────────────────────────────────────
-- NOTE: sp_vencer_reservas
-- NOTE: ────────────────────────────────────────────────────────────
--
-- create or replace function sp_vencer_reservas() returns integer language plpgsql as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_count  integer := 0;
--   r_id     uuid;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--
--   for r_id in
--     select id_reserva
--       from reserva
--      where id_tenant = v_tenant
--        and estado_reserva = 'activa'
--        and fecha_vencimiento < now()
--      for update
--   loop
--     update reserva set estado_reserva = 'vencida', fecha_cierre = now()
--      where id_reserva = r_id;
--     update detalle_reserva set estado = 'vencida'
--      where id_reserva = r_id and estado = 'activa';
--     v_count := v_count + 1;
--   end loop;
--
--   if v_count > 0 then
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios)
--     values (v_tenant, auth.uid(), 'reserva', null, 'vencer_batch',
--             jsonb_build_object('reservas_vencidas', v_count));
--   end if;
--   return v_count;
-- end $$;
--
-- grant execute on function sp_vencer_reservas() to authenticated;
