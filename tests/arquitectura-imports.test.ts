/**
 * Regla de dirección de dependencias y control de deuda de arquitectura.
 *
 * La dirección de dependencias nunca estuvo controlada y el commit fbf809e
 * convirtió una excepción en patrón; las entradas de la deuda conocida solo
 * se borran, y agregar una es volver a abrir esa deuda.
 *
 * Fronteras permitidas: app/** -> components/** -> lib/** (nunca en sentido inverso).
 * Ningún módulo o grupo de rutas en app/ puede importar de otro módulo de app/.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const DIRECTORIOS = ['app', 'components', 'lib']

function archivos(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = `${dir}/${e.name}`.replace(/\\/g, '/')
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : archivos(ruta)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

function resolverDestino(especificador: string, origen: string): string | null {
  if (especificador.startsWith('@/')) {
    return path.posix.normalize(especificador.slice(2))
  }
  if (especificador.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(origen), especificador))
  }
  return null
}

function obtenerPartes(ruta: string): { area: string | null; modulo: string | null } {
  const segmentos = ruta.split('/')
  const area = segmentos.length >= 3 ? segmentos[1] : null
  const modulo = segmentos.length >= 4 ? segmentos[2] : null
  return { area, modulo }
}

function esViolacion(origen: string, destino: string): boolean {
  // a. origen en lib/ y destino en components/ -> violación.
  if (origen.startsWith('lib/') && destino.startsWith('components/')) {
    return true
  }
  // b. destino fuera de app/ -> no hay violación.
  if (!destino.startsWith('app/')) {
    return false
  }
  // c. origen fuera de app/ -> violación.
  if (!origen.startsWith('app/')) {
    return true
  }
  // d. area de origen o destino null -> no hay violación.
  const { area: areaOrigen, modulo: moduloOrigen } = obtenerPartes(origen)
  const { area: areaDestino, modulo: moduloDestino } = obtenerPartes(destino)
  if (areaOrigen === null || areaDestino === null) {
    return false
  }
  // e. areas distintas -> violación.
  if (areaOrigen !== areaDestino) {
    return true
  }
  // f. mismo area, ambos modulos no null y distintos -> violación.
  if (moduloOrigen !== null && moduloDestino !== null && moduloOrigen !== moduloDestino) {
    return true
  }
  return false
}

function analizar(): Set<string> {
  const violaciones = new Set<string>()
  for (const dir of DIRECTORIOS) {
    for (const archivo of archivos(dir)) {
      const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
      const info = ts.preProcessFile(texto, true, true)
      for (const imp of info.importedFiles) {
        const destino = resolverDestino(imp.fileName, archivo)
        if (!destino) continue
        if (esViolacion(archivo, destino)) {
          violaciones.add(`${archivo} -> ${destino}`)
        }
      }
    }
  }
  return violaciones
}

const DEUDA_CONOCIDA = new Set<string>([])

describe('Arquitectura de dependencias', () => {
  const encontradas = analizar()

  it('ningún import cruza una frontera fuera de la deuda conocida', () => {
    const inesperadas = [...encontradas].filter((v) => !DEUDA_CONOCIDA.has(v))
    expect(inesperadas).toEqual([])
  })

  it('la deuda conocida solo se achica', () => {
    const obsoletas = [...DEUDA_CONOCIDA].filter((v) => !encontradas.has(v))
    expect(obsoletas).toEqual([])
  })
})
