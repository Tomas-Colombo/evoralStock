'use server'

import { revalidatePath } from 'next/cache'
import { verifySession } from '@/lib/dal/session'
import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import {
  revendedoraSchema,
  altaRevendedoraUnificadaSchema,
} from '@/lib/validation/revendedoras'
import * as dal from '@/lib/dal/revendedoras'
import { z } from 'zod'

export async function crearRevendedoraUnificadaAction(input: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'crear')

    const parsed = altaRevendedoraUnificadaSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const {
      nombre,
      apellido,
      telefono,
      email,
      notas,
      crear_acceso,
      password_acceso,
      comision_propia,
    } = parsed.data

    if (crear_acceso) {
      await requireModuleRole(session, 'administracion', 'crear')
      await requireModuleRole(session, 'revendedoras', 'editar')
      if (!email) {
        return { ok: false as const, reason: 'email-invalido' }
      }
      // La contraseña la escribe el administrador, igual que en Usuarios.
      if (!password_acceso) {
        return { ok: false as const, reason: 'password-corto' }
      }
    }

    if (comision_propia !== undefined) {
      await requireModuleRole(session, 'revendedoras', 'editar')
    }

    const res = await dal.crearRevendedora({
      nombre,
      apellido,
      telefono: telefono ?? undefined,
      email: email ?? undefined,
      notas: notas ?? undefined,
    })

    if (!res.ok) {
      return res
    }

    const idRevendedora = res.data

    if (crear_acceso && email && password_acceso) {
      const inviteRes = await dal.inviteRevendedora(session, {
        idRevendedora,
        email,
        nombreCompleto: `${nombre} ${apellido}`,
        password: password_acceso,
      })
      if (!inviteRes.ok) {
        await dal.bajaRevendedora(idRevendedora).catch(() => {})
        return inviteRes
      }
    }

    if (comision_propia !== undefined) {
      const comRes = await dal.guardarComisionPropia({
        id_revendedora: idRevendedora,
        tipo: 'fijo',
        porcentajeFijo: comision_propia,
        vigente_desde: new Date().toISOString().slice(0, 10),
      })
      if (!comRes.ok) {
        return comRes
      }
    }

    revalidatePath('/revendedoras')
    return { ok: true as const, data: idRevendedora }
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function crearRevendedoraAction(formData: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'crear')
    
    const schema = z.object({ payload: revendedoraSchema }).strict()
    const parsed = schema.safeParse({ payload: formData })
    
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.crearRevendedora(parsed.data.payload)
    if (res.ok) {
      revalidatePath('/revendedoras')
    }
    return res
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function editarRevendedoraAction(id: string, formData: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'editar')
    
    const schema = z.object({ id: z.string().uuid(), payload: revendedoraSchema }).strict()
    const parsed = schema.safeParse({ id, payload: formData })
    
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.editarRevendedora(parsed.data.id, parsed.data.payload)
    if (res.ok) {
      revalidatePath('/revendedoras')
      revalidatePath(`/revendedoras/${parsed.data.id}`)
    }
    return res
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function bajaRevendedoraAction(id: string) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'eliminar')
    
    const schema = z.object({ id: z.string().uuid() }).strict()
    const parsed = schema.safeParse({ id })
    
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.bajaRevendedora(parsed.data.id)
    if (res.ok) {
      revalidatePath('/revendedoras')
      revalidatePath(`/revendedoras/${parsed.data.id}`)
    }
    return res
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function revocarAccesoRevendedoraAction(id: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'editar')
    await requireModuleRole(session, 'administracion', 'eliminar')

    const schema = z.object({ id: z.string().uuid() }).strict()
    const parsed = schema.safeParse({ id })

    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.revocarAccesoRevendedora(session, { idRevendedora: parsed.data.id })
    if (res.ok) {
      revalidatePath('/revendedoras')
      revalidatePath('/administracion/usuarios')
    }
    return res
  } catch (error) {
    const auth = classifyAuthError(error)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    return { ok: false as const, reason: 'error-desconocido' }
  }
}
