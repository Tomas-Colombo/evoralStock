# Inventario de RLS, Privilegios, Escritores y Lectores — public

Fecha de relevamiento: 2026-11-13 (verificado contra PostgreSQL local y código fuente).
Metodología: 100% generado a partir de consultas al catálogo PostgreSQL (`pg_class`, `pg_tables`, `pg_policies`, `has_table_privilege`), análisis estático de migraciones vivas (`scripts/sp-parser.mts`) y análisis estricto de mutaciones en `lib/dal/**` y `app/**`. La evidencia de comandos ejecutados se encuentra en el [Apéndice de Comandos y Evidencia](#apéndice-de-comandos-y-evidencia).

---

## 1. Resumen Ejecutivo de la Superficie de Ataque

1. **Grants a `anon`**: De las 56 tablas base en `public`, **51 tablas otorgan SELECT a `anon`**, y **48 tablas otorgan INSERT, UPDATE y DELETE a `anon`**. Solo las 3 tablas de superadmin (`superadmin`, `tenant_cargo`, `tenant_pago`) y 5 tablas creadas recientemente (`consulta_ayuda`, `cotizacion_config`, `cotizacion_dolar`, satélites de costo) tienen los grants de `anon` revocados.
2. **Grants a `authenticated`**: **53 tablas base otorgan SELECT, INSERT, UPDATE y DELETE a `authenticated`**.
3. **Estado de RLS**: Las 56 tablas base tienen `rowsecurity = true`. Sin embargo, solo **8 tablas** tienen un cierre completo de RLS restrictivo por permiso para los 4 comandos (SELECT, INSERT, UPDATE, DELETE): `categoria_gasto`, `gasto_negocio`, `ingreso_detalle_costo`, `ingreso_mercaderia_detalle`, `item_costo`, `rendicion_proveedor`, `rol` y `usuario`.
4. **Cierre parcial (solo SELECT)**: **6 tablas** (`auditoria`, `costo_producto`, `detalle_venta_costo`, `detalle_venta_rendicion`, `devolucion_venta_costo`, `regla_precio`) tienen policy restrictiva de SELECT, pero en `costo_producto` y `regla_precio` la policy permisiva de tenant cubre `ALL`, permitiendo INSERT/UPDATE/DELETE arbitrario a cualquier usuario autenticado de ese tenant.
5. **Abiertas sin chequeo de permisos (42 tablas)**: 39 tablas de dominio + `tenant` + `tenant_modulo` + `auditoria` (para escrituras) solo filtran por `id_tenant = auth_tenant_id()` y `auth_revendedora_id() is null`. Un token con `tenant_id` y sin ningún permiso puede consultar clientes, ventas, pagos, cuotas, cuentas bancarias, etc.
6. **Escrituras Directas en `lib/dal` (13 tablas de dominio + 1 auth)**:
   - **12 tablas con cliente de usuario (`createServerClient`)**: `arancel_cobro`, `categoria`, `categoria_gasto`, `cliente`, `cuenta_destino`, `ingreso_detalle_costo`, `ingreso_mercaderia`, `ingreso_mercaderia_detalle`, `plan_cuotas`, `producto`, `proveedor`, `recargo_cuotas`.
   - **2 tablas con service client (`createServiceClient` / `admin`)**: `revendedora` (desvinculación de usuario), `usuario` (creación de operador y desactivación por desvinculación).
   - Estas 13 tablas de dominio requieren policies restrictivas explícitas de INSERT/UPDATE/DELETE para que el cliente autenticado no pueda ejecutar mutaciones arbitrarias fuera de los permisos del módulo (Decisión **D-RCD-01 = A**).
7. **Vistas de public**: Las 8 vistas existentes (`tenant_listado`, `tenant_movimiento`, `tenant_saldo`, `v_alerta_reposicion`, `v_alerta_rotacion_vencida`, `v_ganancia_por_producto`, `v_linea_venta`, `v_perfil_proveedor`) poseen la opción `security_invoker = true/on`.

---

## 2. Inventario Detallado por Entidad

### `arancel_cobro` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `arancel_cobro_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_arancel_cobro` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (3)*:
    - `lib/dal/ventas/arancel.ts:41` [insert] -> función `createArancelCobro` (cliente: `supabase` [user])
    - `lib/dal/ventas/arancel.ts:75` [update] -> función `updateArancelCobro` (cliente: `supabase` [user])
    - `lib/dal/ventas/arancel.ts:89` [update] -> función `toggleArancelCobroActivo` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/arancel.ts` -> función `listArancelesCobro` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/arancel.ts` -> función `createArancelCobro` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `auditoria` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (4)**:
  - `auditoria_insert_own` [PERMISSIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `auditoria_select_own` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_auditoria` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_auditoria_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('administracion'::text, 'ver'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_update_usuario, sp_change_password_user, sp_create_producto, sp_transicion_item_producto, sp_confirmar_ingreso, sp_recalcular_precio_venta, sp_create_regla_precio, sp_baja_regla_precio, sp_extender_vigencia_regla, sp_crear_reserva, sp_cancelar_reserva, sp_vencer_reservas, sp_registrar_venta, sp_anular_venta, sp_registrar_devolucion_cliente, sp_emitir_comprobante, sp_crear_consignacion, sp_agregar_item_consignacion, sp_cancelar_item_consignacion, sp_confirmar_salida_item, sp_cerrar_consignacion, sp_registrar_ajuste_inventario, sp_excluir_detalle_rendicion, sp_reincluir_detalle_rendicion, sp_generar_rendicion, sp_marcar_rendicion_pagada, sp_registrar_gasto, sp_set_presupuesto_categoria_gasto, sp_create_rol, sp_update_rol_permisos, sp_delete_rol, sp_toggle_tenant_modulo, sp_toggle_usuario_activo, sp_crear_stock_directo, sp_importar_remito, sp_cancelar_ingreso, sp_asignar_talles_a_producto, sp_eliminar_gasto, sp_crear_consignacion_con_items, sp_editar_consignacion, sp_confirmar_consignacion, sp_eliminar_consignacion, sp_cobrar_cuota, sp_marcar_cuota_incobrable, sp_crear_revendedora, sp_editar_revendedora, sp_baja_revendedora, sp_crear_consignacion_revendedora_con_items, sp_editar_consignacion_revendedora, sp_confirmar_consignacion_revendedora, sp_registrar_devolucion_revendedora, sp_cerrar_consignacion_revendedora, sp_eliminar_consignacion_revendedora, sp_crear_regla_comision, sp_terminar_regla_comision, sp_generar_liquidacion, sp_excluir_detalle_liquidacion, sp_reincluir_detalle_liquidacion, sp_marcar_liquidacion_pagada, sp_registrar_cambio, sp_confirmar_declaracion_venta, sp_rechazar_declaracion_venta, sp_set_configuracion_qr_lado_mm, sp_set_tenant_logo, sp_toggle_tenant_modulo_admin, sp_set_cotizacion_manual, sp_set_modo_cotizacion, sp_set_configuracion_impresora, sp_aplicar_ultimo_costo, sp_completar_costo_ingreso | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `listAuditoria` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `listEntidadesAuditoria` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `cambio_venta` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cambio_venta_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cambio_venta` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_cambio | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_cambio
  - *FOR UPDATE*: ninguna

### `categoria` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `categoria_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_categoria` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (3)*:
    - `lib/dal/inventario/categoria.ts:54` [insert] -> función `createCategoria` (cliente: `supabase` [user])
    - `lib/dal/inventario/categoria.ts:80` [update] -> función `updateCategoria` (cliente: `supabase` [user])
    - `lib/dal/inventario/categoria.ts:90` [update] -> función `toggleCategoriaActiva` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/categoria.ts` -> función `listCategorias` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/categoria.ts` -> función `listCategoriasActivas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/categoria.ts` -> función `getCategoria` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/categoria.ts` -> función `createCategoria` | Guardas consumidor: `inventario.editar`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `categoria_gasto` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `categoria_gasto_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_categoria_gasto` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_categoria_gasto_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('gastos'::text, 'editar'::text) AS auth_tiene_permiso)`
  - `rlsp_categoria_gasto_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('gastos'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_categoria_gasto_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('gastos'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('reportes'::text, 'ver'::text) AS auth_tiene_permiso))`
  - `rlsp_categoria_gasto_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('gastos'::text, 'editar'::text) AS auth_tiene_permiso)`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('gastos'::text, 'editar'::text) AS auth_tiene_permiso)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: sp_set_presupuesto_categoria_gasto | DELETE: ninguno
  - *Escrituras directas en lib/dal (5)*:
    - `lib/dal/gastos/gasto.ts:98` [insert] -> función `createCategoriaGasto` (cliente: `supabase` [user])
    - `lib/dal/gastos/gasto.ts:113` [update] -> función `renameCategoriaGasto` (cliente: `supabase` [user])
    - `lib/dal/gastos/gasto.ts:136` [delete] -> función `bajaCategoriaGasto (hard)` (cliente: `supabase` [user])
    - `lib/dal/gastos/gasto.ts:144` [update] -> función `bajaCategoriaGasto (soft)` (cliente: `supabase` [user])
    - `lib/dal/gastos/gasto.ts:154` [update] -> función `reactivarCategoriaGasto` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `listCategoriasGasto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `createCategoriaGasto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `listPresupuestoMes` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: sp_set_presupuesto_categoria_gasto

### `cliente` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cliente_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cliente` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (3)*:
    - `lib/dal/clientes/cliente.ts:103` [insert] -> función `createCliente` (cliente: `supabase` [user])
    - `lib/dal/clientes/cliente.ts:114` [update] -> función `updateCliente` (cliente: `supabase` [user])
    - `lib/dal/clientes/cliente.ts:120` [update] -> función `toggleClienteActivo` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/clientes/cliente.ts` -> función `listClientes` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/clientes/cliente.ts` -> función `listClientesPaginado` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/clientes/cliente.ts` -> función `getCliente` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/clientes/cliente.ts` -> función `createCliente` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `comprobante` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `comprobante_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_comprobante` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_emitir_comprobante | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_emitir_comprobante
  - *FOR UPDATE*: ninguna

### `configuracion` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `configuracion_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_configuracion` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_set_configuracion_qr_lado_mm, sp_set_configuracion_impresora | UPDATE: ninguno | DELETE: sp_set_configuracion_impresora
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `getConfiguracionQrLadoMm` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `getConfiguracionImpresora` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `consignacion` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `consignacion_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_consignacion` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_consignacion, sp_crear_consignacion_con_items | UPDATE: sp_cerrar_consignacion, sp_editar_consignacion | DELETE: sp_eliminar_consignacion
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/consignaciones/consignacion.ts` -> función `listConsignaciones` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/consignaciones/consignacion.ts` -> función `getConsignacionConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getPerfilProveedorPorId` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_crear_consignacion, sp_crear_consignacion_con_items
  - *FOR UPDATE*: sp_agregar_item_consignacion, sp_cerrar_consignacion, sp_editar_consignacion, sp_confirmar_consignacion, sp_eliminar_consignacion

### `consignacion_detalle` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `consignacion_detalle_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_consignacion_detalle` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_agregar_item_consignacion | UPDATE: sp_cancelar_item_consignacion, sp_confirmar_salida_item | DELETE: sp_eliminar_consignacion
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/consignaciones/consignacion.ts` -> función `listItemsElegiblesConsignacion` | Guardas consumidor: `consignaciones.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_agregar_item_consignacion
  - *FOR UPDATE*: sp_cancelar_item_consignacion, sp_confirmar_salida_item, sp_confirmar_consignacion

### `consignacion_revendedora` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `consignacion_revendedora_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_consignacion_revendedora` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_consignacion_revendedora_con_items | UPDATE: sp_editar_consignacion_revendedora, sp_confirmar_consignacion_revendedora, sp_cerrar_consignacion_revendedora | DELETE: sp_eliminar_consignacion_revendedora
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `listConsignacionesRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `getConsignacionRevendedoraConDetalle` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_crear_consignacion_revendedora_con_items
  - *FOR UPDATE*: sp_editar_consignacion_revendedora, sp_confirmar_consignacion_revendedora, sp_registrar_devolucion_revendedora, sp_cerrar_consignacion_revendedora, sp_eliminar_consignacion_revendedora

### `consignacion_revendedora_detalle` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `consignacion_revendedora_detalle_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_consignacion_revendedora_detalle` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_consignacion_revendedora_con_items | UPDATE: sp_registrar_venta, sp_anular_venta, sp_confirmar_consignacion_revendedora, sp_registrar_devolucion_revendedora, sp_registrar_cambio | DELETE: sp_eliminar_consignacion_revendedora
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaVentaRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaVentaRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/panel.ts` -> función `listarItemsEnPoderRevendedora` | Guardas consumidor: `revendedoras.editar, revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_crear_consignacion_revendedora_con_items
  - *FOR UPDATE*: sp_registrar_venta, sp_confirmar_consignacion_revendedora, sp_registrar_devolucion_revendedora

### `consulta_ayuda` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `consulta_ayuda_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_consulta_ayuda` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_consulta_ayuda | UPDATE: sp_calificar_consulta_ayuda | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_consulta_ayuda
  - *FOR UPDATE*: ninguna

### `costo_producto` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `costo_producto_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_costo_producto` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_costo_producto_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_aplicar_ultimo_costo | UPDATE: sp_aplicar_ultimo_costo | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/cotizacion.ts` -> función `countProductosCostoUsdVigentes` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_aplicar_ultimo_costo
  - *FOR UPDATE*: sp_revaluar_costos_usd_vigentes, sp_aplicar_ultimo_costo

### `cotizacion_config` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cotizacion_config_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cotizacion_config` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_set_cotizacion_manual, sp_set_modo_cotizacion | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `cotizacion_dolar` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cotizacion_dolar_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cotizacion_dolar` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_set_cotizacion_manual, sp_registrar_cotizacion_bcra | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `cuenta_destino` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cuenta_destino_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cuenta_destino` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (4)*:
    - `lib/dal/ventas/cuenta-destino.ts:67` [insert] -> función `createCuentaDestino` (cliente: `supabase` [user])
    - `lib/dal/ventas/cuenta-destino.ts:103` [update] -> función `updateCuentaDestino` (cliente: `supabase` [user])
    - `lib/dal/ventas/cuenta-destino.ts:117` [update] -> función `toggleCuentaDestinoActiva` (cliente: `supabase` [user])
    - `lib/dal/ventas/cuenta-destino.ts:124` [update] -> función `togglePermiteManual` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/cuenta-destino.ts` -> función `listCuentasDestino` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/cuenta-destino.ts` -> función `listCuentasDestinoPaginado` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/cuenta-destino.ts` -> función `createCuentaDestino` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `cuota_financiada` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `cuota_financiada_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_cuota_financiada` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_venta | UPDATE: sp_anular_venta, sp_cobrar_cuota, sp_marcar_cuota_incobrable | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/cuotas/cuota.ts` -> función `listCuotasPaginado` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/cuotas/cuota.ts` -> función `listCuotasPorCliente` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/cuotas/cuota.ts` -> función `listCuotasPorVenta` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_anular_venta, sp_marcar_cuota_incobrable
  - *FOR UPDATE*: sp_cobrar_cuota, sp_marcar_cuota_incobrable

### `declaracion_venta_revendedora` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (5)**:
  - `declaracion_venta_revendedora_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_declaracion_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `restrict_revendedora_declaracion_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `((auth_revendedora_id() IS NULL) OR (id_revendedora = auth_revendedora_id()))`
  - `restrict_revendedora_declaracion_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `((auth_revendedora_id() IS NULL) OR ((id_revendedora = auth_revendedora_id()) AND (estado = 'pendiente'::estado_declaracion)))`
    - *WITH CHECK*: `((auth_revendedora_id() IS NULL) OR (id_revendedora = auth_revendedora_id()))`
  - `revendedora_propia_declaracion` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `((auth_revendedora_id() IS NULL) OR (id_revendedora = auth_revendedora_id()))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_declarar_venta_revendedora | UPDATE: sp_retirar_declaracion, sp_confirmar_declaracion_venta, sp_rechazar_declaracion_venta | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/declaraciones.ts` -> función `listarDeclaracionesLocal` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_declarar_venta_revendedora
  - *FOR UPDATE*: sp_retirar_declaracion, sp_confirmar_declaracion_venta, sp_rechazar_declaracion_venta

### `detalle_reserva` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `detalle_reserva_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_detalle_reserva` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_reserva | UPDATE: sp_cancelar_reserva, sp_vencer_reservas, sp_registrar_venta | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/consignaciones/consignacion.ts` -> función `listItemsElegiblesConsignacion` | Guardas consumidor: `consignaciones.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reservas/reserva.ts` -> función `listReservasActivasPorProducto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reservas/reserva.ts` -> función `getReservasActivasDeItems` | Guardas consumidor: `ventas.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `detalle_venta` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `detalle_venta_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_detalle_venta` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_venta, sp_registrar_cambio | UPDATE: sp_excluir_detalle_rendicion, sp_reincluir_detalle_rendicion, sp_generar_rendicion, sp_generar_liquidacion, sp_excluir_detalle_liquidacion, sp_reincluir_detalle_liquidacion, sp_registrar_cambio | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getPerfilProveedorPorId` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/rendiciones/rendicion.ts` -> función `getRendicionConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/liquidacion.ts` -> función `obtenerLiquidacionConDetalle` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_cambio
  - *FOR UPDATE*: sp_anular_venta, sp_registrar_devolucion_cliente, sp_excluir_detalle_rendicion, sp_reincluir_detalle_rendicion, sp_generar_liquidacion, sp_excluir_detalle_liquidacion, sp_reincluir_detalle_liquidacion, sp_registrar_cambio

### `detalle_venta_costo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `detalle_venta_costo_own_tenant` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_detalle_venta_costo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_detalle_venta_costo_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `detalle_venta_rendicion` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `detalle_venta_rendicion_own_tenant` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_detalle_venta_rendicion` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_detalle_venta_rendicion_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('rendiciones'::text, 'ver'::text) AS auth_tiene_permiso))`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `devolucion_venta` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `devolucion_venta_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_devolucion_venta` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_devolucion_cliente | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_devolucion_cliente
  - *FOR UPDATE*: ninguna

### `devolucion_venta_costo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `devolucion_venta_costo_own_tenant` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_devolucion_venta_costo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_devolucion_venta_costo_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `escala_comision` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `escala_comision_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_escala_comision` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_toggle_tenant_modulo, sp_crear_regla_comision | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `gasto_negocio` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `gasto_negocio_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_gasto_negocio` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_gasto_negocio_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('gastos'::text, 'editar'::text) AS auth_tiene_permiso)`
  - `rlsp_gasto_negocio_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('gastos'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_gasto_negocio_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('gastos'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('reportes'::text, 'ver'::text) AS auth_tiene_permiso))`
  - `rlsp_gasto_negocio_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `false`
    - *WITH CHECK*: `false`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_gasto | UPDATE: ninguno | DELETE: sp_eliminar_gasto
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `listGastos` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `listGastosPaginado` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `bajaCategoriaGasto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/gastos/gasto.ts` -> función `listPresupuestoMes` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_gasto
  - *FOR UPDATE*: ninguna

### `ingreso_detalle_costo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `ingreso_detalle_costo_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_ingreso_detalle_costo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_ingreso_detalle_costo_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `false`
  - `rlsp_ingreso_detalle_costo_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
  - `rlsp_ingreso_detalle_costo_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)`
  - `rlsp_ingreso_detalle_costo_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
    - *WITH CHECK*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_importar_remito, sp_completar_costo_ingreso | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (1)*:
    - `lib/dal/inventario/ingreso.ts:290` [insert] -> función `addIngresoDetalle (costo)` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `ingreso_mercaderia` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `ingreso_mercaderia_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_ingreso_mercaderia` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: sp_confirmar_ingreso | DELETE: sp_cancelar_ingreso
  - *Escrituras directas en lib/dal (1)*:
    - `lib/dal/inventario/ingreso.ts:232` [insert] -> función `createIngreso` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `listIngresosConResumen` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `listIngresosDeProveedor` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `getIngreso` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `createIngresoBorrador` | Guardas consumidor: `inventario.editar`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `remitoDuplicado` | Guardas consumidor: `inventario.editar`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: sp_confirmar_ingreso, sp_cancelar_ingreso, sp_completar_costo_ingreso

### `ingreso_mercaderia_detalle` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=NO, DELETE=SÍ
- **Policies existentes (6)**:
  - `ingreso_detalle_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_ingreso_mercaderia_detalle` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_ingreso_mercaderia_detalle_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('inventario'::text, 'editar'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('inventario'::text, 'eliminar'::text) AS auth_tiene_permiso))`
  - `rlsp_ingreso_mercaderia_detalle_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('inventario'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_ingreso_mercaderia_detalle_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('inventario'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('reportes'::text, 'ver'::text) AS auth_tiene_permiso))`
  - `rlsp_ingreso_mercaderia_detalle_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `false`
    - *WITH CHECK*: `false`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_importar_remito | UPDATE: ninguno | DELETE: sp_cancelar_ingreso
  - *Escrituras directas en lib/dal (2)*:
    - `lib/dal/inventario/ingreso.ts:275` [insert] -> función `addIngresoDetalle` (cliente: `supabase` [user])
    - `lib/dal/inventario/ingreso.ts:418` [delete] -> función `removeIngresoDetalle` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/ingreso.ts` -> función `addIngresoDetalle` | Guardas consumidor: `inventario.editar`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_importar_remito
  - *FOR UPDATE*: ninguna

### `item_costo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `item_costo_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_item_costo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_item_costo_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `false`
  - `rlsp_item_costo_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
  - `rlsp_item_costo_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)`
  - `rlsp_item_costo_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
    - *WITH CHECK*: `(( SELECT auth_tiene_permiso('inventario'::text, 'cargar_costos'::text) AS auth_tiene_permiso) OR (( SELECT auth_tiene_permiso('precios'::text, 'editar_cotizacion'::text) AS auth_tiene_permiso) AND ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso)))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_stock_directo, sp_aplicar_ultimo_costo, sp_completar_costo_ingreso | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_completar_costo_ingreso
  - *FOR UPDATE*: ninguna

### `item_producto` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `item_producto_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_item_producto` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_confirmar_ingreso, sp_crear_stock_directo | UPDATE: sp_transicion_item_producto, sp_asignar_talles_a_producto | DELETE: sp_cancelar_ingreso
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/consignaciones/consignacion.ts` -> función `listItemsElegiblesConsignacion` | Guardas consumidor: `consignaciones.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `findItemByQr` | Guardas consumidor: `consignaciones.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `getItemConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `getProveedorHabitualDeProducto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `getUltimoContextoIngresoProducto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `listItemsParaEtiquetas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `listQrsByIngreso` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `listItemsParaEtiquetasPorOrigen` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `listItemsByProducto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `listItemsDisponibles` | Guardas consumidor: `ventas.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getPerfilProveedorPorId` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getPerfilProveedorPorId` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaVentaRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/liquidacion.ts` -> función `previewLiquidacion` | Guardas consumidor: `revendedoras.ver, revendedoras.liquidar, revendedoras.liquidar, revendedoras.liquidar, revendedoras.liquidar, revendedoras.liquidar`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_confirmar_ingreso, sp_crear_stock_directo
  - *FOR UPDATE*: sp_transicion_item_producto, sp_crear_reserva, sp_registrar_venta, sp_agregar_item_consignacion, sp_registrar_ajuste_inventario, sp_asignar_talles_a_producto, sp_crear_consignacion_revendedora_con_items, sp_confirmar_consignacion_revendedora, sp_registrar_devolucion_revendedora, sp_registrar_cambio

### `liquidacion_revendedora` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `liquidacion_revendedora_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_liquidacion_revendedora` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_generar_liquidacion | UPDATE: sp_generar_liquidacion, sp_marcar_liquidacion_pagada | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/liquidacion.ts` -> función `listarLiquidacionesRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/liquidacion.ts` -> función `obtenerLiquidacionConDetalle` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_generar_liquidacion
  - *FOR UPDATE*: sp_marcar_liquidacion_pagada

