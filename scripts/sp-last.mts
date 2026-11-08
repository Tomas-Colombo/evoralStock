/**
 * `pnpm sp:last <name>`: prints the LAST definition of a SQL function across
 * supabase/migrations, which is the one live in the database.
 *
 * Why: a `create or replace` copied from an older migration silently reverts
 * every fix made after it. `rg -l ... | sort | tail -1` was the documented
 * recipe; this does the same and also prints the body and the history.
 *
 * Usage: pnpm sp:last sp_registrar_venta
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRACIONES = 'supabase/migrations'

interface Definicion {
  archivo: string
  linea: number
  /** Offset of the `create` keyword inside the file. */
  inicio: number
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Blanks out `/* ... *\/` blocks, keeping length and newlines so offsets and
 * line numbers still point into the original file. 00069 keeps its DOWN as an
 * uncommented `create or replace` inside a block comment, and this script used
 * to report that copy as the live definition: copying it would have reverted
 * the `venta-anulada` guard and brought back the expense insert.
 */
function sinComentariosDeBloque(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
}

/**
 * From `create ... function` to the `;` after the closing dollar quote. Falls
 * back to the next top-level statement for bodies without dollar quoting
 * (`begin atomic ... end;`).
 */
function cuerpo(contenido: string, inicio: number): string {
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

const nombre = process.argv[2]
if (!nombre || !/^[A-Za-z0-9_.]+$/.test(nombre)) {
  console.error('Uso: pnpm sp:last <nombre_de_funcion>')
  process.exit(1)
}

const sinEsquema = escapar(nombre.replace(/^public\./i, ''))
// Line-anchored so the commented-out copies inside DOWN blocks do not match.
const definicion = new RegExp(`^[ \\t]*create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${sinEsquema}\\s*\\(`, 'gim')
const borrado = new RegExp(`^[ \\t]*drop\\s+function\\s+(if\\s+exists\\s+)?(public\\.)?${sinEsquema}\\b`, 'gim')

const archivos = readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => join(MIGRACIONES, f).replace(/\\/g, '/'))

const definiciones: Definicion[] = []
const borrados: string[] = []
const contenidos = new Map<string, string>()

for (const archivo of archivos) {
  const contenido = readFileSync(archivo, 'utf8')
  contenidos.set(archivo, contenido)
  const visible = sinComentariosDeBloque(contenido)
  for (const m of visible.matchAll(definicion)) {
    const indice = m.index ?? 0
    definiciones.push({ archivo, linea: visible.slice(0, indice).split('\n').length, inicio: indice })
  }
  if (borrado.test(visible)) borrados.push(archivo)
  borrado.lastIndex = 0
}

if (definiciones.length === 0) {
  console.error(`No hay ninguna migración que defina "function ${nombre}".`)
  process.exit(1)
}

const vigente = definiciones[definiciones.length - 1]
const anteriores = definiciones.slice(0, -1)
const borradaDespues = borrados.filter((a) => a > vigente.archivo)

console.log(`Vigente: ${vigente.archivo}:${vigente.linea}`)
if (borradaDespues.length > 0) {
  console.log(`ATENCIÓN: hay un drop function posterior en ${borradaDespues.join(', ')}`)
}
const mismoArchivo = anteriores.filter((d) => d.archivo === vigente.archivo)
if (mismoArchivo.length > 0) {
  console.log(`Otras definiciones (¿sobrecargas?) en el mismo archivo, líneas: ${mismoArchivo.map((d) => d.linea).join(', ')}`)
}
if (anteriores.length > 0) {
  console.log(`Anteriores (${anteriores.length}):`)
  for (const d of anteriores) console.log(`  ${d.archivo}:${d.linea}`)
}
console.log('')
console.log(cuerpo(contenidos.get(vigente.archivo) ?? '', vigente.inicio))
