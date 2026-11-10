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

import { buscarDefinicionFuncion, leerMigraciones } from './sp-parser.mts'

const MIGRACIONES = 'supabase/migrations'

const nombre = process.argv[2]
if (!nombre || !/^[A-Za-z0-9_.]+$/.test(nombre)) {
  console.error('Uso: pnpm sp:last <nombre_de_funcion>')
  process.exit(1)
}

const archivos = leerMigraciones(MIGRACIONES)
const res = buscarDefinicionFuncion(archivos, nombre)

if (!res) {
  console.error(`No hay ninguna migración que defina "function ${nombre}".`)
  process.exit(1)
}

const { vigente, anteriores, borradaDespues, mismoArchivo, cuerpo } = res

console.log(`Vigente: ${vigente.archivo}:${vigente.linea}`)
if (borradaDespues.length > 0) {
  console.log(`ATENCIÓN: hay un drop function posterior en ${borradaDespues.join(', ')}`)
}
if (mismoArchivo.length > 0) {
  console.log(`Otras definiciones (¿sobrecargas?) en el mismo archivo, líneas: ${mismoArchivo.map((d) => d.linea).join(', ')}`)
}
if (anteriores.length > 0) {
  console.log(`Anteriores (${anteriores.length}):`)
  for (const d of anteriores) console.log(`  ${d.archivo}:${d.linea}`)
}
console.log('')
console.log(cuerpo)
