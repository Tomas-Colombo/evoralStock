# Propuesta — confirmar-impacto-regla

**Estado**: borrador, pendiente de aprobación.

## Problema

Hoy, ver qué hace una regla de margen lleva dos pasos separados: se crea en
`/precios/reglas` y después hay que ir a `/precios/control` para revisar y
recalcular. Casi nadie usa Control, así que el impacto de la regla queda sin
mirar. Mientras tanto los productos quedan marcados como desactualizados.

## Hechos verificados en el código (13/11/2026)

- `sp_create_regla_precio` (vigente en 00155) inserta la regla y, **solo si es de
  margen**, llama a `sp_marcar_precio_desactualizado_by_regla`. No toca `precio_venta`.
- `sp_marcar_precio_desactualizado_by_regla` (00146) aclara que solo margen
  impacta `precio_venta`; descuento y recargo se resuelven en la venta.
- `sp_calcular_precio_venta_snapshot` (00064) vende con el `precio_venta`
  guardado. **Una regla de margen recién creada no cambia nada hasta que se recalcula.**
- `sp_control_de_precios` (00040) proyecta con `resolver_regla_margen` pero solo
  devuelve `regla_margen_nombre` de la regla **aplicada** (`id_regla_margen_aplicada`),
  no la que resolvería ahora. No se puede filtrar por "productos que gana esta regla".
- Recalcular pide `precios.editar`; dar de baja una regla pide `precios.eliminar`.
- Sin `inventario.ver_costos`, la policy restrictiva de `costo_producto` deja el
  costo en null (regla de satélites), así que `precio_proyectado` sale null.

## Propuesta

Después de guardar una regla de **margen**, el mismo modal muestra un resumen de
impacto por categoría (cantidades, no productos) con tres salidas:

1. **Aplicar** → recalcula en el servidor todos los productos que gana la regla.
2. **Ver detalle** → `/precios/control?regla=<id>`, con productos en tablas por categoría.
3. **Deshacer regla** → la da de baja (si tiene `precios.eliminar`).

Cerrar el modal (X / Esc) deja la regla guardada y los precios sin aplicar.

El pop-up va **después** de guardar y no antes, porque la regla es inerte hasta
el recálculo. Así no hace falta un SP que simule una regla inexistente
duplicando la cascada, y "Ver detalle" funciona con la regla real.

## Decisiones

- **DR-CIR-01** — Confirmar después de guardar, deshacer con baja. Alternativa
  descartada: `sp_simular_regla_margen(params)` antes del insert, que duplica
  la cascada y deja a Control sin forma de mostrar la simulación.
- **DR-CIR-02** — "Afectado" = producto activo cuyo `resolver_regla_margen`
  devuelve **esta** regla. No es "producto dentro del alcance": una regla más
  específica o de mayor prioridad la tapa.
- **DR-CIR-03** — Aplicar se hace en el servidor por id de regla
  (`sp_aplicar_regla_margen`), no con la lista de ids en el cliente. Evita el
  tope de 500 de `recalcularBatchAction` y que el cliente decida el N.
- **DR-CIR-04** — Sin `inventario.ver_costos` los contadores de precio
  (`cambian`, `suben`, `bajan`, `sin_costo`) devuelven null (D-CPC-08) y la UI
  muestra solo cuántos productos pasan a esta regla.
- **DR-CIR-05 (aprobado 13/11/2026)** — Cambia la firma de `sp_control_de_precios`
  (SP compartido): agrega `id_categoria` e `id_regla_margen_resuelta` y el filtro
  por `precios.ver`, que hoy no tiene. Hace falta `drop function` + `create`.
- **DR-CIR-06** — Aplicar exige el mismo AND que `sp_recalcular_precio_venta`
  (`editar` + `ver_costos` + `ver_margenes`, D-CPC-09) y saltea los productos sin
  costo, porque recalcularlos deja su `precio_venta` en null.

## Fuera de alcance

- Reglas de descuento y recargo: siguen con el toast actual (no tocan `precio_venta`).
- La marca `precio_venta_desactualizado` que queda después de deshacer
  (comportamiento previo de `sp_baja_regla_precio`).
- Sacar o esconder el acceso a Control desde el home de Precios.
- Extender la vigencia de una regla (`sp_extender_vigencia_regla`): el mismo pop-up podría aplicar, en un cambio aparte.

Spec: [`specs/REQ-CIR.md`](specs/REQ-CIR.md).
