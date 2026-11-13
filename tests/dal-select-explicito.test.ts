/**
 * Fase 3D de costos-por-columna: el DAL nombra las columnas de las tablas que
 * llevan costo o margen, nunca `select('*')` ni un embed `tabla(*)`.
 *
 * Por qué: la Fase 3E mueve esos costos a tablas satélite y oculta por policy
 * las filas de margen. Con '*' una columna movida desaparece en silencio y el
 * lector recibe undefined (y un `?? 0` la vuelve un costo falso); nombrada,
 * PostgREST falla con 42703 y la rotura se ve. Además, '*' arrastra al
 * navegador columnas nuevas que nadie decidió exponer: `getIngreso` llevaba
 * `costo_original_usd` en runtime sin que el tipo lo declarara.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()

// Tablas con columnas de costo o margen (REQ-CPC §4.1, destinos de la Fase 3E).
const TABLAS_CON_COSTO = [
  'item_producto',
  'detalle_venta',
  'ingreso_mercaderia_detalle',
  'devolucion_venta',
  'regla_precio',
  'costo_producto',
  'item_costo',
  'detalle_venta_costo',
  'detalle_venta_rendicion',
  'devolucion_venta_costo',
  'ingreso_detalle_costo',
]

function archivos(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = `${dir}/${e.name}`
    if (e.isDirectory()) return archivos(ruta)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

/** Quita los grupos `(...)` para mirar solo el nivel superior del select. */
function nivelSuperior(columnas: string): string {
  let previo = ''
  let actual = columnas
  while (actual !== previo) {
    previo = actual
    actual = actual.replace(/\([^()]*\)/g, '')
  }
  return actual
}

/** Devuelve una descripción por cada lectura con '*' sobre una tabla con costo. */
export function violaciones(fuente: string): string[] {
  const halladas: string[] = []
  const tablas = TABLAS_CON_COSTO.join('|')

  // Embed: `alias:tabla(*)`, `tabla!fk(*)`, con o sin espacios.
  const embed = new RegExp(`\\b(${tablas})(?:![\\w]+)?\\s*\\(\\s*\\*`, 'g')
  for (const m of fuente.matchAll(embed)) halladas.push(`embed ${m[1]}(*)`)

  // `.from('tabla')` seguido de su primer `.select(<literal>)`.
  const from = new RegExp(`\\.from\\(\\s*['"\`](${tablas})['"\`]\\s*\\)`, 'g')
  for (const m of fuente.matchAll(from)) {
    const resto = fuente.slice((m.index ?? 0) + m[0].length)
    const corte = resto.search(/\.from\(/)
    const tramo = corte === -1 ? resto : resto.slice(0, corte)
    const select = tramo.match(/\.select\(\s*(['"`])([\s\S]*?)\1/)
    if (!select) continue
    if (/(^|,)\s*\*\s*(,|$)/.test(nivelSuperior(select[2]))) {
      halladas.push(`from('${m[1]}').select('*')`)
    }
  }
  return halladas
}

describe('el detector de select con *', () => {
  it('marca select(*) directo, con count y con columnas mezcladas', () => {
    expect(violaciones(`s.from('item_producto').select('*')`)).toHaveLength(1)
    expect(violaciones(`s.from('regla_precio')\n  .select('*', { count: 'exact' })`)).toHaveLength(1)
    expect(violaciones('s.from(\'detalle_venta\').select(`\n  *,\n  venta:venta(id_venta)`)')).toHaveLength(1)
  })

  it('marca un embed de tabla con costo con alias o fk', () => {
    expect(violaciones(`select('*, detalle:ingreso_mercaderia_detalle(*)')`)).toEqual([
      'embed ingreso_mercaderia_detalle(*)',
    ])
    expect(violaciones(`select('id, item_producto!fk_item ( * )')`)).toHaveLength(1)
  })

  it('no marca listas explícitas ni el * de una tabla sin costo', () => {
    expect(violaciones(`s.from('item_producto').select('id_item, costo_ingreso')`)).toEqual([])
    expect(violaciones(`s.from('item_producto').select(COLUMNAS_ITEM)`)).toEqual([])
    expect(violaciones(`s.from('ingreso_mercaderia').select('*, proveedor:proveedor(*)')`)).toEqual([])
    expect(violaciones(`s.from('item_producto').select('id_item, producto:producto(*)')`)).toEqual([])
  })
})

describe('lib/dal nombra las columnas de las tablas con costo', () => {
  it('ningún archivo del DAL lee con * una tabla con costo o margen', () => {
    const encontradas = archivos('lib/dal').flatMap((ruta) =>
      violaciones(readFileSync(path.join(RAIZ, ruta), 'utf8')).map((v) => `${ruta}: ${v}`),
    )
    expect(encontradas).toEqual([])
  })
})
