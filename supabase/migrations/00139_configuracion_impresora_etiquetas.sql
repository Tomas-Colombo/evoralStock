-- 00139_configuracion_impresora_etiquetas.sql
-- Tamaño de página de la impresora de etiquetas por tenant (ancho y alto en mm,
-- ambos opcionales). Vive en `configuracion` junto a etiquetas/qr_lado_mm.
-- NULL borra la clave: esa dimensión vuelve a la de una hoja A4.
--
-- DOWN:
-- drop function if exists sp_set_configuracion_impresora(integer, integer, inet);
-- delete from configuracion where seccion = 'etiquetas' and clave in ('impresora_ancho_mm', 'impresora_alto_mm');

create or replace function sp_set_configuracion_impresora(
  p_ancho_mm integer,
  p_alto_mm  integer,
  p_ip       inet default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if (p_ancho_mm is not null and (p_ancho_mm < 20 or p_ancho_mm > 300))
     or (p_alto_mm is not null and (p_alto_mm < 20 or p_alto_mm > 300)) then
    raise exception 'impresora-medida-invalida' using errcode = '22023';
  end if;

  if p_ancho_mm is null then
    delete from configuracion
     where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_ancho_mm';
  else
    insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
    values (v_tenant, 'etiquetas', 'impresora_ancho_mm', to_jsonb(p_ancho_mm), 'number', now())
    on conflict (id_tenant, seccion, clave)
    do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
  end if;

  if p_alto_mm is null then
    delete from configuracion
     where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_alto_mm';
  else
    insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
    values (v_tenant, 'etiquetas', 'impresora_alto_mm', to_jsonb(p_alto_mm), 'number', now())
    on conflict (id_tenant, seccion, clave)
    do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
  end if;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'configuracion', 'etiquetas:impresora', 'actualizar',
          jsonb_build_object('impresora_ancho_mm', p_ancho_mm, 'impresora_alto_mm', p_alto_mm), p_ip);
end $$;
