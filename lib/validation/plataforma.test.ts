import { describe, expect, it } from 'vitest'
import {
  registrarCargoSchema,
  registrarPagoSchema,
  anularMovimientoSchema,
  togglePaqueteSchema,
  altaTenantSchema,
  cambiarEstadoTenantSchema,
  extraerReasonZod,
} from './plataforma'

const UUID_TENANT = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const UUID_MOVIMIENTO = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('registrarCargoSchema', () => {
  it('caso feliz: acepta input válido y transforma YYYY-MM a YYYY-MM-01', () => {
    const res = registrarCargoSchema.safeParse({
      idTenant: UUID_TENANT,
      periodo: '2026-11',
      monto: 25000.5,
      concepto: '  Abono mensual  ',
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.idTenant).toBe(UUID_TENANT)
      expect(res.data.periodo).toBe('2026-11-01')
      expect(res.data.monto).toBe(25000.5)
      expect(res.data.concepto).toBe('Abono mensual')
    }
  })

  it('rechaza idTenant que no sea uuid válido', () => {
    const res = registrarCargoSchema.safeParse({
      idTenant: 'invalido',
      periodo: '2026-11',
      monto: 100,
      concepto: 'Cargo',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tenant-inexistente')
    }
  })

  it('rechaza periodo con formato inválido o mes fuera de rango', () => {
    const invalidos = ['2026-13', '2026-00', '2026/11', 'nov-2026', '2026-1', '']
    for (const periodo of invalidos) {
      const res = registrarCargoSchema.safeParse({
        idTenant: UUID_TENANT,
        periodo,
        monto: 100,
        concepto: 'Cargo',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('periodo-invalido')
      }
    }
  })

  it('rechaza monto <= 0 o con más de 2 decimales', () => {
    const montosInvalidos = [0, -50, 100.555, -0.01, NaN, Infinity]
    for (const monto of montosInvalidos) {
      const res = registrarCargoSchema.safeParse({
        idTenant: UUID_TENANT,
        periodo: '2026-11',
        monto,
        concepto: 'Cargo',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('monto-invalido')
      }
    }
  })

  it('rechaza concepto vacío o solo espacios en blanco', () => {
    const conceptosInvalidos = ['', '   ', '\t\n']
    for (const concepto of conceptosInvalidos) {
      const res = registrarCargoSchema.safeParse({
        idTenant: UUID_TENANT,
        periodo: '2026-11',
        monto: 100,
        concepto,
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('concepto-invalido')
      }
    }
  })

  it('strictObject: rechaza campos extra o intento de inyectar actor/created_by', () => {
    const res = registrarCargoSchema.safeParse({
      idTenant: UUID_TENANT,
      periodo: '2026-11',
      monto: 100,
      concepto: 'Cargo',
      created_by: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })

  it('rechaza payload no objeto', () => {
    const res = registrarCargoSchema.safeParse(null)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('payload-invalido')
    }
  })
})

describe('registrarPagoSchema', () => {
  it('caso feliz: acepta input válido, formatea fecha y recorta nota', () => {
    const res = registrarPagoSchema.safeParse({
      idTenant: UUID_TENANT,
      fecha: '2026-10-29',
      monto: 15000.75,
      medio: 'transferencia',
      nota: '  Comprobante #1234  ',
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.idTenant).toBe(UUID_TENANT)
      expect(res.data.fecha).toBe('2026-10-29')
      expect(res.data.monto).toBe(15000.75)
      expect(res.data.medio).toBe('transferencia')
      expect(res.data.nota).toBe('Comprobante #1234')
    }
  })

  it('acepta nota ausente o nula', () => {
    const res1 = registrarPagoSchema.safeParse({
      idTenant: UUID_TENANT,
      fecha: '2026-10-29',
      monto: 500,
      medio: 'efectivo',
    })
    expect(res1.success).toBe(true)

    const res2 = registrarPagoSchema.safeParse({
      idTenant: UUID_TENANT,
      fecha: '2026-10-29',
      monto: 500,
      medio: 'mercadopago',
      nota: null,
    })
    expect(res2.success).toBe(true)
  })

  it('rechaza idTenant inválido', () => {
    const res = registrarPagoSchema.safeParse({
      idTenant: 'not-a-uuid',
      fecha: '2026-10-29',
      monto: 500,
      medio: 'efectivo',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tenant-inexistente')
    }
  })

  it('rechaza fecha con formato inválido', () => {
    const fechasInvalidas = ['2026/10/29', '29-10-2026', '2026-1-1', 'ayer', '']
    for (const fecha of fechasInvalidas) {
      const res = registrarPagoSchema.safeParse({
        idTenant: UUID_TENANT,
        fecha,
        monto: 500,
        medio: 'efectivo',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('fecha-invalida')
      }
    }
  })

  it('rechaza monto <= 0 o con más de 2 decimales', () => {
    const montosInvalidos = [0, -10, 45.999]
    for (const monto of montosInvalidos) {
      const res = registrarPagoSchema.safeParse({
        idTenant: UUID_TENANT,
        fecha: '2026-10-29',
        monto,
        medio: 'efectivo',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('monto-invalido')
      }
    }
  })

  it('rechaza medio fuera de MEDIOS_PAGO_TENANT', () => {
    const res = registrarPagoSchema.safeParse({
      idTenant: UUID_TENANT,
      fecha: '2026-10-29',
      monto: 500,
      medio: 'bitcoin',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('medio-pago-invalido')
    }
  })

  it('strictObject: rechaza campos extra como created_by o actor', () => {
    const res = registrarPagoSchema.safeParse({
      idTenant: UUID_TENANT,
      fecha: '2026-10-29',
      monto: 500,
      medio: 'efectivo',
      actor: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})

describe('anularMovimientoSchema', () => {
  it('caso feliz: acepta tipo cargo o pago con idMovimiento uuid', () => {
    const resCargo = anularMovimientoSchema.safeParse({
      tipo: 'cargo',
      idMovimiento: UUID_MOVIMIENTO,
    })
    expect(resCargo.success).toBe(true)

    const resPago = anularMovimientoSchema.safeParse({
      tipo: 'pago',
      idMovimiento: UUID_MOVIMIENTO,
    })
    expect(resPago.success).toBe(true)
  })

  it('rechaza tipo de movimiento inválido', () => {
    const res = anularMovimientoSchema.safeParse({
      tipo: 'devolucion',
      idMovimiento: UUID_MOVIMIENTO,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tipo-movimiento-invalido')
    }
  })

  it('rechaza idMovimiento que no sea uuid', () => {
    const res = anularMovimientoSchema.safeParse({
      tipo: 'cargo',
      idMovimiento: 'no-uuid',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('movimiento-inexistente')
    }
  })

  it('strictObject: rechaza anulado_por', () => {
    const res = anularMovimientoSchema.safeParse({
      tipo: 'cargo',
      idMovimiento: UUID_MOVIMIENTO,
      anulado_por: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})

describe('togglePaqueteSchema', () => {
  it('caso feliz: acepta paquetes opcionales declarados y boolean', () => {
    const res1 = togglePaqueteSchema.safeParse({
      idTenant: UUID_TENANT,
      paquete: 'revendedoras',
      habilitado: true,
    })
    expect(res1.success).toBe(true)

    const res2 = togglePaqueteSchema.safeParse({
      idTenant: UUID_TENANT,
      paquete: 'consignacionProveedor',
      habilitado: false,
    })
    expect(res2.success).toBe(true)
  })

  it('rechaza idTenant inválido', () => {
    const res = togglePaqueteSchema.safeParse({
      idTenant: 'invalid',
      paquete: 'revendedoras',
      habilitado: true,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tenant-inexistente')
    }
  })

  it('rechaza paquete inexistente o módulo del núcleo', () => {
    const res = togglePaqueteSchema.safeParse({
      idTenant: UUID_TENANT,
      paquete: 'ventas',
      habilitado: true,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('paquete-invalido')
    }
  })

  it('rechaza habilitado no booleano', () => {
    const res = togglePaqueteSchema.safeParse({
      idTenant: UUID_TENANT,
      paquete: 'revendedoras',
      habilitado: 'true',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('payload-invalido')
    }
  })

  it('strictObject: rechaza actor o ip en el input', () => {
    const res = togglePaqueteSchema.safeParse({
      idTenant: UUID_TENANT,
      paquete: 'revendedoras',
      habilitado: true,
      actor: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})

describe('altaTenantSchema', () => {
  it('caso feliz: acepta input válido, recorta strings y asigna paquetes por defecto vacío', () => {
    const res = altaTenantSchema.safeParse({
      nombre: '  Boutique Alfa  ',
      subdominio: 'boutique-alfa',
      emailAdmin: '  ADMIN@alfa.COM ',
      nombreAdmin: '  Ana Álvarez  ',
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.nombre).toBe('Boutique Alfa')
      expect(res.data.subdominio).toBe('boutique-alfa')
      expect(res.data.emailAdmin).toBe('admin@alfa.com')
      expect(res.data.nombreAdmin).toBe('Ana Álvarez')
      expect(res.data.paquetes).toEqual([])
    }
  })

  it('acepta paquetes opcionales reconocidos', () => {
    const res = altaTenantSchema.safeParse({
      nombre: 'Boutique Beta',
      subdominio: 'boutique-beta',
      emailAdmin: 'admin@beta.com',
      nombreAdmin: 'Beta Admin',
      paquetes: ['revendedoras', 'consignacionProveedor'],
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.paquetes).toEqual(['revendedoras', 'consignacionProveedor'])
    }
  })

  it('rechaza subdominio inválido (muy corto, mayúsculas, caracteres especiales o reservado)', () => {
    const invalidos = ['ab', 'Boutique', 'sub_dominio', 'admin', 'www', '']
    for (const subdominio of invalidos) {
      const res = altaTenantSchema.safeParse({
        nombre: 'Boutique Test',
        subdominio,
        emailAdmin: 'admin@test.com',
        nombreAdmin: 'Admin Test',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(extraerReasonZod(res.error)).toBe('subdominio-invalido')
      }
    }
  })

  it('rechaza email de admin inválido', () => {
    const res = altaTenantSchema.safeParse({
      nombre: 'Boutique Test',
      subdominio: 'boutique-test',
      emailAdmin: 'no-es-un-email',
      nombreAdmin: 'Admin Test',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('email-invalido')
    }
  })

  it('rechaza nombre comercial o nombre admin vacíos', () => {
    const res1 = altaTenantSchema.safeParse({
      nombre: '   ',
      subdominio: 'boutique-test',
      emailAdmin: 'admin@test.com',
      nombreAdmin: 'Admin',
    })
    expect(res1.success).toBe(false)
    if (!res1.success) {
      expect(extraerReasonZod(res1.error)).toBe('nombre-invalido')
    }

    const res2 = altaTenantSchema.safeParse({
      nombre: 'Boutique',
      subdominio: 'boutique-test',
      emailAdmin: 'admin@test.com',
      nombreAdmin: '   ',
    })
    expect(res2.success).toBe(false)
    if (!res2.success) {
      expect(extraerReasonZod(res2.error)).toBe('nombre-invalido')
    }
  })

  it('rechaza paquete opcional desconocido', () => {
    const res = altaTenantSchema.safeParse({
      nombre: 'Boutique Test',
      subdominio: 'boutique-test',
      emailAdmin: 'admin@test.com',
      nombreAdmin: 'Admin',
      paquetes: ['paquete-fantasma'],
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('paquete-invalido')
    }
  })

  it('strictObject: rechaza campos de actor u otros extra', () => {
    const res = altaTenantSchema.safeParse({
      nombre: 'Boutique Test',
      subdominio: 'boutique-test',
      emailAdmin: 'admin@test.com',
      nombreAdmin: 'Admin',
      actor: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})

describe('cambiarEstadoTenantSchema', () => {
  it('caso feliz: acepta estado activo o suspendido con UUID válido', () => {
    const resActivo = cambiarEstadoTenantSchema.safeParse({
      idTenant: UUID_TENANT,
      estado: 'activo',
    })
    expect(resActivo.success).toBe(true)

    const resSusp = cambiarEstadoTenantSchema.safeParse({
      idTenant: UUID_TENANT,
      estado: 'suspendido',
    })
    expect(resSusp.success).toBe(true)
  })

  it('rechaza idTenant que no sea uuid válido', () => {
    const res = cambiarEstadoTenantSchema.safeParse({
      idTenant: 'invalido',
      estado: 'activo',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('tenant-inexistente')
    }
  })

  it('rechaza estado distinto de activo o suspendido (ej: archivado o desconocido)', () => {
    const res = cambiarEstadoTenantSchema.safeParse({
      idTenant: UUID_TENANT,
      estado: 'archivado',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('estado-invalido')
    }
  })

  it('strictObject: rechaza campos de actor', () => {
    const res = cambiarEstadoTenantSchema.safeParse({
      idTenant: UUID_TENANT,
      estado: 'activo',
      actor: UUID_TENANT,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(extraerReasonZod(res.error)).toBe('campo-desconocido')
    }
  })
})
