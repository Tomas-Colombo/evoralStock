# Tareas — etiquetas-configurables

**Spec**: `proposal.md` + `specs/REQ-ETQ.md`. Cada fase: su commit, sus tests y el gate que corresponde.

## F1 — Base de datos (`pnpm gate:db`)

- [ ] 1.1 Migración EAN: `fn_ean13_digito`, `item_producto.codigo_ean`, `item_ean_seq`, trigger de asignación + inmutabilidad, backfill, `not null` + único `(id_tenant, codigo_ean)` (REQ-ETQ-02, §5).
- [ ] 1.2 Migración `etiqueta_config` + `etiqueta_plantilla` con policies (§2.2) y los 5 `sp_*` (§2.1), auditados como los `sp_set_configuracion_*` actuales.
- [ ] 1.3 Migración de datos desde `configuracion` y retiro de `sp_set_configuracion_qr_lado_mm` / `sp_set_configuracion_impresora` (REQ-ETQ-07).
- [ ] 1.4 `provision-tenant` crea la plantilla predeterminada (REQ-ETQ-07 N2).
- [ ] 1.5 Registrar las 3 tablas en `lib/seguridad/permisos-tablas.ts` **si ya existe**; si no, nada (RCD las toma de §2.2).
- [ ] 1.6 `tests/db/etiquetas.test.ts` + actualizar `rls-por-permiso.test.ts` por los SP retirados.

## F2 — Dominio puro y render (`pnpm gate`)

- [x] 2.1 `lib/etiquetas/{simbologias,ean13,layout,limites}.ts` + tests.
- [x] 2.2 `lib/validation/etiquetas.ts` + tests.
- [x] 2.3 Agregar `bwip-js`; `components/etiquetas/CodigoEtiqueta.tsx` y `Etiqueta.tsx` + tests.

## F3 — Administración

- [x] 3.1 `lib/dal/etiquetas/etiquetas.ts`; borrar DAL y validación `*QrLadoMm*` / `*Impresora*`.
- [x] 3.2 Actions con las tres compuertas en `administracion/actions.ts`; slugs en `mensajes.ts`.
- [x] 3.3 `ConfiguracionEtiquetasCard` + `PlantillasEtiquetaCard` con vista previa; borrar las dos cards viejas.

## F4 — Impresión y ficha

- [ ] 4.1 `listItemsParaEtiquetas*` devuelven `codigo_ean`.
- [ ] 4.2 `SelectorPlantilla` (`components/ui/Select`) + `?plantilla=` + `ImprimirEtiquetasClient` sobre `layout`/`Etiqueta`.
- [ ] 4.3 La ficha del ítem usa `CodigoEtiqueta` con el método del tenant; borrar `QrDisplay` y `qrcode`.

## F5 — Lectura

- [ ] 5.1 `findItemByEan` + `resolverCodigo` con EAN (REQ-ETQ-06).
- [ ] 5.2 Pasar por el resolver: `api/consignaciones/lookup-item`, `ficha/[qr]`, `ProductosTableClient:243` (a `/inventario/buscar/`).
- [ ] 5.3 Revisar las suposiciones de "24 hex": `NuevaVentaView:241`, `buscar/[codigo]/page.tsx:27`, `inventario/actions.ts:398`.
- [ ] 5.4 Texto de `QrScanner`: "Escaneá el código".

## F6 — Cierre (`pnpm gate:full`)

- [ ] 6.1 Guía de ayuda (§8); `cobertura.test.ts` en verde.
- [ ] 6.2 E2E de `imprimir-etiquetas`.
- [ ] 6.3 `supabase/README.md`: nota de `codigo_ean` y del trigger.

## Gates humanos

- [ ] **H1** — Aprobación de esta spec (D-ETQ-01…05).
- [ ] **H2** — Revisión de F1 (migraciones + DOWN) antes de F3.
- [ ] **H3** — Prueba de impresión real en una térmica de rollo y en una hoja A4.
