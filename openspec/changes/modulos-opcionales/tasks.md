# Tareas — modulos-opcionales

Cadena de PRs, cada uno ≤ 400 líneas cambiadas y cerrado con `pnpm gate:db`
(los de app, `pnpm gate`). Cada caso negativo de la spec es un test con su
número en el nombre.

## Gate humano

- [ ] Spec aprobada (`proposal.md` + `specs/REQ-MODOP.md`)

## PR 1 — DB: guarda de `tenant_modulo`

- [ ] `fn_modulo_habilitado(p_tenant, p_codigo)` (INVOKER, stable)
- [ ] Trigger: el núcleo no se apaga ni se borra (REQ-MODOP-01)
- [ ] Constraint trigger diferido: paquete consignación de a par (REQ-MODOP-02)
- [ ] Trigger: opcional con estado vivo no se apaga (REQ-MODOP-03, N1–N4)
- [ ] `revoke` de `sp_reactivar_acceso_revendedora` (REQ-MODOP-10)
- [ ] `provision-tenant`: núcleo siempre; `--modulos` solo opcionales, valida paquetes
- [ ] Slugs `modulo-nucleo`, `modulo-paquete-incompleto`, `modulo-con-estado-vivo` en catálogo e inventario
- [ ] `tests/db`: casos de REQ-MODOP-01, 02, 03, 10

## PR 2 — DB: tablas del núcleo extendidas

- [ ] Trigger `ingreso_mercaderia`: `consignacion` exige el paquete (REQ-MODOP-05 N2)
- [ ] Trigger `proveedor`: `consignatario` en alta o cambio de tipo exige el paquete (REQ-MODOP-06 N2, N3)
- [ ] `tests/db`: casos N2/N3

## PR 3 — DB: SPs de consignación a proveedor

- [ ] Chequeo de módulo en los 8 SPs de la matriz (desde `pnpm sp:last`)
- [ ] `tests/db`: REQ-MODOP-07 N1, N2 por función

## PR 4 — DB: SPs de rendición

- [ ] Chequeo de módulo en `preview_rendicion` y los 4 SPs
- [ ] Ajustar `tests/db/comisiones.test.ts`: llama a `sp_toggle_tenant_modulo` como admin, denegado desde 00117
- [ ] `tests/db`: REQ-MODOP-07 por función

## PR 5 — App: capa de capacidades + Ingresos + Proveedores

- [ ] `lib/modulos/capacidades.ts` + test colocado (REQ-MODOP-04), agregado a `include` de coverage
- [ ] Schemas zod en `lib/validation/` para alta de ingreso y de proveedor, desde capacidades (`strictObject`)
- [ ] `crearIngresoCompletoAction`: las tres gates con el schema nuevo (REQ-MODOP-05 N1, N3)
- [ ] `createProveedorAction` / `updateProveedorAction`: tipo validado (REQ-MODOP-06 N1)
- [ ] `NuevoIngresoView`: sin selector cuando solo hay `compra`
- [ ] `NuevoProveedorForm`, `NuevoProveedorModal`: opciones desde capacidades
- [ ] Slugs `tipo-ingreso-invalido`, `tipo-proveedor-invalido`

## PR 6 — App: puntos de extensión restantes

- [ ] Ficha de proveedor: KPIs y tablas de consignación/rendición por capacidad
- [ ] Reportes: `BloqueMercaderia`, `BloqueMovimientoPlata`, bloque Proveedores en `lib/reportes/bloques.ts`
- [ ] `PermisosEditor` / `RolesModal`: módulos por capacidad; rol "Revendedora" oculto sin el opcional
- [ ] Schemas de rol desde capacidades (REQ-MODOP-09 N1)
- [ ] `docs/modulos.md`: núcleo, opcionales y paquetes
- [ ] e2e: tenant sin opcionales recorre Ingresos, Proveedores, Reportes y Roles
