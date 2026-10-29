# Reporte de Ejecución — Slice 6: Paginación y Filtros en Plataforma (REQ-SA-11)

## Estado
- **Rama**: `feat/plataforma-paginacion`
- **Worktree**: `C:\Archivos de trabajo\utopia-plataforma-paginacion`
- **Base**: `feat/plataforma` (commit `98801cd` con migración `00120_alta_baja_tenant.sql`)
- **Migración nueva**: `00121_plataforma_paginacion.sql`

## Cambios Implementados
1. **DB (00121_plataforma_paginacion.sql)**:
   - Vista `tenant_listado` con `security_invoker = on`, cálculo consolidado de `saldo`, `total_cargos` y `total_pagos` mediante `coalesce` y `REVOKE ALL`.
   - Vista `tenant_movimiento` con `security_invoker = on` (union all de cargos y pagos con columnas unificadas) y `REVOKE ALL`.
   - Incorporación de ambas vistas al whitelist en `tests/db/rls-revendedoras.test.ts`.
   - Pruebas en `tests/db/plataforma.test.ts` verificando saldo 0 sin movimientos y denegación a anon/authenticated.

2. **DAL y Validación**:
   - Catálogos de filtros y orden en `lib/types/plataforma.ts` (`ESTADOS_TENANT_FILTRO`, `DEUDA_TENANT_FILTRO`, `ORDEN_TENANT_FILTRO`).
   - Esquema Zod `filtrosTenantsSchema`, helper `parseFiltrosTenants` y `hpageSchema` en `lib/validation/plataforma.ts`:
     - Parámetros fuera de catálogo caen a defaults.
     - `q` con recorte y tope de 100 caracteres; rechazo de comas y paréntesis para evitar inyecciones de sintaxis en PostgREST.
     - `page < 1` cae a 1.
   - `listarTenantsPaginado` en `lib/dal/plataforma/index.ts`:
     - Consulta a `tenant_listado` con `.range()` y `count: 'exact'`.
     - Filtros de estado, deuda, orden y `q` escapado con `escaparPatronLike`.
     - Consulta de paquetes vía `.in('id_tenant', ids)` (máximo 2 queries por render).
   - `obtenerTenantDetalle` paginado con `?hpage` (25 por página) sobre `tenant_movimiento`.

3. **UI**:
   - Barra de filtros en `TenantsView.tsx` (`FilterBar`, `Select` de estado, deuda y orden, botones "Filtrar" y "Limpiar").
   - Paginación server-side con `<Pagination>` (solo visible con más de 25 registros).
   - Modificación de cualquier filtro resetea `page` a 1.
   - Paginación `?hpage` en `HistorialTable.tsx`.
   - Distinción de estado vacío: sin comercios en plataforma vs sin resultados para los filtros aplicados.
   - Si `page` supera el total de páginas, se re-consulta y muestra la última página.

4. **Especificación**:
   - Incorporación de `REQ-SA-11` a `openspec/changes/super-admin-plataforma/specs/REQ-SA.md`.
   - Registro de tareas del Slice 6 en `openspec/changes/super-admin-plataforma/tasks.md` sin marcar compuertas humanas.

## Resultado de Verificación (.gate/report.txt)
```
gate:full: OK (exit 0)
typecheck: OK
lint: OK (0 errors, 2 warnings)
unit: OK (94 files / 1038 tests)
db: OK (40 files / 282 tests)
down: OK (7 migrations OK)
build: OK (80 routes)
fecha: 2026-10-29 19:32:55 | commit: fd13430 (feat/plataforma-paginacion)
```
