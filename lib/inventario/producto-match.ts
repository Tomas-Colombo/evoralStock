/**
 * Normaliza nombres para el match: minúsculas, sin acentos, espacios
 * colapsados. Se usa para decidir si un nombre escrito a mano (o leído de un
 * PDF) corresponde a un producto que ya existe en el inventario.
 */
export function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // saca acentos (combining marks)
    .replace(/\s+/g, ' ')
}

/**
 * Índice nombre-normalizado → producto existente. Ante nombres duplicados se
 * queda con el primero (el listado ya viene ordenado por el server).
 */
export function indexarPorNombre<T extends { nombre: string }>(
  productos: T[],
): Map<string, T> {
  const m = new Map<string, T>()
  for (const p of productos) {
    const k = normalizar(p.nombre)
    if (!m.has(k)) m.set(k, p)
  }
  return m
}

/**
 * Busca el producto existente cuyo nombre coincide (normalizado) con el texto
 * dado. Devuelve `null` si el nombre está vacío o no matchea nada: en ese caso
 * el nombre es único y el producto se trata como nuevo.
 */
export function buscarMatchNombre<T>(
  index: Map<string, T>,
  nombre: string,
): T | null {
  const k = normalizar(nombre)
  if (!k) return null
  return index.get(k) ?? null
}

/**
 * Sugerencias del buscador de productos (ventas, consignaciones): SKU exacto,
 * después prefijo de SKU, prefijo de nombre, SKU que contiene y nombre que
 * contiene; a igual puntaje, orden alfabético. Texto vacío → sin sugerencias.
 */
export function rankearProductos<T extends { nombre: string; sku: string | null }>(
  productos: T[],
  texto: string,
  limite = 8,
): T[] {
  const q = normalizar(texto)
  if (!q) return []
  const puntaje = (p: T): number => {
    const sku = normalizar(p.sku ?? '')
    const nombre = normalizar(p.nombre)
    if (sku && sku === q) return 0
    if (sku && sku.startsWith(q)) return 1
    if (nombre.startsWith(q)) return 2
    if (sku && sku.includes(q)) return 3
    if (nombre.includes(q)) return 4
    return Number.POSITIVE_INFINITY
  }
  return productos
    .map((p) => ({ p, s: puntaje(p) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => a.s - b.s || a.p.nombre.localeCompare(b.p.nombre))
    .slice(0, limite)
    .map((x) => x.p)
}
