# Tareas — costos-por-columna

**Change**: `costos-por-columna` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

Fases en orden estricto. Cada fase es dueña exclusiva de sus archivos. Los
puntos de parada humana están marcados y no los tilda un agente.

**Convivencia con otros cambios en curso**:
- Número de migración: el siguiente libre al aplicar (`ls supabase/migrations | tail -1`). Nunca fijarlo antes.
- `pnpm gate:db` hace `db reset`: no correrlo mientras otro agente use la DB local.
- Commits con archivos por nombre, nunca `git add -A`.
- Producción: no hay CI. Las migraciones van a `utopia-dev` con `supabase db push` ANTES del `git push` (`supabase/README.md`).

---

## Fase 1 — Inventario de lectores por columna (solo lectura)

Cierra las preguntas de `proposal.md §5`. No toca código ni SQL.
Archivos:
- `openspec/changes/costos-por-columna/inventario.md`

Tareas:
- [ ] Lista completa de columnas sensibles, generada por comando sobre las migraciones (nombres con costo, ganancia, margen, comision, arancel, ret_ y equivalentes) y contrastada con `rls-por-permiso/inventario.md §4`. Incluye la tabla `costo_producto` entera.
- [ ] Por columna, lectores en `lib/dal/**`: función, `.select` explícito o `*`, Action que la llama y su `requireModuleRole`.
- [ ] Por columna, lectores en SQL: `sp_*`, `rf_*` y funciones INVOKER (última definición con `pnpm sp:last`), y vistas que la exponen.
- [ ] Por columna, escritores (`sp_*` que la insertan o actualizan).
- [ ] Pantallas que muestran cada dato y qué permiso las abre (`docs/modulos.md`).
- [ ] Roles reales: qué combinaciones de permisos usan los roles limitados (sin datos de clientes; solo la forma de `rol.permisos`).
- [ ] Apéndice con la salida textual de cada comando usado; ninguna cita sin comando que la respalde.

### Gate humano
- [ ] Inventario revisado por la persona.

---

## Fase 2 — Spec y decisiones

Archivos:
- `openspec/changes/costos-por-columna/specs/REQ-CPC.md` (plantilla `openspec/templates/spec.md`)

Tareas:
- [ ] Decisión de enfoque por columna (A, B, C o mezcla, `proposal.md §4`), con su porqué.
- [ ] Decisión del permiso que habilita ver costos (uno existente o una acción nueva en `CATALOGO_PERMISOS`, con la migración de roles que implique).
- [ ] Lista cerrada de funciones DEFINER nuevas, si las hay (excepción a AGENTS.md: requiere OK de la persona).
- [ ] Resolución de cada lector de la Fase 1: qué cambia y qué no.
- [ ] Requisitos con casos negativos numerados: rol sin permiso no lee la columna por PostgREST, RPC ni vista; rol con permiso ve lo mismo que hoy; la venta, el ingreso y la consignación siguen funcionando para un rol sin permiso de costos.
- [ ] Partición de la implementación en fases con sus archivos.

### Gate humano
- [ ] Spec aprobada por la persona.

---

## Fase 3+ — Implementación

La define la Fase 2. Cada fase: migración nueva con `-- DOWN:`, partiendo de
`pnpm sp:last` para todo `sp_*` que toque; tests en `tests/db`; `pnpm gate:db`
corrido por la persona antes de commitear la migración (así se ejecuta su DOWN).

Cierre:
- [ ] `AGENTS.md` y `supabase/README.md` documentan la regla nueva, con un test que la haga cumplir.
- [ ] `pnpm gate:full`.

### Gate humano
- [ ] Cambio verificado por la persona en pantalla, con un rol limitado y con Administrador.
