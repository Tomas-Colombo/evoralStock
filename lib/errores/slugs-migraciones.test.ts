import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SLUGS_CON_MENSAJE } from './mensajes'

/**
 * Lee los `raise exception` de supabase/migrations y exige que cada slug tenga
 * mensaje en el catálogo. `mensajes.test.ts` solo verifica la lista que alguien
 * mantiene a mano: un SP nuevo con un slug nuevo pasaba en verde y el operador
 * veía la frase genérica. Este test no depende de que alguien se acuerde.
 */

const DIR_MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')

/** Un slug es kebab-case. Todo lo demás es un aviso en prosa de la propia migración. */
const ES_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Slugs que existen en una migración y NO tienen mensaje en el catálogo. Cada
 * uno lleva su razón. La lista solo puede achicarse: el test falla si un slug
 * nuevo no tiene mensaje, y también si una entrada de acá ya no hace falta.
 */
const SIN_MENSAJE: Record<string, string> = {
  // Invariantes defensivas: solo saltan por un bug o por escribir directo en la
  // base. El operador no las alcanza desde la UI, así que cae el genérico.
  'venta-inmutable': 'trigger 00068, defensivo',
  'detalle-venta-inmutable': 'trigger 00068, defensivo',
  'detalle-venta-costo-inmutable': 'trigger 00156, defensivo',
  'detalle-venta-rendicion-inmutable': 'trigger 00156, defensivo',
  'devolucion-venta-costo-inmutable': 'trigger 00156, defensivo',
  'devolucion-not-found': 'invariante interna del sellador fn_sellar_costo_devolucion (00156)',
  'pago-venta-inmutable': 'trigger 00068, defensivo',
  'cuadre-pagos-fallido': 'constraint trigger 00068, defensivo',
  'financiacion-no-cuadra': 'chequeo defensivo de sp_registrar_venta',
}

function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
}

function slugsPorMigracion(): Map<string, string> {
  const encontrados = new Map<string, string>()
  const archivos = readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()

  for (const archivo of archivos) {
    const sql = sinComentarios(readFileSync(join(DIR_MIGRACIONES, archivo), 'utf8'))
    for (const m of sql.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)) {
      // 'slug: detalle=%' -> 'slug'
      const slug = m[1].split(':')[0].trim()
      if (ES_SLUG.test(slug) && !encontrados.has(slug)) encontrados.set(slug, archivo)
    }
  }
  return encontrados
}

describe('slugs de las migraciones contra el catálogo de mensajes', () => {
  const enMigraciones = slugsPorMigracion()
  const conMensaje = new Set(SLUGS_CON_MENSAJE)

  it('encuentra los raise exception (el escaneo no está vacío)', () => {
    // Si el regex o la ruta se rompen, el resto del archivo pasaría en vacío.
    expect(enMigraciones.size).toBeGreaterThan(50)
  })

  it('todo slug que levanta un SP tiene mensaje en el catálogo', () => {
    const faltantes = [...enMigraciones]
      .filter(([slug]) => !conMensaje.has(slug) && !(slug in SIN_MENSAJE))
      .map(([slug, archivo]) => `${slug}  (${archivo})`)

    expect(
      faltantes,
      'Slug sin mensaje: agregalo a lib/errores/mensajes.ts y a la lista de ' +
        'lib/errores/mensajes.test.ts. Si es una invariante que el operador no ' +
        'puede alcanzar, sumalo a SIN_MENSAJE con su razón.',
    ).toEqual([])
  })

  it('SIN_MENSAJE no tiene entradas viejas', () => {
    const sobrantes = Object.keys(SIN_MENSAJE).filter(
      (slug) => conMensaje.has(slug) || !enMigraciones.has(slug),
    )

    expect(
      sobrantes,
      'Estas entradas ya tienen mensaje o ya no se levantan en ninguna migración: sacalas de SIN_MENSAJE.',
    ).toEqual([])
  })
})
