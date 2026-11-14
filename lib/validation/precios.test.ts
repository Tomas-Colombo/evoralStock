import { describe, expect, it } from 'vitest'
import { reglaIdSchema } from './precios'

describe('reglaIdSchema', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000'

  it('acepta un payload válido con idRegla uuid', () => {
    const res = reglaIdSchema.safeParse({ idRegla: validUuid })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.idRegla).toBe(validUuid)
    }
  })

  it('rechaza si falta idRegla', () => {
    const res = reglaIdSchema.safeParse({})
    expect(res.success).toBe(false)
  })

  it('rechaza idRegla que no sea uuid válido', () => {
    const res = reglaIdSchema.safeParse({ idRegla: 'no-es-un-uuid' })
    expect(res.success).toBe(false)
  })

  it('rechaza campos adicionales por ser strictObject', () => {
    const res = reglaIdSchema.safeParse({
      idRegla: validUuid,
      campoExtra: 'invalido',
    })
    expect(res.success).toBe(false)
  })

  it('rechaza tipos primitivos o null', () => {
    expect(reglaIdSchema.safeParse(null).success).toBe(false)
    expect(reglaIdSchema.safeParse(undefined).success).toBe(false)
    expect(reglaIdSchema.safeParse(validUuid).success).toBe(false)
    expect(reglaIdSchema.safeParse(123).success).toBe(false)
  })
})
