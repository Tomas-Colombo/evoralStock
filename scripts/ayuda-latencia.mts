/**
 * Medición empírica de Time-To-First-Token (TTFT) y tiempo total de streaming
 * para modelos de Gemini utilizando el SDK oficial @google/genai (^2.32.0).
 *
 * Lección crítica de v1:
 * El listado devuelto por ai.models.list() NO garantiza que generateContent o
 * generateContentStream funcione con nuestra clave de API o plan en Google Cloud.
 * Varios modelos listados pueden retornar errores 404, 403 o no soportar streaming.
 * Un modelo se considera candidato viable y se selecciona SOLO si respondió
 * de forma exitosa y verificada a las corridas de medición.
 *
 * Modos de uso:
 * 1. Listar modelos disponibles en la cuenta:
 *    node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts --listar
 *
 * 2. Medir TTFT y duración con prompt realista de v2 (3 corridas por modelo):
 *    node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <modelo1> [modelo2...]
 */

import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  type ThinkingConfig,
} from '@google/genai'

// 1. Validación estricta de credenciales
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.error('Falta GEMINI_API_KEY. Corré el script con --env-file=.env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error(
    'Uso:\n' +
      '  node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts --listar\n' +
      '  node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <modelo1> [modelo2...]',
  )
  process.exit(1)
}

/**
 * Extrae de forma segura el nombre del error y el código HTTP de estado,
 * garantizando que nunca se filtren tokens, prompts, headers ni bodies.
 */
function extraerErrorInfo(err: unknown): {
  nombre: string
  status?: number
  esTimeout: boolean
} {
  if (err instanceof ApiError) {
    return {
      nombre: err.name || 'ApiError',
      status: err.status,
      esTimeout: false,
    }
  }

  if (err && typeof err === 'object') {
    const e = err as {
      name?: unknown
      status?: unknown
      code?: unknown
      cause?: unknown
    }
    const nombre = typeof e.name === 'string' ? e.name : 'Error'
    let status: number | undefined =
      typeof e.status === 'number' ? e.status : undefined

    if (status === undefined && e.cause && typeof e.cause === 'object') {
      const c = e.cause as { status?: unknown }
      if (typeof c.status === 'number') {
        status = c.status
      }
    }

    const esTimeout =
      nombre === 'TimeoutError' ||
      nombre === 'AbortError' ||
      nombre === 'RequestTimeoutError' ||
      e.code === 'ETIMEDOUT'

    return { nombre, status, esTimeout }
  }

  return { nombre: 'Error', esTimeout: false }
}

/**
 * Determina el nivel de pensamiento mínimo según la familia de modelos:
 * - Gemini 3+: ThinkingLevel.MINIMAL (reduce latencia sin apagar soporte).
 * - Gemini 2.5: thinkingBudget: 0 (lo que especifican los tipos para desactivar pensamiento).
 */
function obtenerThinkingConfig(modelo: string): ThinkingConfig {
  if (modelo.startsWith('gemini-2.5')) {
    return { thinkingBudget: 0 }
  }
  return { thinkingLevel: ThinkingLevel.MINIMAL }
}

/**
 * Prompt realista de v2 (~1.000 tokens) compuesto por instrucciones invariantes,
 * 5 entradas reales de lib/ayuda/guia (ventas e inventario) con pasos y detalles,
 * y una pregunta operativa típica del usuario. Copiado como texto sin importar de lib/.
 */
