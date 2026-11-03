import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function obtenerArchivos(directorio: string): string[] {
  const entradas = fs.readdirSync(directorio, { withFileTypes: true })
  const archivos: string[] = []

  for (const entrada of entradas) {
    const rutaCompleta = path.join(directorio, entrada.name)
    if (entrada.isDirectory()) {
      archivos.push(...obtenerArchivos(rutaCompleta))
    } else if (
      entrada.isFile() &&
      (entrada.name.endsWith('.ts') || entrada.name.endsWith('.tsx'))
    ) {
      archivos.push(rutaCompleta)
    }
  }

  return archivos
}

describe('Aislamiento de lib/ayuda', () => {
  it('REQ-AYUDA-09 N1: ningún archivo de lib/ayuda (salvo config.ts y tests) importa DAL, Supabase ni next/headers', () => {
    const baseDir = path.resolve(__dirname)
    const todosLosArchivos = obtenerArchivos(baseDir)

    const archivosAInspeccionar = todosLosArchivos.filter((archivo) => {
      const nombre = path.basename(archivo)
      const esTest = nombre.includes('.test.') || nombre.includes('.spec.')
      const esExcepcionConfig = nombre === 'config.ts'
      return !esTest && !esExcepcionConfig
    })

    const importRegex = /(?:from\s+|import\s*\(?)\s*['"]([^'"]+)['"]/g
    const violaciones: Array<{ archivo: string; modulo: string }> = []

    for (const archivo of archivosAInspeccionar) {
      const contenido = fs.readFileSync(archivo, 'utf-8')
      let match: RegExpExecArray | null

      while ((match = importRegex.exec(contenido)) !== null) {
        const modulo = match[1]
        const importaDal = modulo.includes('lib/dal')
        const importaSupabase = modulo.startsWith('@supabase/')
        const importaHeaders = modulo === 'next/headers' || modulo.startsWith('next/headers')

        if (importaDal || importaSupabase || importaHeaders) {
          violaciones.push({
            archivo: path.relative(process.cwd(), archivo).replace(/\\/g, '/'),
            modulo,
          })
        }
      }
    }

    expect(
      violaciones,
      `Se encontraron imports prohibidos en lib/ayuda:\n${JSON.stringify(violaciones, null, 2)}`,
    ).toEqual([])
  })
})
