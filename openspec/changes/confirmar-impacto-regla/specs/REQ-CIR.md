# Spec — confirmar-impacto-regla / precios

**Change**: `confirmar-impacto-regla` · **Requisitos**: `REQ-CIR-01…06` · **Decisiones**: `DR-CIR-01…06` (ver `../proposal.md`)

## 1. Requisitos

### REQ-CIR-01 — Impacto de una regla de margen

`sp_impacto_regla_margen(p_id_regla uuid)` MUST devolver una fila por categoría
(categoría null = "Sin categoría") con los productos activos del tenant cuyo
`resolver_regla_margen(id_producto).id_regla = p_id_regla` (DR-CIR-02).
Columnas: `id_categoria`, `categoria_nombre`, `productos`, `cambian`, `suben`,
`bajan`, `sin_costo`. MUST NOT devolver montos (costos, precios ni diferencias).

- `cambian` = precio proyectado distinto de `precio_venta` (o `precio_venta` null con costo).
- `suben` / `bajan` = subconjuntos de `cambian`. `sin_costo` = sin costo vigente.
- Categorías con `productos = 0` no aparecen.
- **Feliz**: regla de margen 50% sobre la categoría Remeras, 4 productos con costo y 1 sin costo → `productos=5, cambian=4, sin_costo=1`.
- **N1**: sin `precios.ver_margenes` → `no-permission`.
- **N2**: sin `inventario.ver_costos` → `productos` correcto; `cambian`, `suben`, `bajan` y `sin_costo` null (DR-CIR-04). No deben salir 0.
- **N3**: regla de otro tenant o inexistente → `regla-not-found`.
- **N4**: regla de descuento o recargo → `regla-no-es-margen`.
- **N5**: regla dada de baja, o con `fecha_inicio` futura → 0 filas (la cascada no la elige). La UI lo informa, ver REQ-CIR-03.
- **N6**: regla tapada por una regla de producto más específica → ese producto no cuenta.

### REQ-CIR-02 — Aplicar una regla de margen

`sp_aplicar_regla_margen(p_id_regla uuid) returns integer` MUST recalcular, en
una sola transacción y llamando a `sp_recalcular_precio_venta`, cada producto
activo que gana la regla **y tiene costo vigente**, y devolver cuántos recalculó.
Permiso: `precios.editar` **y** `inventario.ver_costos` **y** `precios.ver_margenes`,
el mismo AND que `sp_recalcular_precio_venta` (00155, D-CPC-09).

MUST NOT recalcular productos sin costo: `sp_recalcular_precio_venta` pone su
`precio_venta` en null y quedan sin poder venderse (`sin-precio-lista` en
`sp_calcular_precio_venta_snapshot`).

- **Feliz**: después de aplicar, `sp_impacto_regla_margen` devuelve `cambian = 0` y esos productos quedan con `precio_venta_desactualizado = false`.
- **N1**: falta cualquiera de los tres permisos → `no-permission`, antes de leer nada.
- **N6**: producto sin costo dentro de la regla → conserva su `precio_venta` anterior y no cuenta en el total.
- **N2**: otro tenant o inexistente → `regla-not-found`; no modifica nada.
- **N3**: no es de margen → `regla-no-es-margen`.
- **N4**: doble ejecución → idempotente (la segunda no cambia precios).
- **N5**: productos de otras reglas o de otro tenant no se tocan.

### REQ-CIR-03 — Pop-up de confirmación al crear

Al crear una regla de **margen** desde `NuevaReglaForm` (modal y ruta
`/precios/reglas/nueva`), la UI MUST pedir el impacto y mostrar un diálogo
"¿Aplicar esta regla?" con una lista por categoría: `nombre — N productos (suben X, bajan Y)`.
No lista productos.

Acciones:

| Botón | Visible si | Efecto |
| --- | --- | --- |
| Aplicar a N productos | `precios.editar` + `inventario.ver_costos` + `precios.ver_margenes` y `cambian > 0` | `aplicarReglaAction`, toast con el total, cierra |
| Ver detalle | siempre | navega a `/precios/control?regla=<id>` |
| Deshacer regla | `precios.eliminar` | `bajaReglaAction`, toast, cierra |
| Cerrar (X / Esc) | siempre | la regla queda guardada y los precios sin aplicar; el texto lo aclara |