### `modulo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `modulo_select_authenticated` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `true`
  - `restrict_revendedora_modulo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `movimiento_item` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `movimiento_item_insert_own_tenant` [PERMISSIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `movimiento_item_select_own_tenant` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_movimiento_item` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_transicion_item_producto, sp_confirmar_ingreso, sp_agregar_item_consignacion, sp_cancelar_item_consignacion, sp_registrar_ajuste_inventario, sp_crear_stock_directo, sp_asignar_talles_a_producto, sp_crear_consignacion_revendedora_con_items | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/item.ts` -> función `getItemConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_ajuste_inventario
  - *FOR UPDATE*: ninguna

### `pago_revendedora` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `pago_revendedora_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_pago_revendedora` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_marcar_liquidacion_pagada | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_marcar_liquidacion_pagada
  - *FOR UPDATE*: ninguna

### `pago_venta` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `pago_venta_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_pago_venta` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_venta, sp_cobrar_cuota, sp_registrar_cambio | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_cobrar_cuota
  - *FOR UPDATE*: ninguna

### `plan_cuotas` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `plan_cuotas_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_plan_cuotas` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (2)*:
    - `lib/dal/precios/cuotas.ts:30` [upsert] -> función `savePlanCuotas` (cliente: `supabase` [user])
    - `lib/dal/precios/cuotas.ts:45` [update] -> función `togglePlanCuotasActivo` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/cuotas.ts` -> función `listPlanesCuotas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `producto` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `producto_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_producto` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_create_producto, sp_importar_remito | UPDATE: sp_recalcular_precio_venta, sp_marcar_precio_desactualizado_by_producto, sp_marcar_precio_desactualizado_by_regla | DELETE: sp_cancelar_ingreso
  - *Escrituras directas en lib/dal (1)*:
    - `lib/dal/inventario/producto.ts:321` [update] -> función `updateProducto` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/codigo.ts` -> función `resolverCodigo` | Guardas consumidor: `ventas.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/producto.ts` -> función `listProductosParaBuscador` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/producto.ts` -> función `getProducto` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/producto.ts` -> función `getProductoConCategoria` | Guardas consumidor: `ventas.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/producto.ts` -> función `findProductoBySku` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_create_producto, sp_importar_remito
  - *FOR UPDATE*: ninguna

### `producto_sku_seq` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `producto_sku_seq_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_producto_sku_seq` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_gen_sku | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_gen_sku
  - *FOR UPDATE*: ninguna

### `proveedor` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `proveedor_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_proveedor` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (2)*:
    - `lib/dal/inventario/proveedor.ts:42` [insert] -> función `createProveedor` (cliente: `supabase` [user])
    - `lib/dal/inventario/proveedor.ts:53` [update] -> función `updateProveedor` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `listProveedores` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `listProveedoresActivos` | Guardas consumidor: `inventario.editar`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `countProveedoresActivos` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getProveedor` | Guardas consumidor: `inventario.editar`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `createProveedor` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `recargo_cuotas` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `recargo_cuotas_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_recargo_cuotas` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal (3)*:
    - `lib/dal/precios/recargo.ts:63` [insert] -> función `createRecargoCuotas` (cliente: `supabase` [user])
    - `lib/dal/precios/recargo.ts:92` [update] -> función `updateRecargoCuotas` (cliente: `supabase` [user])
    - `lib/dal/precios/recargo.ts:106` [update] -> función `toggleRecargoCuotasActivo` (cliente: `supabase` [user])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/recargo.ts` -> función `listRecargosCuotas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/recargo.ts` -> función `createRecargoCuotas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `regla_comision` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `regla_comision_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_regla_comision` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_toggle_tenant_modulo, sp_crear_regla_comision | UPDATE: sp_terminar_regla_comision | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/comisiones.ts` -> función `listReglasComision` | Guardas consumidor: `revendedoras.ver`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_toggle_tenant_modulo, sp_crear_regla_comision
  - *FOR UPDATE*: sp_terminar_regla_comision

### `regla_precio` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (3)**:
  - `regla_precio_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_regla_precio` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_regla_precio_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `((tipo_regla <> 'margen'::tipo_regla) OR ( SELECT auth_tiene_permiso('precios'::text, 'ver_margenes'::text) AS auth_tiene_permiso))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_create_regla_precio | UPDATE: sp_baja_regla_precio, sp_extender_vigencia_regla | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/regla.ts` -> función `listReglasPrecio` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/precios/regla.ts` -> función `getReglaPrecio` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_create_regla_precio
  - *FOR UPDATE*: ninguna

