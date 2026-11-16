import { describe, expect, it } from 'vitest'
import { normalizarTexto, quitarTildes, stem } from './normalizar'
import { esStopword, WHITELIST_FUNCIONAL } from './stopwords'

describe('normalizarTexto y stopwords (REQ-AYUDA-V2-02)', () => {
  it('REQ-AYUDA-V2-02 Feliz: "Cómo cobrar sin recargo" preserva "sin" y normaliza los términos clave', () => {
    const tokens = normalizarTexto('Cómo cobrar sin recargo')
    expect(tokens).toContain('sin')
    expect(tokens).toContain(stem('cobrar'))
    expect(tokens).toContain(stem('recargo'))
    expect(tokens).not.toContain('como')
  })

  it('REQ-AYUDA-V2-02 N1: "no puedo anular una venta" conserva "no" y "anular", diferenciándose de "cómo anular una venta"', () => {
    const conNegacion = normalizarTexto('no puedo anular una venta')
    const afirmativa = normalizarTexto('cómo anular una venta')

    expect(conNegacion).toContain('no')
    expect(conNegacion).toContain('anul')
    expect(conNegacion).toContain('vent')
    expect(conNegacion).not.toContain('puedo')
    expect(conNegacion).not.toContain('una')

    expect(afirmativa).not.toContain('no')
    expect(afirmativa).toContain('anul')
    expect(afirmativa).toContain('vent')
    expect(afirmativa).not.toContain('como')
    expect(afirmativa).not.toContain('una')

    // Se diferencian por la presencia del token funcional de negación
    expect(conNegacion).not.toEqual(afirmativa)
  })

  it('REQ-AYUDA-V2-02 N2: stopwords tradicionales (el, la, de, un, etc.) son eliminadas correctamente', () => {
    const tokens = normalizarTexto('el stock de la tienda en un producto')
    expect(tokens).toEqual(['stock', 'tiend', 'product'])
  })

  it('unifica flexiones morfológicas: "cobrar", "cobro" y "cobranza" caen juntos', () => {
    const tCobrar = normalizarTexto('cobrar')
    const tCobro = normalizarTexto('cobro')
    const tCobranza = normalizarTexto('cobranza')

    expect(tCobrar).toEqual(['cobr'])
    expect(tCobro).toEqual(['cobr'])
    expect(tCobranza).toEqual(['cobr'])
  })

  it('unifica flexiones verbales y nominales: "anular" y "anulación" caen juntos', () => {
    const tAnular = normalizarTexto('anular')
    const tAnulacion = normalizarTexto('anulación')

    expect(tAnular).toEqual(['anul'])
    expect(tAnulacion).toEqual(['anul'])
  })

  it('preserva toda la whitelist funcional inmutable incluso con tildes de entrada', () => {
    const palabras = [
      'no',
      'sin',
      'con',
      'ya',
      'ni',
      'nunca',
      'todavía',
      'sólo',
      'antes',
      'después',
    ]

    for (const palabra of palabras) {
      const normalizada = quitarTildes(palabra)
      expect(WHITELIST_FUNCIONAL.has(normalizada)).toBe(true)
      expect(esStopword(normalizada)).toBe(false)
      expect(normalizarTexto(palabra)).toEqual([normalizada])
    }
  })

  it('gestiona cadenas vacías, nulas o con solo signos de puntuación', () => {
    expect(normalizarTexto('')).toEqual([])
    expect(normalizarTexto('   ')).toEqual([])
    expect(normalizarTexto('???¡¡¡---...')).toEqual([])
    expect(normalizarTexto(null as unknown as string)).toEqual([])
  })
})
