import { NextResponse, type NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/dal/errors'
import { hasModuleAccess, requireModuleRole } from '@/lib/dal/guard'
import { proyectarLookupConsignacionItem } from '@/lib/inventario/proyeccion-costos'
import { verifySession } from '@/lib/dal/session'
import { findItemByQr } from '@/lib/dal/inventario/item'
import { createServerClient } from '@/lib/dal/supabase'

/**
 * GET /api/consignaciones/lookup-item?qr=<code>&id_proveedor=<uuid>
 *
 * Endpoint específico para el carrito de nueva consignación:
 *   - Chequea que el item exista y esté disponible.
 *   - Chequea que sea tipo_ingreso='consignacion' (§L26).
 *   - Chequea que venga del proveedor pasado.
 *   - Chequea que NO tenga ya un consignacion_detalle 'pendiente'.
 *   - Chequea que NO esté en reserva activa.
 *
 * Read-only. La transacción real es sp_agregar_item_consignacion.
 */
export async function GET(req: NextRequest) {
  let session
  try {
    session = await verifySession()
    if (session.idRevendedora) {
      throw new AuthorizationError('no-permission')
    }
    await requireModuleRole(session, 'consignaciones', 'ver')
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, reason: e.reason }, { status: 401 })
    }
    throw e
  }

  const qr = req.nextUrl.searchParams.get('qr')?.trim()
  const idProveedor = req.nextUrl.searchParams.get('id_proveedor')?.trim()

  if (!qr) return NextResponse.json({ ok: false, reason: 'qr-vacio' }, { status: 400 })
  if (!idProveedor)
    return NextResponse.json({ ok: false, reason: 'proveedor-vacio' }, { status: 400 })

  const item = await findItemByQr(qr)
  if (!item) return NextResponse.json({ ok: false, reason: 'item-not-found' })
  if (item.estado_item !== 'disponible') {
    return NextResponse.json({
      ok: false,
      reason: 'item-no-disponible',
      estado: item.estado_item,
    })
  }
  if (item.tipo_ingreso !== 'consignacion') {
    return NextResponse.json({
      ok: false,
      reason: 'item-no-es-consignacion',
      tipo_ingreso: item.tipo_ingreso,
    })
  }

  const supabase = await createServerClient()

  // Verificar proveedor del item vía último ingreso.
  const { data: ingreso } = await supabase
    .from('ingreso_mercaderia')
    .select('id_proveedor')
    .eq('id_ingreso', item.id_ingreso ?? '')
    .maybeSingle<{ id_proveedor: string }>()

  if (!ingreso || ingreso.id_proveedor !== idProveedor) {
    return NextResponse.json({ ok: false, reason: 'item-otro-proveedor' })
  }

  // Chequeo consignación pendiente
  const { data: pendiente } = await supabase
    .from('consignacion_detalle')
    .select('id_consignacion_detalle')
    .eq('id_item', item.id_item)
    .eq('estado', 'pendiente')
    .maybeSingle()
  if (pendiente) {
    return NextResponse.json({
      ok: false,
      reason: 'item-ya-en-consignacion-pendiente',
    })
  }

  // Chequeo reserva activa
  const { data: reserva } = await supabase
    .from('detalle_reserva')
    .select('id_detalle_reserva')
    .eq('id_item', item.id_item)
    .eq('estado', 'activa')
    .maybeSingle()
  if (reserva) {
    return NextResponse.json({ ok: false, reason: 'item-en-reserva' })
  }

  // Producto para mostrar
  const { data: producto } = await supabase
    .from('producto')
    .select('id_producto, nombre, sku, categoria:categoria(id_categoria, nombre)')
    .eq('id_producto', item.id_producto)
    .maybeSingle<{
      id_producto: string
      nombre: string
      sku: string | null
      categoria: { id_categoria: string; nombre: string } | null
    }>()

  const puedeVerCostos = session ? hasModuleAccess(session, 'inventario', 'ver_costos') : false
  return NextResponse.json({
    ok: true,
    item: proyectarLookupConsignacionItem(
      {
        id_item: item.id_item,
        qr_code: item.qr_code,
        producto_nombre: producto?.nombre ?? '(sin nombre)',
        sku: producto?.sku ?? null,
        categoria_nombre: producto?.categoria?.nombre ?? null,
        costo_ingreso: Number(item.costo_ingreso),
        fecha_ingreso: item.fecha_ingreso,
      },
      puedeVerCostos,
    ),
  })
}
