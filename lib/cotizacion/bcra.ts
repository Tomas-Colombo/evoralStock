import 'server-only'

export const BCRA_USD_URL =
  'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD'

export type CotizacionBcraSuccess = {
  ok: true
  valor: number
  fechaValor: string
}

export type CotizacionBcraError = {
  ok: false
  reason: 'bcra-no-disponible'
}

export type CotizacionBcraResult = CotizacionBcraSuccess | CotizacionBcraError

interface DetalleCotizacion {
  codigoMoneda?: unknown
  tipoCotizacion?: unknown
}

interface ResultadoBcra {
  fecha?: unknown
  detalle?: unknown
}

interface BodyBcra {
  status?: unknown
  results?: unknown
}

function esFechaIsoValida(fecha: unknown): fecha is string {
  if (typeof fecha !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const timestamp = Date.parse(fecha)
  return !Number.isNaN(timestamp)
}

/**
 * Consulta la cotización oficial del dólar estadounidense (USD) en la API del BCRA.
 * Timeout estricto de 5000 ms y caché 'no-store'.
 * Retorna resultado tipado (éxito o razón de error 'bcra-no-disponible').
 */
export async function fetchCotizacionBcra(): Promise<CotizacionBcraResult> {
  try {
    const res = await fetch(BCRA_USD_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return { ok: false, reason: 'bcra-no-disponible' }
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      return { ok: false, reason: 'bcra-no-disponible' }
    }

    if (!json || typeof json !== 'object') {
      return { ok: false, reason: 'bcra-no-disponible' }
    }

    const body = json as BodyBcra
    if (body.status !== 200 || !Array.isArray(body.results)) {
      return { ok: false, reason: 'bcra-no-disponible' }
    }

    for (const item of body.results as ResultadoBcra[]) {
      if (!item || typeof item !== 'object') continue
      if (!esFechaIsoValida(item.fecha)) continue
      if (!Array.isArray(item.detalle)) continue

      for (const det of item.detalle as DetalleCotizacion[]) {
        if (!det || typeof det !== 'object') continue
        if (det.codigoMoneda === 'USD') {
          const val = det.tipoCotizacion
          if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
            return {
              ok: true,
              valor: val,
              fechaValor: item.fecha,
            }
          }
        }
      }
    }

    return { ok: false, reason: 'bcra-no-disponible' }
  } catch {
    return { ok: false, reason: 'bcra-no-disponible' }
  }
}
