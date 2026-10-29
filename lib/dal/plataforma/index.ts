import 'server-only'

import { createServiceClient } from '@/lib/dal/supabase'
import { requireSuperAdmin } from '@/lib/dal/plataforma/guard'
import { generarPassword } from '@/lib/tenant/password'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import {
  PAQUETES_OPCIONALES,
  type PaqueteOpcional,
  type TenantPlataformaResumen,
  type TenantPlataformaDetalle,
  type MovimientoCuentaCorriente,
} from '@/lib/types/plataforma'
import type {
  RegistrarCargoInput,
  RegistrarPagoInput,
  AnularMovimientoInput,
  TogglePaqueteInput,
  AltaTenantInput,
  CambiarEstadoTenantInput,
} from '@/lib/validation/plataforma'

type MutationResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; reason: string }

/**
 * Traduce un error retornado por Postgres/PostgREST en un slug kebab-case
 * reconocido por el catálogo de errores, sin exponer volcados internos ni mensajes crudos.
 */
export function extraerSlugError(error: unknown): string {
  if (!error) return 'error-desconocido'
  const errObj = typeof error === 'object' ? (error as Record<string, unknown>) : null
  const msg = typeof errObj?.message === 'string' ? errObj.message : String(error)
  const code = typeof errObj?.code === 'string' ? errObj.code : ''

  if (code === '42501' || msg.includes('no-permission') || msg.includes('permission denied')) {
    return 'no-permission'
  }

  // Quitar prefijo sp_ o funciones si vinieran en el mensaje
  const cleaned = msg.replace(/^.*(?:sp_[a-zA-Z0-9_]+):\s*/, '').trim()
  const candidate = cleaned.split(/[:\n]/)[0]?.trim().toLowerCase() || ''
  const valido = /^[a-z0-9-]+$/

  if (candidate && valido.test(candidate)) {
    return candidate
  }

  const slugsConocidos = [
    'tenant-inexistente',
    'monto-invalido',
    'periodo-invalido',
    'concepto-invalido',
    'fecha-invalida',
    'medio-pago-invalido',
    'tipo-movimiento-invalido',
    'movimiento-inexistente',
    'movimiento-ya-anulado',
    'paquete-invalido',
    'subdominio-en-uso',
    'email-en-uso',
    'subdominio-invalido',
    'estado-invalido',
    'usuario-invalido',
    'nombre-invalido',
    'permisos-no-objeto',
    'modulo-nucleo',
    'modulo-con-estado-vivo',
    'modulo-desconocido',
    'no-permission',
  ]
  for (const slug of slugsConocidos) {
    if (msg.includes(slug)) return slug
  }

  return 'error-desconocido'
}

interface ModuloRelacion {
  habilitado: boolean
  modulo: { codigo: string } | null
}

function calcularPaquetesHabilitados(
  modulos: ModuloRelacion[] | null | undefined,
): { habilitadosList: PaqueteOpcional[]; paquetesMap: Record<PaqueteOpcional, boolean> } {
  const activos = new Set<string>()
  for (const m of modulos ?? []) {
    if (m.habilitado && m.modulo?.codigo) {
      activos.add(m.modulo.codigo)
    }
  }

  const paquetesMap = {} as Record<PaqueteOpcional, boolean>
  const habilitadosList: PaqueteOpcional[] = []

  for (const [paqueteKey, codigos] of Object.entries(PAQUETES_OPCIONALES)) {
    const pkg = paqueteKey as PaqueteOpcional
    const activo = codigos.every((c) => activos.has(c))
    paquetesMap[pkg] = activo
    if (activo) {
      habilitadosList.push(pkg)
    }
  }

  return { habilitadosList, paquetesMap }
}

/**
 * REQ-SA-02: Listado consolidado de tenants.
 * "Design for N": resuelve tenants, módulos y saldo en una cantidad fija de queries (máximo 2),
 * sin queries dependientes de N. Ordenados alfabéticamente por nombre_comercial.
 */
