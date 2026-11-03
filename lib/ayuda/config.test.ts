import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ayudaDisponible, leerConfigAyuda } from './config'

describe('lib/ayuda/config', () => {
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalModel = process.env.GEMINI_MODEL

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
  })

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.GEMINI_API_KEY = originalApiKey
    } else {
      delete process.env.GEMINI_API_KEY
    }
    if (originalModel !== undefined) {
      process.env.GEMINI_MODEL = originalModel
    } else {
      delete process.env.GEMINI_MODEL
    }
  })

  describe('ayudaDisponible', () => {
    it('devuelve false si GEMINI_API_KEY no está definida', () => {
      expect(ayudaDisponible()).toBe(false)
    })

    it('devuelve false si GEMINI_API_KEY es un string vacío o solo espacios', () => {
      process.env.GEMINI_API_KEY = ''
      expect(ayudaDisponible()).toBe(false)

      process.env.GEMINI_API_KEY = '   '
      expect(ayudaDisponible()).toBe(false)
    })

    it('devuelve true si GEMINI_API_KEY tiene contenido', () => {
      process.env.GEMINI_API_KEY = 'test-key-123'
      expect(ayudaDisponible()).toBe(true)
    })
  })

  describe('leerConfigAyuda', () => {
    it('devuelve null si GEMINI_API_KEY no está disponible', () => {
      expect(leerConfigAyuda()).toBeNull()

      process.env.GEMINI_API_KEY = ''
      expect(leerConfigAyuda()).toBeNull()
    })

    it('devuelve apiKey y modelo por defecto (gemini-3-flash-preview) si GEMINI_MODEL no está configurado', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3-flash-preview',
      })
    })

    it('devuelve el modelo configurado si es válido según regex ^[a-z0-9.-]+$', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'gemini-2.5-flash'
      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-2.5-flash',
      })
    })

    it('usa el default si GEMINI_MODEL está vacío o solo espacios', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = '   '
      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3-flash-preview',
      })
    })

    it('lanza error si GEMINI_MODEL tiene caracteres no permitidos (mayúsculas, espacios, símbolos)', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'Gemini-3-Flash'
      expect(() => leerConfigAyuda()).toThrow()

      process.env.GEMINI_MODEL = 'gemini flash'
      expect(() => leerConfigAyuda()).toThrow()

      process.env.GEMINI_MODEL = 'gemini_3_flash'
      expect(() => leerConfigAyuda()).toThrow()
    })
  })
})
