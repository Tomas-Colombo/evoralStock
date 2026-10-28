import { describe, expect, it } from 'vitest'
import {
  compactarPermisos,
  createRolSchema,
  deleteRolSchema,
  permisosSchema,
  primerReason,
  updateConfiguracionQrSchema,
  updateRolSchema,
  updateTenantLogoSchema,
  cambiarPasswordSchema,
} from './administracion'
import { LOGO_MAX_BYTES } from '@/lib/tenant/logo'

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('permisosSchema', () => {
  it('acepta un subconjunto de módulos', () => {
    const r = permisosSchema.safeParse({ inventario: ['ver', 'crear'], revendedoras: ['ver', 'crear'] })
    expect(r.success).toBe(true)
  })

  it('acepta un rol sin ningún permiso', () => {
    // Crear el rol primero y repartirle permisos después es un flujo válido.
    expect(permisosSchema.safeParse({}).success).toBe(true)
  })

  it('rechaza un módulo que no existe en el catálogo', () => {
    const r = permisosSchema.safeParse({ inventario: ['ver'], contabilidad: ['ver'] })
    expect(r.success).toBe(false)
  })

  it('rechaza una acción que ese módulo no tiene', () => {
    // `ventas` no declara `eliminar`: un `record` con un único esquema de
    // valor dejaría pasar esto.
    expect(permisosSchema.safeParse({ ventas: ['eliminar'] }).success).toBe(false)
    expect(permisosSchema.safeParse({ inventario: ['eliminar'] }).success).toBe(true)
  })

  it('rechaza acciones inventadas', () => {
    expect(permisosSchema.safeParse({ inventario: ['borrar-todo'] }).success).toBe(false)
  })

  it('rechaza acciones duplicadas', () => {
    expect(permisosSchema.safeParse({ inventario: ['ver', 'ver'] }).success).toBe(false)
  })

  it('rechaza valores que no son arrays de strings', () => {
    expect(permisosSchema.safeParse({ inventario: 'ver' }).success).toBe(false)
    expect(permisosSchema.safeParse({ inventario: [1] }).success).toBe(false)
    expect(permisosSchema.safeParse({ inventario: null }).success).toBe(false)
  })

  it('rechaza permisos que no son un objeto', () => {
    expect(permisosSchema.safeParse(null).success).toBe(false)
    expect(permisosSchema.safeParse([]).success).toBe(false)
    expect(permisosSchema.safeParse('inventario').success).toBe(false)
  })

  it('descarta __proto__ de la salida sin contaminar el prototipo', () => {
    // zod NO lo reporta como clave desconocida (carve-out propio), pero sí lo
    // deja afuera del resultado: lo que importa es que no llegue al SP.
    const evil = JSON.parse('{"__proto__":{"admin":true},"inventario":["ver"]}')
    expect(Object.keys(evil)).toContain('__proto__')
    const r = permisosSchema.safeParse(evil)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(Object.prototype.hasOwnProperty.call(r.data, '__proto__')).toBe(false)
      expect(compactarPermisos(r.data)).toEqual({ inventario: ['ver'] })
    }
    expect(({} as Record<string, unknown>).admin).toBeUndefined()
  })
})

describe('createRolSchema', () => {
  it('recorta el nombre y mide el mínimo sobre lo recortado', () => {
    const r = createRolSchema.safeParse({ nombre: '  Vendedora  ', permisos: {} })
    expect(r.success && r.data.nombre).toBe('Vendedora')
    expect(createRolSchema.safeParse({ nombre: '  a  ', permisos: {} }).success).toBe(false)
  })

  it('rechaza un nombre demasiado largo', () => {
    const r = createRolSchema.safeParse({ nombre: 'x'.repeat(61), permisos: {} })
    expect(r.success).toBe(false)
  })

  it('rechaza un nombre que no es string', () => {
    expect(createRolSchema.safeParse({ nombre: 42, permisos: {} }).success).toBe(false)
  })

  it('rechaza campos de más en el payload', () => {
    const r = createRolSchema.safeParse({
      nombre: 'Vendedora',
      permisos: {},
      id_tenant: 'otro-tenant',
    })
    expect(r.success).toBe(false)
  })

  it('exige permisos', () => {
    expect(createRolSchema.safeParse({ nombre: 'Vendedora' }).success).toBe(false)
  })
})

