# Propuesta — costo-unico

**Estado**: aprobado por la persona en chat (2026-11-06): §5 y `specs/golden.md`; D8 no aplica. Listo para implementar.

## 1. Problema

Hoy un producto tiene dos costos que no se hablan:

| Costo | Dónde | Quién lo escribe |
| --- | --- | --- |
| Costo vigente | `costo_producto` (fila con `vigente_hasta is null`) | Alta de producto, `sp_importar_remito` solo para productos **nuevos** (`00136:340`), `sp_set_costo_producto`, revaluación USD (`00137`) |
| Costo por unidad | `item_producto.costo_ingreso` | `sp_confirmar_ingreso` (`00032:80`), `sp_crear_stock_directo` (`00033:43`) |

Al reestockear un producto existente con otro costo:

1. Las unidades nuevas guardan el costo nuevo; las viejas el suyo.
2. El costo vigente **no cambia**: la rama "vincular" de `sp_importar_remito` no toca `costo_producto` y ningún trigger lo hace.
3. El precio de venta (costo vigente × margen) **no cambia** ni se marca desactualizado.
4. `setCostoProductoAction` (`app/(app)/inventario/actions.ts:471`) no tiene ningún llamador: no hay forma de corregirlo a mano.
5. `NuevoIngresoView.tsx` documenta el costo vigente como "el de la última compra", que es falso.

## 2. Decisión del negocio

**El costo vigente es el último costo de compra.** Un producto tiene un solo costo.

## 3. ¿Hacen falta las dos columnas?

Sí, pero dejan de ser dos costos: el costo vigente pasa a ser la única fuente y
`costo_ingreso` es una copia sincronizada, salvo en dos casos donde **no puede**
cambiar, porque no es "el costo del producto" sino un hecho ya ocurrido:

- **Consignación** (`tipo_ingreso = 'consignacion'`): `costo_ingreso` es lo que
  se le debe al proveedor por esa unidad. Va a `monto_proveedor = costo_snapshot`
  (check de `00067`) y a la valuación de stock consignado
  (`lib/dal/inventario/proveedor.ts:150`). Cambiarlo cambia una deuda acordada.
- **Unidades vendidas**: la venta (`sp_registrar_venta`, `00023:303`) copia el
  costo a `detalle_venta.costo_snapshot`, inmutable desde `00068`. Es historia.
  La reserva no congela costo (`sp_crear_reserva`, `00048:83`, solo guarda
  precio): una unidad reservada se sincroniza como cualquier otra en stock.

Lo que se elimina es el caso que hoy existe sin razón: **una unidad propia en
stock con un costo distinto del vigente**.

Regla resultante:

> Al confirmar un ingreso, el costo de cada producto pasa a ser el vigente, y
> todas las unidades propias sin vender de ese producto (`compra`, estado
> `disponible`, `reservado` o `en_revendedora`) toman ese mismo costo.
> `devuelto_cliente`, `devuelto` y `baja` no se tocan: son hechos cerrados.

## 4. Diseño

- **D1 — Función interna única.** `sp_aplicar_ultimo_costo(id_producto, costo,
  moneda, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor,
  motivo, ip)`: si el costo difiere del vigente, cierra el vigente, inserta el
  nuevo, sincroniza las unidades propias sin vender, marca el precio
  desactualizado (`sp_marcar_precio_desactualizado_by_producto`) y audita. Si es
  igual, no hace nada (idempotente). Toda escritura de costo pasa por acá.
- **D2 — `sp_confirmar_ingreso`.** Después de generar las unidades, llama a D1
  una vez por producto del ingreso. En un ingreso `consignacion` actualiza el
  vigente (fija el precio) pero no sincroniza unidades (§3).
- **D3 — Un costo por producto por ingreso.** Si dos líneas del mismo producto
  traen costos distintos, `sp_importar_remito` rechaza con
  `costos-distintos-mismo-producto`. Si no, "el último" sería el orden de las
  filas.
- **D4 — `sp_crear_stock_directo`.** Llama a D1 con `p_costo` cuando es mayor a 0.
- **D5 — `sp_set_costo_producto` y `sp_revaluar_costos_usd_vigentes`.** Pasan a
  usar D1, así la revaluación USD también sincroniza las unidades.
- **D6 — Precio.** No se recalcula solo: se marca desactualizado, igual que la
  revaluación USD. El operador lo resuelve en Control de precios.
- **D7 — Limpieza.** Se borra `setCostoProductoAction` y su función del DAL si
  siguen sin llamador (`rg` antes de borrar). Se corrige el comentario de
  `NuevoIngresoView.tsx` y se documenta la regla en `lib/ayuda/guia/inventario.ts`.
- **D8 — Datos existentes.** No aplica: según la persona (2026-11-06) no hay
  costos cargados en ningún tenant, así que no hay nada que migrar. Sin backfill.

## 5. Impacto financiero (requiere aprobación)

Sincronizar unidades cambia dos cifras:

| Cifra | Antes | Después |
| --- | --- | --- |
| Capital en mercadería propia (finanzas, suma de `costo_ingreso` de stock `compra`) | Lo pagado por cada unidad | Unidades × último costo |
| Ganancia de una unidad vieja vendida después del reestock | Precio − lo pagado por esa unidad | Precio − último costo |

Es una valuación a costo de reposición: el stock vale lo que cuesta reponerlo,
no lo que se pagó. La ganancia de las unidades viejas queda subestimada si el
costo subió (y sobreestimada si bajó) respecto del efectivo que realmente salió.

**Alternativa**: actualizar solo el costo vigente y no tocar `costo_ingreso`.
La ganancia es exacta, pero en stock conviven unidades del mismo producto con
costos distintos. Es lo opuesto a "un solo costo"; queda descartada salvo que
la cifra de ganancia exacta pese más.

Antes de implementar: escenario en `specs/golden.md` calculado a mano (dos
ingresos del mismo producto a costos distintos, una venta de cada uno) y OK
de la persona.

## 6. Fuera de alcance

- Costo promedio ponderado.
- Recalcular precios automáticamente.
- Pantalla de edición manual de costo (D7 la elimina en vez de agregarla).
