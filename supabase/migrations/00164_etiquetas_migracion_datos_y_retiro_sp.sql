-- 00164_etiquetas_migracion_datos_y_retiro_sp.sql
-- UP: Migración de datos desde configuracion a etiqueta_config y etiqueta_plantilla (REQ-ETQ-07)
--     y retiro de claves de configuracion y SPs viejos sp_set_configuracion_qr_lado_mm y sp_set_configuracion_impresora (D-ETQ-03).
--
-- DOWN:
--   -- 1. Restaurar sp_set_configuracion_qr_lado_mm (vigente en 00149)
--   create or replace function sp_set_configuracion_qr_lado_mm(
--     p_lado_mm integer,
--     p_ip      inet default null
--   ) returns integer language plpgsql security invoker set search_path = public as $$
--   declare
--     v_tenant uuid := auth_tenant_id();
--     v_actor  uuid := auth.uid();
--   begin
--     if not (select auth_tiene_permiso('administracion', 'editar')) then
--       raise exception 'no-permission' using errcode = '42501';
--     end if;
--     if v_tenant is null then
--       raise exception 'no-tenant' using errcode = '42501';
--     end if;
--     if p_lado_mm is null or p_lado_mm < 15 or p_lado_mm > 100 then
--       raise exception 'qr-lado-mm-invalido' using errcode = '22023';
--     end if;
--     insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--     values (v_tenant, 'etiquetas', 'qr_lado_mm', to_jsonb(p_lado_mm), 'number', now())
--     on conflict (id_tenant, seccion, clave)
--     do update set valor = excluded.valor,
--                   tipo = excluded.tipo,
--                   updated_at = now();
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (v_tenant, v_actor, 'configuracion', 'etiquetas:qr_lado_mm', 'actualizar',
--             jsonb_build_object('qr_lado_mm', p_lado_mm), p_ip);
--     return p_lado_mm;
--   end $$;
--   revoke all on function sp_set_configuracion_qr_lado_mm(integer, inet) from anon, public;
--   grant execute on function sp_set_configuracion_qr_lado_mm(integer, inet) to authenticated;
--
--   -- 2. Restaurar sp_set_configuracion_impresora (vigente en 00149)
--   create or replace function sp_set_configuracion_impresora(
--     p_ancho_mm integer,
--     p_alto_mm  integer,
--     p_ip       inet default null
--   ) returns void language plpgsql security invoker set search_path = public as $$
--   declare
--     v_tenant uuid := auth_tenant_id();
--     v_actor  uuid := auth.uid();
--   begin
--     if not (select auth_tiene_permiso('administracion', 'editar')) then
--       raise exception 'no-permission' using errcode = '42501';
--     end if;
--     if v_tenant is null then
--       raise exception 'no-tenant' using errcode = '42501';
--     end if;
--     if (p_ancho_mm is not null and (p_ancho_mm < 20 or p_ancho_mm > 300))
--        or (p_alto_mm is not null and (p_alto_mm < 20 or p_alto_mm > 300)) then
--       raise exception 'impresora-medida-invalida' using errcode = '22023';
--     end if;
--     if p_ancho_mm is null then
--       delete from configuracion
--        where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_ancho_mm';
--     else
--       insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--       values (v_tenant, 'etiquetas', 'impresora_ancho_mm', to_jsonb(p_ancho_mm), 'number', now())
--       on conflict (id_tenant, seccion, clave)
--       do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
--     end if;
--     if p_alto_mm is null then
--       delete from configuracion
--        where id_tenant = v_tenant and seccion = 'etiquetas' and clave = 'impresora_alto_mm';
--     else
--       insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--       values (v_tenant, 'etiquetas', 'impresora_alto_mm', to_jsonb(p_alto_mm), 'number', now())
--       on conflict (id_tenant, seccion, clave)
--       do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
--     end if;
--     insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--     values (v_tenant, v_actor, 'configuracion', 'etiquetas:impresora', 'actualizar',
--             jsonb_build_object('impresora_ancho_mm', p_ancho_mm, 'impresora_alto_mm', p_alto_mm), p_ip);
--   end $$;
--   revoke all on function sp_set_configuracion_impresora(integer, integer, inet) from anon, public;
--   grant execute on function sp_set_configuracion_impresora(integer, integer, inet) to authenticated;
--
--   -- 3. Restaurar configuracion desde etiqueta_config y etiqueta_plantilla
--   insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--   select p.id_tenant, 'etiquetas', 'impresora_ancho_mm', to_jsonb(p.ancho_mm::integer), 'number', now()
--     from etiqueta_plantilla p
--     join etiqueta_config c on c.id_tenant = p.id_tenant
--    where p.predeterminada = true and c.impresora_tipo = 'rollo'
--   on conflict (id_tenant, seccion, clave) do update set valor = excluded.valor;
--
--   insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--   select p.id_tenant, 'etiquetas', 'impresora_alto_mm', to_jsonb(p.alto_mm::integer), 'number', now()
--     from etiqueta_plantilla p
--     join etiqueta_config c on c.id_tenant = p.id_tenant
--    where p.predeterminada = true and c.impresora_tipo = 'rollo'
--   on conflict (id_tenant, seccion, clave) do update set valor = excluded.valor;
--
--   insert into configuracion (id_tenant, seccion, clave, valor, tipo, updated_at)
--   select p.id_tenant, 'etiquetas', 'qr_lado_mm',
--          to_jsonb(greatest(15, least(100, round(p.alto_mm - 12)))::integer),
--          'number', now()
--     from etiqueta_plantilla p
--     join etiqueta_config c on c.id_tenant = p.id_tenant
--    where p.predeterminada = true and c.impresora_tipo = 'hoja'
--   on conflict (id_tenant, seccion, clave) do update set valor = excluded.valor;

