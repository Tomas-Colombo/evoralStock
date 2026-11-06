# Escenario dorado — costo-unico

**Change**: `costo-unico`
**Aprobado**: por la persona en chat (2026-11-06).

Contrato de aceptación. Las cifras se calcularon a mano. Si un test da otra
cosa, el error está en la implementación o en este documento; **MUST NOT
ajustarse el test para que pase**.

## Fixtures

- Un producto P, regla de margen global 50 %, sin recargos.
- Sesión real `authenticated` (no service-role).
- Todas las unidades `compra`, en ARS.
- "Capital" = suma de `costo_ingreso` de unidades `compra` en `disponible`,
  `reservado` o `en_revendedora` del producto.

## Escenario

| Paso | Acción | Esperado |
| --- | --- | --- |
| E1 | Ingreso confirmado: 5 u × 1.000 | Vigente 1.000. Precio resuelto 1.500. Capital 5.000. |
| E2 | Venta A de 1 unidad de E1 a 1.500 | `costo_snapshot` 1.000, `monto_ganancia` 500. Capital 4.000. |
| E3 | Ingreso confirmado: 5 u × 1.300 | Vigente 1.300 (el de E1 cerrado). Las 4 unidades de E1 en stock pasan a `costo_ingreso` 1.300. P con `precio_venta_desactualizado = true`. Capital 11.700. |
| E4 | Resolver precio de P | Precio 1.950. |
| E5 | Venta B de 1 unidad de E1 a 1.950 | `costo_snapshot` 1.300, `monto_ganancia` 650. |
| E6 | Venta C de 1 unidad de E3 a 1.950 | `costo_snapshot` 1.300, `monto_ganancia` 650. |
| E7 | Cierre | Ganancia acumulada 1.800 (500 + 650 + 650). Capital 9.100 (7 × 1.300). La línea de venta A sigue con costo 1.000 y ganancia 500. |

## Contraste con el comportamiento anterior (no se testea)

Con costo por unidad: vigente fijo en 1.000, ganancia 2.100 (500 + 950 + 650)
y capital final 8.200 (3 × 1.000 + 4 × 1.300). La diferencia de +600 en
ganancia + capital es la revaluación de las 4 unidades viejas
(4 × 300 = 1.200): −300 en la venta B y +900 en el capital. No sale de caja;
es la valuación a costo de reposición aprobada en `proposal.md` §5.

## Negativos

| Caso | Esperado |
| --- | --- |
| N1: ingreso E3 en consignación | Vigente 1.300; unidades de E1 sin cambios. |
| N2: ingreso con dos líneas de P a 1.300 y 1.400 | Rechazo `costos-distintos-mismo-producto`; nada confirmado. |
| N3: reestock al mismo costo 1.000 | Sin fila nueva en `costo_producto`, sin auditoría, precio no desactualizado. |
| N4: unidad de E1 reservada antes de E3 | Pasa a 1.300 igual que las disponibles. |
| N5: unidad de E1 en `baja` o `devuelto_cliente` antes de E3 | Conserva 1.000. |
| N6: otro tenant con el mismo producto | No ve ni modifica nada. |
