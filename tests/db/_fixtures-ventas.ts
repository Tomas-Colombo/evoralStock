import { expect } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import {
  createTenantWithUser,
  signInAs,
  unwrapFixture,
  withScopedTenant,
  type TenantFixture,
} from './_helpers'

/**
 * Fixture de venta: tenant + catálogo + stock + caja + cliente.
 *
 * Vive fuera de los `.test.ts` porque lo comparten la suite de cuotas y la de
 * reportes. El prefijo `_` lo mantiene fuera del `include` de vitest, igual
 * que `_helpers.ts`.
 */

export interface VentaFixture extends TenantFixture {
  authenticated: Awaited<ReturnType<typeof signInAs>>
  idProducto: string
  idCliente: string
  idCuenta: string
  /** Ítems disponibles, listos para vender. */
  items: string[]
  /** Precio de lista del producto: el total de una venta de un ítem. */
  precio: number
  /** Lo que se le debe al proveedor por cada ítem (consignación). */
  costo: number
}

export const PRECIO = 60_000
export const COSTO = 20_000

/**
 * Habilita el paquete de consignaciones y rendiciones para un tenant vía service role.
 * Requerido por la guarda de 00123 al crear o mutar stock con tipo_ingreso = 'consignacion'.
 */
export async function habilitarPaqueteConsignacion(
  tenantIdOrFixture: string | { tenantId: string; serviceRole?: ReturnType<typeof createServiceRoleTestClient> },
  client?: ReturnType<typeof createServiceRoleTestClient>,
) {
  const tenantId = typeof tenantIdOrFixture === 'string' ? tenantIdOrFixture : tenantIdOrFixture.tenantId
  const sr = client ?? (typeof tenantIdOrFixture === 'object' && tenantIdOrFixture.serviceRole ? tenantIdOrFixture.serviceRole : createServiceRoleTestClient())
  const { data: modulos, error: errMod } = await sr
    .from('modulo')
    .select('id_modulo, codigo')
    .in('codigo', ['consignaciones', 'rendiciones'])
  expect(errMod, 'lookup modulos consignaciones/rendiciones').toBeNull()
  expect(modulos?.length).toBe(2)

  const { error: errUpsert } = await sr.from('tenant_modulo').upsert(
    modulos!.map((m) => ({
      id_tenant: tenantId,
      id_modulo: m.id_modulo,
      habilitado: true,
    })),
  )
  expect(errUpsert, 'habilitar consignaciones y rendiciones').toBeNull()
}

export const habilitarConsignaciones = habilitarPaqueteConsignacion

