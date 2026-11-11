import { describe, expect, it } from 'vitest'
import {
  crearIngresoCompletoSchema,
  proveedorSchema,
  proveedorPatchSchema,
  extraerReasonZod,
  createProductoSchema,
  confirmarIngresoSchema,
  importarRemitoSchema,
  completarCostoIngresoSchema,
} from './inventario'

describe('Validación de inventario: ingresos — REQ-MODOP-05', () => {
  it('REQ-MODOP-05 Feliz: permite compra y consignación cuando ambos están habilitados', () => {
    const schema = crearIngresoCompletoSchema(['compra', 'consignacion'])
    const res = schema.safeParse({
      idProveedor: 'd3b07384-d113-4a11-b011-37d36371c667',
      tipoIngreso: 'consignacion',
      numeroRemito: 'R-001',
      observaciones: 'Ingreso consignación',
      moneda: 'ARS',
      lineas: [{ nombre: 'Remera', cantidad: 5 }],
    })
    expect(res.success).toBe(true)
  })

  it('REQ-MODOP-05 N1: consignacion cuando solo se permite compra rechaza con tipo-ingreso-invalido', () => {
    const schema = crearIngresoCompletoSchema(['compra'])
    const res = schema.safeParse({
      idProveedor: null,
      tipoIngreso: 'consignacion',
      lineas: [],
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tipo-ingreso-invalido')
    }
  })

  it('rechaza idProveedor que no sea un UUID válido con proveedor-invalido', () => {
    const schema = crearIngresoCompletoSchema(['compra'])
    const res = schema.safeParse({
      idProveedor: 'no-es-un-uuid',
      tipoIngreso: 'compra',
      lineas: [],
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('proveedor-invalido')
    }
  })

  it('REQ-MODOP-05 N3: input con campo extra rechaza con campo-desconocido (strictObject)', () => {
    const schema = crearIngresoCompletoSchema(['compra'])
    const res = schema.safeParse({
      tipoIngreso: 'compra',
      lineas: [],
      campoExtraNoPermitido: 123,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})

describe('Validación de inventario: proveedores — REQ-MODOP-06', () => {
  it('REQ-MODOP-06 Feliz: permite consignatario cuando el paquete está habilitado', () => {
    const schemaAlta = proveedorSchema(['mayorista', 'particular', 'consignatario'])
    const resAlta = schemaAlta.safeParse({
      nombre: 'Proveedor Consignación',
      tipo: 'consignatario',
    })
    expect(resAlta.success).toBe(true)

    const schemaPatch = proveedorPatchSchema(['mayorista', 'particular', 'consignatario'])
    const resPatch = schemaPatch.safeParse({
      tipo: 'consignatario',
    })
    expect(resPatch.success).toBe(true)
  })

  it('REQ-MODOP-06 N1: alta o edición con tipo consignatario cuando no está habilitado rechaza con tipo-proveedor-invalido', () => {
    const schemaAlta = proveedorSchema(['mayorista', 'particular'])
    const resAlta = schemaAlta.safeParse({
      nombre: 'Proveedor X',
      tipo: 'consignatario',
    })
    expect(resAlta.success).toBe(false)
    if (!resAlta.success) {
      expect(extraerReasonZod(resAlta.error)).toBe('tipo-proveedor-invalido')
    }

    const schemaPatch = proveedorPatchSchema(['mayorista', 'particular'])
    const resPatch = schemaPatch.safeParse({
      tipo: 'consignatario',
    })
    expect(resPatch.success).toBe(false)
    if (!resPatch.success) {
      expect(extraerReasonZod(resPatch.error)).toBe('tipo-proveedor-invalido')
    }
  })

  it('rechaza alta con nombre en blanco con nombre-requerido', () => {
    const schemaAlta = proveedorSchema(['mayorista', 'particular'])
    const res = schemaAlta.safeParse({
      nombre: '   ',
      tipo: 'mayorista',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('nombre-requerido')
    }
  })

  it('REQ-MODOP-06 patch con campo desconocido rechaza (strictObject)', () => {
    const schemaPatch = proveedorPatchSchema(['mayorista', 'particular'])
    const resPatch = schemaPatch.safeParse({
      nombre: 'Nuevo Nombre',
      desconocido: true,
    })
    expect(resPatch.success).toBe(false)
    if (!resPatch.success) {
      expect(extraerReasonZod(resPatch.error)).toBe('campo-desconocido')
    }
  })
})

describe('Validación de inventario: costos-por-columna (Fase 3C.2)', () => {
  const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const VALID_UUID_2 = '4f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

  it('createProductoSchema acepta costoInicial opcional o null', () => {
    expect(createProductoSchema.safeParse({ nombre: 'Remera', idCategoria: VALID_UUID }).success).toBe(true)
    expect(createProductoSchema.safeParse({ nombre: 'Remera', idCategoria: VALID_UUID, costoInicial: null }).success).toBe(true)
    expect(createProductoSchema.safeParse({ nombre: 'Remera', idCategoria: VALID_UUID, costoInicial: 1500 }).success).toBe(true)
    expect(createProductoSchema.safeParse({ nombre: 'Remera', idCategoria: VALID_UUID, costoInicial: -5 }).success).toBe(false)
  })

  it('confirmarIngresoSchema valida UUID y costo opcional', () => {
    expect(confirmarIngresoSchema.safeParse({ idIngreso: VALID_UUID }).success).toBe(true)
    expect(confirmarIngresoSchema.safeParse({ idIngreso: VALID_UUID, costo: 2500 }).success).toBe(true)
    expect(confirmarIngresoSchema.safeParse({ idIngreso: '' }).success).toBe(false)
  })

  it('importarRemitoSchema valida idIngreso y costoUnitario opcional o null por línea', () => {
    const resValido = importarRemitoSchema.safeParse({
      idIngreso: VALID_UUID,
      lineas: [
        { nombre: 'Item 1', cantidad: 3, costoUnitario: null, esNuevo: true, idProducto: null, idCategoria: VALID_UUID },
        { nombre: 'Item 2', cantidad: 1, costoUnitario: 200, esNuevo: false, idProducto: VALID_UUID_2, idCategoria: null },
      ],
    })
    expect(resValido.success).toBe(true)
  })

  describe('completarCostoIngresoSchema', () => {
    it('acepta lote de líneas con costoUnitario > 0 y rechaza negativos o ceros', () => {
      const resValido = completarCostoIngresoSchema.safeParse({
        idIngreso: VALID_UUID,
        lineas: [{ idDetalle: VALID_UUID_2, costoUnitario: 3500 }],
      })
      expect(resValido.success).toBe(true)

      const resCero = completarCostoIngresoSchema.safeParse({
        idIngreso: VALID_UUID,
        lineas: [{ idDetalle: VALID_UUID_2, costoUnitario: 0 }],
      })
      expect(resCero.success).toBe(false)
      if (!resCero.success) {
        expect(extraerReasonZod(resCero.error)).toBe('costo-invalido')
      }

      const resNegativo = completarCostoIngresoSchema.safeParse({
        idIngreso: VALID_UUID,
        lineas: [{ idDetalle: VALID_UUID_2, costoUnitario: -100 }],
      })
      expect(resNegativo.success).toBe(false)
      if (!resNegativo.success) {
        expect(extraerReasonZod(resNegativo.error)).toBe('costo-invalido')
      }
    })

    it('rechaza líneas vacías con detalle-requerido', () => {
      const resVacio = completarCostoIngresoSchema.safeParse({
        idIngreso: VALID_UUID,
        lineas: [],
      })
      expect(resVacio.success).toBe(false)
      if (!resVacio.success) {
        expect(extraerReasonZod(resVacio.error)).toBe('sin-lineas')
      }
    })
  })
})
