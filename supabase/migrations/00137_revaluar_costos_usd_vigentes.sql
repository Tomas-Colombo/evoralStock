-- Migration: 00137_revaluar_costos_usd_vigentes.sql
-- Description: Rechazar revaluación con cotización desactualizada y omitir productos sin cambio de cotización

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
  v_id_costo               uuid;
  v_costo_nuevo            numeric;
begin
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

    -- Cerrar costo vigente anterior
    update costo_producto
       set vigente_hasta = now()
     where id_costo = r.id_costo;

    -- Insertar nuevo costo vigente con cotización actualizada y el mismo costo_original_usd
    insert into costo_producto (
      id_tenant, id_producto, costo, moneda,
      id_usuario_alta, motivo,
      costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
    ) values (
      v_tenant, r.id_producto, v_costo_nuevo, 'USD',
      v_actor, 'revaluacion masiva usd',
      r.costo_original_usd, v_valor, v_fecha_valor
    )
    returning id_costo into v_id_costo;

    -- Marcar precio desactualizado en producto
    perform sp_marcar_precio_desactualizado_by_producto(r.id_producto);

    -- Auditoría por producto revaluado
    insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
    values (
      v_tenant, v_actor, 'costo_producto', v_id_costo::text, 'revaluar',
      jsonb_build_object(
        'id_producto', r.id_producto,
        'costo_anterior', r.costo,
        'costo_nuevo', v_costo_nuevo,
        'costo_original_usd', r.costo_original_usd,
        'cotizacion_anterior', r.cotizacion_aplicada,
        'cotizacion_nueva', v_valor,
        'cotizacion_fecha_valor', v_fecha_valor
      ),
      p_ip
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

revoke all on function sp_revaluar_costos_usd_vigentes(inet) from public, anon;
grant execute on function sp_revaluar_costos_usd_vigentes(inet) to authenticated;

-- DOWN:
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
--   v_revaluados             integer := 0;
--   v_omitidos_sin_original  integer := 0;
--   r                        record;
--   v_id_costo               uuid;
--   v_costo_nuevo            numeric;
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
-- 
--   v_cotizacion := sp_get_cotizacion_vigente();
--   v_valor := nullif(v_cotizacion->>'valor', '')::numeric;
--   v_fecha_valor := nullif(v_cotizacion->>'fecha_valor', '')::date;
-- 
--   if v_valor is null or v_valor <= 0 or v_fecha_valor is null then
--     raise exception 'sin-cotizacion-dolar' using errcode = '22023';
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
--     select id_costo, id_producto, costo, costo_original_usd
--       from costo_producto
--      where id_tenant = v_tenant
--        and vigente_hasta is null
--        and moneda = 'USD'
--        and costo_original_usd is not null
--      for update
--   loop
--     v_costo_nuevo := round(r.costo_original_usd * v_valor, 2);
-- 
--     -- Cerrar costo vigente anterior
--     update costo_producto
--        set vigente_hasta = now()
--      where id_costo = r.id_costo;
-- 
--     -- Insertar nuevo costo vigente con cotización actualizada y el mismo costo_original_usd
--     insert into costo_producto (
--       id_tenant, id_producto, costo, moneda,
--       id_usuario_alta, motivo,
--       costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
--     ) values (
--       v_tenant, r.id_producto, v_costo_nuevo, 'USD',
--       v_actor, 'revaluacion masiva usd',
--       r.costo_original_usd, v_valor, v_fecha_valor
--     )
--     returning id_costo into v_id_costo;
-- 
--     -- Marcar precio desactualizado en producto
--     perform sp_marcar_precio_desactualizado_by_producto(r.id_producto);
-- 
--     -- Auditoría por producto revaluado
--     insert into auditoria (id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (
--       v_tenant, v_actor, 'costo_producto', v_id_costo::text, 'revaluar',
--       jsonb_build_object(
--         'id_producto', r.id_producto,
--         'costo_anterior', r.costo,
--         'costo_nuevo', v_costo_nuevo,
--         'costo_original_usd', r.costo_original_usd,
--         'cotizacion_nueva', v_valor,
--         'cotizacion_fecha_valor', v_fecha_valor
--       ),
--       p_ip
--     );
-- 
--     v_revaluados := v_revaluados + 1;
--   end loop;
-- 
--   return jsonb_build_object(
--     'revaluados', v_revaluados,
--     'omitidos_sin_original', v_omitidos_sin_original
--   );
-- end;
-- $$;
-- 
-- revoke all on function sp_revaluar_costos_usd_vigentes(inet) from public, anon;
-- grant execute on function sp_revaluar_costos_usd_vigentes(inet) to authenticated;
