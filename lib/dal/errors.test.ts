import { describe, expect, it } from 'vitest'
import { AuthorizationError, errorDeRpc } from './errors'
import { mensajeDeError } from '@/lib/errores/mensajes'

describe('AuthorizationError', () => {
  it('carries the reason and sets name/message', () => {
    const error = new AuthorizationError('no-session')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AuthorizationError')
    expect(error.reason).toBe('no-session')
    expect(error.message).toBe('no-session')
  })

  it('supports every reason variant from design §7', () => {
    const reasons = ['no-session', 'no-permission', 'module-disabled', 'tenant-mismatch'] as const

    for (const reason of reasons) {
      expect(new AuthorizationError(reason).reason).toBe(reason)
    }
  })
})

describe('errorDeRpc', () => {
  it('no-permission queda limpio', () => {
    const res = errorDeRpc('sp_create_producto', { message: 'no-permission' })
    expect(res).toBe('no-permission')
  })

  it('duplicate key y ingreso-con-items-movidos conservan texto completo con prefijo del sp y mensajeDeError traduce el duplicado', () => {
    const dup = errorDeRpc('sp_create_producto', {
      message: 'duplicate key value violates unique constraint "producto_tenant_sku_uk"',
    })
    expect(dup).toBe('sp_create_producto: duplicate key value violates unique constraint "producto_tenant_sku_uk"')
    expect(mensajeDeError(dup)).toBe('Ya existe un producto con ese código.')

    const movidos = errorDeRpc('sp_cancelar_ingreso', {
      message: 'ingreso-con-items-movidos: 3',
    })
    expect(movidos).toBe('sp_cancelar_ingreso: ingreso-con-items-movidos: 3')
  })
})
