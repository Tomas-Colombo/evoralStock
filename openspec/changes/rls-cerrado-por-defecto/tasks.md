# Tareas — RLS Cerrado por Defecto (rls-cerrado-por-defecto)

**Change**: `rls-cerrado-por-defecto` · **Spec**: `proposal.md` + `specs/REQ-RCD.md`

---

## Estrategia de Entrega
La implementación se particiona en **7 fases incrementales** por afinidad de dominio. Cada fase cuenta con su migración, tests colocados, bloque `-- DOWN:` ejecutable verificado y pase limpio de `pnpm gate:db`.

El **Test Guardián** se introduce en la **Fase 1** con un set de exclusión explícito (`PENDIENTES_RLS`), el cual se reduce progresivamente en cada fase hasta alcanzar 0 elementos en la Fase 7.

---

## Fase 1 — Catálogo de Seguridad, Test Guardián y Revocación a `anon`

- [ ] 1.1 Crear el catálogo TypeScript `lib/seguridad/permisos-tablas.ts` con la definición canónica de permisos para las 56 tablas base y las 8 vistas.
- [ ] 1.2 Implementar el test guardián `tests/db/rls-guardian.test.ts` que valida:
  - Presencia obligatoria en el catálogo de toda tabla de `public`.
  - `rowsecurity = true` en todas las tablas base.
  - Vistas con `security_invoker = true/on`.
  - Ausencia total de grants a `anon` en tablas y secuencias.
  - Validación de policies restrictivas por comando según el catálogo (con lista inicial de exclusión `PENDIENTES_RLS`).
- [ ] 1.3 Crear migración `NNNNN_rcd_fase1_revoke_anon.sql`:
  - `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`
  - `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;`
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;`
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;`
  - Bloque `-- DOWN:` restaurando grants estándar.
- [ ] 1.4 Test de regresión verificando que `anon` recibe `42501` en PostgREST (`tests/db/rls-guardian.test.ts`).
- [ ] 1.5 Ejecutar `pnpm gate:db` y verificar reporte limpio.

---

## Fase 2 — Protección de Datos Personales y Terceros (`cliente`, `proveedor`)

- [ ] 2.1 Crear migración `NNNNN_rcd_fase2_clientes_proveedores.sql`:
  - Policies restrictivas en `cliente` (SELECT para `ventas.ver` O `ventas.crear`, INSERT para `ventas.crear`, UPDATE para `ventas.editar`, DELETE para `ventas.eliminar`).
  - Policies restrictivas en `proveedor` (SELECT para `inventario.ver` O `consignaciones.ver` O `rendiciones.ver`, INSERT para `inventario.crear`, UPDATE para `inventario.editar`, DELETE para `inventario.eliminar`).
  - Bloque `-- DOWN:` con drop policies correspondientes.
- [ ] 2.2 Quitar `cliente` y `proveedor` de `PENDIENTES_RLS` en `tests/db/rls-guardian.test.ts`.
- [ ] 2.3 Tests de integración en `tests/db/rls-cerrado-por-defecto.test.ts`:
  - Rol sin permiso recibe 0 filas en SELECT de cliente y proveedor.
  - Rol con `ventas.ver` lee clientes con normalidad.
  - Intento de mutación sin permiso retorna 42501 o 0 filas.
  - Revendedora no puede leer clientes del tenant.
- [ ] 2.4 Ejecutar `pnpm gate:db`.

---

## Fase 3 — Tablas Financieras y Transacciones de Dinero

Tablas: `venta`, `pago_venta`, `cuota_financiada`, `cuenta_destino`, `arancel_cobro`, `reintegro_cliente`.

- [ ] 3.1 Crear migración `NNNNN_rcd_fase3_dinero_finanzas.sql`:
  - Policies restrictivas de SELECT/INSERT/UPDATE/DELETE en `venta`, `pago_venta`, `cuota_financiada`.
  - Policies restrictivas en `cuenta_destino`, `arancel_cobro` y `reintegro_cliente`.
  - Cierre de mutaciones directas en `venta` y `pago_venta`.
  - Bloque `-- DOWN:` ejecutable.
- [ ] 3.2 Quitar las 6 tablas financieras de `PENDIENTES_RLS`.
- [ ] 3.3 Tests en `tests/db/rls-cerrado-por-defecto.test.ts`:
  - Rol sin permisos financieros recibe 0 filas en ventas, cobros y cuotas.
  - Flujo feliz de cobro de cuotas (`sp_cobrar_cuota`) y anulación de venta (`sp_anular_venta`) con rol `Vendedora-Local`.
  - Intento de lectura de `cuenta_destino` por roles no autorizados retorna 0 filas.
- [ ] 3.4 Ejecutar `pnpm gate:db`.

---

## Fase 4 — Stock, Catálogo y Operaciones Comerciales

Tablas: `item_producto`, `movimiento_item`, `detalle_venta`, `cambio_venta`, `devolucion_venta`, `reserva`, `detalle_reserva`, `comprobante`, `ingreso_mercaderia`, `producto`, `categoria`.

