-- 00151_transicion_item_devuelto.sql
-- Restaura la transición de 'devuelto' hacia 'disponible' y 'baja' en is_transicion_item_valida.
--
-- 00054 habilitó esta transición para que sp_eliminar_consignacion pudiera reestockear ítems devueltos;
-- 00062 reescribió la función desde una versión anterior y la perdió, y 00082 y 00090 heredaron el error.
-- Desde entonces, eliminar una consignación con ítems devueltos falla con invalid-transition.
-- La cabecera de 00062 afirma que devuelto es terminal, pero partía de 00016 e ignoró 00054; esa afirmación queda superada acá.

create or replace function is_transicion_item_valida(
  p_desde estado_item, p_hasta estado_item
) returns boolean language sql immutable as $$
  select case
    when p_desde = 'disponible'       and p_hasta in ('reservado', 'vendido', 'devuelto', 'baja', 'en_revendedora') then true
    when p_desde = 'reservado'        and p_hasta in ('disponible', 'vendido', 'baja') then true
    when p_desde = 'vendido'          and p_hasta in ('disponible', 'devuelto_cliente', 'devuelto', 'baja', 'en_revendedora') then true
    when p_desde = 'devuelto'         and p_hasta in ('disponible', 'baja') then true
    when p_desde = 'devuelto_cliente' and p_hasta in ('disponible', 'baja') then true
    when p_desde = 'en_revendedora'   and p_hasta in ('disponible', 'vendido', 'devuelto', 'baja') then true
    else false
  end;
$$;

grant execute on function is_transicion_item_valida(estado_item, estado_item) to authenticated;

-- DOWN:
-- NOTE: Restaura la definición de 00090_anular_venta_revendedora.sql (sin transición desde 'devuelto')
-- create or replace function is_transicion_item_valida(
--   p_desde estado_item, p_hasta estado_item
-- ) returns boolean language sql immutable as $$
--   select case
--     when p_desde = 'disponible'       and p_hasta in ('reservado', 'vendido', 'devuelto', 'baja', 'en_revendedora') then true
--     when p_desde = 'reservado'        and p_hasta in ('disponible', 'vendido', 'baja') then true
--     when p_desde = 'vendido'          and p_hasta in ('disponible', 'devuelto_cliente', 'devuelto', 'baja', 'en_revendedora') then true
--     when p_desde = 'devuelto_cliente' and p_hasta in ('disponible', 'baja') then true
--     when p_desde = 'en_revendedora'   and p_hasta in ('disponible', 'vendido', 'devuelto', 'baja') then true
--     else false
--   end;
-- $$;
-- grant execute on function is_transicion_item_valida(estado_item, estado_item) to authenticated;
