-- supabase/seeds/seed_datos_prueba.sql
--
-- Datos de PRUEBA para el tenant local 'utopia-local': productos, stock,
-- cotización USD, clientes, ventas (contado, tarjeta, transferencia y cuotas
-- propias), reserva, anulación, cambio, consignación con rendición,
-- revendedoras con liquidación y gastos. Todo inventado.
--
-- SOLO LOCAL. Lo corre `pnpm db:seed:local` (y por lo tanto
-- `pnpm db:reset:local`) DESPUÉS de seed_dev.sql, del que toma el tenant, el
-- usuario Administrador, categorías, cuentas destino, aranceles, reglas de
-- precio y categorías de gasto. Nunca se aplica en producción: no está en
-- config.toml ni en supabase/seed.sql.
--
-- Por qué sp_* y no INSERT: ventas, pagos, cuotas, consignaciones,
-- rendiciones, liquidaciones, cambios, declaraciones y transiciones de
-- item_producto tienen invariantes (cuadre de pagos, máquina de estados,
-- auditoría) que viven en los stored procedures. Se llaman igual que desde
-- lib/dal: con sesión `authenticated` y claims JWT del admin (o de la
-- revendedora para declarar), así la RLS y auth_tenant_id() aplican. Sólo
-- van por INSERT directo las filas que la app también inserta directo
-- (proveedor, cliente, cabecera de ingreso_mercaderia).
--
-- Fechas: las ventas, cobros y movimientos quedan con la fecha de HOY porque
-- sp_registrar_venta y compañía no aceptan fecha. Lo que sí se reparte en
-- los últimos 60 días: cabeceras de ingreso, vencimientos de cuotas (hay
-- vencidas) y gastos.
--
-- Idempotente: marcador = ingreso con numero_remito 'SEED-PRUEBA-0001' en
-- utopia-local. Si existe, el bloque entero se saltea. Todo corre en una
-- sola transacción: o entra completo o no entra nada.
--
-- Correr a mano:
--   docker exec -i supabase_db_utopia psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -q < supabase/seeds/seed_datos_prueba.sql

begin;

do $$
declare
  v_tenant  uuid;
  v_admin   uuid;
  v_claims  text;
  v_hoy     date;
  v_cot     numeric;
  v_cot_fec date;
  v_prov    uuid[] := '{}';
  v_cli     uuid[] := '{}';
  v_rev     uuid[] := '{}';
  v_ventas  uuid[] := '{}';
  v_items   uuid[];
  v_id      uuid;
  v_lineas  jsonb;
  v_pagos   jsonb;
  v_total   numeric;
  v_fijo    numeric;
  r         record;
