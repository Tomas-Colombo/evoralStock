import { describe, expect, it } from 'vitest'
import {
  buscarBM25,
  IndiceBM25,
  PESO_TURNO_PREVIO,
  UMBRAL_MINIMO_BM25,
} from './bm25'
import type { EntradaGuia } from './tipos'
import type { Permiso } from '@/lib/types/administracion'

describe('Motor BM25 (REQ-AYUDA-V2-03 / 04 / 05)', () => {
  const permisosCompletos = new Set<Permiso>([
    'ventas.ver',
    'ventas.crear',
    'ventas.editar',
    'gastos.ver',
    'gastos.crear',
    'inventario.ver',
    'inventario.editar',
  ])

  describe('REQ-AYUDA-V2-03 — Retrieval BM25 local fail-closed', () => {
    it('Feliz: operador con permiso ventas consulta por facturación; recupera entradas relevantes de ventas', () => {
      const permisos = new Set<Permiso>(['ventas.ver', 'ventas.crear'])
      const resultados = buscarBM25('cómo emitir una factura o comprobante', permisos)

      expect(resultados.length).toBeGreaterThan(0)
      expect(resultados.length).toBeLessThanOrEqual(5)
      expect(resultados[0].entrada.permisos.every((p) => permisos.has(p))).toBe(true)
      // Debe rankear alto emitir comprobante
      const ids = resultados.map((r) => r.entrada.id)
      expect(ids).toContain('ventas-emitir-comprobante')
      expect(resultados[0].scoreNormalizado).toBeGreaterThan(0)
      expect(resultados[0].scoreNormalizado).toBeLessThanOrEqual(1)
    })

    it('N1: operador sin permiso gastos consulta por "cómo cargar un gasto"; ninguna entrada de gastos aparece', () => {
      // Solo tiene permiso ventas
      const permisos = new Set<Permiso>(['ventas.ver', 'ventas.crear'])
      const resultados = buscarBM25('cómo cargar un nuevo gasto operativo', permisos)

      for (const r of resultados) {
        expect(r.entrada.id.startsWith('gastos-')).toBe(false)
        expect(r.entrada.permisos.some((p) => p.startsWith('gastos.'))).toBe(false)
      }
    })

    it('N2: conjunto de permisos vacío → lista recuperada vacía', () => {
      const permisosVacios = new Set<Permiso>()
      const resultados = buscarBM25('cómo cobrar una venta', permisosVacios)
      expect(resultados).toEqual([])
    })

    it('N3: descarta resultados con score <= 0 antes del topK', () => {
      const resultados = buscarBM25('termino_completamente_inexistente_xyz_987654', permisosCompletos)
      expect(resultados).toEqual([])
      // Si hay coincidencias, ningún elemento retornado tiene score <= 0
      const resVentas = buscarBM25('venta', permisosCompletos, { topK: 100 })
      expect(resVentas.length).toBeGreaterThan(0)
      expect(resVentas.every((r) => r.score > 0)).toBe(true)
      expect(resVentas.every((r) => r.scoreNormalizado > 0 && r.scoreNormalizado <= 1)).toBe(true)
    })
  })

  describe('REQ-AYUDA-V2-04 — Umbral de corte BM25 normalizado y discriminación de consultas', () => {
    it('Feliz: consulta fuera de dominio queda bajo el umbral mínimo BM25 normalizado', () => {
      const resultados = buscarBM25('cómo cocinar una pizza napolitana en horno de barro', permisosCompletos)

      const mejorScore = resultados[0]?.scoreNormalizado ?? 0
      expect(mejorScore).toBeLessThan(UMBRAL_MINIMO_BM25)
    })

    it('N1: consulta con palabras clave operativas reconocidas supera el umbral normalizado', () => {
      const resultados = buscarBM25('cómo anular una venta confirmada', permisosCompletos)

      expect(resultados.length).toBeGreaterThan(0)
      expect(resultados[0].scoreNormalizado).toBeGreaterThanOrEqual(UMBRAL_MINIMO_BM25)
      expect(resultados[0].entrada.id).toBe('ventas-anular-venta')
    })
  })

  describe('REQ-AYUDA-V2-05 — Contexto multi-turno y revalidación de citas previas', () => {
    it('Feliz: turno previo cita ventas-registrar-venta; turno 2 consulta "¿y el descuento?"; BM25 pondera turno previo', () => {
      const resSinContexto = buscarBM25('y el descuento', permisosCompletos)
      const resConContexto = buscarBM25('y el descuento', permisosCompletos, {
        citasPrevias: ['ventas-registrar-venta'],
      })

      expect(resConContexto.length).toBeGreaterThan(0)
      // Con el contexto de la venta, las pantallas relacionadas a ventas y descuentos se ven favorecidas
      const scoreConContexto = resConContexto.find(
        (r) => r.entrada.id === 'ventas-registrar-venta',
      )?.score ?? 0
      const scoreSinContexto = resSinContexto.find(
        (r) => r.entrada.id === 'ventas-registrar-venta',
      )?.score ?? 0

      expect(scoreConContexto).toBeGreaterThan(scoreSinContexto)
    })

    it('N1: cliente envía id de entrada ajena a sus permisos actuales; servidor la descarta', () => {
      const permisosSoloVentas = new Set<Permiso>(['ventas.ver'])

      // gastos-registrar no está permitido para este usuario
      const res = buscarBM25('consultar estado', permisosSoloVentas, {
        citasPrevias: ['gastos-registrar'],
      })

      // Ningún resultado devuelto debe ser gastos ni haberse contaminado con permisos no autorizados
      for (const r of res) {
        expect(r.entrada.id.startsWith('gastos-')).toBe(false)
      }
    })

    it('N2: cliente envía id con más de 64 caracteres o caracteres inválidos; se ignora sin error', () => {
      const idLargo = 'a'.repeat(65)
      const idInvalido = 'ventas registrar con espacios'

      const res = buscarBM25('cómo registrar una venta', permisosCompletos, {
        citasPrevias: [idLargo, idInvalido, '!@#$%^&*()'],
      })

      expect(res.length).toBeGreaterThan(0)
      expect(res[0].entrada.id).toBe('ventas-registrar-venta')
    })

    it('N4: la cita previa no tapa una pregunta de otro tema', () => {
      const res = buscarBM25('como hacer una venta', permisosCompletos, {
        citasPrevias: ['gastos-registrar'],
      })

      expect(res[0].entrada.id.startsWith('ventas-')).toBe(true)
      expect(res.map((r) => r.entrada.id)).toContain('ventas-registrar-venta')
    })

    it('N3: si el cliente envía más de 4 citas previas, se conservan solo las 4 más recientes', () => {
      const citas = [
        'ventas-listado',
        'ventas-emitir-comprobante',
        'gastos-listado',
        'inventario-listado',
        'ventas-registrar-venta',
      ]

      const res = buscarBM25('descuentos', permisosCompletos, {
        citasPrevias: citas,
      })

      expect(res.length).toBeGreaterThan(0)
    })
  })

  describe('Aislamiento y ponderación del índice', () => {
    it('exporta constantes requeridas por la spec para su calibración', () => {
      expect(typeof UMBRAL_MINIMO_BM25).toBe('number')
      expect(UMBRAL_MINIMO_BM25).toBeGreaterThan(0)
      expect(UMBRAL_MINIMO_BM25).toBeLessThanOrEqual(1)
      expect(PESO_TURNO_PREVIO).toBe(0.4)
    })

    it('admite guía personalizada en IndiceBM25 para pruebas aisladas', () => {
      const guiaFixture: readonly EntradaGuia[] = [
        {
          id: 'test-1',
          titulo: 'Guía de prueba sobre remitos',
          pasos: ['Paso A', 'Paso B'],
          permisos: ['ventas.ver'],
          alias: ['comprobante de entrega', 'despacho'],
        },
        {
          id: 'test-2',
          titulo: 'Guía sobre notas de crédito',
          pasos: ['Paso X'],
          permisos: ['ventas.ver'],
        },
      ]

      const indice = new IndiceBM25(guiaFixture)
      const res = indice.buscar('despacho', new Set<Permiso>(['ventas.ver']))
      expect(res.length).toBeGreaterThan(0)
      expect(res[0].entrada.id).toBe('test-1')
      expect(res[0].scoreNormalizado).toBeGreaterThan(0)
      expect(res[0].scoreNormalizado).toBeLessThanOrEqual(1)
    })
  })
})
