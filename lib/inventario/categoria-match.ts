import type { CategoriaRow } from '@/lib/types/inventario'
import { normalizar } from './producto-match'

/** Coincidencia mínima (en letras) para asociar un nombre a una categoría. */
export const MIN_COINCIDENCIA_CATEGORIA = 4

/** Longitud del prefijo común entre dos strings ya normalizados. */
function prefijoComun(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * Sugiere la categoría de un producto nuevo a partir de su nombre. Elige la
 * categoría cuyo nombre comparte el prefijo más largo con la primera palabra
 * del producto, siempre que coincidan al menos `MIN_COINCIDENCIA_CATEGORIA`
 * letras. Así "anillo" cae en "anillos" y "coll" en "collares", pero
 * "collar" no se confunde con "colgante" (comparten solo 3 letras).
 *
 * Si nada llega al mínimo devuelve `null` y el usuario elige. Antes caía en una
 * categoría "accesorios" que solo existía en el seed de indumentaria: en otro
 * rubro la sugerencia era arbitraria y pasaba inadvertida.
 */
export function sugerirCategoria(nombre: string, categorias: CategoriaRow[]): string | null {
  if (categorias.length === 0) return null

  // Comparamos contra la primera palabra: "anillo dorado" → "anillo".
  const primeraPalabra = normalizar(nombre).split(' ')[0] ?? ''
  if (primeraPalabra.length < MIN_COINCIDENCIA_CATEGORIA) return null

  let mejorId: string | null = null
  let mejorPrefijo = MIN_COINCIDENCIA_CATEGORIA - 1
  for (const c of categorias) {
    const p = prefijoComun(primeraPalabra, normalizar(c.nombre))
    if (p >= MIN_COINCIDENCIA_CATEGORIA && p > mejorPrefijo) {
      mejorPrefijo = p
      mejorId = c.id_categoria
    }
  }
  return mejorId
}
