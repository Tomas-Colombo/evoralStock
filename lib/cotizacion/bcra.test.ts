import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCotizacionBcra } from './bcra'

describe('fetchCotizacionBcra — Integración HTTP con API del BCRA', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('caso feliz (ok): extrae tipoCotizacion USD y fechaValor válida', async () => {
    const mockResponse = {
      status: 200,
      metadata: {
        resultset: { count: 1, offset: 0, limit: 1000 },
      },
      results: [
        {
          fecha: '2026-11-04',
          detalle: [
            {
              codigoMoneda: 'USD',
              descripcion: 'DOLAR E.E.U.U.',
              tipoPase: 0.0,
              tipoCotizacion: 1546.5,
            },
          ],
        },
      ],
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    })
    globalThis.fetch = fetchMock

    const res = await fetchCotizacionBcra()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD')
    expect(init).toMatchObject({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })

    expect(res).toEqual({
      ok: true,
      valor: 1546.5,
      fechaValor: '2026-11-04',
    })
  })

  it('falla con timeout (AbortSignal timeout)', async () => {
    const errorTimeout = new DOMException('The operation timed out', 'TimeoutError')
    globalThis.fetch = vi.fn().mockRejectedValue(errorTimeout)

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla con status HTTP 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si el body no contiene moneda USD en detalle', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        results: [
          {
            fecha: '2026-11-04',
            detalle: [
              {
                codigoMoneda: 'EUR',
                descripcion: 'EURO',
                tipoCotizacion: 1650.0,
              },
            ],
          },
        ],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si tipoCotizacion es 0', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        results: [
          {
            fecha: '2026-11-04',
            detalle: [
              {
                codigoMoneda: 'USD',
                tipoCotizacion: 0,
              },
            ],
          },
        ],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si tipoCotizacion es NaN', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        results: [
          {
            fecha: '2026-11-04',
            detalle: [
              {
                codigoMoneda: 'USD',
                tipoCotizacion: Number.NaN,
              },
            ],
          },
        ],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si tipoCotizacion es string', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        results: [
          {
            fecha: '2026-11-04',
            detalle: [
              {
                codigoMoneda: 'USD',
                tipoCotizacion: '1546.5',
              },
            ],
          },
        ],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla con JSON roto o parseo inválido', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si fecha no es una fecha ISO válida', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        results: [
          {
            fecha: 'fecha-invalida',
            detalle: [
              {
                codigoMoneda: 'USD',
                tipoCotizacion: 1546.5,
              },
            ],
          },
        ],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })

  it('falla si body.status no es 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 500,
        results: [],
      }),
    })

    const res = await fetchCotizacionBcra()

    expect(res).toEqual({
      ok: false,
      reason: 'bcra-no-disponible',
    })
  })
})
