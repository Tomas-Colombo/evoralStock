import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Permiso } from '@/lib/types/administracion'
import { GUIA } from './index'

/**
 * Rutas de páginas estáticas en app/(app) que no tienen entrada en la guía.
 *
 * Las páginas dinámicas ([id], [qr], [codigo], etc.) quedan afuera de esta lista y de la
 * verificación por diseño: la guía de ayuda solo enlaza a rutas estáticas (pantallas principales,
 * listados o formularios de creación), ya que no puede adivinar identificadores concretos de
 * entidades en tiempo de ejecución.
 *
 * Cada ruta en esta lista debe justificar con un comentario por qué no tiene ayuda.
 */
export const RUTAS_SIN_AYUDA: readonly string[] = [
  // app/(app)/page.tsx: es un redirect directo a /ventas (el espacio de trabajo principal).
  // La raíz no renderiza interfaz ni dashboard propio; se conserva solo por retrocompatibilidad de links.
  '/',

  // app/(app)/inventario/productos/page.tsx: es un redirect a /inventario preservando query params.
  // El catálogo de productos ahora vive directamente en /inventario; la ruta se mantiene solo por retrocompatibilidad.
  '/inventario/productos',

  // app/(app)/no-autorizado/page.tsx: pantalla de bloqueo cuando el usuario no tiene permisos o el módulo está deshabilitado.
  // No ofrece guía interactiva porque el usuario no tiene acceso a operar el sistema en esta vista.
  '/no-autorizado',
]

/**
 * Mapeo del primer segmento de la URL al permiso `ver` exigido por el layout correspondiente.
 * Fuente de verdad: tabla "Mapa de módulos" en docs/modulos.md.
 */
const RUTA_A_PERMISO_VER: Record<string, Permiso> = {
  administracion: 'administracion.ver',
  clientes: 'ventas.ver',
  consignaciones: 'consignaciones.ver',
  cuotas: 'ventas.ver',
  gastos: 'gastos.ver',
  inventario: 'inventario.ver',
  precios: 'precios.ver',
  proveedores: 'inventario.ver',
  rendiciones: 'rendiciones.ver',
  reportes: 'reportes.ver',
  revendedoras: 'revendedoras.ver',
  ventas: 'ventas.ver',
}

interface PaginaApp {
  archivoRelativo: string
  rutaUrl: string
  esEstatica: boolean
}

/**
 * Recorre recursivamente app/(app) y encuentra todos los page.tsx, resolviendo su ruta URL
 * sin considerar los segmentos de route group (paréntesis como "(app)").
 */
function recolectarPaginasApp(appDir: string): PaginaApp[] {
  const paginas: PaginaApp[] = []

  function explorar(dirActual: string) {
    const entradas = fs.readdirSync(dirActual, { withFileTypes: true })
    for (const entrada of entradas) {
      const rutaCompleta = path.join(dirActual, entrada.name)
      if (entrada.isDirectory()) {
        explorar(rutaCompleta)
      } else if (entrada.isFile() && entrada.name === 'page.tsx') {
        const relativoApp = path.relative(appDir, rutaCompleta).replace(/\\/g, '/')
        const partes = relativoApp.split('/')
        // Quitamos el nombre del archivo 'page.tsx'
        partes.pop()

        // Removemos route groups como (app)
        const segmentosUrl = partes.filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
        const rutaUrl = segmentosUrl.length === 0 ? '/' : `/${segmentosUrl.join('/')}`
        const esEstatica = !segmentosUrl.some((seg) => seg.includes('['))

        paginas.push({
          archivoRelativo: path.relative(process.cwd(), rutaCompleta).replace(/\\/g, '/'),
          rutaUrl,
          esEstatica,
        })
      }
    }
  }

  explorar(appDir)
  return paginas
}

