-- 00135_rf_deudores_resumen.sql
-- Función rf_deudores_resumen (SECURITY INVOKER, STABLE) para consolidar
-- la agregación de deudores, KPIs y filtros directamente en BD en una sola pasada.
--
-- DOWN:
-- drop function if exists rf_deudores_resumen(date, text, date, date, text);

create or replace function rf_deudores_resumen(
  p_hoy date,
  p_estado text default 'con_deuda',
  p_desde date default null,
  p_hasta date default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_inicio_mes date;
  v_fin_mes date;
  v_manana date;
  v_search text;
  v_resultado jsonb;
begin
  v_inicio_mes := date_trunc('month', p_hoy)::date;
  v_fin_mes := (date_trunc('month', p_hoy) + interval '1 month')::date - 1;
  v_manana := p_hoy + 1;
  v_search := nullif(trim(p_search), '');

  with cuotas_filtradas as (
    select
      cf.id_cuota_financiada,
      cf.id_cliente,
      cf.id_venta,
      cf.estado,
      cf.monto,
      cf.monto_pagado,
      cf.fecha_vencimiento,
      (cf.monto - cf.monto_pagado) as saldo,
      cli.nombre,
      cli.apellido,
      cli.nombre_completo,
      cli.telefono
    from cuota_financiada cf
    join cliente cli on cli.id_cliente = cf.id_cliente
    where
      (
        case coalesce(p_estado, 'con_deuda')
          when 'todas' then true
          when 'con_deuda' then cf.estado in ('pendiente', 'parcial')
          when 'vencidas' then cf.estado in ('pendiente', 'parcial') and cf.fecha_vencimiento < p_hoy
          when 'vence_este_mes' then cf.estado in ('pendiente', 'parcial')
            and cf.fecha_vencimiento >= v_inicio_mes
            and cf.fecha_vencimiento <= v_fin_mes
          when 'parciales' then cf.estado = 'parcial'
          when 'pagadas' then cf.estado = 'pagada'
          when 'incobrables' then cf.estado = 'incobrable'
          else true
        end
      )
      and (p_desde is null or cf.fecha_vencimiento >= p_desde)
      and (p_hasta is null or cf.fecha_vencimiento <= p_hasta)
      and (
        v_search is null
        or cli.nombre ilike '%' || v_search || '%'
        or cli.apellido ilike '%' || v_search || '%'
        or cli.nombre_completo ilike '%' || v_search || '%'
      )
  ),
  deudores_agg as (
    select
      id_cliente,
      nombre,
      apellido,
      nombre_completo,
      telefono,
      count(*)::int as pendientes,
      count(*) filter (where fecha_vencimiento < p_hoy)::int as vencidas,
      round(sum(saldo), 2)::numeric as adeudado,
      round(coalesce(sum(saldo) filter (where fecha_vencimiento < p_hoy), 0), 2)::numeric as vencido,
      min(fecha_vencimiento) filter (where fecha_vencimiento >= p_hoy) as proximo_vencimiento,
      min(fecha_vencimiento) filter (where fecha_vencimiento < p_hoy) as vencida_desde,
      count(distinct id_venta)::int as planes,
      min(fecha_vencimiento) as min_fecha_vencimiento
    from cuotas_filtradas
    where estado in ('pendiente', 'parcial')
    group by id_cliente, nombre, apellido, nombre_completo, telefono
  ),
  deudores_ordenados as (
    select
      id_cliente,
      vencido,
      adeudado,
      min_fecha_vencimiento,
      jsonb_build_object(
        'id_cliente', id_cliente,
        'cliente', jsonb_build_object(
          'id_cliente', id_cliente,
          'nombre', nombre,
          'apellido', apellido,
          'nombre_completo', nombre_completo,
          'telefono', telefono
        ),
        'pendientes', pendientes,
        'vencidas', vencidas,
        'adeudado', adeudado,
        'vencido', vencido,
        'proximo_vencimiento', proximo_vencimiento,
        'vencida_desde', vencida_desde,
        'planes', planes
      ) as fila_json
    from deudores_agg
  ),
  totales_cuotas as (
    select
      count(*)::int as total_filas,
      round(coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial')), 0), 2)::numeric as a_cobrar,
      round(coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial') and fecha_vencimiento = p_hoy), 0), 2)::numeric as vence_hoy,
      round(coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial') and fecha_vencimiento = v_manana), 0), 2)::numeric as vence_manana,
      round(coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial') and fecha_vencimiento >= p_hoy and fecha_vencimiento <= v_fin_mes), 0), 2)::numeric as vence_este_mes,
      round(coalesce(sum(saldo) filter (where estado in ('pendiente', 'parcial') and fecha_vencimiento < p_hoy), 0), 2)::numeric as vencido,
      round(coalesce(sum(saldo) filter (where estado = 'incobrable'), 0), 2)::numeric as incobrable
    from cuotas_filtradas
  ),
  totales_clientes as (
    select
      count(*)::int as clientes_con_deuda,
      count(*) filter (where vencidas > 0)::int as clientes_vencidos
    from deudores_agg
  )
  select
    jsonb_build_object(
      'rows', coalesce((select jsonb_agg(fila_json order by vencido desc, adeudado desc, min_fecha_vencimiento asc, id_cliente asc) from deudores_ordenados), '[]'::jsonb),
      'resumen', jsonb_build_object(
        'aCobrar', tc.a_cobrar,
        'venceHoy', tc.vence_hoy,
        'venceManana', tc.vence_manana,
        'venceEsteMes', tc.vence_este_mes,
        'vencido', tc.vencido,
        'incobrable', tc.incobrable,
        'clientesConDeuda', tcli.clientes_con_deuda,
        'clientesVencidos', tcli.clientes_vencidos,
        'filas', tc.total_filas
      )
    )
  into v_resultado
  from totales_cuotas tc
  cross join totales_clientes tcli;

  return v_resultado;
end;
$$;

grant execute on function rf_deudores_resumen(date, text, date, date, text) to authenticated;