begin
  select id_tenant into v_tenant from tenant where subdominio = 'utopia-local';
  if v_tenant is null then
    raise exception 'seed_datos_prueba: falta el tenant utopia-local (correr seed_dev.sql antes)';
  end if;

  if exists (select 1 from ingreso_mercaderia
              where id_tenant = v_tenant and numero_remito = 'SEED-PRUEBA-0001') then
    raise notice 'seed_datos_prueba: ya cargado (marcador SEED-PRUEBA-0001), se saltea';
    return;
  end if;

  select u.id_usuario into v_admin
    from usuario u join rol ro on ro.id_rol = u.id_rol
   where u.id_tenant = v_tenant and ro.nombre = 'Administrador'
   order by u.created_at limit 1;
  if v_admin is null then
    raise exception 'seed_datos_prueba: utopia-local no tiene usuario Administrador';
  end if;

  -- Sesión como la de la app: rol authenticated + claims del admin.
  v_claims := json_build_object('sub', v_admin, 'tenant_id', v_tenant, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  v_hoy := fn_hoy_tenant();

  -- ── Catálogo plano (la app los inserta directo desde lib/dal) ────────
  for r in select * from (values
      ('Hilandería del Sur',        'mayorista',     30),
      ('Atelier Rivadavia',         'particular',    60),
      ('Consignaciones La Esquina', 'consignatario', 45)
    ) as p(nombre, tipo, dias) loop
    insert into proveedor (id_tenant, nombre, tipo, telefono, email, dias_rotacion, notas)
    values (v_tenant, r.nombre, r.tipo::tipo_proveedor,
            '11-5555-02' || lpad((cardinality(v_prov) + 1)::text, 2, '0'),
            'contacto' || (cardinality(v_prov) + 1) || '@proveedor-prueba.example.com',
            r.dias, 'Proveedor de prueba (seed_datos_prueba)')
    returning id_proveedor into v_id;
    v_prov := v_prov || v_id;
  end loop;

  for r in select * from unnest(
      array['Paula', 'Hernán', 'Micaela', 'Federico', 'Rocío', 'Ignacio'],
      array['Quiroga', 'Videla', 'Ortiz', 'Lamas', 'Bustos', 'Pereyra']
    ) with ordinality as c(nombre, apellido, i) loop
    insert into cliente (id_tenant, nombre, apellido, telefono, email, notas)
    values (v_tenant, r.nombre, r.apellido, '11-5555-' || lpad(r.i::text, 4, '0'),
            lower(translate(r.nombre || '.' || r.apellido, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) || '@example.com',
            'Cliente de prueba (seed_datos_prueba)')
    returning id_cliente into v_id;
    v_cli := v_cli || v_id;
  end loop;

  for r in select * from unnest(array['Julieta', 'Daniela'], array['Sarmiento', 'Correa'])
             with ordinality as x(nombre, apellido, i) loop
    v_rev := v_rev || sp_crear_revendedora(r.nombre, r.apellido, '11-5555-01' || lpad(r.i::text, 2, '0'),
                                           lower(r.nombre || '.' || r.apellido) || '@example.com',
                                           'Revendedora de prueba (seed_datos_prueba)', null);
  end loop;

  -- ── Cotización manual ANTES de cargar costos en USD ─────────────────
  perform sp_set_cotizacion_manual(1500, null);
  -- Igual que resolverConversionCarga: costo ARS = round(usd * cotización, 2).
  v_lineas  := sp_get_cotizacion_vigente();
  v_cot     := (v_lineas->>'valor')::numeric;
  v_cot_fec := (v_lineas->>'fecha_valor')::date;

  -- ── Ingresos: cabecera borrador + sp_importar_remito + sp_confirmar_ingreso
  --    (el camino de crearIngresoCompletoAction). Costos en múltiplos de 100
  --    para que margen y cambio den precios exactos.
  for r in select * from (values
      ('SEED-PRUEBA-0001', 1, 'compra', 'ARS', 55, '[
        {"n":"Remera lisa algodón peinado","c":"Remeras","costo":7000,"t":{"S":2,"M":3,"L":2}},
        {"n":"Remera rayada marinera","c":"Remeras","costo":8500,"t":{"M":2,"L":2}},
        {"n":"Camisa lino natural","c":"Camisas","costo":15000,"t":{"M":2,"L":2}},
        {"n":"Buzo frisa oversize","c":"Buzos","costo":19000,"t":{"M":2,"L":2,"XL":1}},
        {"n":"Campera inflable liviana","c":"Camperas","costo":42000,"t":{"M":1,"L":2}},
        {"n":"Vestido midi estampado","c":"Vestidos","costo":21000,"t":{"S":2,"M":2}},
        {"n":"Jean wide leg","c":"Pantalones","costo":24000,"t":{"38":2,"40":2,"42":1}},
        {"n":"Pantalón sastrero","c":"Pantalones","costo":20000,"t":{"40":2,"42":2}},
        {"n":"Short deportivo","c":"Shorts","costo":9500,"t":{"38":2,"40":2}},
        {"n":"Zapatillas lona clásica","c":"Calzado","costo":30000,"t":{"38":1,"39":2,"40":1,"41":1}},
        {"n":"Cartera bandolera","c":"Accesorios","costo":16000,"t":{"Único":3}},
        {"n":"Pijama algodón","c":"Ropa Interior","costo":13000,"t":{"M":2,"L":1}}]'::jsonb),
      ('SEED-PRUEBA-0002', 2, 'compra', 'USD', 0, '[
        {"n":"Campera de cuero importada","c":"Camperas","costo":60,"t":{"M":1,"L":1}},
        {"n":"Botas de cuero importadas","c":"Calzado","costo":45,"t":{"37":1,"38":1,"39":1}}]'::jsonb),
      ('SEED-PRUEBA-0003', 3, 'consignacion', 'ARS', 30, '[
        {"n":"Vestido de fiesta largo","c":"Vestidos","costo":35000,"t":{"S":1,"M":1,"L":1}}]'::jsonb)
    ) as i(remito, prov, tipo, moneda, dias, lineas) loop
    insert into ingreso_mercaderia (id_tenant, id_proveedor, tipo_ingreso, numero_remito,
                                    observaciones, id_usuario_alta, fecha)
    values (v_tenant, v_prov[r.prov], r.tipo::tipo_ingreso, r.remito,
            'Ingreso de prueba (seed_datos_prueba)', v_admin, now() - r.dias * interval '1 day')
    returning id_ingreso into v_id;

    select jsonb_agg(jsonb_build_object(
             'esNuevo', true, 'idCategoria', c.id_categoria, 'nombre', l->>'n',
             'costoUnitario', case when r.moneda = 'USD' then round((l->>'costo')::numeric * v_cot, 2)
                                   else (l->>'costo')::numeric end,
             'costoOriginalUsd', case when r.moneda = 'USD' then (l->>'costo')::numeric end,
             'partes', (select jsonb_agg(jsonb_build_object('talle', t.key, 'cantidad', t.value::int))
                          from jsonb_each_text(l->'t') t))),
           count(*)
      into v_lineas, v_fijo
      from jsonb_array_elements(r.lineas) l
      join categoria c on c.id_tenant = v_tenant and lower(c.nombre) = lower(l->>'c');
    if v_fijo <> jsonb_array_length(r.lineas) then
      raise exception 'seed_datos_prueba: faltan categorías para %', r.remito;
    end if;

    perform sp_importar_remito(v_id, r.moneda, v_lineas, null,
                               case when r.moneda = 'USD' then v_cot end,
                               case when r.moneda = 'USD' then v_cot_fec end);
    perform sp_confirmar_ingreso(v_id, null);
  end loop;

  -- Precio de lista desde costo vigente + regla de margen (sin esto no se vende).
  perform sp_recalcular_precio_venta(d.id_producto, null)
     from (select distinct dt.id_producto
             from ingreso_mercaderia_detalle dt
             join ingreso_mercaderia im on im.id_ingreso = dt.id_ingreso
            where im.id_tenant = v_tenant and im.numero_remito like 'SEED-PRUEBA-%') d;

  -- ── Operaciones en orden. `ref` según tipo: venta/reserva → cliente
  --    (0 = sin cliente); entrega/declarar/liquidar → revendedora;
  --    rendir/devolver → proveedor; anular/cambio/cobrar → nº de op de la venta.
  --    items = 'Producto|talle'. pagos: plantilla (cuenta por tipo; el pago
  --    sin "monto" se lleva el resto). fin: financiación propia o cuota a cobrar.
  for r in select * from (values
      ( 1, 'venta',    1, array['Campera inflable liviana|L'], 'cuotas_3', null::jsonb, '{"cuotas":3,"dias":-40}'::jsonb, null::text),
      ( 2, 'venta',    2, array['Jean wide leg|40', 'Remera lisa algodón peinado|L'], 'cuotas_2',
                      '[{"medio":"efectivo","cuenta":"efectivo","monto":10000}]', '{"cuotas":2,"dias":10}', 'Anticipo en efectivo'),
      ( 3, 'venta',    3, array['Zapatillas lona clásica|39'], 'cuotas_3', null, '{"cuotas":3,"dias":-20}', null),
      ( 4, 'venta',    4, array['Campera de cuero importada|M'], 'cuotas_6', null, '{"cuotas":6,"dias":5}', null),
      ( 5, 'venta',    5, array['Remera rayada marinera|M', 'Short deportivo|38'], 'efectivo', null, null, null),
      ( 6, 'venta',    6, array['Vestido de fiesta largo|M', 'Pantalón sastrero|42'], 'transferencia',
                      '[{"medio":"transferencia","cuenta":"banco","referencia":"TRF-2001"}]', null, null),
      ( 7, 'venta',    0, array['Cartera bandolera|Único'], 'efectivo',
                      '[{"medio":"tarjeta_debito","cuenta":"billetera_virtual"}]', null, null),
      ( 8, 'venta',    1, array['Camisa lino natural|M', 'Pijama algodón|M'], 'efectivo',
                      '[{"medio":"tarjeta_credito","cuenta":"billetera_virtual","cuotas":1,"monto":20000},{"medio":"efectivo","cuenta":"efectivo"}]', null, null),
      ( 9, 'venta',    6, array['Remera lisa algodón peinado|S'], 'efectivo', null, null, null),
      (10, 'anular',   9, '{}'::text[], null, null, null, 'El cliente se arrepintió en el mostrador'),
      (11, 'cambio',   5, array['Remera rayada marinera|L'], null, null, null, 'Le quedó chica'),
      (12, 'reserva',  3, array['Vestido midi estampado|S', 'Buzo frisa oversize|M'], null, null, null, 'Pasa a buscar el sábado'),
      (13, 'cobrar',   1, '{}', null, '[{"medio":"efectivo","cuenta":"efectivo"}]', '{"cuota":1,"pct":100}', null),
      (14, 'cobrar',   3, '{}', null, '[{"medio":"transferencia","cuenta":"banco"}]', '{"cuota":1,"pct":50}', null),
      (15, 'rendir',   3, '{}', null, null, null, 'Rendición de prueba'),
      (16, 'devolver', 3, array['Vestido de fiesta largo|S'], null, null, null, 'Devolución de fin de temporada'),
      (17, 'entrega',  1, array['Remera lisa algodón peinado|M', 'Buzo frisa oversize|L', 'Short deportivo|40'], null, null, null, 'Entrega de prueba'),
      (18, 'entrega',  2, array['Pantalón sastrero|40', 'Vestido midi estampado|M'], null, null, null, 'Entrega de prueba'),
      (19, 'declarar', 1, array['Remera lisa algodón peinado|M'], 'confirmar', null, null, 'Vendida a una vecina'),
      (20, 'declarar', 2, array['Vestido midi estampado|M'], null, null, null, 'Vendido en feria'),
      (21, 'liquidar', 1, '{}', null, null, null, 'Liquidación de prueba')
    ) as o(n, tipo, ref, items, forma, pagos, fin, nota) order by n loop

    v_items := '{}';
    if cardinality(r.items) > 0 then
      select coalesce(array_agg(x.id_item order by s.k), '{}') into v_items
        from unnest(r.items) with ordinality s(spec, k)
        cross join lateral (
          select ip.id_item
            from item_producto ip join producto p on p.id_producto = ip.id_producto
           where p.id_tenant = v_tenant
             and p.nombre = split_part(s.spec, '|', 1)
             and ip.talle is not distinct from nullif(split_part(s.spec, '|', 2), '')
             and ip.estado_item = (case when r.tipo = 'declarar' then 'en_revendedora' else 'disponible' end)::estado_item
             and not exists (select 1 from detalle_reserva dr where dr.id_item = ip.id_item and dr.estado = 'activa')
           order by ip.qr_code limit 1) x;
      if cardinality(v_items) <> cardinality(r.items) then
        raise exception 'seed_datos_prueba: op % (%) sin stock para %', r.n, r.tipo, r.items;
      end if;
    end if;

    if r.tipo = 'venta' then
      -- Mismo precio que calcula sp_registrar_venta, para que los pagos cuadren.
      select sum((sp_calcular_precio_venta_snapshot(ip.id_producto, r.forma::forma_pago, '{}', null, null,
                                                    r.fin is not null)->>'precio_final')::numeric)
        into v_total from item_producto ip where ip.id_item = any (v_items);
      select coalesce(sum((e->>'monto')::numeric), 0) into v_fijo from jsonb_array_elements(coalesce(r.pagos, '[]')) e;
      select jsonb_agg(jsonb_build_object(
               'medio', e->>'medio', 'id_cuenta_destino', cd.id_cuenta_destino,
               'monto', coalesce((e->>'monto')::numeric, v_total - v_fijo),
               'cuotas', e->'cuotas', 'referencia', e->>'referencia'))
        into v_pagos
        from jsonb_array_elements(r.pagos) e
        cross join lateral (select id_cuenta_destino from cuenta_destino
                             where id_tenant = v_tenant and activo and tipo::text = e->>'cuenta'
                             order by es_predeterminada desc, nombre limit 1) cd;
      v_ventas[r.n] := sp_registrar_venta(
        (select jsonb_agg(jsonb_build_object('id_item', i, 'descuentos', '[]'::jsonb)) from unnest(v_items) i),
        r.forma::forma_pago, v_cli[nullif(r.ref, 0)], null, r.nota, null, v_pagos,
        case when r.fin is not null then jsonb_build_object('cuotas', r.fin->'cuotas',
               'primer_vencimiento', v_hoy + (r.fin->>'dias')::int) end,
        case when r.fin is not null then '{"propia":true}'::jsonb end,
        'local', null);
    elsif r.tipo = 'anular' then
      perform sp_anular_venta(v_ventas[r.ref], r.nota, null);
    elsif r.tipo = 'cambio' then
      perform sp_registrar_cambio(
        (select dv.id_detalle_venta from detalle_venta dv join item_producto ip on ip.id_item = v_items[1]
          where dv.id_venta = v_ventas[r.ref] and dv.id_producto = ip.id_producto limit 1),
        v_items[1], r.nota, null, null, null);
    elsif r.tipo = 'reserva' then
      perform sp_crear_reserva(v_cli[r.ref], v_items, now() + interval '7 days', r.nota, null);
    elsif r.tipo = 'cobrar' then
      perform sp_cobrar_cuota(cf.id_cuota_financiada, round(cf.monto * (r.fin->>'pct')::numeric / 100, 2),
                              (r.pagos->0->>'medio')::medio_pago, cd.id_cuenta_destino, 'Cobro de prueba', null)
         from cuota_financiada cf,
              lateral (select id_cuenta_destino from cuenta_destino
                        where id_tenant = v_tenant and activo and tipo::text = r.pagos->0->>'cuenta'
                        order by es_predeterminada desc, nombre limit 1) cd
        where cf.id_venta = v_ventas[r.ref] and cf.numero = (r.fin->>'cuota')::int;
    elsif r.tipo = 'rendir' then
      perform sp_generar_rendicion(v_prov[r.ref], r.nota, null);
    elsif r.tipo = 'devolver' then
      perform sp_confirmar_consignacion(sp_crear_consignacion_con_items(v_prov[r.ref], r.nota, v_items, r.nota, null), null);
    elsif r.tipo = 'entrega' then
      perform sp_entregar_consignacion_revendedora(v_rev[r.ref], v_items, v_hoy - 15, v_hoy + 15, r.nota, null, null);
    elsif r.tipo = 'declarar' then
      -- La declaración la hace la revendedora: sus claims, no los del admin.
      perform set_config('request.jwt.claims', json_build_object(
        'tenant_id', v_tenant, 'id_revendedora', v_rev[r.ref], 'role', 'authenticated')::text, true);
      v_id := sp_declarar_venta_revendedora(v_items[1], r.nota);
      perform set_config('request.jwt.claims', v_claims, true);
      if r.forma = 'confirmar' then
        perform sp_confirmar_declaracion_venta(v_id);
      end if;
    elsif r.tipo = 'liquidar' then
      perform sp_generar_liquidacion(v_rev[r.ref], v_hoy - 30, v_hoy, r.nota, null);
    end if;

    -- tr_venta_cuadre_pagos es diferido al commit. En la app cada venta
    -- commitea antes del cobro de cuotas; acá se fuerza ese chequeo ahora
    -- para que un cobro posterior no rompa el cuadre de la venta.
    set constraints all immediate;
    set constraints all deferred;
  end loop;

  -- ── Gastos repartidos en los últimos 60 días ────────────────────────
  for r in select * from (values
      ('Alquiler',  450000, 'Alquiler del local', 50),
      ('Servicios',  38500, 'Luz',                35),
      ('Alquiler',  450000, 'Alquiler del local', 20),
      ('Servicios',  18900, 'Internet',           12),
      ('Marketing',  60000, 'Publicidad en redes', 5)
    ) as g(cat, monto, descr, dias) loop
    perform sp_registrar_gasto(cg.id_categoria_gasto, r.monto, r.descr, now() - r.dias * interval '1 day',
                               'SEED-G-' || r.dias, null)
       from categoria_gasto cg where cg.id_tenant = v_tenant and lower(cg.nombre) = lower(r.cat);
    if not found then
      raise exception 'seed_datos_prueba: falta la categoría de gasto %', r.cat;
    end if;
  end loop;

  reset role;
  raise notice 'seed_datos_prueba: OK en utopia-local';
end $$;

commit;
