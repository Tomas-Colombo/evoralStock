import type { ConsignacionConDetalle } from '@/lib/types/consignaciones'
import type {
  IngresoConResumen,
  IngresoMercaderiaDetalleRow,
  IngresoMercaderiaRow,
  ItemConProducto,
  ProductoConDetalle,
  ProductoSinCosto,
  ProveedorRow,
} from '@/lib/types/inventario'

/**
 * Proyección pura que elimina las claves de costo y margen de un producto.
 */
export function omitirCostoProducto(
  producto: ProductoConDetalle,
): ProductoSinCosto {
  const {
    costo_vigente: _costo,
    moneda_vigente: _moneda,
    id_regla_margen_aplicada: _regla,
    ...sinCosto
  } = producto
  return sinCosto
}

/**
 * Proyecta la ficha de ítem suprimiendo el costo de ingreso si la sesión no tiene permiso.
 */
export function proyectarItemConDetalle(
  item: ItemConProducto | null,
  puedeVerCostos: boolean,
): ItemConProducto | null {
  if (!item) return null
  if (puedeVerCostos) return item
  return {
    ...item,
    costo_ingreso: null,
  }
}

/**
 * Proyecta el resultado del lookup de ítems para consignación.
 */
export function proyectarLookupConsignacionItem<
  T extends { costo_ingreso?: number | null },
>(item: T, puedeVerCostos: boolean): T {
  if (puedeVerCostos) return item
  return {
    ...item,
    costo_ingreso: null,
  }
}

/**
 * Proyecta el detalle de un lote de consignación suprimiendo costo_ingreso de los ítems.
 */
export function proyectarConsignacionConDetalle(
  cons: ConsignacionConDetalle | null,
  puedeVerCostos: boolean,
): ConsignacionConDetalle | null {
  if (!cons) return null
  if (puedeVerCostos) return cons
  return {
    ...cons,
    detalles: cons.detalles.map((d) => ({
      ...d,
      item: d.item ? { ...d.item, costo_ingreso: null } : null,
    })),
  }
}

/**
 * Proyecta la lista de ingresos suprimiendo total_costo.
 */
export function proyectarIngresosConResumen(
  rows: IngresoConResumen[],
  puedeVerCostos: boolean,
): IngresoConResumen[] {
  if (puedeVerCostos) return rows
  return rows.map((r) => ({
    ...r,
    total_costo: null,
    costo_pendiente: false,
  }))
}

export type IngresoConDetallesCompletos = IngresoMercaderiaRow & {
  proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre' | 'telefono'> | null
  detalle: IngresoMercaderiaDetalleRow[]
}

/**
 * Proyecta el detalle de un comprobante de ingreso suprimiendo costo_unitario de las líneas.
 */
export function proyectarIngresoDetalle(
  ingreso: IngresoConDetallesCompletos | null,
  puedeVerCostos: boolean,
): IngresoConDetallesCompletos | null {
  if (!ingreso) return null
  const lineas =
    ingreso.detalle ??
    (ingreso as unknown as { detalles?: IngresoMercaderiaDetalleRow[] }).detalles ??
    []
  if (puedeVerCostos || !ingreso.confirmado) {
    return {
      ...ingreso,
      detalle: lineas,
    }
  }
  // Lista blanca, no `...d`: `getIngreso` trae `ingreso_mercaderia_detalle(*)`,
  // así que en runtime la línea también lleva `costo_original_usd` y la
  // cotización aplicada aunque el tipo no las declare.
  return {
    ...ingreso,
    detalle: lineas.map((d) => ({
      id_detalle: d.id_detalle,
      id_tenant: d.id_tenant,
      id_ingreso: d.id_ingreso,
      id_producto: d.id_producto,
      cantidad: d.cantidad,
      costo_unitario: null,
      talle: d.talle,
      created_at: d.created_at,
    })),
  }
}
