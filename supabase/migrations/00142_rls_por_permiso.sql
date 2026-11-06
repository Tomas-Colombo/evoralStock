-- 00142_rls_por_permiso.sql
-- Policies RLS restrictivas por permiso para tablas exclusivas (Fase 4, REQ-RLSP-02..05).
--
-- DOWN:
-- drop policy if exists rlsp_gasto_negocio_select on gasto_negocio;
-- drop policy if exists rlsp_gasto_negocio_insert on gasto_negocio;
-- drop policy if exists rlsp_gasto_negocio_update on gasto_negocio;
-- drop policy if exists rlsp_gasto_negocio_delete on gasto_negocio;
-- drop policy if exists rlsp_categoria_gasto_select on categoria_gasto;
-- drop policy if exists rlsp_categoria_gasto_insert on categoria_gasto;
-- drop policy if exists rlsp_categoria_gasto_update on categoria_gasto;
-- drop policy if exists rlsp_categoria_gasto_delete on categoria_gasto;
-- drop policy if exists rlsp_rendicion_proveedor_select on rendicion_proveedor;
-- drop policy if exists rlsp_rendicion_proveedor_insert on rendicion_proveedor;
-- drop policy if exists rlsp_rendicion_proveedor_update on rendicion_proveedor;
-- drop policy if exists rlsp_rendicion_proveedor_delete on rendicion_proveedor;
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_select on ingreso_mercaderia_detalle;
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_insert on ingreso_mercaderia_detalle;
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle;
-- drop policy if exists rlsp_ingreso_mercaderia_detalle_delete on ingreso_mercaderia_detalle;

-- 1. gasto_negocio (REQ-RLSP-02)
create policy rlsp_gasto_negocio_select on gasto_negocio as restrictive for select to authenticated
  using ((select auth_tiene_permiso('gastos', 'ver')) or (select auth_tiene_permiso('reportes', 'ver')));

create policy rlsp_gasto_negocio_insert on gasto_negocio as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('gastos', 'crear')));

create policy rlsp_gasto_negocio_update on gasto_negocio as restrictive for update to authenticated
  using (false)
  with check (false);

create policy rlsp_gasto_negocio_delete on gasto_negocio as restrictive for delete to authenticated
  using ((select auth_tiene_permiso('gastos', 'editar')));

-- 2. categoria_gasto (REQ-RLSP-03)
create policy rlsp_categoria_gasto_select on categoria_gasto as restrictive for select to authenticated
  using ((select auth_tiene_permiso('gastos', 'ver')) or (select auth_tiene_permiso('reportes', 'ver')));

create policy rlsp_categoria_gasto_insert on categoria_gasto as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('gastos', 'crear')));

create policy rlsp_categoria_gasto_update on categoria_gasto as restrictive for update to authenticated
  using ((select auth_tiene_permiso('gastos', 'editar')))
  with check ((select auth_tiene_permiso('gastos', 'editar')));

create policy rlsp_categoria_gasto_delete on categoria_gasto as restrictive for delete to authenticated
  using ((select auth_tiene_permiso('gastos', 'editar')));

-- 3. rendicion_proveedor (REQ-RLSP-04)
create policy rlsp_rendicion_proveedor_select on rendicion_proveedor as restrictive for select to authenticated
  using ((select auth_tiene_permiso('rendiciones', 'ver')) or (select auth_tiene_permiso('inventario', 'ver')) or (select auth_tiene_permiso('reportes', 'ver')));

create policy rlsp_rendicion_proveedor_insert on rendicion_proveedor as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('rendiciones', 'crear')));

create policy rlsp_rendicion_proveedor_update on rendicion_proveedor as restrictive for update to authenticated
  using ((select auth_tiene_permiso('rendiciones', 'crear')) or (select auth_tiene_permiso('rendiciones', 'editar')))
  with check ((select auth_tiene_permiso('rendiciones', 'crear')) or (select auth_tiene_permiso('rendiciones', 'editar')));

create policy rlsp_rendicion_proveedor_delete on rendicion_proveedor as restrictive for delete to authenticated
  using (false);

-- 4. ingreso_mercaderia_detalle (REQ-RLSP-05)
create policy rlsp_ingreso_mercaderia_detalle_select on ingreso_mercaderia_detalle as restrictive for select to authenticated
  using ((select auth_tiene_permiso('inventario', 'ver')) or (select auth_tiene_permiso('reportes', 'ver')));

create policy rlsp_ingreso_mercaderia_detalle_insert on ingreso_mercaderia_detalle as restrictive for insert to authenticated
  with check ((select auth_tiene_permiso('inventario', 'crear')));

create policy rlsp_ingreso_mercaderia_detalle_update on ingreso_mercaderia_detalle as restrictive for update to authenticated
  using (false)
  with check (false);

create policy rlsp_ingreso_mercaderia_detalle_delete on ingreso_mercaderia_detalle as restrictive for delete to authenticated
  using ((select auth_tiene_permiso('inventario', 'editar')) or (select auth_tiene_permiso('inventario', 'eliminar')));