describe('updateRolSchema / deleteRolSchema', () => {
  it('exigen un uuid', () => {
    expect(deleteRolSchema.safeParse({ idRol: UUID }).success).toBe(true)
    expect(deleteRolSchema.safeParse({ idRol: 'no-soy-un-uuid' }).success).toBe(false)
    expect(
      updateRolSchema.safeParse({ idRol: '1', nombre: 'Vendedora', permisos: {} }).success,
    ).toBe(false)
  })

  it('aceptan un payload completo', () => {
    const r = updateRolSchema.safeParse({
      idRol: UUID,
      nombre: 'Vendedora',
      permisos: { ventas: ['ver', 'crear'] },
    })
    expect(r.success).toBe(true)
  })
})

describe('updateConfiguracionQrSchema', () => {
  it('acepta enteros entre 15 y 100 mm', () => {
    expect(updateConfiguracionQrSchema.safeParse({ ladoMm: 15 }).success).toBe(true)
    expect(updateConfiguracionQrSchema.safeParse({ ladoMm: 35 }).success).toBe(true)
    expect(updateConfiguracionQrSchema.safeParse({ ladoMm: 100 }).success).toBe(true)
  })

  it('rechaza medidas fuera de rango o no enteras con el slug qr-lado-mm-invalido', () => {
    for (const ladoMm of [14, 101, 35.5, '35', null]) {
      const r = updateConfiguracionQrSchema.safeParse({ ladoMm })
      expect(r.success).toBe(false)
      if (!r.success) expect(primerReason(r.error)).toBe('qr-lado-mm-invalido (ladoMm)')
    }
  })

  it('rechaza claves adicionales', () => {
    const r = updateConfiguracionQrSchema.safeParse({ ladoMm: 35, extra: true })
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toBe('campo-desconocido')
  })
})

describe('updateTenantLogoSchema', () => {
  const archivo = (bytes: number, type: string) => new File([new Uint8Array(bytes)], 'logo', { type })
  const reason = (input: unknown) => {
    const r = updateTenantLogoSchema.safeParse(input)
    return r.success ? null : primerReason(r.error)
  }

  it('acepta un PNG, JPEG o WebP dentro del tope', () => {
    expect(reason({ logo: archivo(1000, 'image/png') })).toBeNull()
    expect(reason({ logo: archivo(1000, 'image/jpeg') })).toBeNull()
    expect(reason({ logo: archivo(LOGO_MAX_BYTES, 'image/webp') })).toBeNull()
  })

  it('rechaza un archivo por encima del tope', () => {
    expect(reason({ logo: archivo(LOGO_MAX_BYTES + 1, 'image/webp') })).toBe('logo-muy-grande (logo)')
  })

  it('rechaza SVG y tipos que no son imagen', () => {
    expect(reason({ logo: archivo(100, 'image/svg+xml') })).toBe('logo-formato-invalido (logo)')
    expect(reason({ logo: archivo(100, 'text/html') })).toBe('logo-formato-invalido (logo)')
  })

  it('rechaza un archivo vacío, un string (data URL) o null', () => {
    expect(reason({ logo: archivo(0, 'image/png') })).toBe('logo-invalido (logo)')
    expect(reason({ logo: 'data:image/png;base64,abc' })).toBe('logo-invalido (logo)')
    expect(reason({ logo: null })).toBe('logo-invalido (logo)')
  })

  it('rechaza campos desconocidos', () => {
    expect(reason({ logo: archivo(100, 'image/png'), extra: true })).toBe('campo-desconocido')
  })
})

