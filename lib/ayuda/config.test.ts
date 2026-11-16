import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ayudaDisponible, leerConfigAyuda } from './config'

describe('lib/ayuda/config', () => {
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalModel = process.env.GEMINI_MODEL
  const originalFallback = process.env.GEMINI_MODEL_FALLBACK

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_MODEL_FALLBACK
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
    if (originalFallback !== undefined) {
      process.env.GEMINI_MODEL_FALLBACK = originalFallback
    } else {
      delete process.env.GEMINI_MODEL_FALLBACK
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

    it('devuelve true si GEMINI_API_KEY y GEMINI_MODEL son válidos', () => {
      process.env.GEMINI_API_KEY = 'test-key-123'
      expect(ayudaDisponible()).toBe(true)
    })

    it('devuelve false si GEMINI_MODEL es inválido (alineado con leerConfigAyuda)', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.env.GEMINI_API_KEY = 'test-key-123'
      process.env.GEMINI_MODEL = 'Gemini 3!'

      expect(ayudaDisponible()).toBe(false)
      spyError.mockRestore()
    })
  })

  describe('leerConfigAyuda', () => {
    it('devuelve null si GEMINI_API_KEY no está disponible', () => {
      expect(leerConfigAyuda()).toBeNull()

      process.env.GEMINI_API_KEY = ''
      expect(leerConfigAyuda()).toBeNull()
    })

    it('devuelve apiKey y modelo por defecto (gemini-3.5-flash-lite) si GEMINI_MODEL no está configurado', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3.5-flash-lite',
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
        modelo: 'gemini-3.5-flash-lite',
      })
    })

    it('devuelve null, ayudaDisponible false y loguea "ayuda: configuración inválida" sin valores si GEMINI_MODEL es inválido', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'Gemini 3!'

      const cfg = leerConfigAyuda()
      expect(cfg).toBeNull()
      expect(ayudaDisponible()).toBe(false)

      expect(spyError).toHaveBeenCalledWith('ayuda: configuración inválida')
      for (const callArgs of spyError.mock.calls) {
        expect(callArgs).toHaveLength(1)
        expect(callArgs[0]).toBe('ayuda: configuración inválida')
        expect(callArgs[0]).not.toContain('clave-secreta')
        expect(callArgs[0]).not.toContain('Gemini 3!')
      }

      spyError.mockRestore()
    })

    it('devuelve modeloFallback si GEMINI_MODEL_FALLBACK es válido', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'gemini-3-flash-preview'
      process.env.GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash'

      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3-flash-preview',
        modeloFallback: 'gemini-2.5-flash',
      })
    })

    it('ignora GEMINI_MODEL_FALLBACK si está vacío o solo espacios', () => {
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'gemini-3-flash-preview'
      process.env.GEMINI_MODEL_FALLBACK = '   '

      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3-flash-preview',
      })
    })

    it('ignora GEMINI_MODEL_FALLBACK si es inválido, loguea mensaje fijo sin valores y mantiene ayudaDisponible true', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.env.GEMINI_API_KEY = 'clave-secreta'
      process.env.GEMINI_MODEL = 'gemini-3-flash-preview'
      process.env.GEMINI_MODEL_FALLBACK = 'Gemini 2.5 Invalido!'

      const cfg = leerConfigAyuda()
      expect(cfg).toEqual({
        apiKey: 'clave-secreta',
        modelo: 'gemini-3-flash-preview',
      })
      expect(ayudaDisponible()).toBe(true)

      expect(spyError).toHaveBeenCalledWith('ayuda: configuración inválida')
      for (const callArgs of spyError.mock.calls) {
        expect(callArgs[0]).not.toContain('Gemini 2.5 Invalido!')
        expect(callArgs[0]).not.toContain('clave-secreta')
      }

      spyError.mockRestore()
    })
  })
})