- [ ] 4.1 Crear migración `NNNNN_rcd_fase4_stock_comercial.sql`:
  - Policies restrictivas en circuito comercial (`detalle_venta`, `cambio_venta`, `devolucion_venta`, `reserva`, `detalle_reserva`, `comprobante`).
  - Policies restrictivas en stock (`item_producto`, `movimiento_item`, `ingreso_mercaderia`).
  - Policies restrictivas de catálogo (`producto`, `categoria`) permitiendo SELECT `todo_el_tenant` y cerrando mutaciones a `inventario.crear/editar/eliminar`.
  - Bloque `-- DOWN:` ejecutable.
- [ ] 4.2 Quitar las 11 tablas de `PENDIENTES_RLS`.
- [ ] 4.3 Tests en `tests/db/rls-cerrado-por-defecto.test.ts`:
  - Verificación de que `sp_registrar_venta` no se bloquea por el FOR UPDATE en `item_producto`.
  - Verificación de que `sp_confirmar_ingreso` y `sp_crear_stock_directo` operan normalmente con rol `Encargada`.
  - Usuario sin permisos no puede modificar catálogo ni reservar ítems.
- [ ] 4.4 Ejecutar `pnpm gate:db`.

---

## Fase 5 — Consignaciones y Canal Revendedoras

Tablas: `consignacion`, `consignacion_detalle`, `consignacion_revendedora`, `consignacion_revendedora_detalle`, `declaracion_venta_revendedora`, `liquidacion_revendedora`, `pago_revendedora`, `escala_comision`, `regla_comision`, `revendedora`.

- [ ] 5.1 Crear migración `NNNNN_rcd_fase5_consignaciones_revendedoras.sql`:
  - Policies restrictivas en consignaciones a proveedor (`consignacion`, `consignacion_detalle`).
  - Policies restrictivas en canal revendedoras (`consignacion_revendedora`, `consignacion_revendedora_detalle`, `declaracion_venta_revendedora`, `liquidacion_revendedora`, `pago_revendedora`, `revendedora`, comisiones).
  - Bloque `-- DOWN:` ejecutable.
- [ ] 5.2 Quitar las 10 tablas de `PENDIENTES_RLS`.
- [ ] 5.3 Tests en `tests/db/rls-cerrado-por-defecto.test.ts`:
  - Flujo de liquidación de revendedoras (`sp_generar_liquidacion`, `sp_marcar_liquidacion_pagada`).
  - Portal de revendedoras (`rvp_*`) sin degradación ni bloqueos para Ana y Berta.
  - Usuario ajeno a revendedoras no ve liquidaciones ni declaraciones.
- [ ] 5.4 Ejecutar `pnpm gate:db`.

---

## Fase 6 — Configuración, Reglas Operativas y Sellado Parcial

Tablas: `configuracion`, `cotizacion_config`, `cotizacion_dolar`, `plan_cuotas`, `recargo_cuotas`, `producto_sku_seq`, `consulta_ayuda`, `costo_producto` (mutaciones), `regla_precio` (mutaciones), `auditoria` (mutaciones).

- [ ] 6.1 Crear migración `NNNNN_rcd_fase6_configuracion_y_parciales.sql`:
  - Policies restrictivas en configuración general, cotizaciones y asistente IA.
  - Policies restrictivas en `plan_cuotas` y `recargo_cuotas`.
  - Cierre de `INSERT`, `UPDATE` y `DELETE` en `costo_producto` (a `inventario.cargar_costos`) y `regla_precio` (a `precios.crear/editar`).
  - Remoción de policy permisiva `ALL` en satélites de costo (`detalle_venta_costo`, etc.), dejando solo `SELECT`.
  - Bloque `-- DOWN:` ejecutable.
- [ ] 6.2 Quitar las tablas de `PENDIENTES_RLS`.
- [ ] 6.3 Tests en `tests/db/rls-cerrado-por-defecto.test.ts`:
  - Intento de mutar `costo_producto` o `regla_precio` directamente sin permisos falla.
  - Recálculo de cotización y planes de cuotas operan según permisos.
- [ ] 6.4 Ejecutar `pnpm gate:db`.

---

## Fase 7 — Plataforma, Tenant y Cierre 100% del Guardián

Tablas: `tenant`, `tenant_modulo`, `modulo`.

- [ ] 7.1 Crear migración `NNNNN_rcd_fase7_tenant_plataforma.sql`:
  - Policy restrictiva de UPDATE en `tenant` exigiendo `administracion.editar`.
  - Cierre estricto de mutaciones en `tenant_modulo` y `modulo` a solo DEFINER / service role.
  - Bloque `-- DOWN:` ejecutable.
- [ ] 7.2 Vaciar completamente `PENDIENTES_RLS`: la lista queda en `[]`.
- [ ] 7.3 Actualizar `AGENTS.md` (compactando comandos para mantener ≤150 líneas) y `supabase/README.md`.
- [ ] 7.4 Ejecutar suite completa `pnpm gate:full`.

---

## Gates Humanos

- [ ] **Gate H1 — Aprobación de Spec y Decisiones de Arquitectura**: Revisión de las decisiones `D-RCD-01` a `D-RCD-03` por parte de la persona antes de escribir código o migraciones.
- [ ] **Gate H2 — Validación de Matriz de Permisos vs. Tenants Productivos**: Confirmar que los roles reales de los clientes en producción no se verán afectados en sus tareas cotidianas.
- [ ] **Gate H3 — Aprobación de Despliegue en `utopia-dev`**: Verificación en base staging previo al merge a main.