const PROMPT_REALISTA = `Sos el asistente de navegación de Utopía, un sistema SaaS para comercios de indumentaria.
Reglas:
1. Respondé únicamente a partir de las opciones de la guía provista.
2. Si la consulta del usuario no se encuentra en la guía, respondé que no tenés esa información.
3. No inventes pantallas, rutas ni permisos bajo ninguna circunstancia.
4. Tu respuesta debe ser breve, directa y con voseo.
5. Respondé en texto plano puro, sin formato Markdown (sin negritas **, sin itálicas, sin listas con viñetas ni encabezados).
6. Citá las pantallas oficiales utilizando únicamente la sintaxis sintáctica [[entrada-id]]. No escribas rutas ni URLs.

Guía de pantallas disponibles:

[ventas-registrar-venta] Cómo registrar una venta
Pasos:
- Ingresá a Ventas y hacé clic en "Nueva venta" para abrir el mostrador.
- Escaneá el código del producto o buscalo manualmente por nombre o código para sumarlo a la lista.
- Seleccioná el cliente si deseás asociar la compra o si vas a financiar en cuotas.
- Elegí la forma de pago principal entre efectivo, débito, crédito, transferencia o cuotas.
- Hacé clic en "Continuar al cobro" para desglosar importes, medios de pago y cuentas de destino.
- Hacé clic en "Confirmar venta" para asentar la operación y descontar el stock.
Detalles:
- Financiación en cuotas: Si seleccionás venta en cuotas, es obligatorio vincular un cliente para poder generar su plan de pagos.
- Venta por revendedora: Si elegís canal revendedora, tenés que seleccionar la revendedora asignada antes de confirmar.

[ventas-emitir-comprobante] Cómo emitir un comprobante de venta
Pasos:
- Desde el listado de Ventas, buscá la venta y hacé clic en "Ver" para abrir su ficha.
- En la tarjeta superior de datos de la venta, hacé clic en "Emitir comprobante".
- Seleccioná el tipo de comprobante en el desplegable (Factura A, Factura B, Factura C, Remito o Ticket).
- Ingresá el número de comprobante.
- Hacé clic en "Emitir" para asociar el comprobante a la venta.
Detalles:
- Comprobante único: Solo se puede emitir un comprobante por venta y no está disponible si la venta se encuentra anulada.

[ventas-listado] Cómo consultar el listado de ventas
Pasos:
- Ingresá a Ventas desde el menú principal.
- Ajustá el filtro de período con las fechas desde y hasta para definir el rango a consultar.
- Si tenés el módulo de revendedoras activo, podés filtrar además por canal local o revendedora.
- Revisá los indicadores de operaciones registradas y facturación del período en la cabecera.
- Hacé clic en "Ver" en la fila correspondiente para abrir el detalle completo de una venta.

[inventario-producto-crear] Cómo registrar un nuevo producto
Pasos:
- En Inventario, hacé clic en "Nuevo producto" (o ingresá desde el acceso directo).
- Ingresá el Nombre del producto y seleccioná su Categoría.
- Definí opcionalmente el Stock mínimo y el Costo inicial con su moneda (ARS o USD).
- Si querés vincular el alta inicial a un proveedor, elegí el Proveedor en el desplegable.
- Indicá el stock inicial cargando unidades por talle o el stock total si la categoría no maneja talles.
- Hacé clic en "Crear producto" para registrar el artículo y generar sus ítems físicos.
Detalles:
- Generación automática de SKU: El código SKU se autogenera en el sistema al guardar; no es necesario cargarlo manualmente.
- Control de nombres duplicados: El sistema no permite crear un producto con el mismo nombre que otro ya existente en el catálogo.
- Costo en dólares y conversión oficial: Si seleccionás moneda USD para el costo inicial, el sistema muestra la cotización oficial del BCRA y un estimado en pesos. Al guardar, el costo se convierte a pesos al tipo de cambio vigente y se preserva el importe original en dólares.

[inventario-listado] Cómo consultar el inventario de productos
Pasos:
- Ingresá a Inventario desde el menú principal.
- Revisá los indicadores de stock disponible, productos activos, productos bajo mínimo y cantidad de proveedores.
- Revisá los paneles de Reposición urgente y Rotación vencida en caso de requerir reponer mercadería o devolver unidades.
- Utilizá el buscador para filtrar por nombre o código SKU, o seleccioná una categoría en el filtro.
- Hacé clic en cualquier producto de la tabla para abrir su ficha y ver el detalle.

Pregunta del usuario:
¿Cómo registro una venta financiada en cuotas y cómo emito el comprobante una vez confirmada?`

