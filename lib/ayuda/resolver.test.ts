import { describe, expect, it } from 'vitest'
import type { EntradaGuia } from './tipos'
import { resolverRespuesta } from './resolver'

describe('resolverRespuesta', () => {
  const fixtureEntradas: EntradaGuia[] = [
    {
      id: 'ventas-crear',
      titulo: 'Crear venta',
      pasos: ['Ir a ventas', 'Click en nueva venta'],
      ruta: '/ventas',
      permisos: ['ventas.ver', 'ventas.crear'],
    },
    {
      id: 'ayuda-uso',
      titulo: 'Uso de la ayuda',
      pasos: ['Escribí tu consulta'],
      permisos: ['ayuda.consultar'],
      // sin ruta intencionalmente
    },
  ]

  it('REQ-AYUDA-06 Feliz: entradaId con ruta resuelve a respondida con ruta de la guía', () => {
    const resultado = resolverRespuesta(fixtureEntradas, {
      respuesta: 'Andá a ventas para cargarla.',
      entradaId: 'ventas-crear',
    })

    expect(resultado).toEqual({
      resultado: 'respondida',
      texto: 'Andá a ventas para cargarla.',
      entrada: {
        id: 'ventas-crear',
        titulo: 'Crear venta',
        ruta: '/ventas',
      },
    })
  })

  it('REQ-AYUDA-06 Feliz: entradaId sin ruta resuelve sin propiedad ruta', () => {
    const resultado = resolverRespuesta(fixtureEntradas, {
      respuesta: 'Escribí tu consulta claramente.',
      entradaId: 'ayuda-uso',
    })

    expect(resultado).toEqual({
      resultado: 'respondida',
      texto: 'Escribí tu consulta claramente.',
      entrada: {
        id: 'ayuda-uso',
        titulo: 'Uso de la ayuda',
      },
    })
  })

  it('REQ-AYUDA-06 N1: entradaId null devuelve fuera_de_opciones y descarta texto del modelo', () => {
    const resultado = resolverRespuesta(fixtureEntradas, {
      respuesta: 'Texto que debería descartarse porque no está en la guía.',
      entradaId: null,
    })

    expect(resultado).toEqual({
      resultado: 'fuera_de_opciones',
    })
    expect('texto' in resultado).toBe(false)
  })

  it('REQ-AYUDA-06 N2: texto del modelo que contiene rutas (/administracion) se devuelve tal cual como texto, nunca como link', () => {
    const resultado = resolverRespuesta(fixtureEntradas, {
      respuesta: 'El admin puede verlo en /administracion/usuarios.',
      entradaId: 'ventas-crear',
    })

    expect(resultado.resultado).toBe('respondida')
    if (resultado.resultado === 'respondida') {
      expect(resultado.texto).toBe('El admin puede verlo en /administracion/usuarios.')
      // La ruta de entrada debe ser la de la guía (/ventas), nunca la inventada por el modelo
      expect(resultado.entrada.ruta).toBe('/ventas')
    }
  })
})