-- ─── 1. Migración de datos ───────────────────────────────────────────
do $$
declare
  v_tenant record;
  v_ancho  numeric;
  v_alto   numeric;
  v_lado   numeric;
  v_tipo   text;
  v_p_ancho numeric;
  v_p_alto  numeric;
begin
  for v_tenant in select id_tenant from tenant loop
    -- Leer configuracion existente
    select (valor#>>'{}')::numeric into v_ancho
      from configuracion
     where id_tenant = v_tenant.id_tenant and seccion = 'etiquetas' and clave = 'impresora_ancho_mm';

    select (valor#>>'{}')::numeric into v_alto
      from configuracion
     where id_tenant = v_tenant.id_tenant and seccion = 'etiquetas' and clave = 'impresora_alto_mm';

    select (valor#>>'{}')::numeric into v_lado
      from configuracion
     where id_tenant = v_tenant.id_tenant and seccion = 'etiquetas' and clave = 'qr_lado_mm';

    if v_ancho is not null and v_alto is not null then
      v_tipo    := 'rollo';
      v_p_ancho := v_ancho;
      v_p_alto  := v_alto;
    else
      v_tipo    := 'hoja';
      v_lado    := coalesce(v_lado, 35);
      v_p_ancho := round(v_lado + 2, 2);  -- QR + 2 * 1mm padding
      v_p_alto  := round(v_lado + 12, 2); -- QR + padding + espacio de texto (~12mm)
    end if;

    -- Clamp de seguridad a los rangos permitidos (ancho: 15..300, alto: 10..300)
    v_p_ancho := greatest(15, least(300, v_p_ancho));
    v_p_alto  := greatest(10, least(300, v_p_alto));

    -- Crear etiqueta_config si no existe
    insert into etiqueta_config (id_tenant, metodo, impresora_tipo, margen_mm, separacion_mm, columnas, offset_x_mm, offset_y_mm)
    values (v_tenant.id_tenant, 'qr', v_tipo, 10, 2, null, 0, 0)
    on conflict (id_tenant) do nothing;

    -- Crear plantilla Predeterminada si no existe ninguna plantilla para el tenant
    if not exists (select 1 from etiqueta_plantilla where id_tenant = v_tenant.id_tenant) then
      insert into etiqueta_plantilla (
        id_tenant, nombre, ancho_mm, alto_mm,
        mostrar_nombre, mostrar_talle, mostrar_sku, mostrar_texto_codigo,
        predeterminada
      )
      values (
        v_tenant.id_tenant, 'Predeterminada', v_p_ancho, v_p_alto,
        true, true, true, true,
        true
      );
    end if;
  end loop;
end;
$$;

-- ─── 2. Retiro de claves de configuracion ─────────────────────────────
delete from configuracion
 where seccion = 'etiquetas'
   and clave in ('qr_lado_mm', 'impresora_ancho_mm', 'impresora_alto_mm');

-- ─── 3. Retiro de stored procedures viejos ────────────────────────────
drop function if exists sp_set_configuracion_qr_lado_mm(integer, inet);
drop function if exists sp_set_configuracion_impresora(integer, integer, inet);