export async function listarTenants(): Promise<TenantPlataformaResumen[]> {
  await requireSuperAdmin()
  const supabase = createServiceClient()

  // 1. Obtener todos los tenants y sus módulos relacionados en 1 query
  const { data: tenantsData, error: errTenants } = await supabase
    .from('tenant')
    .select(`
      id_tenant,
      nombre_comercial,
      subdominio,
      estado_tenant,
      created_at,
      tenant_modulo (
        habilitado,
        modulo (
          codigo
        )
      )
    `)
    .order('nombre_comercial', { ascending: true })

  if (errTenants) {
    throw new Error(`listarTenants tenant: ${errTenants.message}`)
  }

  // 2. Obtener los saldos consolidados de todos los tenants en 1 query
  const { data: saldosData, error: errSaldos } = await supabase
    .from('tenant_saldo')
    .select('id_tenant, saldo, total_cargos, total_pagos')

  if (errSaldos) {
    throw new Error(`listarTenants saldo: ${errSaldos.message}`)
  }

  const saldosMap = new Map<string, { saldo: number; totalCargos: number; totalPagos: number }>()
  for (const row of saldosData ?? []) {
    saldosMap.set(row.id_tenant, {
      saldo: Number(row.saldo ?? 0),
      totalCargos: Number(row.total_cargos ?? 0),
      totalPagos: Number(row.total_pagos ?? 0),
    })
  }

  return (tenantsData ?? []).map((t) => {
    const { habilitadosList } = calcularPaquetesHabilitados(
      t.tenant_modulo as unknown as ModuloRelacion[],
    )
    const saldoInfo = saldosMap.get(t.id_tenant) ?? {
      saldo: 0,
      totalCargos: 0,
      totalPagos: 0,
    }

    return {
      idTenant: t.id_tenant,
      nombreComercial: t.nombre_comercial,
      subdominio: t.subdominio,
      estadoTenant: t.estado_tenant,
      createdAt: t.created_at,
      paquetesHabilitados: habilitadosList,
      saldo: saldoInfo.saldo,
      totalCargos: saldoInfo.totalCargos,
      totalPagos: saldoInfo.totalPagos,
    }
  })
}

/**
 * REQ-SA-07: Detalle del tenant, paquetes, saldo e historial de cuenta corriente.
 * Resuelve la ficha y el historial cronológico unificado con queries fijas.
 */
export async function obtenerTenantDetalle(idTenant: string): Promise<TenantPlataformaDetalle> {
  await requireSuperAdmin()
  const supabase = createServiceClient()

  // Queries fijas en paralelo
  const [tenantRes, saldoRes, cargosRes, pagosRes] = await Promise.all([
    supabase
      .from('tenant')
      .select(`
        id_tenant,
        nombre_comercial,
        subdominio,
        logo_url,
        color_primario,
        estado_tenant,
        created_at,
        tenant_modulo (
          habilitado,
          modulo (
            codigo
          )
        )
      `)
      .eq('id_tenant', idTenant)
      .maybeSingle(),
    supabase
      .from('tenant_saldo')
      .select('saldo, total_cargos, total_pagos')
      .eq('id_tenant', idTenant)
      .maybeSingle(),
    supabase
      .from('tenant_cargo')
      .select('*')
      .eq('id_tenant', idTenant)
      .order('periodo', { ascending: false }),
    supabase
      .from('tenant_pago')
      .select('*')
      .eq('id_tenant', idTenant)
      .order('fecha', { ascending: false }),
  ])

  if (tenantRes.error) {
    throw new Error(`obtenerTenantDetalle tenant: ${tenantRes.error.message}`)
  }
  if (!tenantRes.data) {
    throw new Error('tenant-inexistente')
  }

  const { paquetesMap } = calcularPaquetesHabilitados(
    tenantRes.data.tenant_modulo as unknown as ModuloRelacion[],
  )

  const saldo = Number(saldoRes.data?.saldo ?? 0)
  const totalCargos = Number(saldoRes.data?.total_cargos ?? 0)
  const totalPagos = Number(saldoRes.data?.total_pagos ?? 0)

  // Unificar cargos y pagos
  const historial: MovimientoCuentaCorriente[] = []

  for (const c of cargosRes.data ?? []) {
    historial.push({
      id: c.id,
      tipo: 'cargo',
      fechaImputacion: c.periodo,
      monto: Number(c.monto),
      detalle: c.concepto,
      concepto: c.concepto,
      createdAt: c.created_at,
      anulado: Boolean(c.anulado_at),
      anuladoAt: c.anulado_at,
      anuladoPor: c.anulado_por,
    })
  }

  for (const p of pagosRes.data ?? []) {
    historial.push({
      id: p.id,
      tipo: 'pago',
      fechaImputacion: p.fecha,
      monto: Number(p.monto),
      detalle: p.nota ? `${p.medio} (${p.nota})` : p.medio,
      medio: p.medio,
      nota: p.nota,
      createdAt: p.created_at,
      anulado: Boolean(p.anulado_at),
      anuladoAt: p.anulado_at,
      anuladoPor: p.anulado_por,
    })
  }

  // Ordenar descendentemente por fecha/periodo y desempate por createdAt
  historial.sort((a, b) => {
    if (a.fechaImputacion !== b.fechaImputacion) {
      return b.fechaImputacion.localeCompare(a.fechaImputacion)
    }
    return b.createdAt.localeCompare(a.createdAt)
  })

  return {
    tenant: {
      idTenant: tenantRes.data.id_tenant,
      nombreComercial: tenantRes.data.nombre_comercial,
      subdominio: tenantRes.data.subdominio,
      logoUrl: tenantRes.data.logo_url,
      colorPrimario: tenantRes.data.color_primario,
      estadoTenant: tenantRes.data.estado_tenant,
      createdAt: tenantRes.data.created_at,
    },
    paquetes: paquetesMap,
    saldo,
    totalCargos,
    totalPagos,
    historial,
  }
}

/**
 * REQ-SA-04: Registrar cargo a tenant.
 */
