import type { EntradaGuia } from './tipos'
import type { Permiso } from '@/lib/types/administracion'
import { filtrarGuia } from './filtrar'
import { GUIA } from './guia'
import { normalizarTexto } from './normalizar'

/** Ponderación de campos según diseño (§4.1) */
export const PESO_TITULO = 3.0
export const PESO_ALIAS = 2.5
export const PESO_DETALLES = 1.2
export const PESO_PASOS = 1.0

/** Parámetros estándar de Okapi BM25 */
export const K1 = 1.2
export const B = 0.75

/**
 * Ponderación atenuada de títulos y alias de citas previas del usuario (REQ-AYUDA-V2-05).
 * Exportada como constante para calibración empírica.
 */
export const PESO_TURNO_PREVIO = 0.4

/**
 * Umbral de corte de relevancia mínima normalizado en [0, 1] para evitar invocar a Gemini
 * en consultas fuera de dominio (REQ-AYUDA-V2-04).
 * Calibrado en lib/ayuda/evaluacion.test.ts. Con 0.28 el 13% de las preguntas válidas
 * coloquiales caía en sin_llm aun con la entrada correcta primera ("no me deja anular una
 * venta de ayer": 0.247), y BM25 léxico no separa del todo dominio de fuera de dominio
 * cercano ("contraseña del wifi": 0.275). Se prioriza recall: una pregunta válida sin
 * respuesta es peor que gastar una consulta de cuota en una ajena, que igual termina en
 * sin_cita con la tarjeta fija.
 * - Mínimo de dominio (ambos sets): ~0.184 ("subir un diez por ciento todos los precios").
 * - Máximo fuera de dominio general (pizza, mundial): ~0.07.
 * - Fuera de dominio cercano (wifi, ARCA, posnet, sueldos) pasa al modelo a propósito.
 */
export const UMBRAL_MINIMO_BM25 = 0.18

/**
 * Piso para mostrar sugerencias en sin_llm. Debajo de esto el top es ruido: "finanzas"
 * (sin entrada que la nombre) sugería crear roles y consignaciones con ~0.08. Las ajenas
 * generales (recetas, fútbol) quedan en ~0.07.
 */
export const UMBRAL_SUGERENCIAS_BM25 = 0.12

export interface ResultadoBM25 {
  entrada: EntradaGuia
  score: number
  scoreNormalizado: number
}

export interface OpcionesBuscarBM25 {
  citasPrevias?: readonly string[]
  topK?: number
  guia?: readonly EntradaGuia[]
}

interface DocumentoIndexado {
  entrada: EntradaGuia
  tf: Map<string, number>
  docLength: number
}