export async function ventaFixture(
  prefix: string,
  cantidadItems = 1,
  opts: { tipoIngreso?: 'compra' | 'consignacion' } = {},
): Promise<VentaFixture> {
  const user = await createTenantWithUser(prefix)
  const authenticated = await signInAs(user)
  const sr = user.serviceRole

  if (opts.tipoIngreso === 'consignacion') {
    await habilitarPaqueteConsignacion(user.tenantId, sr)
  }

  const categoria = unwrapFixture(
    'categoria insert',
    await sr
      .from('categoria')
      .insert({ id_tenant: user.tenantId, nombre: withScopedTenant('cat') })
      .select('id_categoria')
      .single(),
  ) as { id_categoria: string }

  // `precio_venta` se setea a mano en vez de correr el motor de precios: lo
  // que se prueba es la financiación y los reportes, y hacer pasar cada
  // fixture por una regla de margen ataría estos tests a un módulo que no
  // están ejerciendo.
  const producto = unwrapFixture(
    'producto insert',
    await sr
      .from('producto')
      .insert({
        id_tenant: user.tenantId,
        id_categoria: categoria.id_categoria,
        nombre: withScopedTenant('prod'),
        precio_venta: PRECIO,
        precio_venta_resuelto_at: new Date().toISOString(),
      })
      .select('id_producto')
      .single(),
  ) as { id_producto: string }

  // Vía RPC porque genera los QR únicos y la auditoría; insertar
  // `item_producto` a mano se saltea eso y deja el ítem a medio nacer.
  const { error: stockError } = await authenticated.rpc('sp_crear_stock_directo', {
    p_id_producto: producto.id_producto,
    p_costo: COSTO,
    p_tipo_ingreso: opts.tipoIngreso ?? 'compra',
    p_items: [{ talle: null, cantidad: cantidadItems }],
  })
  expect(stockError, 'sp_crear_stock_directo').toBeNull()

  const items = unwrapFixture(
    'items select',
    await sr
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', producto.id_producto)
      .eq('estado_item', 'disponible'),
  ) as Array<{ id_item: string }>

  const cuenta = unwrapFixture(
    'cuenta_destino insert',
    await sr
      .from('cuenta_destino')
      .insert({
        id_tenant: user.tenantId,
        nombre: 'Caja',
        tipo: 'efectivo',
        es_predeterminada: true,
      })
      .select('id_cuenta_destino')
      .single(),
  ) as { id_cuenta_destino: string }

  const cliente = unwrapFixture(
    'cliente insert',
    await sr
      .from('cliente')
      .insert({ id_tenant: user.tenantId, nombre: 'Ana', apellido: 'Pérez' })
      .select('id_cliente')
      .single(),
  ) as { id_cliente: string }

  return {
    ...user,
    authenticated,
    idProducto: producto.id_producto,
    idCliente: cliente.id_cliente,
    idCuenta: cuenta.id_cuenta_destino,
    items: items.map((i) => i.id_item),
    precio: PRECIO,
    costo: COSTO,
  }
}

/** Registra una venta financiada. Devuelve la respuesta cruda del RPC. */
export async function venderFinanciado(
  f: VentaFixture,
  opts: {
    cuotas: number
    primerVencimiento: string
    anticipo?: number
    idCliente?: string | null
    items?: string[]
  },
) {
  return f.authenticated.rpc('sp_registrar_venta', {
    p_lineas: (opts.items ?? f.items).map((id_item) => ({ id_item, descuentos: [] })),
    p_forma_pago: 'efectivo',
    p_id_cliente: opts.idCliente === undefined ? f.idCliente : opts.idCliente,
    p_pagos: opts.anticipo
      ? [{ medio: 'efectivo', id_cuenta_destino: f.idCuenta, monto: opts.anticipo }]
      : null,
    p_financiacion: {
      cuotas: opts.cuotas,
      primer_vencimiento: opts.primerVencimiento,
    },
  })
}

/** Registra una venta al contado, cobrada íntegra el día de la venta. */
export async function venderContado(f: VentaFixture, opts: { items?: string[] } = {}) {
  const items = opts.items ?? f.items
  return f.authenticated.rpc('sp_registrar_venta', {
    p_lineas: items.map((id_item) => ({ id_item, descuentos: [] })),
    p_forma_pago: 'efectivo',
    p_id_cliente: f.idCliente,
    p_pagos: [
      {
        medio: 'efectivo',
        id_cuenta_destino: f.idCuenta,
        monto: PRECIO * items.length,
      },
    ],
  })
}

/** Las cuotas de una venta, ordenadas por número. */
export async function cuotasDe(f: VentaFixture, idVenta: string) {
  return unwrapFixture(
    'cuotas select',
    await f.serviceRole
      .from('cuota_financiada')
      .select('id_cuota_financiada, numero, monto, monto_pagado, estado, fecha_vencimiento')
      .eq('id_venta', idVenta)
      .order('numero'),
  ) as Array<{
    id_cuota_financiada: string
    numero: number
    monto: string
    monto_pagado: string
    estado: string
    fecha_vencimiento: string
  }>
}

/** Cobra una cuota completa. */
export async function cobrar(f: VentaFixture, idCuota: string, monto: number) {
  const res = await f.authenticated.rpc('sp_cobrar_cuota', {
    p_id_cuota: idCuota,
    p_monto: monto,
    p_medio: 'efectivo',
    p_id_cuenta_destino: f.idCuenta,
  })
  expect(res.error, 'sp_cobrar_cuota').toBeNull()
  return res
}