describe('Cobertura de la guía de ayuda', () => {
  const appBaseDir = path.join(process.cwd(), 'app', '(app)')
  const todasLasPaginas = recolectarPaginasApp(appBaseDir)
  const rutasExistentes = new Set(todasLasPaginas.map((p) => p.rutaUrl))
  const paginasEstaticas = todasLasPaginas.filter((p) => p.esEstatica)

  it('a) Toda ruta de GUIA existe como page.tsx bajo app/(app)/**', () => {
    const rutasInvalidas: Array<{ id: string; ruta: string }> = []

    for (const entrada of GUIA) {
      if (entrada.ruta && !rutasExistentes.has(entrada.ruta)) {
        rutasInvalidas.push({ id: entrada.id, ruta: entrada.ruta })
      }
    }

    expect(
      rutasInvalidas,
      `Se encontraron entradas en GUIA con rutas que no existen como page.tsx bajo app/(app)/**:\n${rutasInvalidas
        .map((r) => `- Entrada "${r.id}": ruta "${r.ruta}" no encontrada. Corregí la ruta en lib/ayuda/guia/<area>.ts o creá la página.`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('b) Toda página ESTÁTICA de app/(app) tiene al menos una entrada con esa ruta, o está en RUTAS_SIN_AYUDA', () => {
    const rutasConGuia = new Set<string>()
    for (const entrada of GUIA) {
      if (entrada.ruta) {
        rutasConGuia.add(entrada.ruta)
      }
    }
    const rutasSinAyudaSet = new Set<string>(RUTAS_SIN_AYUDA)

    const paginasSinCobertura: Array<{ ruta: string; archivo: string }> = []

    for (const pag of paginasEstaticas) {
      if (!rutasConGuia.has(pag.rutaUrl) && !rutasSinAyudaSet.has(pag.rutaUrl)) {
        paginasSinCobertura.push({
          ruta: pag.rutaUrl,
          archivo: pag.archivoRelativo,
        })
      }
    }

    expect(
      paginasSinCobertura,
      `Se encontraron páginas estáticas en app/(app) sin cobertura de ayuda ni motivo registrado:\n${paginasSinCobertura
        .map(
          (p) =>
            `- Ruta "${p.ruta}" (${p.archivo}): agregá una entrada en lib/ayuda/guia/<area>.ts o sumala a RUTAS_SIN_AYUDA con el motivo.`,
        )
        .join('\n')}`,
    ).toEqual([])
  })

  it("c) Toda entrada con ruta exige AL MENOS el 'ver' del módulo de esa ruta", () => {
    const fallasPermisos: Array<{ id: string; ruta: string; permisoFaltante: string; permisosActuales: readonly string[] }> = []

    for (const entrada of GUIA) {
      if (!entrada.ruta) continue

      // Extraemos el primer segmento de la ruta (ej. '/ventas/nueva' -> 'ventas')
      const partes = entrada.ruta.split('/').filter(Boolean)
      const primerSegmento = partes[0]

      const permisoRequerido = primerSegmento ? RUTA_A_PERMISO_VER[primerSegmento] : undefined
      if (!permisoRequerido) {
        fallasPermisos.push({
          id: entrada.id,
          ruta: entrada.ruta,
          permisoFaltante: `(módulo desconocido para segmento "${primerSegmento}")`,
          permisosActuales: entrada.permisos,
        })
        continue
      }

      if (!entrada.permisos.includes(permisoRequerido)) {
        fallasPermisos.push({
          id: entrada.id,
          ruta: entrada.ruta,
          permisoFaltante: permisoRequerido,
          permisosActuales: entrada.permisos,
        })
      }
    }

    expect(
      fallasPermisos,
      `Se encontraron entradas con ruta que no exigen el permiso 'ver' correspondiente a su módulo:\n${fallasPermisos
        .map(
          (f) =>
            `- Entrada "${f.id}" con ruta "${f.ruta}": falta exigir "${f.permisoFaltante}". Permisos actuales: [${f.permisosActuales.join(', ')}].`,
        )
        .join('\n')}`,
    ).toEqual([])
  })

  it('d) Los ids son únicos en toda GUIA y tienen ≤ 64 caracteres', () => {
    const idsVistos = new Map<string, number>()
    const idsDuplicados: string[] = []
    const idsDemasiadoLargos: Array<{ id: string; longitud: number }> = []

    for (const entrada of GUIA) {
      const cuenta = idsVistos.get(entrada.id) ?? 0
      idsVistos.set(entrada.id, cuenta + 1)
      if (cuenta === 1) {
        idsDuplicados.push(entrada.id)
      }

      if (entrada.id.length > 64) {
        idsDemasiadoLargos.push({ id: entrada.id, longitud: entrada.id.length })
      }
    }

    expect(
      idsDuplicados,
      `Se encontraron IDs duplicados en GUIA:\n${idsDuplicados.map((id) => `- ID duplicado: "${id}"`).join('\n')}`,
    ).toEqual([])

    expect(
      idsDemasiadoLargos,
      `Se encontraron IDs con más de 64 caracteres en GUIA:\n${idsDemasiadoLargos
        .map((item) => `- ID "${item.id}" tiene ${item.longitud} caracteres (máximo permitido: 64)`)
        .join('\n')}`,
    ).toEqual([])
  })
})
