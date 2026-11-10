/**
 * Parser y extractor puro de funciones SQL en migraciones de Supabase.
 *
 * Extraído de scripts/sp-last.mts para permitir su consumo reutilizable tanto
 * desde la CLI como desde tests unitarios de arquitectura sin efectos colaterales.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ArchivoMigracion {
  archivo: string
  contenido: string
}

export interface Definicion {
  archivo: string
  linea: number
  /** Offset de la palabra clave `create` dentro del archivo. */
  inicio: number
}

export interface ResultadoBusquedaFuncion {
  nombre: string
  vigente: Definicion
  anteriores: Definicion[]
  borradaDespues: string[]
  mismoArchivo: Definicion[]
  cuerpo: string
}

export interface SpVivo {
  nombre: string
  archivo: string
  linea: number
  cuerpo: string
}

export function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Reemplaza bloques `/* ... *\/` por espacios y saltos de línea equivalentes,
 * preservando offsets y números de línea.
 */
export function sinComentariosDeBloque(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
}

/**
 * Remueve comentarios de línea `-- ...`.
 */
export function sinComentariosDeLinea(texto: string): string {
  return texto.replace(/--.*$/gm, '')
}

/**
 * Remueve comentarios de bloque y de línea.
 */
export function sinComentarios(texto: string): string {
  return sinComentariosDeLinea(sinComentariosDeBloque(texto))
}

/**
 * Extrae el cuerpo completo de una función desde `inicio` hasta el `;` de cierre
 * de la comilla de dólar (`$$`) o la siguiente sentencia de nivel superior.
 */
export function cuerpo(contenido: string, inicio: number): string {
  const resto = contenido.slice(inicio)
  const apertura = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(resto)
  if (apertura) {
    const etiqueta = apertura[1]
    const cierre = resto.indexOf(etiqueta, apertura.index + apertura[0].length)
    if (cierre >= 0) {
      const fin = resto.indexOf(';', cierre + etiqueta.length)
      return resto.slice(0, fin >= 0 ? fin + 1 : undefined)
    }
  }
  const siguiente = /\n\s*(create|alter|drop|grant|revoke|comment)\b/i.exec(resto.slice(1))
  return resto.slice(0, siguiente ? siguiente.index + 1 : undefined)
}

/**
 * Lee y ordena alfabéticamente los archivos SQL de un directorio de migraciones.
 */
export function leerMigraciones(directorio = 'supabase/migrations'): ArchivoMigracion[] {
  return readdirSync(directorio)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const ruta = join(directorio, f).replace(/\\/g, '/')
      return {
        archivo: ruta,
        contenido: readFileSync(ruta, 'utf8'),
      }
    })
}

/**
 * Busca el historial y la definición vigente de una función SQL por nombre.
 */
export function buscarDefinicionFuncion(
  archivos: ArchivoMigracion[],
  nombre: string,
): ResultadoBusquedaFuncion | null {
  const sinEsquema = escapar(nombre.replace(/^public\./i, ''))
  // Anclado al inicio de línea para no matchear copias comentadas en bloques DOWN.
  const definicion = new RegExp(`^[ \\t]*create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${sinEsquema}\\s*\\(`, 'gim')
  const borrado = new RegExp(`^[ \\t]*drop\\s+function\\s+(if\\s+exists\\s+)?(public\\.)?${sinEsquema}\\b`, 'gim')

  const definiciones: Definicion[] = []
  const borrados: string[] = []
  const contenidos = new Map<string, string>()

  for (const { archivo, contenido } of archivos) {
    contenidos.set(archivo, contenido)
    const visible = sinComentariosDeBloque(contenido)
    for (const m of visible.matchAll(definicion)) {
      const indice = m.index ?? 0
      definiciones.push({ archivo, linea: visible.slice(0, indice).split('\n').length, inicio: indice })
    }
    if (borrado.test(visible)) borrados.push(archivo)
    borrado.lastIndex = 0
  }

  if (definiciones.length === 0) return null

  const vigente = definiciones[definiciones.length - 1]
  const anteriores = definiciones.slice(0, -1)
  const borradaDespues = borrados.filter((a) => a > vigente.archivo)
  const mismoArchivo = anteriores.filter((d) => d.archivo === vigente.archivo)
  const textoCuerpo = cuerpo(contenidos.get(vigente.archivo) ?? '', vigente.inicio)

  return {
    nombre,
    vigente,
    anteriores,
    borradaDespues,
    mismoArchivo,
    cuerpo: textoCuerpo,
  }
}

/**
 * Función pura que recibe una lista cronológica de migraciones y devuelve los
 * procedimientos almacenados `sp_*` vivos con su último cuerpo registrado.
 * Un `sp_*` cuyo último evento es un `drop function` no está vivo.
 */
export function obtenerSpVivos(archivos: ArchivoMigracion[]): Map<string, SpVivo> {
  const eventosPorSp = new Map<string, Array<{ tipo: 'create' | 'drop'; sp: SpVivo; ordenArchivo: number; indiceEnArchivo: number }>>()

  const defRegex = /^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(sp_[A-Za-z0-9_]+)\s*\(/gim
  const dropRegex = /^[ \t]*drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(sp_[A-Za-z0-9_]+)\b/gim

  archivos.forEach(({ archivo, contenido }, ordenArchivo) => {
    const visible = sinComentariosDeBloque(contenido)

    // 1. Creates de sp_*
    for (const m of visible.matchAll(defRegex)) {
      const nombre = m[1].toLowerCase()
      const indice = m.index ?? 0
      const linea = visible.slice(0, indice).split('\n').length
      const textoCuerpo = cuerpo(contenido, indice)
      if (!eventosPorSp.has(nombre)) eventosPorSp.set(nombre, [])
      eventosPorSp.get(nombre)!.push({
        tipo: 'create',
        sp: { nombre, archivo, linea, cuerpo: textoCuerpo },
        ordenArchivo,
        indiceEnArchivo: indice,
      })
    }

    // 2. Drops de sp_*
    for (const m of visible.matchAll(dropRegex)) {
      const nombre = m[1].toLowerCase()
      const indice = m.index ?? 0
      const linea = visible.slice(0, indice).split('\n').length
      if (!eventosPorSp.has(nombre)) eventosPorSp.set(nombre, [])
      eventosPorSp.get(nombre)!.push({
        tipo: 'drop',
        sp: { nombre, archivo, linea, cuerpo: '' },
        ordenArchivo,
        indiceEnArchivo: indice,
      })
    }
  })

  const vivos = new Map<string, SpVivo>()

  for (const [nombre, evs] of eventosPorSp.entries()) {
    evs.sort((a, b) => a.ordenArchivo - b.ordenArchivo || a.indiceEnArchivo - b.indiceEnArchivo)
    const ultimo = evs[evs.length - 1]
    if (ultimo.tipo === 'create') {
      vivos.set(nombre, ultimo.sp)
    }
  }

  return vivos
}

/**
 * Determina si el cuerpo de un sp contiene una llamada ejecutable a `auth_tiene_permiso(`,
 * ignorando comentarios de bloque y comentarios de línea.
 */
export function tieneChequeoPermiso(cuerpoSp: string): boolean {
  const sinComms = sinComentarios(cuerpoSp)
  return /auth_tiene_permiso\s*\(/i.test(sinComms)
}
