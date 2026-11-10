# Propuesta — costos-por-columna

**Change**: `costos-por-columna` · **Spec**: `proposal.md` (+ `specs/REQ-CPC.md` en Fase 2) · **Tareas**: `tasks.md`

## 1. Problema

`rls-por-permiso` cerró dos frentes: quién **escribe** (cada `sp_*` exige
`auth_tiene_permiso`) y quién **lee** cuatro tablas que pertenecen enteras a un
módulo (`gasto_negocio`, `categoria_gasto`, `rendicion_proveedor`,
`ingreso_mercaderia_detalle`, en `00142`). Quedó abierto quién **lee los
costos**, porque viven en columnas de tablas compartidas:

- `item_producto.costo_ingreso`: lo que se pagó por cada unidad.
- `detalle_venta.costo_snapshot` y `monto_ganancia`: el costo y la ganancia de cada venta.
- `costo_producto`: el historial de costos (tabla entera, sin policy por permiso).
- Y el resto de `rls-por-permiso/inventario.md §4`: costo de cobro, costo
  recuperado, comisiones, aranceles y margen de las reglas de precio.

RLS filtra **filas, no columnas**. Un vendedor necesita las filas de
`item_producto` para escanear y vender, y las de `detalle_venta` para ver sus
ventas; con ellas vienen las columnas de costo. La anon key es pública y la
sesión es accesible desde el navegador: hoy un empleado con rol limitado puede
pedir por PostgREST el costo y la ganancia de todas las ventas del tenant.

Hay tenants en producción con empleados de rol limitado: el hueco está activo.

## 2. Objetivo

Que un usuario sin permiso de ver costos no pueda leer las columnas sensibles
por ningún camino (PostgREST, RPC, vistas), sin romper lo que ese usuario sí
hace (vender, ingresar, consignar) y sin que quien tiene permiso vea algo
distinto de lo que ve hoy. La aislación por tenant, la de revendedoras y los
chequeos de `rls-por-permiso` no cambian.

## 3. El nudo

Las operaciones leen el costo **con los permisos de quien opera**:
`sp_registrar_venta` es INVOKER y lee `v_item.costo_ingreso` para guardar el
`costo_snapshot` de la venta. Ocultarle la columna al vendedor sin rediseñar
rompe la venta. Lo mismo puede pasar con cualquier `sp_*`, `rf_*` o vista
INVOKER que lea costos; la Fase 1 los enumera.

## 4. Enfoques candidatos (se decide en Fase 2, con el inventario en la mano)

| Enfoque | A favor | En contra |
| --- | --- | --- |
| **A.** Revocar el SELECT de las columnas a `authenticated` | El más directo | Los `sp_*`/`rf_*` que las leen pasan a DEFINER (excepciones nuevas a AGENTS.md); todo `select('*')` de la DAL se rompe |
| **B.** Mover los costos a tablas propias con policy por permiso | RLS vuelve a funcionar: filas, no columnas | Migración grande: venta, reportes, rendiciones, consignaciones |
| **C.** Leer costos solo con funciones `rf_*` DEFINER con chequeo | Mismo patrón que el portal (`rvp_*`) | No evita ocultar las columnas: se combina con A o B |

Puede resultar una mezcla por columna. Toda función DEFINER nueva es una
excepción a AGENTS.md y necesita el OK de la persona.

## 5. Preguntas que cierra la Fase 1

1. ¿Están todas las columnas sensibles? (la lista de §4 del inventario anterior es punto de partida, no fuente: ese inventario tuvo citas inventadas).
2. ¿Quién lee cada columna? DAL (`.select` explícito o `*`), `sp_*`/`rf_*` INVOKER, vistas (`v_linea_venta`, `v_ganancia_por_producto`, …), y desde qué Action y permiso.
3. ¿Quién la escribe? (para saber qué se rompe si se mueve).
4. ¿Qué pantallas muestran cada dato y a qué roles?
5. ¿Qué permiso debería habilitar ver costos? Hoy no existe uno propio en `CATALOGO_PERMISOS`.

## 6. Fuera de alcance

- Escrituras: ya las cubre `rls-por-permiso`.
- El portal de revendedoras: ya lee por `rvp_*` DEFINER con lista blanca de columnas.
- Cambiar el modelo de permisos más allá de lo que decida la Fase 2 (si hace falta una acción nueva, va en la spec con su migración de roles).

## 7. Decisiones de la persona

**D-CPC-01 — Ver y cargar costos es un permiso que el dueño otorga por rol.**
Las dos formas de trabajar son válidas y conviven: un rol con ese permiso
carga ingresos con costo y lo ve (como hoy); un rol sin él puede cargar
ingresos sin ver ni escribir costos. Caso real que lo origina: el rol
"Vendedora-Local" de un tenant en producción tiene `inventario.crear` y
`inventario.editar`.

Consecuencias que la Fase 2 resuelve (no se deciden acá):
- Si es una acción nueva en `CATALOGO_PERMISOS` o más de una (ver costos, cargar costos, ver ganancia y márgenes).
- Qué hace un ingreso cargado sin costo: hoy `item_producto.costo_ingreso` e
  `ingreso_mercaderia_detalle.costo_unitario` son `not null check (>= 0)`, y un
  0 falsearía márgenes y rendiciones. Hace falta un estado "costo pendiente" y
  quién lo completa.
- Qué pasa con el precio de venta: `sp_recalcular_precio_venta` lo calcula desde
  el costo vigente. Un producto sin costo no tiene precio y no se puede vender.
- Cómo se migran los roles existentes: quién recibe el permiso nuevo al
  desplegar (Administrador sí; los roles limitados, según cómo trabajen hoy).

## 8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Romper una venta, un ingreso o un reporte para un rol que hoy funciona | Fase 1 lista cada lector; Fase 2 resuelve cada uno; tests por rol en `tests/db` |
| Un `select('*')` deja de funcionar al revocar columnas | Inventario de cada `select('*')` sobre estas tablas |
| Vistas INVOKER heredan el cambio sin aviso | Inventario de vistas y sus columnas |
| Abrir DEFINER de más | Lista cerrada en la spec, con test al estilo de `rvp-lecturas.test.ts` |
| Inventario con citas inventadas (pasó dos veces en el cambio anterior) | Evidencia generada por comando en un apéndice; el revisor la contrasta con su propio `rg` |
