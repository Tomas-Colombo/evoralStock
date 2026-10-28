-- 00116_logo_tenant_storage.sql
-- UP: El logo del tenant pasa a Storage (bucket `tenant-logos`, carpeta
--     `<id_tenant>/`) en vez de un data URL base64 en `tenant.logo_url`.
--     El base64 superaba el límite de 1 MB de Server Actions, viajaba en cada
--     `sp_session_context` y se copiaba entero en `auditoria`.
--     - Bucket con tope de 512 KB y solo PNG/JPEG/WebP: un SVG servido desde el
--       origen de Storage ejecuta script si alguien abre la URL directo.
--     - Policies de `storage.objects` por tenant (claim `tenant_id`), sin
--       service role: el DAL sube con el cliente del usuario, igual que el
--       resto de las escrituras.
--     - `sp_set_tenant_logo` solo acepta null o una URL de la carpeta del propio
--       tenant en el bucket.
--     - `tenant_update_own` (00114) dejaba que cualquier sesión actualizara
--       cualquier columna de su fila de `tenant` (subdominio, nombre…) por
--       PostgREST. Ahora `authenticated` solo puede escribir `logo_url` y
--       `updated_at`.
-- DOWN:
-- revoke update (logo_url, updated_at) on tenant from authenticated;
-- grant update on tenant to authenticated;
-- drop policy if exists tenant_logos_select on storage.objects;
-- drop policy if exists tenant_logos_insert on storage.objects;
-- drop policy if exists tenant_logos_update on storage.objects;
-- drop policy if exists tenant_logos_delete on storage.objects;
-- update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'tenant-logos';
-- create or replace function sp_set_tenant_logo(
--   p_logo_url text,
--   p_ip       inet default null
-- ) returns text language plpgsql security invoker set search_path = public as $$
-- declare
--   v_tenant uuid := auth_tenant_id();
--   v_actor  uuid := auth.uid();
-- begin
--   if v_tenant is null then
--     raise exception 'no-tenant' using errcode = '42501';
--   end if;
--   update tenant
--      set logo_url = p_logo_url,
--          updated_at = now()
--    where id_tenant = v_tenant;
--   insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
--   values (v_tenant, v_actor, 'tenant', v_tenant::text, 'actualizar_logo',
--           jsonb_build_object('logo_url', p_logo_url), p_ip);
--   return p_logo_url;
-- end $$;
-- NOTE: si storage está apagado (no existe storage.objects) las líneas de
-- NOTE: policies y bucket fallan; en ese caso se omiten a mano.

-- Columnas de `tenant` que una sesión puede escribir. El resto lo administra
-- el service role (provisión) y nunca una sesión de operador.
revoke update on tenant from authenticated;
grant update (logo_url, updated_at) on tenant to authenticated;

-- Storage puede estar apagado (00109 lo daba por apagado en local y CI): todo
-- lo de storage va detrás de `to_regclass`, igual que la creación del bucket.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('tenant-logos', 'tenant-logos', true, 524288,
            array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public             = true,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;

  if to_regclass('storage.objects') is not null then
    -- `auth_revendedora_id() is null`: la revendedora tiene sesión con el
    -- mismo claim `tenant_id`, pero no administra la marca del negocio.
    execute $p$drop policy if exists tenant_logos_select on storage.objects$p$;
    execute $p$create policy tenant_logos_select on storage.objects for select to authenticated
      using (bucket_id = 'tenant-logos'
             and (storage.foldername(name))[1] = public.auth_tenant_id()::text
             and public.auth_revendedora_id() is null)$p$;

    execute $p$drop policy if exists tenant_logos_insert on storage.objects$p$;
    execute $p$create policy tenant_logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'tenant-logos'
                  and (storage.foldername(name))[1] = public.auth_tenant_id()::text
                  and public.auth_revendedora_id() is null)$p$;

    execute $p$drop policy if exists tenant_logos_update on storage.objects$p$;
    execute $p$create policy tenant_logos_update on storage.objects for update to authenticated
      using (bucket_id = 'tenant-logos'
             and (storage.foldername(name))[1] = public.auth_tenant_id()::text
             and public.auth_revendedora_id() is null)
      with check (bucket_id = 'tenant-logos'
                  and (storage.foldername(name))[1] = public.auth_tenant_id()::text
                  and public.auth_revendedora_id() is null)$p$;

    execute $p$drop policy if exists tenant_logos_delete on storage.objects$p$;
    execute $p$create policy tenant_logos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'tenant-logos'
             and (storage.foldername(name))[1] = public.auth_tenant_id()::text
             and public.auth_revendedora_id() is null)$p$;
  end if;
end $$;

-- Copiada de 00114. Cambia solo la validación de `p_logo_url`: el host no se
-- chequea (no se conoce desde SQL), pero la ruta ata la URL a la carpeta del
-- propio tenant y deja afuera los data URL que inflaban sesión y auditoría.
create or replace function sp_set_tenant_logo(
  p_logo_url text,
  p_ip       inet default null
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_actor  uuid := auth.uid();
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;

  if p_logo_url is not null and (
       length(p_logo_url) > 1000
       or p_logo_url !~ '^https?://'
       or strpos(p_logo_url, '/storage/v1/object/public/tenant-logos/' || v_tenant::text || '/') = 0
     ) then
    raise exception 'logo-invalido' using errcode = '22023';
  end if;

  update tenant
     set logo_url = p_logo_url,
         updated_at = now()
   where id_tenant = v_tenant;

  insert into auditoria(id_tenant, id_usuario, entidad, entidad_id, accion, cambios, ip)
  values (v_tenant, v_actor, 'tenant', v_tenant::text, 'actualizar_logo',
          jsonb_build_object('logo_url', p_logo_url), p_ip);

  return p_logo_url;
end $$;

grant execute on function sp_set_tenant_logo(text, inet) to authenticated;
