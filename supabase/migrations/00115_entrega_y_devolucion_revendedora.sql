-- 00115_entrega_y_devolucion_revendedora.sql
-- Entregar mercadería a una revendedora y recibirla de vuelta en un paso.
--
-- La pantalla de asignación creaba la consignación en borrador y obligaba a
-- confirmarla en otra pantalla; si la UI encadenaba las dos llamadas, un fallo
-- entre ambas dejaba un borrador colgado. sp_entregar_consignacion_revendedora
-- hace las dos cosas en una sola transacción.
--
-- La devolución vivía dentro de cada consignación: para recibir lo que trae
-- una revendedora había que saber de qué lote salió cada pieza.
-- sp_devolver_items_revendedora recibe los ítems de la revendedora, los agrupa
-- por consignación y reutiliza sp_registrar_devolucion_revendedora.
--
-- Ambas son INVOKER: las validaciones y el aislamiento por tenant siguen
-- viviendo en los SP que reutilizan.
--
-- UP:
--   1. sp_entregar_consignacion_revendedora(p_id_revendedora, p_items,
--      p_periodo_desde, p_periodo_hasta, p_observaciones, p_motivo, p_ip).
--   2. sp_devolver_items_revendedora(p_id_revendedora, p_items,
--      p_estado_destino, p_motivo, p_ip).
--
-- DOWN:
-- drop function if exists sp_devolver_items_revendedora(uuid, uuid[], estado_item, text, inet);
-- drop function if exists sp_entregar_consignacion_revendedora(uuid, uuid[], date, date, text, text, inet);

create or replace function sp_entregar_consignacion_revendedora(
  p_id_revendedora uuid,
  p_items          uuid[],
  p_periodo_desde  date default null,
  p_periodo_hasta  date default null,
  p_observaciones  text default null,
  p_motivo         text default null,
  p_ip             inet default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := sp_crear_consignacion_revendedora_con_items(
    p_id_revendedora, p_items, p_periodo_desde, p_periodo_hasta,
    p_observaciones, p_motivo, p_ip
  );
  perform sp_confirmar_consignacion_revendedora(v_id, p_ip);
  return v_id;
end $$;

create or replace function sp_devolver_items_revendedora(
  p_id_revendedora uuid,
  p_items          uuid[],
  p_estado_destino estado_item default 'disponible',
  p_motivo         text default null,
  p_ip             inet default null
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_items  uuid[];
  v_grupo  record;
  v_count  integer := 0;
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_id_revendedora is null then
    raise exception 'revendedora-requerida' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_items
    from unnest(coalesce(p_items, '{}')) as x
   where x is not null;

  if coalesce(array_length(v_items, 1), 0) = 0 then
    raise exception 'items-vacios' using errcode = '22023';
  end if;

  if not exists (
    select 1 from revendedora
     where id_revendedora = p_id_revendedora and id_tenant = v_tenant
  ) then
    raise exception 'revendedora-not-found' using errcode = '42704';
  end if;

  -- Todo o nada: un ítem ajeno no puede colarse en la devolución de otra.
  if exists (
    select 1
      from unnest(v_items) as x
     where not exists (
       select 1
         from consignacion_revendedora_detalle d
         join consignacion_revendedora c
           on c.id_consignacion_revendedora = d.id_consignacion_revendedora
        where d.id_item = x
          and d.id_tenant = v_tenant
          and d.estado_detalle = 'en_poder'
          and c.id_revendedora = p_id_revendedora
     )
  ) then
    raise exception 'item-no-en-poder-revendedora' using errcode = '22023';
  end if;

  for v_grupo in
    select d.id_consignacion_revendedora as id_consig,
           array_agg(d.id_item order by d.id_item) as items
      from consignacion_revendedora_detalle d
      join consignacion_revendedora c
        on c.id_consignacion_revendedora = d.id_consignacion_revendedora
     where d.id_item = any(v_items)
       and d.id_tenant = v_tenant
       and d.estado_detalle = 'en_poder'
       and c.id_revendedora = p_id_revendedora
     group by d.id_consignacion_revendedora
     order by d.id_consignacion_revendedora
  loop
    v_count := v_count + sp_registrar_devolucion_revendedora(
      v_grupo.id_consig, v_grupo.items, p_estado_destino, p_motivo, p_ip
    );
  end loop;

  return v_count;
end $$;

grant execute on function sp_entregar_consignacion_revendedora(uuid, uuid[], date, date, text, text, inet) to authenticated;
grant execute on function sp_devolver_items_revendedora(uuid, uuid[], estado_item, text, inet) to authenticated;