- **Feliz**: crear regla de margen → diálogo con categorías → Aplicar → precios actualizados y la tabla de reglas refrescada.
- **N1**: regla de descuento o recargo → no hay diálogo; queda el toast actual.
- **N2**: impacto con 0 productos → diálogo con "Esta regla no cambia ningún precio ahora" + motivo probable (tapada por otra regla o vigencia futura); solo Cerrar / Deshacer.
- **N3**: sin `inventario.ver_costos` → muestra `N productos pasan a esta regla`, sin suben/bajan, y **sin** Aplicar. El texto dice que otra persona con permiso para ver costos puede aplicar los precios desde Control.
- **N4**: falla el pedido de impacto → la regla ya se creó: toast de éxito + aviso `mensajeDeError(reason)` y link a Control. Nunca un estado colgado.
- **N5**: `sin_costo > 0` → aviso: "X productos no tienen costo y no se van a recalcular".
- **N6**: doble clic en Aplicar → un solo llamado (botón deshabilitado mientras corre).

### REQ-CIR-04 — Control agrupado por categoría y filtrable por regla

`/precios/control` MUST mostrar una tabla por categoría (encabezado con nombre
y cantidad), manteniendo las columnas, permisos y acciones actuales.
Con `?regla=<uuid>` MUST mostrar solo los productos cuyo
`id_regla_margen_resuelta` es esa regla, con un aviso arriba
"Productos de la regla <nombre>" y un botón **Aplicar a todos** (mismos tres permisos que REQ-CIR-02) que usa `aplicarReglaAction`.

`sp_control_de_precios` MUST filtrar por `auth_tiene_permiso('precios','ver')`
(hoy, en 00040, no chequea ningún permiso; sin el permiso devuelve 0 filas).
`proyectarControlDePrecios` MUST poner `id_regla_margen_resuelta` en null sin
`precios.ver_margenes`, igual que `regla_margen_nombre`.

- **N4**: sin `precios.ver` → 0 filas.
- **N5**: sin `precios.ver_margenes` → `id_regla_margen_resuelta` null en la proyección; `?regla=` muestra lista vacía.
- **N1**: `regla` no es uuid → se ignora el filtro (vista completa), sin error.
- **N2**: uuid de regla inexistente o de otro tenant → lista vacía con aviso "Esa regla ya no existe".
- **N3**: los filtros y la exportación existentes siguen funcionando dentro de la vista filtrada.

### REQ-CIR-05 — Server Actions con tres gates

`impactoReglaAction(idRegla)` y `aplicarReglaAction(idRegla)` en
`app/(app)/precios/actions.ts`:

1. `requireModuleRole`: `impacto` ← `precios.ver_margenes`; `aplicar` ← `precios.editar` + `inventario.ver_costos` + `precios.ver_margenes`. El `sp_*` vuelve a chequear (la action no es la frontera).
2. `safeParse` con `z.strictObject({ idRegla: z.uuid() })` (o el schema uuid compartido si ya existe en `lib/validation/**`).
3. DAL con `parsed.data`. Devuelve `{ ok, reason }` con slug.

`aplicarReglaAction` revalida `/precios`, `/precios/reglas` y `/precios/control`.

- **N1**: input sin uuid o con claves de más → `payload-invalido` (o `extraerReasonZod`, como el resto de las actions).
- **N2**: error de Postgres → slug mapeado, nunca el texto crudo.

### REQ-CIR-06 — Guía y mensajes

- Slugs nuevos en `lib/errores/mensajes.ts` + inventario de `mensajes.test.ts`: `regla-no-es-margen`.
- `lib/ayuda/guia/precios.ts`: describir el pop-up y el filtro por regla de Control (lo exige `cobertura.test.ts`).

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `sp_impacto_regla_margen` | filas por categoría | `no-permission` (sin `ver_margenes`); null en contadores de precio (sin `ver_costos`) | `no-permission` | `no-permission` / `module-disabled` según `auth_tiene_permiso` | `regla-not-found` |
| `sp_aplicar_regla_margen` | n recalculados | `no-permission` (falta `editar`, `ver_costos` o `ver_margenes`; un test por cada uno) | `no-permission` | ídem | `regla-not-found`, 0 cambios |
| `sp_control_de_precios` (firma nueva) | igual que hoy + 2 columnas | 0 filas (sin `precios.ver`) | 0 filas | 0 filas | 0 filas |

