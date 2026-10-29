import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Toda Server Action es un endpoint POST público: los tipos de TS no existen en
 * runtime y el `layout.tsx` solo protege `ver`. Este test lee el AST de cada
 * archivo `'use server'` y exige, en cada función exportada:
 *
 *  1. una llamada a `requireModuleRole(...)`, directa o a través de un helper
 *     local del mismo archivo que la hace y captura el error (p. ej. `guarded`);
 *  2. que esa llamada ocurra antes de cualquier llamada a una función importada
 *     de `lib/dal` (salvo sesión, guardas y errores);
 *  3. que el `AuthorizationError` se capture (`classifyAuthError` o
 *     `instanceof AuthorizationError`) y no escape como un 500.
 *
 * Antes dependía de que el revisor se acordara de mirarlo en cada action nueva.
 */

const RAIZ = process.cwd()
const DIRECTORIOS = ['app', 'lib']

/**
 * Actions que no autorizan contra un módulo, con su razón. Solo puede
 * achicarse: el test falla también si una entrada ya no corresponde a ninguna action.
 */
const SIN_GUARDA: Record<string, string> = {
  'app/(app)/actions.ts#logoutAction': 'cierra la sesión: no hay módulo que autorizar',
  'app/(auth)/login/actions.ts#loginAction': 'todavía no hay sesión',
  'app/(auth)/settings/password-actions.ts#changePasswordAction': 'cambia la contraseña propia: solo exige sesión',
}

/** Imports de `lib/dal` que se pueden llamar antes de autorizar. */
const DAL_PREVIO_A_AUTORIZAR = new Set(['lib/dal/session', 'lib/dal/guard', 'lib/dal/errors', 'lib/dal/plataforma/guard'])

function archivos(dir: string): string[] {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const ruta = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : archivos(ruta)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

function esUseServer(fuente: ts.SourceFile): boolean {
  const primera = fuente.statements[0]
  return (
    primera !== undefined &&
    ts.isExpressionStatement(primera) &&
    ts.isStringLiteral(primera.expression) &&
    primera.expression.text === 'use server'
  )
}

/** `lib/dal/x` para un import de `lib/dal`, o null si es de otro lado. */
function moduloDal(especificador: string, archivo: string): string | null {
  let ruta: string
  if (especificador.startsWith('@/')) ruta = especificador.slice(2)
  else if (especificador.startsWith('.')) ruta = relative(RAIZ, resolve(dirname(join(RAIZ, archivo)), especificador))
  else return null
  ruta = ruta.replace(/\\/g, '/').replace(/\.tsx?$/, '')
  return ruta.startsWith('lib/dal/') ? ruta : null
}

interface Action {
  clave: string
  cuerpo: ts.Node
}

function actionsExportadas(fuente: ts.SourceFile, archivo: string): Action[] {
  const exportada = (n: ts.Node) =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const actions: Action[] = []
  for (const s of fuente.statements) {
    if (ts.isFunctionDeclaration(s) && exportada(s) && s.name && s.body) {
      actions.push({ clave: `${archivo}#${s.name.text}`, cuerpo: s.body })
    }
    if (ts.isVariableStatement(s) && exportada(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          actions.push({ clave: `${archivo}#${d.name.text}`, cuerpo: init.body })
        }
      }
    }
  }
  return actions
}

function problemas(action: Action, importsDal: Map<string, string>, guardas: Set<string>): string[] {
  let autoriza = -1
  let primerDal = -1
  let primerDalNombre = ''
  let capturaAuth = false

  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const nombre = n.expression.text
      if ((nombre === 'requireModuleRole' || nombre === 'requireSuperAdmin' || guardas.has(nombre)) && autoriza < 0) autoriza = n.getStart()
      if (nombre === 'classifyAuthError' || guardas.has(nombre)) capturaAuth = true
      const modulo = importsDal.get(nombre)
      if (modulo && !DAL_PREVIO_A_AUTORIZAR.has(modulo) && primerDal < 0) {
        primerDal = n.getStart()
        primerDalNombre = nombre
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      n.right.getText() === 'AuthorizationError'
    ) {
      capturaAuth = true
    }
    ts.forEachChild(n, visitar)
  }
  visitar(action.cuerpo)

  const encontrados: string[] = []
  if (autoriza < 0) encontrados.push('sin requireModuleRole')
  else if (primerDal >= 0 && primerDal < autoriza) encontrados.push(`llama a ${primerDalNombre} antes de autorizar`)
  if (autoriza >= 0 && !capturaAuth) encontrados.push('no captura AuthorizationError')
  return encontrados
}

/**
 * Funciones NO exportadas del archivo que autorizan y capturan el error por sí
 * solas: llamarlas cuenta como autorizar.
 */
function helpersDeGuarda(fuente: ts.SourceFile, importsDal: Map<string, string>): Set<string> {
  const locales: Action[] = []
  for (const s of fuente.statements) {
    if ((ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }
    if (ts.isFunctionDeclaration(s) && s.name && s.body) locales.push({ clave: s.name.text, cuerpo: s.body })
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          locales.push({ clave: d.name.text, cuerpo: init.body })
        }
      }
    }
  }
  // Hasta un punto fijo: `guarded = (a) => guardedModulo('x', a)` delega en otro helper.
  const guardas = new Set<string>()
  let agrego = true
  while (agrego) {
    agrego = false
    for (const h of locales) {
      if (!guardas.has(h.clave) && problemas(h, importsDal, guardas).length === 0) {
        guardas.add(h.clave)
        agrego = true
      }
    }
  }
  return guardas
}

function analizar(): { violaciones: string[]; claves: Set<string> } {
  const violaciones: string[] = []
  const claves = new Set<string>()
  for (const archivo of DIRECTORIOS.flatMap(archivos)) {
    const texto = readFileSync(join(RAIZ, archivo), 'utf8')
    if (!texto.includes('use server')) continue
    const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    if (!esUseServer(fuente)) continue

    const importsDal = new Map<string, string>()
    for (const s of fuente.statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
      const modulo = moduloDal(s.moduleSpecifier.text, archivo)
      const nombrados = s.importClause?.namedBindings
      if (!modulo || !nombrados || !ts.isNamedImports(nombrados)) continue
      for (const el of nombrados.elements) importsDal.set(el.name.text, modulo)
    }

    const guardas = helpersDeGuarda(fuente, importsDal)
    for (const action of actionsExportadas(fuente, archivo)) {
      claves.add(action.clave)
      if (action.clave in SIN_GUARDA) continue
      for (const p of problemas(action, importsDal, guardas)) violaciones.push(`${action.clave}: ${p}`)
    }
  }
  return { violaciones, claves }
}

describe('Server Actions: autorizar antes que nada', () => {
  const { violaciones, claves } = analizar()

  it('encuentra las actions (si no, el test no prueba nada)', () => {
    expect(claves.size).toBeGreaterThan(50)
  })

  it('cada action exportada autoriza con requireModuleRole antes del DAL y captura AuthorizationError', () => {
    expect(violaciones).toEqual([])
  })

  it('la lista de excepciones solo tiene actions que existen', () => {
    expect(Object.keys(SIN_GUARDA).filter((c) => !claves.has(c))).toEqual([])
  })
})
