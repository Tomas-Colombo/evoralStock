import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { verifySession } from '@/lib/dal/session'
import { resolverCodigo } from '@/lib/dal/inventario/codigo'
import { listItemsByProducto } from '@/lib/dal/inventario/item'
import { parsearSku } from '@/lib/inventario/codigo'
import { ESTADO_ITEM_LABEL, ESTADO_ITEM_VARIANT } from '@/lib/types/inventario'
import { Card } from '@/components/ui/Card'

/**
 * Resolver de búsqueda manual (fallback sin escáner). Estrategia:
 *   1. ¿Es un QR exacto? → redirige a la ficha del ítem físico.
 *   2. Si no, se interpreta como SKU `PREFIJO-####` con talle opcional
 *      (`REM-0007` o `REM-0007-M`) → muestra el producto y sus unidades,
 *      filtradas por talle si vino el sufijo.
 * El QR sigue siendo el flujo ideal; el SKU es el respaldo tipeable.
 */
export default async function BuscarCodigoPage(props: {
  params: Promise<{ codigo: string }>
}) {
  const session = await verifySession()
  const { codigo } = await props.params
  const decoded = decodeURIComponent(codigo).trim()

  // QR exacto → ficha del ítem (los QR son 24 hex, nunca chocan con un SKU).
  const resuelto = await resolverCodigo(decoded)
  if (resuelto?.tipo === 'item') {
    redirect(`/inventario/ficha/${encodeURIComponent(resuelto.item.qr_code)}`)
  }

  if (!resuelto) {
    const { baseSku } = parsearSku(decoded)
    return (
      <>
        <Topbar title="Código no encontrado" session={session} backHref="/inventario/ficha" />
        <main className="flex-1 p-4 sm:p-6">
          <Card padding="none" className="mx-auto max-w-md p-6 text-center">
            <p className="font-display text-lg mb-2">Nada coincide</p>
            <p className="text-sm text-muted mb-4">
              No hay un ítem con ese QR ni un producto con SKU{' '}
              <span className="font-mono">{baseSku}</span> en este tenant.
            </p>
            <Link
              href="/inventario/ficha"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Volver a buscar
            </Link>
          </Card>
        </main>
      </>
    )
  }

  const { producto, talle } = resuelto
  const todos = await listItemsByProducto(producto.id_producto)
  const items = talle
    ? todos.filter((it) => (it.talle ?? '').toUpperCase() === talle)
    : todos
  const disponibles = items.filter((it) => it.estado_item === 'disponible').length

  return (
    <>
      <Topbar title="Resultado de búsqueda" session={session} backHref="/inventario/ficha" />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Cabecera del producto */}
          <Card>
            <h2 className="font-display text-xl">{producto.nombre}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-mono text-muted">
              <span>SKU: {producto.sku ?? '—'}</span>
              {talle && (
                <Badge variant="info">Talle {talle}</Badge>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase font-mono text-muted">Categoría</div>
                <div>{producto.categoria?.nombre ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase font-mono text-muted">Disponibles</div>
                <div className="font-mono">{disponibles}</div>
              </div>
              <div>
                <div className="text-xs uppercase font-mono text-muted">Total listado</div>
                <div className="font-mono">{items.length}</div>
              </div>
            </div>
          </Card>

          {/* Unidades físicas */}
          <Card>
            <h3 className="font-display text-lg mb-3">
              Unidades{talle ? ` · talle ${talle}` : ''}
            </h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted">
                {talle
                  ? `Este producto no tiene unidades cargadas con talle ${talle}.`
                  : 'Este producto todavía no tiene unidades físicas cargadas.'}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {items.map((it) => (
                  <li
                    key={it.id_item}
                    className="flex items-center justify-between border-b border-border-2 pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={ESTADO_ITEM_VARIANT[it.estado_item]}>
                        {ESTADO_ITEM_LABEL[it.estado_item]}
                      </Badge>
                      {it.talle && (
                        <span className="font-mono text-xs text-muted">Talle {it.talle}</span>
                      )}
                    </div>
                    <Link
                      href={`/inventario/ficha/${encodeURIComponent(it.qr_code)}`}
                      className="font-mono text-xs text-ink hover:underline"
                    >
                      Ver ficha →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </>
  )
}
