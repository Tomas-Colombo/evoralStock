/**
 * Helpers puros de carrito compartidos entre la venta del local y el portal de
 * revendedoras.
 */

/**
 * Agrega ítems al carrito evitando duplicados según una clave única.
 * Preserva el orden existente y devuelve el nuevo array junto con los ítems
 * que efectivamente se sumaron.
 */
export function agregarSinDuplicados<T>(
  actuales: readonly T[],
  nuevas: readonly T[],
  clave: (item: T) => string,
): { siguientes: T[]; agregadas: T[] } {
  const vistas = new Set(actuales.map(clave))
  const siguientes = [...actuales]
  const agregadas: T[] = []
  for (const item of nuevas) {
    const k = clave(item)
    if (!vistas.has(k)) {
      vistas.add(k)
      siguientes.push(item)
      agregadas.push(item)
    }
  }
  return { siguientes, agregadas }
}

/**
 * Suma los precios de los ítems del carrito, tratando `null` como 0.
 */
export function calcularTotalCarrito<T>(
  items: readonly T[],
  precio: (item: T) => number | null,
): number {
  return items.reduce((acc, item) => acc + (precio(item) ?? 0), 0)
}
