import 'server-only'

import { createServiceClient } from '@/lib/dal/supabase'
import { requireSuperAdmin } from '@/lib/dal/plataforma/guard'
import { generarPassword } from '@/lib/tenant/password'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import { escaparPatronLike } from '@/lib/inventario/codigo'
import {
  PAQUETES_OPCIONALES,
  PAGE_SIZE_PLATAFORMA,
  type PaqueteOpcional,
  type TenantPlataformaResumen,
  type TenantPlataformaDetalle,
  type MovimientoCuentaCorriente,
  type TipoMovimientoTenant,
  type ListarTenantsPaginadoOptions,
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
 * REQ-SA-11: Listado paginado y filtrado de tenants en /plataforma.
 * "Design for N": consulta tenant_listado con .range() y count: 'exact'.
 * Resuelve módulos en una segunda query (.in('id_tenant', idsDeLaPagina)). Máximo 2 queries por render.
 */
export async function listarTenantsPaginado(
  opts: ListarTenantsPaginadoOptions,
): Promise<{ rows: TenantPlataformaResumen[]; total: number }> {
  await requireSuperAdmin()
  const supabase = createServiceClient()

  const pageSize = opts.pageSize ?? PAGE_SIZE_PLATAFORMA
  const from = (Math.max(1, opts.page) - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('tenant_listado')
    .select('*', { count: 'exact' })

  // Filtro de texto (q) en nombre_comercial y subdominio
  if (opts.q && opts.q.trim().length > 0) {
    const escapado = escaparPatronLike(opts.q.trim())
    query = query.or(`nombre_comercial.ilike.%${escapado}%,subdominio.ilike.%${escapado}%`)
  }

  // Filtro de estado
  if (opts.estado === 'activo' || opts.estado === 'suspendido') {
    query = query.eq('estado_tenant', opts.estado)
  }

  // Filtro de deuda
  if (opts.deuda === 'con-deuda') {
    query = query.gt('saldo', 0)
  } else if (opts.deuda === 'al-dia') {
    query = query.lte('saldo', 0)
  }

  // Ordenamiento
  if (opts.orden === 'saldo_desc') {
    query = query.order('saldo', { ascending: false }).order('nombre_comercial', { ascending: true })
  } else if (opts.orden === 'alta_desc') {
    query = query.order('created_at', { ascending: false })
  } else {
    // default: nombre_asc
    query = query.order('nombre_comercial', { ascending: true })
  }

  // Paginación
  query = query.range(from, to)

  const { data: rowsData, count, error: errTenants } = await query
  if (errTenants) {
    throw new Error(`listarTenantsPaginado tenant_listado: ${errTenants.message}`)
  }

  const total = count ?? 0
  const rows = rowsData ?? []

  if (rows.length === 0) {
    return { rows: [], total }
  }

  // Query 2: Módulos de los tenants de la página visible
  const ids = rows.map((r) => r.id_tenant)
  const { data: modulosData, error: errModulos } = await supabase
    .from('tenant_modulo')
    .select(`
      id_tenant,
      habilitado,
      modulo (
        codigo
      )
    `)
    .in('id_tenant', ids)

  if (errModulos) {
    throw new Error(`listarTenantsPaginado tenant_modulo: ${errModulos.message}`)
  }

  const modulosPorTenant = new Map<string, ModuloRelacion[]>()
  for (const m of modulosData ?? []) {
    const lista = modulosPorTenant.get(m.id_tenant) ?? []
    lista.push(m as unknown as ModuloRelacion)
    modulosPorTenant.set(m.id_tenant, lista)
  }

  const resultRows: TenantPlataformaResumen[] = rows.map((t) => {
    const { habilitadosList } = calcularPaquetesHabilitados(modulosPorTenant.get(t.id_tenant))
    return {
      idTenant: t.id_tenant,
      nombreComercial: t.nombre_comercial,
      subdominio: t.subdominio,
      estadoTenant: t.estado_tenant,
      createdAt: t.created_at,
      paquetesHabilitados: habilitadosList,
      saldo: Number(t.saldo ?? 0),
      totalCargos: Number(t.total_cargos ?? 0),
      totalPagos: Number(t.total_pagos ?? 0),
    }
  })

  return { rows: resultRows, total }
}

/**
 * REQ-SA-07 / D5: Detalle del tenant, paquetes, saldo e historial de cuenta corriente paginado.
 * Resuelve la ficha, el saldo y el historial paginado de tenant_movimiento con queries fijas.
 */
export async function obtenerTenantDetalle(
  idTenant: string,
  opts?: { hpage?: number; hpageSize?: number },
): Promise<TenantPlataformaDetalle> {
  await requireSuperAdmin()
  const supabase = createServiceClient()

  const hpageSize = opts?.hpageSize ?? PAGE_SIZE_PLATAFORMA
  const hpage = Math.max(1, opts?.hpage ?? 1)
  const from = (hpage - 1) * hpageSize
  const to = from + hpageSize - 1

  // Queries fijas en paralelo
  const [tenantRes, saldoRes, movsRes] = await Promise.all([
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
      .from('tenant_movimiento')
      .select('*', { count: 'exact' })
      .eq('id_tenant', idTenant)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to),
  ])

  if (tenantRes.error) {
    throw new Error(`obtenerTenantDetalle tenant: ${tenantRes.error.message}`)
  }
  if (!tenantRes.data) {
    throw new Error('tenant-inexistente')
  }
  if (saldoRes.error) {
    throw new Error(`obtenerTenantDetalle saldo: ${saldoRes.error.message}`)
  }
  if (movsRes.error) {
    throw new Error(`obtenerTenantDetalle movimiento: ${movsRes.error.message}`)
  }

  const { paquetesMap } = calcularPaquetesHabilitados(
    tenantRes.data.tenant_modulo as unknown as ModuloRelacion[],
  )

  const saldo = Number(saldoRes.data?.saldo ?? 0)
  const totalCargos = Number(saldoRes.data?.total_cargos ?? 0)
  const totalPagos = Number(saldoRes.data?.total_pagos ?? 0)

  const historial: MovimientoCuentaCorriente[] = (movsRes.data ?? []).map((m) => {
    const esCargo = m.tipo === 'cargo'
    return {
      id: m.id,
      tipo: m.tipo as TipoMovimientoTenant,
      fechaImputacion: m.fecha,
      monto: Number(m.monto),
      detalle: esCargo ? m.concepto : (m.nota ? `${m.medio} (${m.nota})` : m.medio),
      concepto: m.concepto ?? undefined,
      medio: m.medio ?? undefined,
      nota: m.nota ?? undefined,
      createdAt: m.created_at,
      anulado: Boolean(m.anulado_at),
      anuladoAt: m.anulado_at,
      anuladoPor: m.anulado_por,
    }
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
    totalHistorial: movsRes.count ?? 0,
    hpage,
    hpageSize,
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
