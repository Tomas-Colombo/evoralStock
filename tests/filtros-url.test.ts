/**
 * Regla de navegación por URL para filtros, búsqueda y paginación.
 *
 * El patrón de `components/filtros/` se rompió porque nada lo controlaba y
 * terminaron apareciendo copias locales con `router.push` / `router.replace` y
 * query strings armados a mano. Este test no admite excepciones:
 *
 * - En `app/**` y `components/**` (fuera de `components/filtros/`), los
 *   filtros, la búsqueda y la paginación por URL pasan solo por
 *   `components/filtros/` (`PaginacionUrl`, `SelectUrl`, `BusquedaUrl`,
 *   `useFiltrosUrl`) o `FiltroPeriodo`.
 * - Navegar a otra pantalla con query string se hace con `<Link href="...">`.
 * - Ningún archivo de `app/**` o `components/**` (excepto `components/filtros/`)
 *   puede llamar `.push(` o `.replace(` sobre un receptor inicializado con
 *   `useRouter()` (ni sobre `useRouter()` directo) con un destino que lleve
 *   query string (literal/template con `?` o variable armada con
 *   `URLSearchParams`).
 * - Usar `URLSearchParams` para un `fetch('/api/...')` o navegar sin query
 *   string sigue permitido.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const DIRECTORIOS = ['app', 'components']

function archivos(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = `${dir}/${e.name}`.replace(/\\/g, '/')
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || ruta === 'components/filtros') return []
      return archivos(ruta)
    }
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

function esLlamadaUseRouter(expr: ts.Expression): boolean {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'useRouter'
  )
}

function recolectarReceptoresRouter(sf: ts.SourceFile): Set<string> {
  const receptores = new Set<string>()
  const visitar = (nodo: ts.Node) => {
    if (
      ts.isVariableDeclaration(nodo) &&
      ts.isIdentifier(nodo.name) &&
      nodo.initializer &&
      esLlamadaUseRouter(nodo.initializer)
    ) {
      receptores.add(nodo.name.text)
    } else if (
      ts.isBinaryExpression(nodo) &&
      nodo.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(nodo.left) &&
      esLlamadaUseRouter(nodo.right)
    ) {
      receptores.add(nodo.left.text)
    }
    ts.forEachChild(nodo, visitar)
  }
  visitar(sf)
  return receptores
}

function expresionLlevaQueryString(
  expr: ts.Expression,
  variablesConQuery: Set<string>,
  sf: ts.SourceFile,
): boolean {
  if (ts.isParenthesizedExpression(expr)) {
    return expresionLlevaQueryString(expr.expression, variablesConQuery, sf)
  }
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isNonNullExpression(expr)) {
    return expresionLlevaQueryString(expr.expression, variablesConQuery, sf)
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text.includes('?')
  }
  if (ts.isTemplateExpression(expr)) {
    if (expr.head.text.includes('?')) return true
    return expr.templateSpans.some(
      (span) =>
        span.literal.text.includes('?') ||
        expresionLlevaQueryString(span.expression, variablesConQuery, sf),
    )
  }
  if (ts.isConditionalExpression(expr)) {
    return (
      expresionLlevaQueryString(expr.whenTrue, variablesConQuery, sf) ||
      expresionLlevaQueryString(expr.whenFalse, variablesConQuery, sf)
    )
  }
  if (ts.isBinaryExpression(expr)) {
    return (
      expresionLlevaQueryString(expr.left, variablesConQuery, sf) ||
      expresionLlevaQueryString(expr.right, variablesConQuery, sf)
    )
  }
  if (ts.isIdentifier(expr)) {
    return variablesConQuery.has(expr.text)
  }
  if (ts.isNewExpression(expr)) {
    return ts.isIdentifier(expr.expression) && expr.expression.text === 'URLSearchParams'
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    if (expr.expression.name.text === 'toString') {
      return expresionLlevaQueryString(expr.expression.expression, variablesConQuery, sf)
    }
  }
  return false
}

function recolectarVariablesConQuery(sf: ts.SourceFile): Set<string> {
  const vars = new Set<string>()
  let cambio = true
  while (cambio) {
    cambio = false
    const visitar = (nodo: ts.Node) => {
      if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.initializer) {
        if (!vars.has(nodo.name.text) && expresionLlevaQueryString(nodo.initializer, vars, sf)) {
          vars.add(nodo.name.text)
          cambio = true
        }
      } else if (
        ts.isBinaryExpression(nodo) &&
        nodo.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(nodo.left)
      ) {
        if (!vars.has(nodo.left.text) && expresionLlevaQueryString(nodo.right, vars, sf)) {
          vars.add(nodo.left.text)
          cambio = true
        }
      }
      ts.forEachChild(nodo, visitar)
    }
    visitar(sf)
  }
  return vars
}

function analizar(): string[] {
  const violaciones: string[] = []
  for (const dir of DIRECTORIOS) {
    for (const archivo of archivos(dir)) {
      const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
      const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
      const receptores = recolectarReceptoresRouter(sf)
      const variablesConQuery = recolectarVariablesConQuery(sf)

      const visitar = (nodo: ts.Node) => {
        if (
          ts.isCallExpression(nodo) &&
          ts.isPropertyAccessExpression(nodo.expression) &&
          (nodo.expression.name.text === 'push' || nodo.expression.name.text === 'replace') &&
          nodo.arguments.length > 0
        ) {
          const obj = nodo.expression.expression
          const esRouter =
            (ts.isIdentifier(obj) && receptores.has(obj.text)) || esLlamadaUseRouter(obj)
          if (esRouter && expresionLlevaQueryString(nodo.arguments[0], variablesConQuery, sf)) {
            const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf))
            violaciones.push(`${archivo}:${line + 1} (${nodo.expression.name.text})`)
          }
        }
        ts.forEachChild(nodo, visitar)
      }
      visitar(sf)
    }
  }
  return violaciones
}

describe('Navegación y filtros por URL', () => {
  it('ningún archivo de app/ ni components/ (fuera de components/filtros/) navega con query string vía useRouter', () => {
    expect(analizar()).toEqual([])
  })
})
