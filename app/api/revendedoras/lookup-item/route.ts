import { NextResponse, type NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  lookupItemParaConsignacionRevendedora,
  lookupItemParaVentaRevendedora,
} from '@/lib/dal/revendedoras'
import { parsearCantidadLookup } from '@/lib/inventario/cantidades'

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession()
    if (session.idRevendedora) {
      throw new AuthorizationError('no-permission')
    }
    await requireModuleRole(session, 'revendedoras', 'ver')
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, reason: e.reason }, { status: 401 })
    }
    throw e
  }

  const code = (req.nextUrl.searchParams.get('code') || req.nextUrl.searchParams.get('qr'))?.trim()
  const idProducto = req.nextUrl.searchParams.get('id_producto')?.trim()
  const idRevendedora = req.nextUrl.searchParams.get('id_revendedora')?.trim()
  const talle = req.nextUrl.searchParams.get('talle')?.trim() || null
  const sinTalle = req.nextUrl.searchParams.get('sin_talle') === '1'
  const modo = req.nextUrl.searchParams.get('modo')?.trim() || 'consignacion'
  // Unidades que ya están en el carrito/lote: se excluyen para que un segundo
  // ingreso por SKU o nombre elija la siguiente unidad FIFO disponible.
  const excluir = (req.nextUrl.searchParams.get('excluir') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!code && !idProducto) {
    return NextResponse.json({ ok: false, reason: 'qr-vacio' }, { status: 400 })
  }
  if (!idRevendedora) {
    return NextResponse.json({ ok: false, reason: 'revendedora-requerida' }, { status: 400 })
  }

  if (modo === 'venta') {
    const result = await lookupItemParaVentaRevendedora(code, idRevendedora, idProducto, excluir, {
      talle,
      sinTalle,
    })
    if (!result.ok) {
      return NextResponse.json(result)
    }
    return NextResponse.json({
      ok: true,
      item: result.data.item,
      linea: result.data.linea,
    })
  }

  const rawCantidad = req.nextUrl.searchParams.get('cantidad')
  const esConsignacionPorTalle = Boolean(idProducto && (talle || sinTalle))
  const cantidad =
    esConsignacionPorTalle && rawCantidad !== null
      ? parsearCantidadLookup(rawCantidad)
      : undefined

  const result = await lookupItemParaConsignacionRevendedora(code, idRevendedora, excluir, {
    idProducto,
    talle,
    sinTalle,
    ...(cantidad !== undefined ? { cantidad } : {}),
  })

  if (!result.ok) {
    return NextResponse.json(result)
  }

  return NextResponse.json({
    ok: true,
    item: result.data,
    ...(result.items ? { items: result.items } : {}),
    ...(result.aviso ? { aviso: result.aviso } : {}),
  })
}
