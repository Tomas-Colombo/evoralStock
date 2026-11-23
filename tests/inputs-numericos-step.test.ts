/**
 * Un `<input type="number">` acepta solo `min + k·step`: el navegador cuenta
 * los pasos desde `min`, no desde 0. La cotización manual tenía `min=0.0001`
 * con `step=0.01` y rechazaba 1580 (pedía 1580,0001). Sin `step` explícito el
 * paso es 1, así que un `min` decimal sin `step` cae en la misma trampa.
 *
 * Este test exige que todo input numérico con `min` tenga `min` múltiplo del
 * `step`, y que ambos sean literales o constantes exportadas de `lib/` para
 * poder verificarlos.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
// Pasa `min`/`step` tal cual al input nativo: los valores reales están en quien lo usa.
const EXCLUIDOS = new Set(['components/ui/NumberInput.tsx'])

function archivos(dir: string, ext: RegExp): string[] {
  return readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = `${dir}/${e.name}`.replace(/\\/g, '/')
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : archivos(ruta, ext)
    return ext.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

function parsear(ruta: string): ts.SourceFile {
  const texto = readFileSync(path.join(RAIZ, ruta), 'utf8')
  return ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function literalNumerico(expr: ts.Expression): number | null {
  if (ts.isNumericLiteral(expr)) return Number(expr.text)
  if (ts.isStringLiteral(expr)) return expr.text.trim() === '' ? null : Number(expr.text)
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text)
  }
  return null
}

function constantesNumericas(fuentes: ts.SourceFile[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const sf of fuentes) {
    sf.forEachChild((nodo) => {
      if (!ts.isVariableStatement(nodo)) return
      if (!(nodo.declarationList.flags & ts.NodeFlags.Const)) return
      for (const d of nodo.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const valor = literalNumerico(d.initializer)
        if (valor !== null && Number.isFinite(valor)) mapa.set(d.name.text, valor)
      }
    })
  }
  return mapa
}

type Atributo = { presente: false } | { presente: true; valor: number | 'any' | null; texto: string }

function leerAtributo(
  attrs: ts.JsxAttributes,
  nombre: string,
  constantes: Map<string, number>,
): Atributo {
  const attr = attrs.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === nombre,
  )
  if (!attr) return { presente: false }
  const init = attr.initializer
  const texto = attr.getText()
  if (!init) return { presente: true, valor: null, texto }
  const expr = ts.isJsxExpression(init) ? init.expression : init
  if (!expr) return { presente: true, valor: null, texto }
  if (ts.isStringLiteral(expr) && expr.text === 'any') return { presente: true, valor: 'any', texto }
  const literal = literalNumerico(expr)
  if (literal !== null) return { presente: true, valor: literal, texto }
  if (ts.isIdentifier(expr) && constantes.has(expr.text)) {
    return { presente: true, valor: constantes.get(expr.text)!, texto }
  }
  return { presente: true, valor: null, texto }
}

function esInputNumerico(tag: string, attrs: ts.JsxAttributes): boolean {
  if (tag === 'NumberInput') return true
  return attrs.properties.some(
    (p) =>
      ts.isJsxAttribute(p) &&
      p.name.getText() === 'type' &&
      p.initializer !== undefined &&
      ts.isStringLiteral(p.initializer) &&
      p.initializer.text === 'number',
  )
}

function alineado(min: number, step: number): boolean {
  const pasos = min / step
  return Math.abs(pasos - Math.round(pasos)) < 1e-6
}

describe('inputs numéricos: min alineado con step', () => {
  it('todo min es múltiplo del step (el navegador cuenta los pasos desde min)', () => {
    const constantes = constantesNumericas(archivos('lib', /\.tsx?$/).map(parsear))
    const vistas = [...archivos('app', /\.tsx$/), ...archivos('components', /\.tsx$/)].filter(
      (r) => !EXCLUIDOS.has(r),
    )
    const problemas: string[] = []

    for (const ruta of vistas) {
      const sf = parsear(ruta)
      const locales = new Map([...constantes, ...constantesNumericas([sf])])
      const visitar = (nodo: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(nodo) || ts.isJsxOpeningElement(nodo)) {
          const tag = nodo.tagName.getText()
          if (esInputNumerico(tag, nodo.attributes)) {
            const min = leerAtributo(nodo.attributes, 'min', locales)
            const step = leerAtributo(nodo.attributes, 'step', locales)
            const linea = sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1
            const donde = `${ruta}:${linea}`
            if (min.presente && step.presente && step.valor === 'any') {
              // step="any" no restringe nada.
            } else if (min.presente) {
              const pasoReal = step.presente ? step.valor : 1
              if (min.valor === null || min.valor === 'any') {
                problemas.push(`${donde} ${min.texto}: usá un literal o una constante de lib/`)
              } else if (pasoReal === null || pasoReal === 'any') {
                problemas.push(`${donde} ${step.presente ? step.texto : ''}: usá un literal o una constante de lib/`)
              } else if (!alineado(min.valor, pasoReal)) {
                problemas.push(
                  `${donde} min=${min.valor} no es múltiplo de step=${pasoReal}${step.presente ? '' : ' (por defecto)'}`,
                )
              }
            }
          }
        }
        ts.forEachChild(nodo, visitar)
      }
      visitar(sf)
    }

    expect(problemas).toEqual([])
  })
})
