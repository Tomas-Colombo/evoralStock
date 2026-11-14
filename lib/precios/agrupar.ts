export interface GrupoCategoria<T> {
  idCategoria: string | null
  nombre: string
  filas: T[]
}

/**
 * Agrupa filas por categoría para la vista de control de precios.
 *
 * Invariantes:
 * - Respeta el orden de entrada de las filas dentro de cada grupo.
 * - Ordena los grupos por nombre alfabéticamente (es-AR, localeCompare).
 * - "Sin categoría" (id null) se ubica siempre al final.
 * - Nunca devuelve grupos vacíos (si rows es vacío, devuelve []).
 */
export function agruparPorCategoria<
  T extends { id_categoria?: string | null; categoria_nombre?: string | null }
>(rows: T[]): GrupoCategoria<T>[] {
  const gruposMap = new Map<string | null, GrupoCategoria<T>>()

  for (const row of rows) {
    const id = row.id_categoria ?? null
    let grupo = gruposMap.get(id)
    if (!grupo) {
      const nombre = id === null ? 'Sin categoría' : (row.categoria_nombre ?? 'Sin categoría')
      grupo = { idCategoria: id, nombre, filas: [] }
      gruposMap.set(id, grupo)
    }
    grupo.filas.push(row)
  }

  const conCategoria: GrupoCategoria<T>[] = []
  let sinCategoria: GrupoCategoria<T> | null = null

  for (const grupo of gruposMap.values()) {
    if (grupo.filas.length === 0) continue
    if (grupo.idCategoria === null) {
      sinCategoria = grupo
    } else {
      conCategoria.push(grupo)
    }
  }

  conCategoria.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'))

  if (sinCategoria) {
    conCategoria.push(sinCategoria)
  }

  return conCategoria
}
