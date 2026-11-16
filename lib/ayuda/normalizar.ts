import { esStopword, WHITELIST_FUNCIONAL } from './stopwords'

/**
 * Remueve tildes y diacríticos dieréticos, convirtiendo a minúsculas.
 */
export function quitarTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const SUFIJOS_PASO_1: readonly RegExp[] = [
  /(acion|icion|ucion)(es)?$/,
  /anza(s)?$/,
  /encia(s)?$/,
  /ancia(s)?$/,
  /miento(s)?$/,
  /idad(es)?$/,
  /(ad|ed|id)or(es|as|a)?$/,
  /ando$/,
  /iendo$/,
  /ad(o|a|os|as)$/,
  /id(o|a|os|as)$/,
  /aron$/,
  /ieron$/,
  /ar(ia|ian|ias)?$/,
  /er(ia|ian|ias)?$/,
  /ir(ia|ian|ias)?$/,
  /aremos$/,
  /eremos$/,
  /iremos$/,
  /ab(a|as|an|amos)$/,
  /amos$/,
  /emos$/,
  /imos$/,
  /an$/,
  /en$/,
  /ar$/,
  /er$/,
  /ir$/,
]

/**
 * Stemming liviano en español para normalización morfológica (verbos, sustantivos, plurales).
 * Protege estrictamente las palabras de la whitelist funcional.
 */
export function stem(palabra: string): string {
  if (WHITELIST_FUNCIONAL.has(palabra)) {
    return palabra
  }

  if (palabra.length < 4) {
    return palabra
  }

  let res = palabra

  // Paso 1: sufijos nominales y verbales largos
  for (const rx of SUFIJOS_PASO_1) {
    if (rx.test(res)) {
      const candidato = res.replace(rx, '')
      if (candidato.length >= 3) {
        res = candidato
        break
      }
    }
  }

  // Paso 2: plurales residuales (-es, -s)
  if (res.length >= 4) {
    if (/es$/.test(res)) {
      const candidato = res.replace(/es$/, '')
      if (candidato.length >= 3) {
        res = candidato
      }
    } else if (/s$/.test(res)) {
      const candidato = res.replace(/s$/, '')
      if (candidato.length >= 3) {
        res = candidato
      }
    }
  }

  // Paso 3: vocales terminales flexivas (-a, -e, -o)
  if (res.length >= 4 && /[aeo]$/.test(res)) {
    const candidato = res.replace(/[aeo]$/, '')
    if (candidato.length >= 3) {
      res = candidato
    }
  }

  return res
}

/**
 * Pipeline completo de normalización textual:
 * 1. Minúsculas y remoción de tildes.
 * 2. Limpieza de puntuación no semántica.
 * 3. Tokenización.
 * 4. Filtrado de stopwords tradicionales preservando la whitelist funcional.
 * 5. Stemming liviano en español.
 */
export function normalizarTexto(texto: string): string[] {
  if (!texto || typeof texto !== 'string') {
    return []
  }

  const limpio = quitarTildes(texto)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!limpio) {
    return []
  }

  const palabras = limpio.split(/\s+/).filter(Boolean)
  const tokens: string[] = []

  for (const palabra of palabras) {
    if (WHITELIST_FUNCIONAL.has(palabra)) {
      tokens.push(palabra)
      continue
    }

    if (esStopword(palabra)) {
      continue
    }

    const raiz = stem(palabra)
    if (raiz) {
      tokens.push(raiz)
    }
  }

  return tokens
}