const REGEX_ID_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class IndiceBM25 {
  private readonly documentos: DocumentoIndexado[] = []
  private readonly idfs: Map<string, number> = new Map()
  private readonly docPorId: Map<string, DocumentoIndexado> = new Map()
  private readonly avgdl: number
  private readonly nTotal: number
  private readonly idfDf0: number

  constructor(guia: readonly EntradaGuia[]) {
    this.nTotal = guia.length
    this.idfDf0 = Math.log((this.nTotal + 0.5) / 0.5 + 1)
    let sumaLongitudes = 0
    const docFrequencies: Map<string, number> = new Map()

    for (const entrada of guia) {
      const tfDoc: Map<string, number> = new Map()

      const acumularTokens = (tokens: readonly string[], peso: number) => {
        for (const token of tokens) {
          tfDoc.set(token, (tfDoc.get(token) ?? 0) + peso)
        }
      }

      const tokensTitulo = normalizarTexto(entrada.titulo)
      const tokensAlias = (entrada.alias ?? []).flatMap((a) => normalizarTexto(a))
      const tokensDetalles = (entrada.detalles ?? []).flatMap((d) => [
        ...normalizarTexto(d.tema),
        ...normalizarTexto(d.texto),
      ])
      const tokensPasos = entrada.pasos.flatMap((p) => normalizarTexto(p))

      acumularTokens(tokensTitulo, PESO_TITULO)
      acumularTokens(tokensAlias, PESO_ALIAS)
      acumularTokens(tokensDetalles, PESO_DETALLES)
      acumularTokens(tokensPasos, PESO_PASOS)

      const docLength =
        tokensTitulo.length * PESO_TITULO +
        tokensAlias.length * PESO_ALIAS +
        tokensDetalles.length * PESO_DETALLES +
        tokensPasos.length * PESO_PASOS

      sumaLongitudes += docLength

      for (const token of tfDoc.keys()) {
        docFrequencies.set(token, (docFrequencies.get(token) ?? 0) + 1)
      }

      const docIndexado: DocumentoIndexado = {
        entrada,
        tf: tfDoc,
        docLength,
      }

      this.documentos.push(docIndexado)
      this.docPorId.set(entrada.id, docIndexado)
    }

    this.avgdl = this.nTotal > 0 ? sumaLongitudes / this.nTotal : 1

    for (const [token, df] of docFrequencies.entries()) {
      // Fórmula Robertson-Spärck Jones con + 1 para garantizar no-negatividad
      const idf = Math.log((this.nTotal - df + 0.5) / (df + 0.5) + 1)
      this.idfs.set(token, idf)
    }
  }

  public buscar(
    query: string,
    permisos: ReadonlySet<Permiso>,
    opciones?: OpcionesBuscarBM25,
  ): ResultadoBM25[] {
    // 1. Filtrado fail-closed previo al rankeo (REQ-AYUDA-V2-03)
    const entradasAutorizadas = filtrarGuia(
      this.documentos.map((d) => d.entrada),
      permisos,
    )

    if (entradasAutorizadas.length === 0) {
      return []
    }

    const idsAutorizados = new Set(entradasAutorizadas.map((e) => e.id))

    // 2. Extracción de términos de consulta ponderados
    const pesosTerminos = new Map<string, number>()
    const tokensQuery = normalizarTexto(query)

    for (const token of tokensQuery) {
      pesosTerminos.set(token, (pesosTerminos.get(token) ?? 0) + 1.0)
    }

    // 3. Multi-turno: títulos y alias del turno previo (REQ-AYUDA-V2-05). El peso TOTAL
    // del turno previo es PESO_TURNO_PREVIO × el peso de la pregunta actual, repartido
    // entre sus tokens. Antes sumaba 0.4 por token: una cita con 8 tokens pesaba 3.2
    // contra 1 de "como hacer una venta" y el top quedaba lleno de la entrada anterior.
    const tokensPrevios = new Set<string>()
    if (tokensQuery.length > 0 && opciones?.citasPrevias && opciones.citasPrevias.length > 0) {
      // Conservamos hasta 4 citas más recientes
      const citasRelevantes = opciones.citasPrevias.slice(-4)

      for (const idCita of citasRelevantes) {
        // Validación kebab-case ≤ 64 y pertenencia a entradas autorizadas
        if (
          typeof idCita === 'string' &&
          idCita.length > 0 &&
          idCita.length <= 64 &&
          REGEX_ID_VALIDO.test(idCita) &&
          idsAutorizados.has(idCita)
        ) {
          const docPrevio = this.docPorId.get(idCita)
          if (docPrevio) {
            const tokensPrevTitulo = normalizarTexto(docPrevio.entrada.titulo)
            const tokensPrevAlias = (docPrevio.entrada.alias ?? []).flatMap((a) =>
              normalizarTexto(a),
            )
            for (const token of [...tokensPrevTitulo, ...tokensPrevAlias]) {
              tokensPrevios.add(token)
            }
          }
        }
      }
    }

    if (tokensPrevios.size > 0) {
      const pesoPorToken = (PESO_TURNO_PREVIO * tokensQuery.length) / tokensPrevios.size
      for (const token of tokensPrevios) {
        pesosTerminos.set(token, (pesosTerminos.get(token) ?? 0) + pesoPorToken)
      }
    }

    if (pesosTerminos.size === 0) {
      return []
    }

    // Denominador del scoreNormalizado: Σ_t (peso_t · idf_t · (K1 + 1))
    // Para tokens no presentes en el índice se usa idfDf0 = ln((N+0.5)/0.5 + 1)
    let sumaIdfMax = 0
    for (const [token, queryWeight] of pesosTerminos.entries()) {
      const idf = this.idfs.get(token) ?? this.idfDf0
      sumaIdfMax += queryWeight * idf * (K1 + 1)
    }

    // 4. Scoring BM25 exclusivamente sobre entradas autorizadas
    const resultados: ResultadoBM25[] = []

    for (const doc of this.documentos) {
      if (!idsAutorizados.has(doc.entrada.id)) {
        continue
      }

      let score = 0
      for (const [token, queryWeight] of pesosTerminos.entries()) {
        const tf = doc.tf.get(token)
        if (!tf || tf <= 0) {
          continue
        }

        const idf = this.idfs.get(token) ?? 0
        const numerador = tf * (K1 + 1)
        const denominador = tf + K1 * (1 - B + B * (doc.docLength / this.avgdl))
        score += queryWeight * idf * (numerador / denominador)
      }

      if (score > 0) {
        const scoreNormalizado =
          sumaIdfMax > 0
            ? Math.min(1, Math.max(0, score / sumaIdfMax))
            : 0

        resultados.push({
          entrada: doc.entrada,
          score,
          scoreNormalizado,
        })
      }
    }

    // 5. Ordenar descendente por score
    resultados.sort((a, b) => b.score - a.score)

    const topK = opciones?.topK ?? 5
    return resultados.slice(0, topK)
  }
}

/** Índice global en memoria construido una sola vez por proceso */
let indiceGlobal: IndiceBM25 | null = null

export function obtenerIndiceBM25(guia: readonly EntradaGuia[] = GUIA): IndiceBM25 {
  if (guia === GUIA) {
    if (!indiceGlobal) {
      indiceGlobal = new IndiceBM25(GUIA)
    }
    return indiceGlobal
  }
  return new IndiceBM25(guia)
}

/**
 * Función principal de retrieval BM25 fail-closed.
 */
export function buscarBM25(
  query: string,
  permisos: ReadonlySet<Permiso>,
  opciones?: OpcionesBuscarBM25,
): ResultadoBM25[] {
  const indice = obtenerIndiceBM25(opciones?.guia ?? GUIA)
  return indice.buscar(query, permisos, opciones)
}