### `reintegro_cliente` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `reintegro_cliente_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_reintegro_cliente` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_anular_venta, sp_registrar_devolucion_cliente | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `rendicion_proveedor` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `rendicion_proveedor_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_rendicion_proveedor` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_rendicion_proveedor_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `false`
  - `rlsp_rendicion_proveedor_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('rendiciones'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_rendicion_proveedor_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('rendiciones'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('inventario'::text, 'ver_costos'::text) AS auth_tiene_permiso))`
  - `rlsp_rendicion_proveedor_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('rendiciones'::text, 'crear'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('rendiciones'::text, 'editar'::text) AS auth_tiene_permiso))`
    - *WITH CHECK*: `(( SELECT auth_tiene_permiso('rendiciones'::text, 'crear'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('rendiciones'::text, 'editar'::text) AS auth_tiene_permiso))`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_generar_rendicion | UPDATE: sp_generar_rendicion, sp_marcar_rendicion_pagada | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/inventario/proveedor.ts` -> función `getPerfilProveedorPorId` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/rendiciones/rendicion.ts` -> función `listRendiciones` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/rendiciones/rendicion.ts` -> función `getRendicionConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_generar_rendicion
  - *FOR UPDATE*: sp_marcar_rendicion_pagada

### `reserva` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `reserva_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `restrict_revendedora_reserva` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_reserva | UPDATE: sp_cancelar_reserva, sp_vencer_reservas, sp_registrar_venta | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reservas/reserva.ts` -> función `listReservas` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reservas/reserva.ts` -> función `getReservaConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reservas/reserva.ts` -> función `listReservasPorCliente` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_crear_reserva
  - *FOR UPDATE*: sp_cancelar_reserva, sp_vencer_reservas, sp_registrar_venta

