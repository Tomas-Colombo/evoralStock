# Tareas — rls-por-permiso

**Change**: `rls-por-permiso` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

Fases en orden estricto. Cada fase es dueña exclusiva de sus archivos. Los
puntos de parada humana están marcados y no los tilda un agente.

**Convivencia con otros cambios en curso**:
- Número de migración: el siguiente libre al aplicar (`ls supabase/migrations | tail -1`). Nunca fijarlo antes.
- `pnpm gate:db` hace `db reset`: no correrlo mientras el otro agente use la DB local.
- Commits con archivos por nombre, nunca `git add -A`.

---

## Fase 1 — Inventario de lecturas y escrituras por módulo (solo lectura)

Cierra las preguntas de `proposal.md §6`. No toca código ni SQL.
Archivos:
- `openspec/changes/rls-por-permiso/inventario.md`

Tareas:
- [ ] Matriz tabla × módulo de permiso: para cada tabla con `id_tenant`, qué funciones de `lib/dal/**` la leen o escriben y bajo qué permiso (`requireModuleRole` de la Server Action que las llama, según `docs/modulos.md`).
- [ ] Clasificar cada tabla: **exclusiva** (un solo módulo), **compartida** (varios), **sistema** (`tenant`, `usuario`, `rol`, `modulo`, `tenant_modulo`, `configuracion`, `auditoria`).
- [ ] Listar `sp_*`/`rf_*` INVOKER que cruzan tablas de otro módulo (lecturas cruzadas), con la última definición (`pnpm sp:last`).
- [ ] Listar los `sp_*` de escritura y si chequean permiso adentro (hoy se espera que ninguno).
- [ ] Marcar qué tablas y `sp_*` toca `cotizacion-usd` (cruce con su `tasks.md`).
- [ ] Documentar cómo se identifica al administrador.
- [ ] Columnas sensibles en tablas compartidas (costo, ganancia, margen), insumo de `costos-por-columna`.

### Gate humano
- [ ] Inventario revisado por la persona.

---

## Fase 2 — Spec y decisiones

Archivos:
- `openspec/changes/rls-por-permiso/specs/REQ-RLSP.md` (plantilla `openspec/templates/spec.md`)

Tareas:
- [ ] Requisitos con casos negativos numerados por tabla de la Fase 4.
- [ ] Matriz de permisos: rol con permiso / sin permiso / Administrador / revendedora / otro tenant.
- [ ] Decisión: ¿la policy exige también el módulo habilitado (`tenant_modulo`) o solo el permiso?
- [ ] Resolución de cada lectura cruzada (§4 de la plantilla).

### Gate humano
- [ ] Spec aprobada por la persona.

---

## Fase 3 — Helper `auth_tiene_permiso`

Archivos:
- `supabase/migrations/<siguiente>_auth_tiene_permiso.sql`
- `tests/db/rls-por-permiso.test.ts`

Tareas:
- [ ] Función `stable`, INVOKER, con `-- DOWN:`. Si exige DEFINER: PARAR y preguntar.
- [ ] Tests: con permiso → true; sin permiso → false; sin JWT / sin tenant → false; usuario de otro tenant → false; permiso revocado → false en la consulta siguiente.
- [ ] Medir costo con `explain analyze` sobre una tabla de 10k filas usando `(select auth_tiene_permiso(...))`.
- [ ] `pnpm gate:db`.

---

## Fase 4 — Policies restrictivas en tablas exclusivas

Archivos:
- `supabase/migrations/<siguiente>_rls_por_permiso.sql`
- `tests/db/rls-por-permiso.test.ts`

Tareas:
- [ ] Una policy `restrictive` por tabla exclusiva confirmada en Fase 1 (candidatas: `costo_producto`, `gasto_negocio`, `categoria_gasto`, `proveedor`, `rendicion_proveedor`, `ingreso_mercaderia`, `ingreso_mercaderia_detalle`), con su `-- DOWN:`.
- [ ] Matriz de tests rol × tabla × operación (select/insert/update/delete) por PostgREST con JWT de empleado limitado.
- [ ] Regresión: las suites existentes de `tests/db` siguen pasando con el rol Administrador.
- [ ] `pnpm gate:db`.

---

## Fase 5 — Chequeo de permiso dentro de los `sp_*` de escritura

`cotizacion-usd` ya está en main: partir siempre de `pnpm sp:last`, que trae
sus versiones de `sp_set_costo_producto`, `sp_confirmar_ingreso` y `sp_importar_remito`.
No correr en paralelo con otro cambio que reescriba los mismos `sp_*`.

Archivos:
- `supabase/migrations/<siguiente>_sp_exigir_permiso.sql`
- `tests/db/rls-por-permiso.test.ts`

Tareas:
- [ ] Cada `sp_*` parte de `pnpm sp:last <nombre>`; diff mínimo: chequeo al inicio que lanza un slug (`no-permission`).
- [ ] Slug nuevo, si hace falta, en `lib/errores/mensajes.ts` y su inventario de test.
- [ ] Tests: llamada directa por RPC con rol sin permiso → rechazo.
- [ ] `pnpm gate:full`.

### Gate humano
- [ ] Cambio verificado por la persona.

---

## Fuera de este cambio

- `costos-por-columna`: columnas de costo y ganancia en `venta` / `detalle_venta` (ver `proposal.md §4`).