export async function registrarCargo(
  input: RegistrarCargoInput,
): Promise<MutationResult<{ id: string }>> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('sp_registrar_cargo_tenant', {
    p_id_tenant: input.idTenant,
    p_periodo: input.periodo,
    p_monto: input.monto,
    p_concepto: input.concepto,
    p_created_by: actor.id,
  })

  if (error) {
    return { ok: false, reason: extraerSlugError(error) }
  }

  return { ok: true, data: { id: data as string } }
}

/**
 * REQ-SA-05: Registrar pago de tenant.
 */
export async function registrarPago(
  input: RegistrarPagoInput,
): Promise<MutationResult<{ id: string }>> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('sp_registrar_pago_tenant', {
    p_id_tenant: input.idTenant,
    p_fecha: input.fecha,
    p_monto: input.monto,
    p_medio: input.medio,
    p_nota: input.nota ?? null,
    p_created_by: actor.id,
  })

  if (error) {
    return { ok: false, reason: extraerSlugError(error) }
  }

  return { ok: true, data: { id: data as string } }
}

/**
 * REQ-SA-06: Anular movimiento de cuenta corriente.
 */
export async function anularMovimiento(
  input: AnularMovimientoInput,
): Promise<MutationResult> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const { error } = await supabase.rpc('sp_anular_movimiento_tenant', {
    p_tipo: input.tipo,
    p_id_movimiento: input.idMovimiento,
    p_anulado_por: actor.id,
  })

  if (error) {
    return { ok: false, reason: extraerSlugError(error) }
  }

  return { ok: true }
}

/**
 * REQ-SA-03: Toggle de paquete funcional para un tenant.
 */
export async function togglePaquete(
  input: TogglePaqueteInput,
  ip: string | null = null,
): Promise<MutationResult> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const { error } = await supabase.rpc('sp_toggle_tenant_modulo_admin', {
    p_id_tenant: input.idTenant,
    p_paquete: input.paquete,
    p_habilitado: input.habilitado,
    p_actor: actor.id,
    p_ip: ip ?? null,
  })

  if (error) {
    return { ok: false, reason: extraerSlugError(error) }
  }

  return { ok: true }
}

/**
 * REQ-SA-09 / DR-SA-06: Alta de tenant en 2 pasos con compensación.
 * Paso a: Creación de usuario administrador en Auth con service-role y password temporal.
 * Paso b: Creación atómica en BD mediante sp_alta_tenant (INVOKER).
 * Paso c: Compensación (borrado del auth user) si el paso b falla.
 */
export async function altaTenant(
  input: AltaTenantInput,
): Promise<MutationResult<{ idTenant: string; passwordTemporal: string }>> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const passwordTemporal = generarPassword()

  // Paso a: crear usuario en Auth
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: input.emailAdmin,
    password: passwordTemporal,
    email_confirm: true,
    user_metadata: { nombre_completo: input.nombreAdmin },
  })

  if (authError || !created?.user) {
    const msg = authError?.message?.toLowerCase() ?? ''
    const code = (authError as { code?: string })?.code

    if (code === 'email_exists' || msg.includes('already registered')) {
      return { ok: false, reason: 'email-en-uso' }
    }
    return { ok: false, reason: extraerSlugError(authError) }
  }

  const authUserId = created.user.id

  // Paso b: armar matriz de permisos desde CATALOGO_PERMISOS (todas las acciones)
  const permisosAdmin: Record<string, string[]> = Object.fromEntries(
    Object.entries(CATALOGO_PERMISOS).map(([modulo, acciones]) => [modulo, [...acciones]]),
  )

  const { data: idTenant, error: rpcError } = await supabase.rpc('sp_alta_tenant', {
    p_nombre: input.nombre,
    p_subdominio: input.subdominio,
    p_paquetes: input.paquetes,
    p_id_auth_user: authUserId,
    p_email: created.user.email ?? input.emailAdmin,
    p_nombre_admin: input.nombreAdmin,
    p_permisos: permisosAdmin,
    p_actor: actor.id,
  })

  if (rpcError) {
    // Paso c: Compensación - borrar el usuario de Auth creado en el paso a
    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUserId)
    if (deleteError) {
      console.error('altaTenant: auth user huérfano', authUserId)
    }
    return { ok: false, reason: extraerSlugError(rpcError) }
  }

  return {
    ok: true,
    data: {
      idTenant: idTenant as string,
      passwordTemporal,
    },
  }
}

/**
 * REQ-SA-10 / D1, D4: Cambiar estado del tenant entre 'activo' y 'suspendido'.
 */
export async function cambiarEstadoTenant(
  input: CambiarEstadoTenantInput,
): Promise<MutationResult> {
  const actor = await requireSuperAdmin()
  const supabase = createServiceClient()

  const { error } = await supabase.rpc('sp_cambiar_estado_tenant', {
    p_id_tenant: input.idTenant,
    p_estado: input.estado,
    p_actor: actor.id,
  })

  if (error) {
    return { ok: false, reason: extraerSlugError(error) }
  }

  return { ok: true }
}