const ai = new GoogleGenAI({ apiKey })

// MODO 1: Listar modelos disponibles en la cuenta
if (args[0] === '--listar') {
  try {
    const pager = await ai.models.list()
    console.log('nombre | métodos soportados | preview/exp/latest')
    for await (const m of pager) {
      const nombre = m.name ?? '-'
      const metodos =
        m.supportedActions && m.supportedActions.length > 0
          ? m.supportedActions.join(', ')
          : '-'
      const contieneTag = /(?:preview|exp|latest)/i.test(nombre)
      const tagCol = contieneTag ? 'si' : 'no'
      console.log(`${nombre} | ${metodos} | ${tagCol}`)
    }
  } catch (err: unknown) {
    const { nombre, status, esTimeout } = extraerErrorInfo(err)
    const statusTexto = esTimeout
      ? 'timeout'
      : status !== undefined
        ? `HTTP ${status}`
        : nombre
    console.error(`Error al listar modelos: ${statusTexto}`)
    process.exit(1)
  }
  process.exit(0)
}

// MODO 2: Medición de TTFT y stream de modelos indicados
const modelos = args
console.log('modelo | status | TTFT p50 | TTFT máx | total p50 | tokens in/out/thinking')

for (const modelo of modelos) {
  const ttfts: number[] = []
  const totales: number[] = []
  let tokensIn: number | undefined
  let tokensOut: number | undefined
  let tokensThinking: number | undefined
  let statusTexto = 'ok'
  let fallo = false

  for (let i = 0; i < 3; i++) {
    const inicio = performance.now()
    let primerTokenRegistrado = false
    let ttftCorrida = 0

    try {
      const stream = await ai.models.generateContentStream({
        model: modelo,
        contents: PROMPT_REALISTA,
        config: {
          temperature: 0.2,
          maxOutputTokens: 800,
          thinkingConfig: obtenerThinkingConfig(modelo),
          httpOptions: {
            timeout: 30_000,
          },
          abortSignal: AbortSignal.timeout(30_000),
        },
      })

      for await (const chunk of stream) {
        if (!primerTokenRegistrado) {
          primerTokenRegistrado = true
          ttftCorrida = Math.round(performance.now() - inicio)
        }
        if (chunk.usageMetadata) {
          if (typeof chunk.usageMetadata.promptTokenCount === 'number') {
            tokensIn = chunk.usageMetadata.promptTokenCount
          }
          if (typeof chunk.usageMetadata.candidatesTokenCount === 'number') {
            tokensOut = chunk.usageMetadata.candidatesTokenCount
          }
          if (typeof chunk.usageMetadata.thoughtsTokenCount === 'number') {
            tokensThinking = chunk.usageMetadata.thoughtsTokenCount
          }
        }
      }

      const totalCorrida = Math.round(performance.now() - inicio)
      if (!primerTokenRegistrado) {
        ttftCorrida = totalCorrida
      }

      ttfts.push(ttftCorrida)
      totales.push(totalCorrida)
    } catch (err: unknown) {
      fallo = true
      const { nombre, status, esTimeout } = extraerErrorInfo(err)
      statusTexto = esTimeout
        ? 'timeout'
        : status !== undefined
          ? `HTTP ${status}`
          : nombre
      break
    }
  }

  if (fallo) {
    console.log(`${modelo} | ${statusTexto} | - | - | - | -`)
  } else {
    ttfts.sort((a, b) => a - b)
    totales.sort((a, b) => a - b)
    const ttftP50 = ttfts[1]
    const ttftMax = ttfts[2]
    const totalP50 = totales[1]
    const tokensResumen = `${tokensIn ?? '-'}/${tokensOut ?? '-'}/${tokensThinking ?? 0}`
    console.log(
      `${modelo} | ${statusTexto} | ${ttftP50} ms | ${ttftMax} ms | ${totalP50} ms | ${tokensResumen}`,
    )
  }
}