### `revendedora` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (6)**:
  - `restrict_revendedora_escritura_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `restrict_revendedora_escritura_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `(auth_revendedora_id() IS NULL)`
  - `restrict_revendedora_escritura_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
    - *WITH CHECK*: `(auth_revendedora_id() IS NULL)`
  - `revendedora_auth_admin_read` [PERMISSIVE] (SELECT) Roles: `{supabase_auth_admin}`
    - *USING*: `true`
  - `revendedora_propia` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `((auth_revendedora_id() IS NULL) OR (id_revendedora = auth_revendedora_id()))`
  - `revendedora_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_crear_revendedora | UPDATE: sp_editar_revendedora, sp_baja_revendedora, sp_enlazar_revendedora_usuario, sp_reactivar_acceso_revendedora | DELETE: ninguno
  - *Escrituras directas en lib/dal (1)*:
    - `lib/dal/revendedoras/index.ts:233` [update] -> función `desvincularUsuarioRevendedora` (cliente: `admin` [service])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaConsignacionRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/consignacion.ts` -> función `lookupItemParaVentaRevendedora` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/index.ts` -> función `listarRevendedoras` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/revendedoras/index.ts` -> función `obtenerRevendedora` | Guardas consumidor: `revendedoras.crear, revendedoras.ver, revendedoras.editar, revendedoras.liquidar`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_crear_revendedora
  - *FOR UPDATE*: sp_editar_revendedora, sp_baja_revendedora, sp_crear_consignacion_revendedora_con_items, sp_generar_liquidacion

### `rol` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (7)**:
  - `restrict_revendedora_rol` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_rol_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('administracion'::text, 'eliminar'::text) AS auth_tiene_permiso)`
  - `rlsp_rol_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('administracion'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_rol_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `((id_rol = ( SELECT u.id_rol
   FROM usuario u
  WHERE (u.id_usuario = auth.uid()))) OR ( SELECT auth_tiene_permiso('administracion'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'crear'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'eliminar'::text) AS auth_tiene_permiso))`
  - `rlsp_rol_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'eliminar'::text) AS auth_tiene_permiso))`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso)`
  - `rol_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `rol_auth_admin_read` [PERMISSIVE] (SELECT) Roles: `{supabase_auth_admin}`
    - *USING*: `true`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_create_rol, sp_alta_tenant | UPDATE: sp_update_rol_permisos | DELETE: sp_delete_rol
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `listRoles` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `getRol` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_create_rol, sp_alta_tenant
  - *FOR UPDATE*: sp_update_rol_permisos, sp_delete_rol

### `superadmin` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Policies existentes (0)**:
  - *(Ninguna policy definida)*
- **Escritores**:
  - *SPs vivos*: INSERT: ninguno | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `tenant` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=NO, DELETE=SÍ
- **Policies existentes (4)**:
  - `restrict_revendedora_tenant` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `tenant_auth_admin_read` [PERMISSIVE] (SELECT) Roles: `{supabase_auth_admin}`
    - *USING*: `true`
  - `tenant_select_own` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
  - `tenant_update_own` [PERMISSIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_alta_tenant | UPDATE: sp_set_tenant_logo, sp_cambiar_estado_tenant | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_alta_tenant
  - *FOR UPDATE*: sp_cambiar_estado_tenant

### `tenant_cargo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Policies existentes (0)**:
  - *(Ninguna policy definida)*
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_cargo_tenant | UPDATE: sp_anular_movimiento_tenant | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_cargo_tenant
  - *FOR UPDATE*: sp_anular_movimiento_tenant

