import { rankearProductos } from '@/lib/inventario/producto-match'

export interface ItemEnPoderBuscable {
  id_item: string
  nombre_producto: string
  sku: string
  qr_code: string | null
}

export type ResultadoBusquedaEnPoder =
  | { ok: true; idItem: string }
  | { ok: false; reason: 'qr-vacio' | 'item-ya-marcado' | 'item-no-en-poder-revendedora' }

/**
 * Resuelve lo escaneado contra lo que la revendedora tiene en su poder. El QR
 * identifica una unidad exacta; un SKU o un nombre elige la próxima unidad de
 * ese producto que todavía no se marcó, para poder escanear la misma etiqueta
 * de producto varias veces.
 */
export function buscarEnPoder(
  items: ItemEnPoderBuscable[],
  texto: string,
  elegidos: ReadonlySet<string>,
): ResultadoBusquedaEnPoder {
  const q = texto.trim()
  if (!q) return { ok: false, reason: 'qr-vacio' }

  const porQr = items.find((i) => i.qr_code !== null && i.qr_code === q)
  if (porQr) {
    return elegidos.has(porQr.id_item)
      ? { ok: false, reason: 'item-ya-marcado' }
      : { ok: true, idItem: porQr.id_item }
  }

  const conNombre = (lista: ItemEnPoderBuscable[]) =>
    lista.map((i) => ({ ...i, nombre: i.nombre_producto }))

  const [libre] = rankearProductos(conNombre(items.filter((i) => !elegidos.has(i.id_item))), q, 1)
  if (libre) return { ok: true, idItem: libre.id_item }

  return rankearProductos(conNombre(items), q, 1).length > 0
    ? { ok: false, reason: 'item-ya-marcado' }
    : { ok: false, reason: 'item-no-en-poder-revendedora' }
}