Cada celda es un test en `tests/db/impacto-regla-margen.test.ts`. Incluir el rol
`Encargada` del seed (`precios.editar` sin `ver_margenes`): `aplicar` → `no-permission`.
`auth_tiene_permiso` de cada SP = OR de sus entradas: `impacto` ← `impactoReglaAction`
(`ver_margenes`); `aplicar` ← `aplicarReglaAction` desde reglas y control (AND de tres,
igual que `sp_recalcular_precio_venta`, al que delega).

## 3. Cifras financieras

No aplica: no se crea ni se redefine ninguna cifra. `precio_venta` lo sigue
calculando `sp_recalcular_precio_venta`; `sp_aplicar_regla_margen` solo lo
invoca por lotes. Los contadores son cantidades, no montos.

## 4. INVOKER contra RLS restrictiva

- `sp_impacto_regla_margen`: INVOKER. Lee `costo_producto` (satélite con policy
  restrictiva por `inventario.ver_costos`). **Filtra por diseño**: sin permiso,
  el costo no se ve y los contadores derivados devuelven null de forma explícita
  (chequeo de `auth_tiene_permiso('inventario','ver_costos')`). No inferir de un
  costo null. No sella ni escribe.
- `sp_aplicar_regla_margen`: INVOKER, escritor. Delega en
  `sp_recalcular_precio_venta`, que ya resuelve costo y margen. No lee satélites por su cuenta.
- `resolver_regla_margen` es INVOKER y lee `regla_precio`, cuya policy de SELECT
  oculta las reglas de margen sin `precios.ver_margenes` (3E.1; matriz de
  REQ-RCD). Sin ese permiso la cascada resuelve "sin regla" **en silencio**. Por
  eso los dos SP nuevos chequean `ver_margenes` explícitamente antes de resolver,
  y nunca devuelven 0 filas en lugar de `no-permission`.
- Revendedoras: no tienen `precios.*`, el chequeo de permiso las corta antes de leer.
- Ningún DEFINER nuevo: no se toca la whitelist (`tests/db/rvp-lecturas.test.ts`).
- No hay tablas nuevas: nada que declarar en el catálogo de `rls-cerrado-por-defecto`
  (`lib/seguridad/permisos-tablas.ts`, todavía sin implementar).

## 5. Migraciones

Una migración, con el siguiente número libre al aplicar:

1. `create function sp_impacto_regla_margen` (INVOKER).
2. `create function sp_aplicar_regla_margen` (INVOKER).
3. `sp_control_de_precios`: partir de `pnpm sp:last sp_control_de_precios` (vigente en 00040),
   `drop function` + `create` con `id_categoria uuid` e `id_regla_margen_resuelta uuid` (`r.id_regla`)
   agregadas, y el filtro `auth_tiene_permiso('precios','ver')`. DR-CIR-05: aprobado (13/11/2026).
4. Para las tres funciones: `revoke execute … from public, anon` + `grant execute … to authenticated`.
   Los default privileges de 00056 le dan execute a `anon` sobre toda rutina nueva.
   En línea con REQ-RCD-01, ninguna se expone a anónimos.
5. `-- DOWN:` borra las dos funciones nuevas y restaura `sp_control_de_precios` con la firma de 00040.

Los SQL los aplica la persona (`pnpm gate:db`), no el agente a mano.

## 6. Ubicación del código

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `app/(app)/precios/reglas/ImpactoReglaDialog.tsx` | `NuevaReglaForm` (modal y `/reglas/nueva`) | Un solo módulo: reglas. Presentacional, recibe impacto + permisos por props. |
| `app/(app)/precios/actions.ts` (+2 actions) | reglas y control | Ya es el archivo de actions compartido de precios. |
| `lib/dal/precios/regla.ts` (+`spImpactoReglaMargen`, `spAplicarReglaMargen`) | actions de precios | Única capa con SQL. |
| `lib/dal/precios/resolucion.ts` (`listControlDePrecios` mapea 2 columnas) | control | Ya existe. |
| `lib/types/precios.ts` (`ImpactoReglaCategoria`, campos nuevos de `ProductoConPrecioStatus`) | DAL, actions, UI | Tipos de dominio de precios. |
| `lib/precios/agrupar.ts` (agrupar filas por categoría, función pura + test) | `ControlDePreciosView` | Lógica pura testeable, sumarla al `include` de coverage. |

`NuevaReglaForm` ya recibe `onSuccess`: pasa a recibir el `id` creado y decide
si abre el diálogo (`tipo_regla === 'margen'`). Los permisos (`puedeAplicar`,
`puedeDeshacer`, `puedeVerCostos`) llegan desde `reglas/page.tsx`.
