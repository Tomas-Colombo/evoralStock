# Tareas — modulos-opcionales

Cadena de PRs, cada uno ≤ 400 líneas cambiadas y cerrado con `pnpm gate:db`
(los de app, `pnpm gate`). Cada caso negativo de la spec es un test con su
número en el nombre.

## Gate humano

- [ ] Spec aprobada (`proposal.md` + `specs/REQ-MODOP.md`)

Todo el cambio vive en `feat/plataforma` (super admin depende del PR 1);
nada va a `main` hasta probar el conjunto en local. Migraciones nuevas desde
el siguiente número libre (hoy `00122`).

## PR 1 — DB: guarda de `tenant_modulo` (hecho: `6533702`, `194d86b`)

- [x] `fn_modulo_habilitado(p_tenant, p_codigo)` (INVOKER, stable)
- [x] Trigger: el núcleo no se apaga ni se borra (REQ-MODOP-01)
- [x] Constraint trigger diferido: paquete consignación de a par (REQ-MODOP-02)
- [x] Trigger: opcional con estado vivo no se apaga (REQ-MODOP-03, N1–N4) — N1 incompleto, se corrige en PR 2
- [x] `revoke` de `sp_reactivar_acceso_revendedora` (REQ-MODOP-10)
- [x] `provision-tenant`: núcleo siempre; `--modulos` solo opcionales, valida paquetes
- [x] Slugs `modulo-nucleo`, `modulo-paquete-incompleto`, `modulo-con-estado-vivo` en catálogo e inventario
- [x] `tests/db/tenant-modulo-guarda.test.ts`: casos de REQ-MODOP-01, 02, 03, 10
- [x] `tests/db/comisiones.test.ts` ajustado al revoke de `sp_toggle_tenant_modulo` (00117)

## PR 2 — DB: tablas del núcleo extendidas

- [x] Trigger `ingreso_mercaderia`: `consignacion` exige el paquete (REQ-MODOP-05 N2)
- [x] Trigger `proveedor`: `consignatario` en alta o cambio de tipo exige el paquete (REQ-MODOP-06 N2, N3)
- [x] Trigger `item_producto`: 'consignacion' exige el paquete (REQ-MODOP-05 N5)
- [x] `fn_modulo_tiene_estado_vivo`: N1 suma ítems `consignacion` en `en_revendedora` (fix forward de 00118)
- [x] `tests/db`: REQ-MODOP-05 N2, REQ-MODOP-06 N2/N3, REQ-MODOP-03 N1 con ítem en revendedora

## PR 3 — DB: SPs de consignación a proveedor

- [x] Chequeo de módulo en los 8 SPs de la matriz (desde `pnpm sp:last`)
- [x] `tests/db`: REQ-MODOP-07 N1, N2 por función

## PR 4 — DB: SPs de rendición

- [x] Chequeo de módulo en `preview_rendicion` y los 4 SPs
- [x] `tests/db`: REQ-MODOP-07 por función

## PR 5 — App: capa de capacidades + Ingresos + Proveedores

- [x] `lib/modulos/catalogo.ts`: `MODULOS_NUCLEO` + `PAQUETES_OPCIONALES` movido desde `lib/types/plataforma.ts` (plataforma lo importa) (DR-MODOP-3)
- [x] `tests/db`: el catálogo TS coincide con `fn_modulo_es_nucleo` y `fn_codigos_paquete`
- [x] `lib/modulos/capacidades.ts` + test colocado (REQ-MODOP-04), agregado a `include` de coverage
- [x] Schemas zod en `lib/validation/` para alta de ingreso y de proveedor, desde capacidades (`strictObject`)
- [x] `crearIngresoCompletoAction`: las tres gates con el schema nuevo (REQ-MODOP-05 N1, N3)
- [x] `createProveedorAction` / `updateProveedorAction`: tipo validado (REQ-MODOP-06 N1)
- [x] `NuevoIngresoView`: sin selector cuando solo hay `compra`
- [x] `NuevoProveedorForm`, `NuevoProveedorModal`: opciones desde capacidades
- [x] Slugs `tipo-ingreso-invalido`, `tipo-proveedor-invalido`

## PR 6 — App: puntos de extensión restantes

- [ ] Ficha de proveedor: KPIs y tablas de consignación/rendición por capacidad
- [ ] Reportes: `BloqueMercaderia`, `BloqueMovimientoPlata`, bloque Proveedores en `lib/reportes/bloques.ts`
- [ ] `PermisosEditor` / `RolesModal`: módulos por capacidad; rol "Revendedora" oculto sin el opcional
- [ ] Schemas de rol desde capacidades (REQ-MODOP-09 N1)
- [ ] `docs/modulos.md`: núcleo, opcionales y paquetes
- [ ] e2e: tenant sin opcionales recorre Ingresos, Proveedores, Reportes y Roles
