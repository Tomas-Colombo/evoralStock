import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ETIQUETA_CONFIG_DEFAULTS } from '@/lib/etiquetas/limites'

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
}))

describe('lib/dal/etiquetas/etiquetas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getEtiquetaConfig', () => {
    it('devuelve los datos de la fila con los tipos numéricos correctos', async () => {
      let selectCols = ''
      const builder = {
        select: (cols: string) => {
          selectCols = cols
          return builder
        },
        maybeSingle: async () => ({
          data: {
            metodo: 'code128',
            impresora_tipo: 'rollo',
            margen_mm: '5.50',
            separacion_mm: '1.20',
            columnas: '2',
            offset_x_mm: '0.50',
            offset_y_mm: '-1.00',
          },
          error: null,
        }),
      }

      createServerClientMock.mockResolvedValue({
        from: (tabla: string) => {
          expect(tabla).toBe('etiqueta_config')
          return builder
        },
      })

      const { getEtiquetaConfig } = await import('./etiquetas')
      const config = await getEtiquetaConfig()

      expect(selectCols).toBe('metodo, impresora_tipo, margen_mm, separacion_mm, columnas, offset_x_mm, offset_y_mm')
      expect(config).toEqual({
        metodo: 'code128',
        impresora_tipo: 'rollo',
        margen_mm: 5.5,
        separacion_mm: 1.2,
        columnas: 2,
        offset_x_mm: 0.5,
        offset_y_mm: -1,
      })
    })

    it('devuelve los valores por defecto si no hay fila o supabase devuelve error', async () => {
      const builder = {
        select: () => builder,
        maybeSingle: async () => ({ data: null, error: { message: 'not found' } }),
      }

      createServerClientMock.mockResolvedValue({
        from: () => builder,
      })

      const { getEtiquetaConfig } = await import('./etiquetas')
      const config = await getEtiquetaConfig()

      expect(config).toEqual({
        metodo: ETIQUETA_CONFIG_DEFAULTS.metodo,
        impresora_tipo: ETIQUETA_CONFIG_DEFAULTS.impresora_tipo,
        margen_mm: ETIQUETA_CONFIG_DEFAULTS.margen_mm,
        separacion_mm: ETIQUETA_CONFIG_DEFAULTS.separacion_mm,
        columnas: ETIQUETA_CONFIG_DEFAULTS.columnas,
        offset_x_mm: ETIQUETA_CONFIG_DEFAULTS.offset_x_mm,
        offset_y_mm: ETIQUETA_CONFIG_DEFAULTS.offset_y_mm,
      })
    })
  })

  describe('listEtiquetaPlantillas', () => {
    it('lista las plantillas con orden predeterminada desc, nombre asc y columnas explícitas', async () => {
      let selectCols = ''
      const orderCalls: Array<{ col: string; opts: unknown }> = []
      let limitValue = 0

      const fakeRows = [
        {
          id_plantilla: 'plan-1',
          id_tenant: 'tenant-1',
          nombre: 'Predeterminada',
          ancho_mm: '50.00',
          alto_mm: '30.00',
          mostrar_nombre: true,
          mostrar_talle: true,
          mostrar_sku: false,
          mostrar_texto_codigo: false,
          predeterminada: true,
          created_at: '2026-11-13T10:00:00Z',
          updated_at: '2026-11-13T10:00:00Z',
        },
      ]

      const builder = {
        select: (cols: string) => {
          selectCols = cols
          return builder
        },
        order: (col: string, opts: unknown) => {
          orderCalls.push({ col, opts })
          return builder
        },
        limit: (n: number) => {
          limitValue = n
          return Promise.resolve({ data: fakeRows, error: null })
        },
      }

      createServerClientMock.mockResolvedValue({
        from: (tabla: string) => {
          expect(tabla).toBe('etiqueta_plantilla')
          return builder
        },
      })

      const { listEtiquetaPlantillas } = await import('./etiquetas')
      const plantillas = await listEtiquetaPlantillas()

      expect(selectCols).toContain('id_plantilla')
      expect(selectCols).toContain('nombre')
      expect(orderCalls).toEqual([
        { col: 'predeterminada', opts: { ascending: false } },
        { col: 'nombre', opts: { ascending: true } },
      ])
      expect(limitValue).toBe(20)
      expect(plantillas).toHaveLength(1)
      expect(plantillas[0]).toEqual({
        id_plantilla: 'plan-1',
        id_tenant: 'tenant-1',
        nombre: 'Predeterminada',
        ancho_mm: 50,
        alto_mm: 30,
        mostrar_nombre: true,
        mostrar_talle: true,
        mostrar_sku: false,
        mostrar_texto_codigo: false,
        predeterminada: true,
        created_at: '2026-11-13T10:00:00Z',
        updated_at: '2026-11-13T10:00:00Z',
      })
    })

    it('lanza error si la consulta falla', async () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: null, error: { message: 'database down' } }),
      }

      createServerClientMock.mockResolvedValue({
        from: () => builder,
      })

      const { listEtiquetaPlantillas } = await import('./etiquetas')
      await expect(listEtiquetaPlantillas()).rejects.toThrow('listEtiquetaPlantillas: database down')
    })
  })

  describe('spSetEtiquetaConfig', () => {
    it('invoca sp_set_etiqueta_config con los parámetros correspondientes', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: null })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spSetEtiquetaConfig } = await import('./etiquetas')
      await spSetEtiquetaConfig({
        metodo: 'ean13',
        impresora_tipo: 'hoja',
        margen_mm: 10,
        separacion_mm: 2,
        columnas: 3,
        offset_x_mm: 1,
        offset_y_mm: -1,
      })

      expect(rpcMock).toHaveBeenCalledWith('sp_set_etiqueta_config', {
        p_metodo: 'ean13',
        p_impresora_tipo: 'hoja',
        p_margen_mm: 10,
        p_separacion_mm: 2,
        p_columnas: 3,
        p_offset_x_mm: 1,
        p_offset_y_mm: -1,
        p_ip: null,
      })
    })

    it('mapea no-permission si el RPC devuelve error', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: { message: 'no-permission' } })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spSetEtiquetaConfig } = await import('./etiquetas')
      await expect(
        spSetEtiquetaConfig({
          metodo: 'qr',
          impresora_tipo: 'hoja',
          margen_mm: 10,
          separacion_mm: 2,
          columnas: null,
          offset_x_mm: 0,
          offset_y_mm: 0,
        }),
      ).rejects.toThrow('no-permission')
    })
  })

  describe('spCrearEtiquetaPlantilla', () => {
    it('invoca sp_crear_etiqueta_plantilla y devuelve el uuid generado', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ data: 'uuid-creado', error: null })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spCrearEtiquetaPlantilla } = await import('./etiquetas')
      const id = await spCrearEtiquetaPlantilla({
        nombre: 'Plantilla Test',
        ancho_mm: 40,
        alto_mm: 25,
        mostrar_nombre: true,
        mostrar_talle: false,
        mostrar_sku: true,
        mostrar_texto_codigo: false,
      })

      expect(id).toBe('uuid-creado')
      expect(rpcMock).toHaveBeenCalledWith('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Plantilla Test',
        p_ancho_mm: 40,
        p_alto_mm: 25,
        p_mostrar_nombre: true,
        p_mostrar_talle: false,
        p_mostrar_sku: true,
        p_mostrar_texto_codigo: false,
        p_ip: null,
      })
    })
  })

  describe('spEditarEtiquetaPlantilla', () => {
    it('invoca sp_editar_etiqueta_plantilla con el id y campos', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: null })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spEditarEtiquetaPlantilla } = await import('./etiquetas')
      await spEditarEtiquetaPlantilla({
        id: 'plan-id',
        nombre: 'Editada',
        ancho_mm: 45,
        alto_mm: 30,
        mostrar_nombre: true,
        mostrar_talle: true,
        mostrar_sku: false,
        mostrar_texto_codigo: true,
      })

      expect(rpcMock).toHaveBeenCalledWith('sp_editar_etiqueta_plantilla', {
        p_id_plantilla: 'plan-id',
        p_nombre: 'Editada',
        p_ancho_mm: 45,
        p_alto_mm: 30,
        p_mostrar_nombre: true,
        p_mostrar_talle: true,
        p_mostrar_sku: false,
        p_mostrar_texto_codigo: true,
        p_ip: null,
      })
    })
  })

  describe('spMarcarEtiquetaPlantillaPredeterminada', () => {
    it('invoca sp_marcar_etiqueta_plantilla_predeterminada con p_id_plantilla', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: null })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spMarcarEtiquetaPlantillaPredeterminada } = await import('./etiquetas')
      await spMarcarEtiquetaPlantillaPredeterminada('plan-id')

      expect(rpcMock).toHaveBeenCalledWith('sp_marcar_etiqueta_plantilla_predeterminada', {
        p_id_plantilla: 'plan-id',
        p_ip: null,
      })
    })
  })

  describe('spEliminarEtiquetaPlantilla', () => {
    it('invoca sp_eliminar_etiqueta_plantilla con p_id_plantilla', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: null })
      createServerClientMock.mockResolvedValue({ rpc: rpcMock })

      const { spEliminarEtiquetaPlantilla } = await import('./etiquetas')
      await spEliminarEtiquetaPlantilla('plan-id')

      expect(rpcMock).toHaveBeenCalledWith('sp_eliminar_etiqueta_plantilla', {
        p_id_plantilla: 'plan-id',
        p_ip: null,
      })
    })
  })
})
