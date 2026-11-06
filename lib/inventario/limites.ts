import type { EstadoItem } from '@/lib/types/inventario'

/**
 * Topes de unidades, compartidos por el formulario y las Server Actions.
 *
 * Vive acá (sin `'use client'` ni `'server-only'`) porque lo necesitan los dos
 * lados: el input clampea para que el usuario vea el límite, y la action lo
 * vuelve a chequear porque el payload lo arma el navegador y se puede falsear.
 */

/** Unidades máximas por línea de stock o de remito. */
export const MAX_UNIDADES_LINEA = 1000

/** Unidades máximas que puede generar UNA operación (alta o ingreso completo). */
export const MAX_UNIDADES_OPERACION = 5000

/** Tope de etiquetas QR por tanda de impresión. */
export const ETIQUETAS_MAX = 200

/** Lado mínimo (en mm) permitido para el código QR impreso en etiquetas. */
export const QR_LADO_MM_MIN = 15

/** Lado máximo (en mm) permitido para el código QR impreso en etiquetas. */
export const QR_LADO_MM_MAX = 100

/** Lado por defecto (en mm) del código QR impreso en etiquetas (~132 px a 96 DPI). */
export const QR_LADO_MM_DEFAULT = 35

/** Rango (en mm) aceptado para el ancho y el alto de página de la impresora de etiquetas. */
export const IMPRESORA_MM_MIN = 20
export const IMPRESORA_MM_MAX = 300

/** Margen de página y separación entre etiquetas (en mm) al imprimir con medida de impresora. */
export const IMPRESORA_MARGEN_MM = 2
export const IMPRESORA_SEPARACION_MM = 2

/**
 * Estados de `item_producto` que admiten impresión o reimpresión de etiqueta QR.
 * Los ítems vendidos, dados de baja, devueltos o en poder de revendedora nunca
 * deben volver a etiquetarse en el local.
 */
export const ESTADOS_IMPRIMIBLES: readonly EstadoItem[] = ['disponible', 'reservado'] as const

/**
 * Tope del PDF de remito, atado al `bodySizeLimit` de Server Actions de Next
 * (1MB por defecto; `next.config.ts` no lo cambia). Por encima de eso el
 * request muere en el framework y la action ni se ejecuta, así que el cap
 * explícito existe para dar un mensaje entendible en vez de un error opaco.
 * Si algún día hay que aceptar remitos escaneados, se suben los DOS números.
 */
export const MAX_PDF_BYTES = 1024 * 1024

/**
 * Valida las unidades de una línea. Devuelve el mensaje de error, o `null` si
 * está bien — así encaja directo en el `reason` que devuelven las actions.
 *
 * Rechaza fraccionarios de forma explícita: cada unidad es una fila en
 * `item_producto`, así que "2,5 unidades" no tiene representación posible.
 */
export function unidadesInvalidas(cantidad: unknown, contexto: string): string | null {
  if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad <= 0) {
    return `cantidad inválida en "${contexto}": tiene que ser un entero positivo`
  }
  if (cantidad > MAX_UNIDADES_LINEA) {
    return `"${contexto}": ${cantidad} unidades supera el máximo por línea (${MAX_UNIDADES_LINEA}). Dividí la carga.`
  }
  return null
}

/**
 * Valida un monto (costo, precio). Devuelve el mensaje de error o `null`.
 *
 * El `typeof` no es paranoia: el payload lo arma el navegador, y un
 * `"NaN"` string llega hasta `::numeric` en Postgres, donde `'NaN'::numeric`
 * es un valor válido que además pasa cualquier `check (>= 0)` porque NaN se
 * ordena como mayor que todo.
 */
export function montoInvalido(monto: unknown, contexto: string): string | null {
  if (monto == null) return null
  if (typeof monto !== 'number' || !Number.isFinite(monto)) {
    return `costo inválido en "${contexto}"`
  }
  if (monto < 0) return `el costo en "${contexto}" no puede ser negativo`
  return null
}

/** Mensaje único para cuando la operación completa se pasa del tope. */
export function excedeOperacion(total: number): string {
  return `La carga suma ${total} unidades y el máximo por operación es ${MAX_UNIDADES_OPERACION}. Dividila en varias.`
}