describe('cambiarPasswordSchema', () => {
  it('acepta contraseñas válidas que coinciden', () => {
    const r = cambiarPasswordSchema.safeParse({
      passwordActual: 'OldPass123!',
      passwordNuevo: 'NewPass123!',
      passwordConfirmacion: 'NewPass123!',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza cuando la nueva contraseña es corta', () => {
    const r = cambiarPasswordSchema.safeParse({
      passwordActual: 'OldPass123!',
      passwordNuevo: 'short',
      passwordConfirmacion: 'short',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toBe('password-corto (passwordNuevo)')
  })

  it('rechaza cuando las contraseñas no coinciden', () => {
    const r = cambiarPasswordSchema.safeParse({
      passwordActual: 'OldPass123!',
      passwordNuevo: 'NewPass123!',
      passwordConfirmacion: 'DifferentPass123!',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toBe('passwords-no-coinciden (passwordConfirmacion)')
  })
})

describe('compactarPermisos', () => {
  it('descarta los módulos ausentes en vez de dejarlos como undefined', () => {
    const parsed = permisosSchema.parse({ inventario: ['ver'] })
    const compacto = compactarPermisos(parsed)
    expect(compacto).toEqual({ inventario: ['ver'] })
    expect(Object.keys(compacto)).toEqual(['inventario'])
    // Sin compactar, `JSON.stringify` escribe los ausentes como ausentes pero
    // `Object.keys` ya los expone: el contrato es que no estén.
    expect('ventas' in compacto).toBe(false)
  })
})

describe('primerReason', () => {
  it('devuelve el mensaje con la ruta del campo', () => {
    const r = permisosSchema.safeParse({ ventas: ['eliminar'] })
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toContain('ventas')
  })

  it('devuelve el mensaje sin ruta cuando el error es de la raíz', () => {
    const r = permisosSchema.safeParse(null)
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).not.toContain('(')
  })
})

describe('reasons estables', () => {
  // El `reason` viaja al cliente y `RolesModal` lo traduce por prefijo: si zod
  // devolviera su prosa en inglés, el toast la mostraría cruda.
  const casos: Array<[string, unknown, string]> = [
    ['módulo inexistente', { contabilidad: ['ver'] }, 'modulo-desconocido'],
    ['acción inexistente', { ventas: ['eliminar'] }, 'accion-invalida'],
    ['valor no array', { inventario: 'ver' }, 'permisos-no-array'],
    ['duplicados', { inventario: ['ver', 'ver'] }, 'acciones-duplicadas'],
    ['no es objeto', null, 'permisos-no-objeto'],
  ]

  it.each(casos)('%s → %s', (_nombre, payload, esperado) => {
    const r = permisosSchema.safeParse(payload)
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toMatch(new RegExp(`^${esperado}`))
  })

  it('los errores del payload también son slugs', () => {
    const extra = createRolSchema.safeParse({ nombre: 'Vendedora', permisos: {}, x: 1 })
    expect(extra.success).toBe(false)
    if (!extra.success) expect(primerReason(extra.error)).toBe('campo-desconocido')

    const corto = createRolSchema.safeParse({ nombre: 'a', permisos: {} })
    expect(corto.success).toBe(false)
    if (!corto.success) expect(primerReason(corto.error)).toBe('nombre-corto (nombre)')

    const uuid = deleteRolSchema.safeParse({ idRol: 'x' })
    expect(uuid.success).toBe(false)
    if (!uuid.success) expect(primerReason(uuid.error)).toBe('id-rol-invalido (idRol)')
  })
})

describe('payloads que no son objetos', () => {
  it('caen en payload-invalido, no en campo-desconocido', () => {
    for (const schema of [createRolSchema, updateRolSchema, deleteRolSchema, updateConfiguracionQrSchema, updateTenantLogoSchema, cambiarPasswordSchema]) {
      const r = schema.safeParse(null)
      expect(r.success).toBe(false)
      if (!r.success) expect(primerReason(r.error)).toBe('payload-invalido')
    }
  })
})
