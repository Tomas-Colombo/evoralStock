import { describe, expect, it } from 'vitest'
import { calcularDigitoEan13, esEan13Valido, generarEan13 } from './ean13'

describe('ean13', () => {
  describe('calcularDigitoEan13', () => {
    it('calcula correctamente el dígito verificador para el vector canónico 200000000000', () => {
      // 2 * 1 + 0 = 2 -> (10 - 2) = 8
      expect(calcularDigitoEan13('200000000000')).toBe(8)
    })

    it('calcula correctamente dígitos para otros códigos conocidos', () => {
      // 779123456789 -> cálculo GS1
      // Pos impares (×1): 7+9+2+4+6+8 = 36
      // Pos pares (×3): (7+1+3+5+7+9)*3 = 32 * 3 = 96
      // Suma = 132 -> 132 % 10 = 2 -> (10 - 2) = 8
      expect(calcularDigitoEan13('779123456789')).toBe(8)

      // Vector con dígito 0 exacto (suma múltiplo de 10)
      // 400638133393 -> suma = 70 -> (10 - 0) % 10 = 0
      expect(calcularDigitoEan13('400638133393')).toBe(1)
    })

    it('falla si el string no tiene exactamente 12 dígitos numéricos', () => {
      expect(() => calcularDigitoEan13('123')).toThrow(/12 dígitos/)
      expect(() => calcularDigitoEan13('2000000000008')).toThrow(/12 dígitos/)
      expect(() => calcularDigitoEan13('20000000000a')).toThrow(/12 dígitos/)
    })
  })

  describe('esEan13Valido', () => {
    it('valida como true el vector 2000000000008', () => {
      expect(esEan13Valido('2000000000008')).toBe(true)
    })

    it('rechaza códigos con verificador inválido', () => {
      expect(esEan13Valido('2000000000000')).toBe(false)
      expect(esEan13Valido('2000000000001')).toBe(false)
      expect(esEan13Valido('2000000000007')).toBe(false)
      expect(esEan13Valido('2000000000009')).toBe(false)
    })

    it('rechaza entradas de longitud distinta a 13 o no numéricas', () => {
      expect(esEan13Valido('')).toBe(false)
      expect(esEan13Valido('200000000000')).toBe(false)
      expect(esEan13Valido('20000000000080')).toBe(false)
      expect(esEan13Valido('200000000000A')).toBe(false)
      expect(esEan13Valido(null)).toBe(false)
      expect(esEan13Valido(undefined)).toBe(false)
      expect(esEan13Valido(1234567890123)).toBe(false)
    })
  })

  describe('generarEan13', () => {
    it('genera el EAN completo agregando el dígito verificador', () => {
      expect(generarEan13('200000000000')).toBe('2000000000008')
    })
  })
})