### `tenant_modulo` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=SÍ, INSERT=NO, UPDATE=NO, DELETE=NO
- **Policies existentes (2)**:
  - `restrict_revendedora_tenant_modulo` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `tenant_modulo_select_own_tenant` [PERMISSIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_toggle_tenant_modulo, sp_toggle_tenant_modulo_admin, sp_alta_tenant | UPDATE: ninguno | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: ninguna

### `tenant_pago` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Grants `authenticated`**: SELECT=NO, INSERT=NO, UPDATE=NO, DELETE=NO
- **Policies existentes (0)**:
  - *(Ninguna policy definida)*
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_pago_tenant | UPDATE: sp_anular_movimiento_tenant | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa con cliente de usuario (solo service client o solo lectura vía SP/RPC).
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: sp_registrar_pago_tenant
  - *FOR UPDATE*: sp_anular_movimiento_tenant

### `usuario` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (7)**:
  - `restrict_revendedora_usuario` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `rlsp_usuario_delete` [RESTRICTIVE] (DELETE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('administracion'::text, 'eliminar'::text) AS auth_tiene_permiso)`
  - `rlsp_usuario_insert` [RESTRICTIVE] (INSERT) Roles: `{authenticated}`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('administracion'::text, 'crear'::text) AS auth_tiene_permiso)`
  - `rlsp_usuario_select` [RESTRICTIVE] (SELECT) Roles: `{authenticated}`
    - *USING*: `((id_usuario = auth.uid()) OR ( SELECT auth_tiene_permiso('administracion'::text, 'ver'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'crear'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso) OR ( SELECT auth_tiene_permiso('administracion'::text, 'eliminar'::text) AS auth_tiene_permiso))`
  - `rlsp_usuario_update` [RESTRICTIVE] (UPDATE) Roles: `{authenticated}`
    - *USING*: `( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso)`
    - *WITH CHECK*: `( SELECT auth_tiene_permiso('administracion'::text, 'editar'::text) AS auth_tiene_permiso)`
  - `usuario_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
  - `usuario_auth_admin_read` [PERMISSIVE] (SELECT) Roles: `{supabase_auth_admin}`
    - *USING*: `true`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_enlazar_revendedora_usuario, sp_alta_tenant | UPDATE: sp_update_usuario, sp_toggle_usuario_activo, sp_reactivar_acceso_revendedora | DELETE: ninguno
  - *Escrituras directas en lib/dal (2)*:
    - `lib/dal/administracion/administracion.ts:99` [insert] -> función `crearUsuario` (cliente: `admin` [service])
    - `lib/dal/revendedoras/index.ts:241` [update] -> función `desvincularUsuarioRevendedora` (cliente: `admin` [service])
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `listUsuarios` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/administracion/administracion.ts` -> función `listAuditoria` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: sp_toggle_usuario_activo

### `venta` (Tabla Base)

- **RLS Habilitada**: SÍ
- **Grants `anon`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Grants `authenticated`**: SELECT=SÍ, INSERT=SÍ, UPDATE=SÍ, DELETE=SÍ
- **Policies existentes (2)**:
  - `restrict_revendedora_venta` [RESTRICTIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(auth_revendedora_id() IS NULL)`
  - `venta_all_own_tenant` [PERMISSIVE] (ALL) Roles: `{authenticated}`
    - *USING*: `(id_tenant = auth_tenant_id())`
    - *WITH CHECK*: `(id_tenant = auth_tenant_id())`
- **Escritores**:
  - *SPs vivos*: INSERT: sp_registrar_venta | UPDATE: sp_anular_venta | DELETE: ninguno
  - *Escrituras directas en lib/dal*: ninguna (solo vía SPs o service role)
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/venta.ts` -> función `listVentasPaginado` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/venta.ts` -> función `listVentasPaginado` | Guardas consumidor: `revendedoras.ver`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/venta.ts` -> función `getVentaConDetalle` | Guardas consumidor: `sin guarda identificada (layout/pública)`
  - `c:/Archivos de trabajo/evoralStock/lib/dal/ventas/venta.ts` -> función `listVentasPorCliente` | Guardas consumidor: `sin guarda identificada (layout/pública)`
- **Funciones INVOKER con RETURNING o FOR UPDATE** (evalúan policy de SELECT):
  - *RETURNING*: ninguna
  - *FOR UPDATE*: sp_anular_venta, sp_registrar_devolucion_cliente

## 3. Vistas de `public`

### `tenant_listado` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=NO
- **Grants `authenticated`**: SELECT=NO
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa en DAL con cliente de usuario.

### `tenant_movimiento` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=NO
- **Grants `authenticated`**: SELECT=NO
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa en DAL con cliente de usuario.

### `tenant_saldo` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=NO
- **Grants `authenticated`**: SELECT=NO
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa en DAL con cliente de usuario.

### `v_alerta_reposicion` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=SÍ
- **Grants `authenticated`**: SELECT=SÍ
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reportes/reportes.ts` -> función `listAlertaReposicion` | Guardas consumidor: `sin guarda`

### `v_alerta_rotacion_vencida` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=SÍ
- **Grants `authenticated`**: SELECT=SÍ
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reportes/reportes.ts` -> función `listAlertaRotacionVencida` | Guardas consumidor: `sin guarda`

### `v_ganancia_por_producto` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=SÍ
- **Grants `authenticated`**: SELECT=SÍ
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reportes/reportes.ts` -> función `listGananciaPorProducto` | Guardas consumidor: `sin guarda`

### `v_linea_venta` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=SÍ
- **Grants `authenticated`**: SELECT=SÍ
- **Lectores con cliente de usuario en `lib/dal`**:
  - Ninguna lectura directa en DAL con cliente de usuario.

### `v_perfil_proveedor` (Vista)

- **security_invoker**: SÍ (true/on)
- **Grants `anon`**: SELECT=SÍ
- **Grants `authenticated`**: SELECT=SÍ
- **Lectores con cliente de usuario en `lib/dal`**:
  - `c:/Archivos de trabajo/evoralStock/lib/dal/reportes/reportes.ts` -> función `listPerfilProveedor` | Guardas consumidor: `sin guarda`

## 4. Clasificación de Tablas con Escrituras Directas en `lib/dal` (13 de Dominio + 1 Auth)

| Tabla | Tipo de Cliente | Operaciones Directas | Archivo / Función en DAL | Permiso Requerido para la Policy de Escritura |
| --- | --- | --- | --- | --- |
| `arancel_cobro` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/ventas/arancel.ts` (`createArancelCobro`, `updateArancelCobro`, `toggleArancelCobroActivo`) | INSERT: `administracion.crear` | UPDATE: `administracion.editar` | DELETE: `administracion.eliminar` |
| `categoria` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/inventario/categoria.ts` (`createCategoria`, `updateCategoria`, `toggleCategoriaActiva`) | INSERT: `inventario.crear` | UPDATE: `inventario.editar` | DELETE: `inventario.eliminar` |
| `categoria_gasto` | Usuario (`createServerClient`) | INSERT, UPDATE, DELETE | `lib/dal/gastos/gasto.ts` (`createCategoriaGasto`, `renameCategoriaGasto`, `bajaCategoriaGasto`, `reactivarCategoriaGasto`) | INSERT: `gastos.crear` | UPDATE: `gastos.editar` | DELETE: `gastos.editar` (00142 ya vigente) |
| `cliente` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/clientes/cliente.ts` (`createCliente`, `updateCliente`, `toggleClienteActivo`) | INSERT: `ventas.crear` | UPDATE: `ventas.editar` | DELETE: `ventas.eliminar` |
| `cuenta_destino` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/ventas/cuenta-destino.ts` (`createCuentaDestino`, `updateCuentaDestino`, `toggleCuentaDestinoActiva`, `togglePermiteManual`) | INSERT: `administracion.crear` | UPDATE: `administracion.editar` | DELETE: `administracion.eliminar` |
| `ingreso_detalle_costo` | Usuario (`createServerClient`) | INSERT | `lib/dal/inventario/ingreso.ts` (`addIngresoDetalle`) | INSERT: `inventario.cargar_costos` | DELETE: `inventario.editar` O `inventario.eliminar` (00157 ya vigente) |
| `ingreso_mercaderia` | Usuario (`createServerClient`) | INSERT | `lib/dal/inventario/ingreso.ts` (`createIngreso`) | INSERT: `inventario.crear` | UPDATE: `inventario.editar` O `inventario.crear` | DELETE: `inventario.eliminar` |
| `ingreso_mercaderia_detalle` | Usuario (`createServerClient`) | INSERT, DELETE | `lib/dal/inventario/ingreso.ts` (`addIngresoDetalle`, `removeIngresoDetalle`) | INSERT: `inventario.crear` | DELETE: `inventario.editar` O `inventario.eliminar` (00142 ya vigente) |
| `plan_cuotas` | Usuario (`createServerClient`) | UPSERT, UPDATE | `lib/dal/precios/cuotas.ts` (`savePlanCuotas`, `togglePlanCuotasActivo`) | INSERT: `precios.crear` | UPDATE: `precios.editar` | DELETE: `precios.eliminar` |
| `producto` | Usuario (`createServerClient`) | UPDATE | `lib/dal/inventario/producto.ts` (`updateProducto`) | INSERT: `inventario.crear` | UPDATE: `inventario.editar` | DELETE: `inventario.eliminar` |
| `proveedor` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/inventario/proveedor.ts` (`createProveedor`, `updateProveedor`) | INSERT: `inventario.crear` | UPDATE: `inventario.editar` | DELETE: `inventario.eliminar` |
| `recargo_cuotas` | Usuario (`createServerClient`) | INSERT, UPDATE | `lib/dal/precios/recargo.ts` (`createRecargoCuotas`, `updateRecargoCuotas`, `toggleRecargoCuotasActivo`) | INSERT: `precios.crear` | UPDATE: `precios.editar` | DELETE: `precios.eliminar` |
| `revendedora` | Service (`createServiceClient` / `admin`) | UPDATE | `lib/dal/revendedoras/index.ts` (`desvincularUsuarioRevendedora`) | En PostgREST usuario: INSERT: `revendedoras.crear` | UPDATE: `revendedoras.editar` | DELETE: `revendedoras.eliminar` (service client bypasses RLS) |
| `usuario` | Service (`createServiceClient` / `admin`) | INSERT, UPDATE | `lib/dal/administracion/administracion.ts` (`crearUsuario`), `lib/dal/revendedoras/index.ts` (`desvincularUsuarioRevendedora`) | Policies restrictivas ya vigentes en 00159 (`administracion.crear/editar/eliminar`) |

---

## 5. Trampas de RETURNING y FOR UPDATE para Escritores INVOKER

Cuando una función `SECURITY INVOKER` ejecuta:
1. `INSERT ... RETURNING col into var`
2. `UPDATE ... RETURNING col into var`
3. `DELETE ... RETURNING col into var`
4. `SELECT ... FOR UPDATE` (o `FOR SHARE`)

PostgreSQL **evalúa las policies de SELECT** de la tabla sobre el llamador.
Si la tabla tiene una policy restrictiva de SELECT que exige un permiso que el llamador no posee, ocurre una de dos fallas:
- Si es `FOR UPDATE`: la consulta retorna 0 filas. El SP cree que la fila no existe y lanza una excepción tipo `not-found` o no ejecuta la actualización requerida.
- Si es `RETURNING`: la sentencia falla con error de permisos o retorna NULL en la variable receptora.

### Regla Fundamental:
> **Todo permiso que autoriza a un `sp_*` INVOKER que lee una tabla mediante `FOR UPDATE` o `RETURNING` MUST formar parte del `OR` de la policy restrictiva de `SELECT` de dicha tabla.**

### Mapeo de SPs INVOKER y Aportes al OR de SELECT por Tabla:

| Tabla | SPs INVOKER con FOR UPDATE o RETURNING | Permisos Aportados al OR de SELECT |
| --- | --- | --- |
| `cambio_venta` | `sp_registrar_cambio` [RETURNING] | `ventas.crear` |
| `categoria_gasto` | `sp_set_presupuesto_categoria_gasto` [FOR UPDATE] | `gastos.editar` |
| `comprobante` | `sp_emitir_comprobante` [RETURNING] | `ventas.crear` |
| `consignacion` | `sp_agregar_item_consignacion` [FOR UPDATE], `sp_cerrar_consignacion` [FOR UPDATE], `sp_crear_consignacion_con_items` [RETURNING], `sp_editar_consignacion` [FOR UPDATE], `sp_confirmar_consignacion` [FOR UPDATE], `sp_eliminar_consignacion` [FOR UPDATE] | `consignaciones.crear`, `consignaciones.editar`, `consignaciones.eliminar` |
| `consignacion_detalle` | `sp_agregar_item_consignacion` [RETURNING], `sp_cancelar_item_consignacion` [FOR UPDATE], `sp_confirmar_salida_item` [FOR UPDATE], `sp_confirmar_consignacion` [FOR UPDATE] | `consignaciones.crear`, `consignaciones.editar` |
| `consignacion_revendedora` | `sp_crear_consignacion_revendedora_con_items` [RETURNING], `sp_editar_consignacion_revendedora` [FOR UPDATE], `sp_confirmar_consignacion_revendedora` [FOR UPDATE], `sp_registrar_devolucion_revendedora` [FOR UPDATE], `sp_cerrar_consignacion_revendedora` [FOR UPDATE], `sp_eliminar_consignacion_revendedora` [FOR UPDATE] | `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar` |
| `consignacion_revendedora_detalle` | `sp_registrar_venta` [FOR UPDATE], `sp_crear_consignacion_revendedora_con_items` [RETURNING], `sp_confirmar_consignacion_revendedora` [FOR UPDATE], `sp_registrar_devolucion_revendedora` [FOR UPDATE] | `ventas.crear`, `revendedoras.crear`, `revendedoras.editar` |
| `consulta_ayuda` | `sp_registrar_consulta_ayuda` [RETURNING] | `ayuda.consultar` |
| `costo_producto` | `sp_revaluar_costos_usd_vigentes` [FOR UPDATE], `sp_aplicar_ultimo_costo` [FOR UPDATE, RETURNING] | `precios.editar_cotizacion`, `inventario.ver_costos`, `inventario.cargar_costos` |
| `cuota_financiada` | `sp_anular_venta` [RETURNING], `sp_cobrar_cuota` [FOR UPDATE], `sp_marcar_cuota_incobrable` [FOR UPDATE, RETURNING] | `ventas.editar`, `ventas.eliminar` |
| `declaracion_venta_revendedora` | `sp_declarar_venta_revendedora` [RETURNING], `sp_retirar_declaracion` [FOR UPDATE], `sp_confirmar_declaracion_venta` [FOR UPDATE], `sp_rechazar_declaracion_venta` [FOR UPDATE] | `revendedoras.crear`, `revendedoras.declarar` |
| `detalle_venta` | `sp_anular_venta` [FOR UPDATE], `sp_registrar_devolucion_cliente` [FOR UPDATE], `sp_excluir_detalle_rendicion` [FOR UPDATE], `sp_reincluir_detalle_rendicion` [FOR UPDATE], `sp_generar_liquidacion` [FOR UPDATE], `sp_excluir_detalle_liquidacion` [FOR UPDATE], `sp_reincluir_detalle_liquidacion` [FOR UPDATE], `sp_registrar_cambio` [FOR UPDATE, RETURNING] | `ventas.crear`, `ventas.editar`, `ventas.eliminar`, `rendiciones.editar`, `revendedoras.liquidar` |
| `devolucion_venta` | `sp_registrar_devolucion_cliente` [RETURNING] | `ventas.editar` |
| `gasto_negocio` | `sp_registrar_gasto` [RETURNING] | `gastos.crear` |
| `ingreso_mercaderia` | `sp_confirmar_ingreso` [FOR UPDATE], `sp_cancelar_ingreso` [FOR UPDATE], `sp_completar_costo_ingreso` [FOR UPDATE] | `inventario.crear`, `inventario.editar`, `inventario.cargar_costos` |
| `ingreso_mercaderia_detalle` | `sp_importar_remito` [RETURNING] | `inventario.crear` |
| `item_producto` | `sp_transicion_item_producto` [FOR UPDATE], `sp_confirmar_ingreso` [RETURNING], `sp_crear_reserva` [FOR UPDATE], `sp_registrar_venta` [FOR UPDATE], `sp_agregar_item_consignacion` [FOR UPDATE], `sp_registrar_ajuste_inventario` [FOR UPDATE], `sp_crear_stock_directo` [RETURNING], `sp_asignar_talles_a_producto` [FOR UPDATE], `sp_crear_consignacion_revendedora_con_items` [FOR UPDATE], `sp_confirmar_consignacion_revendedora` [FOR UPDATE], `sp_registrar_devolucion_revendedora` [FOR UPDATE], `sp_registrar_cambio` [FOR UPDATE] | `inventario.crear`, `inventario.editar`, `ventas.crear`, `ventas.editar`, `consignaciones.crear`, `consignaciones.editar`, `consignaciones.eliminar`, `revendedoras.crear`, `revendedoras.editar` |
| `liquidacion_revendedora` | `sp_generar_liquidacion` [RETURNING], `sp_marcar_liquidacion_pagada` [FOR UPDATE] | `revendedoras.liquidar` |
| `movimiento_item` | `sp_registrar_ajuste_inventario` [RETURNING] | `inventario.editar` |
| `pago_revendedora` | `sp_marcar_liquidacion_pagada` [RETURNING] | `revendedoras.liquidar` |
| `pago_venta` | `sp_cobrar_cuota` [RETURNING], `sp_registrar_cambio` [RETURNING] | `ventas.editar`, `ventas.crear` |
| `producto` | `sp_create_producto` [RETURNING], `sp_importar_remito` [RETURNING] | `inventario.crear`, `inventario.cargar_costos` |
| `producto_sku_seq` | `sp_gen_sku` [RETURNING] | `inventario.crear` |
| `regla_comision` | `sp_crear_regla_comision` [RETURNING], `sp_terminar_regla_comision` [FOR UPDATE] | `revendedoras.editar` |
| `regla_precio` | `sp_create_regla_precio` [RETURNING] | `precios.crear`, `precios.ver_margenes` |
| `rendicion_proveedor` | `sp_generar_rendicion` [RETURNING], `sp_marcar_rendicion_pagada` [FOR UPDATE] | `rendiciones.crear`, `rendiciones.ver`, `rendiciones.editar` |
| `reserva` | `sp_crear_reserva` [RETURNING], `sp_cancelar_reserva` [FOR UPDATE], `sp_vencer_reservas` [FOR UPDATE], `sp_registrar_venta` [FOR UPDATE] | `ventas.crear`, `ventas.editar`, `revendedoras.crear` |
| `revendedora` | `sp_crear_revendedora` [RETURNING], `sp_editar_revendedora` [FOR UPDATE], `sp_baja_revendedora` [FOR UPDATE], `sp_crear_consignacion_revendedora_con_items` [FOR UPDATE], `sp_generar_liquidacion` [FOR UPDATE] | `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.liquidar` |
| `rol` | `sp_create_rol` [RETURNING], `sp_update_rol_permisos` [FOR UPDATE], `sp_delete_rol` [FOR UPDATE] | `administracion.crear`, `administracion.editar`, `administracion.eliminar` |
| `usuario` | `sp_toggle_usuario_activo` [FOR UPDATE] | `administracion.editar` |
| `venta` | `sp_anular_venta` [FOR UPDATE], `sp_registrar_devolucion_cliente` [FOR UPDATE] | `ventas.editar`, `ventas.eliminar` |

---

## Apéndice de Comandos y Evidencia

### 1. Conteo de Tablas y Vistas en `public`
```sql
SELECT c.relname, c.relkind, COALESCE(t.rowsecurity, false) AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_tables t ON t.schemaname = n.nspname AND t.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
ORDER BY c.relkind, c.relname;
```
Resultado: 56 tablas base (`r`) y 8 vistas (`v`). Total = 64 entidades.

### 2. Comprobación de Grants para `anon` y `authenticated`
```sql
SELECT 
    c.relname,
    has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
    has_table_privilege('anon', c.oid, 'INSERT') AS anon_ins,
    has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
    has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_ins
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```
Evidencia: 51 tablas tienen `anon_sel = true`. 53 tablas tienen `auth_ins = true`.

### 3. Verificación de Security Invoker en Vistas
```sql
SELECT c.relname as view_name, c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
ORDER BY c.relname;
```
Evidencia: Las 8 vistas devuelven `{security_invoker=on}` o `{security_invoker=true}`.

### 4. Comando Reproducible para Detección de Mutaciones Directas en `lib/dal`
El siguiente script en Node.js inspecciona cada archivo bajo `lib/dal/**`, extrayendo las mutaciones directas (`insert`, `update`, `delete`, `upsert`) y clasificando el cliente según provenga de `createServerClient` (usuario autenticado) o `createServiceClient` (service role / admin):

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function getFiles(dir: string): string[] {
  let res: string[] = []
  for (const item of readdirSync(dir)) {
    const p = join(dir, item)
    if (statSync(p).isDirectory()) res = res.concat(getFiles(p))
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) res.push(p)
  }
  return res
}

const dalFiles = getFiles('lib/dal')
const regex = /([a-zA-Z0-9_]+)s*.s*from(s*['"]([a-zA-Z0-9_]+)['"]s*)s*.s*(insert|update|delete|upsert)s*(/g

for (const f of dalFiles) {
  const content = readFileSync(f, 'utf-8')
  const rel = f.replace(/\\/g, '/')
  const isPlataforma = rel.startsWith('lib/dal/plataforma')
  let m
  while ((m = regex.exec(content)) !== null) {
    const clientVar = m[1]
    const table = m[2]
    const op = m[3]
    const line = content.slice(0, m.index).split('\n').length
    const isService = isPlataforma || clientVar === 'admin'
    console.log(`${table} | ${op} | ${isService ? 'service' : 'user'} | ${rel}:${line}`)
  }
}
```

Salida del comando (14 tablas con escrituras directas):
- **`arancel_cobro`** [user]: `lib/dal/ventas/arancel.ts:41` (insert), `line:75` (update), `line:89` (update)
- **`categoria`** [user]: `lib/dal/inventario/categoria.ts:54` (insert), `line:80` (update), `line:90` (update)
- **`categoria_gasto`** [user]: `lib/dal/gastos/gasto.ts:98` (insert), `line:113` (update), `line:136` (delete), `line:144` (update), `line:154` (update)
- **`cliente`** [user]: `lib/dal/clientes/cliente.ts:103` (insert), `line:114` (update), `line:120` (update)
- **`cuenta_destino`** [user]: `lib/dal/ventas/cuenta-destino.ts:67` (insert), `line:103` (update), `line:117` (update), `line:124` (update)
- **`ingreso_detalle_costo`** [user]: `lib/dal/inventario/ingreso.ts:290` (insert en `addIngresoDetalle`)
- **`ingreso_mercaderia`** [user]: `lib/dal/inventario/ingreso.ts:232` (insert en `createIngreso`)
- **`ingreso_mercaderia_detalle`** [user]: `lib/dal/inventario/ingreso.ts:275` (insert en `addIngresoDetalle`), `line:418` (delete en `removeIngresoDetalle`)
- **`plan_cuotas`** [user]: `lib/dal/precios/cuotas.ts:30` (upsert), `line:45` (update)
- **`producto`** [user]: `lib/dal/inventario/producto.ts:321` (update en `updateProducto`)
- **`proveedor`** [user]: `lib/dal/inventario/proveedor.ts:42` (insert), `line:53` (update)
- **`recargo_cuotas`** [user]: `lib/dal/precios/recargo.ts:63` (insert), `line:92` (update), `line:106` (update)
- **`revendedora`** [service]: `lib/dal/revendedoras/index.ts:233` (update en `desvincularUsuarioRevendedora`)
- **`usuario`** [service]: `lib/dal/administracion/administracion.ts:99` (insert), `lib/dal/revendedoras/index.ts:241` (update)
