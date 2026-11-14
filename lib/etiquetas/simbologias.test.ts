import { describe, expect, it } from 'vitest'
import {
  SIMBOLOGIA_IDS,
  SIMBOLOGIAS,
  campoValorSimbologia,
  esSimbologiaId,
  obtenerSimbologia,
  resolverValorSimbologia,
} from './simbologias'

describe('simbologias', () => {
  it('contiene exactamente las 4 simbologías soportadas con sus metadatos (D-ETQ-01)', () => {
    expect(SIMBOLOGIA_IDS).toEqual(['qr', 'datamatrix', 'code128', 'ean13'])
    expect(SIMBOLOGIAS).toHaveLength(4)

    const qr = obtenerSimbologia('qr')
    expect(qr).toMatchObject({
      id: 'qr',
      dimension: '2d',
      valor: 'qr_code',
      bcid: 'qrcode',
      minAnchoMm: 15,
      minAltoMm: 15,
    })

    const datamatrix = obtenerSimbologia('datamatrix')
    expect(datamatrix).toMatchObject({
      id: 'datamatrix',
      dimension: '2d',
      valor: 'qr_code',
      bcid: 'datamatrix',
      minAnchoMm: 10,
      minAltoMm: 10,
    })

    const code128 = obtenerSimbologia('code128')
    expect(code128).toMatchObject({
      id: 'code128',
      dimension: '1d',
      valor: 'codigo_ean',
      bcid: 'code128',
      minAnchoMm: 30,
      minAltoMm: 10,
    })

    const ean13 = obtenerSimbologia('ean13')
    expect(ean13).toMatchObject({
      id: 'ean13',
      dimension: '1d',
      valor: 'codigo_ean',
      bcid: 'ean13',
      minAnchoMm: 30,
      minAltoMm: 10,
    })
  })

  it('esSimbologiaId valida solo IDs válidos del catálogo', () => {
    expect(esSimbologiaId('qr')).toBe(true)
    expect(esSimbologiaId('datamatrix')).toBe(true)
    expect(esSimbologiaId('code128')).toBe(true)
    expect(esSimbologiaId('ean13')).toBe(true)

    expect(esSimbologiaId('pdf417')).toBe(false)
    expect(esSimbologiaId('')).toBe(false)
    expect(esSimbologiaId(null)).toBe(false)
    expect(esSimbologiaId(undefined)).toBe(false)
  })

  it('obtenerSimbologia devuelve undefined para IDs desconocidos', () => {
    expect(obtenerSimbologia('desconocido')).toBeUndefined()
  })

  it('campoValorSimbologia extrae el campo del catálogo SIMBOLOGIAS o recurre a qr', () => {
    expect(campoValorSimbologia('qr')).toBe('qr_code')
    expect(campoValorSimbologia('datamatrix')).toBe('qr_code')
    expect(campoValorSimbologia('code128')).toBe('codigo_ean')
    expect(campoValorSimbologia('ean13')).toBe('codigo_ean')

    // Fallback defensivo a qr
    expect(campoValorSimbologia(undefined)).toBe('qr_code')
    expect(campoValorSimbologia('invalido')).toBe('qr_code')
  })

  it('resolverValorSimbologia resuelve snake_case (qr_code vs codigo_ean) según la simbología', () => {
    const item = {
      qr_code: 'abcdef1234567890abcdef12',
      codigo_ean: '2000000000015',
    }

    expect(resolverValorSimbologia('qr', item)).toBe('abcdef1234567890abcdef12')
    expect(resolverValorSimbologia('datamatrix', item)).toBe('abcdef1234567890abcdef12')
    expect(resolverValorSimbologia('code128', item)).toBe('2000000000015')
    expect(resolverValorSimbologia('ean13', item)).toBe('2000000000015')
  })

  it('resolverValorSimbologia resuelve camelCase (qrCode vs codigoEan)', () => {
    const props = {
      qrCode: 'abcdef1234567890abcdef12',
      codigoEan: '2000000000015',
    }

    expect(resolverValorSimbologia('qr', props)).toBe('abcdef1234567890abcdef12')
    expect(resolverValorSimbologia('code128', props)).toBe('2000000000015')
  })

  it('resolverValorSimbologia devuelve string vacío si falta el campo pedido', () => {
    expect(resolverValorSimbologia('qr', {})).toBe('')
    expect(resolverValorSimbologia('code128', { qr_code: 'abc' })).toBe('')
  })
})
