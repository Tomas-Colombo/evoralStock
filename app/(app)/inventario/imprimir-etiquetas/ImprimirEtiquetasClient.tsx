'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { generarQrDataUrl } from '@/components/inventario/QrDisplay'
import { QR_LADO_MM_DEFAULT } from '@/lib/inventario/limites'
import type { ItemParaEtiqueta } from '@/lib/dal/inventario/item'

export interface PaginacionTandaClient {
  tandaActual: number
  totalTandas: number
  totalItems: number
  anteriorHref?: string | null
  siguienteHref?: string | null
}

/**
 * CSS de impresión.
 *
 * Está anclado a `[data-hoja-etiquetas]` y NO a `.grid`, que es una utility de
 * Tailwind usada en cuarenta y cinco archivos: la regla es global al documento
 * mientras esta página está montada, así que apuntarla a una utility significa
 * que el día que alguien ponga un `grid` en el shell o en un modal, la
 * impresión se rompe sin que nadie sepa por qué.
 *
 * El `visibility: hidden` + `position: absolute` es el patrón conocido para
 * imprimir un subárbol que vive dentro de un shell: la hoja no es hija directa
 * de `body`, así que no se la puede aislar con `display: none` sobre sus
 * hermanos. Oculta todo, vuelve a mostrar la hoja, y la saca del offset que le
 * impone el sidebar.
 */
const CSS_IMPRESION = `
@media print {
  body * { visibility: hidden; }
  [data-hoja-etiquetas], [data-hoja-etiquetas] * { visibility: visible; }
  [data-hoja-etiquetas] { position: absolute; left: 0; top: 0; width: 100%; }
  @page { margin: 1cm; }
}
`

export function ImprimirEtiquetasClient({
  items,
  noEncontrados,
  recortadoEn,
  ladoMm = QR_LADO_MM_DEFAULT,
  paginacion = null,
}: {
  items: ItemParaEtiqueta[]
  /** QR pedidos que no resolvieron a ningún ítem. */
  noEncontrados: string[]
  /** Tope aplicado, si se pidieron más etiquetas de las permitidas. */
  recortadoEn: number | null
  /** Lado del código QR en milímetros configurado para el tenant. */
  ladoMm?: number
  /** Paginación por tandas cuando la impresión proviene de un origen paginado. */
  paginacion?: PaginacionTandaClient | null
}) {
  // Generamos el PNG con al menos ~4 px por milímetro (~100 DPI mínimo, o 140 px
  // de piso) para que la imagen conserve bordes nítidos al escalarse a `ladoMm` mm.
  const ladoPx = Math.max(140, Math.round(ladoMm * 4))
  const anchoTextoMm = Math.max(ladoMm, 25)

  // Los QR se generan todos acá, en un solo efecto, en vez de dejar que cada
  // etiqueta resuelva el suyo. El motivo no es la performance: es poder saber
  // CUÁNDO está lista la hoja. Con una generación por etiqueta nadie puede
  // responder eso, y apretar Ctrl+P antes de que resuelvan imprime una hoja de
  // cuadrados blancos.
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [fallaron, setFallaron] = useState<string[]>([])

  useEffect(() => {
    let cancelado = false
    Promise.all(
      items.map(async (item) => {
        try {
          return { qr: item.qr_code, url: await generarQrDataUrl(item.qr_code, ladoPx) }
        } catch {
          return { qr: item.qr_code, url: null }
        }
      }),
    ).then((res) => {
      if (cancelado) return
      setUrls(Object.fromEntries(res.filter((r) => r.url).map((r) => [r.qr, r.url as string])))
      setFallaron(res.filter((r) => !r.url).map((r) => r.qr))
    })
    return () => {
      cancelado = true
    }
  }, [items, ladoPx])

  const resueltas = Object.keys(urls).length + fallaron.length
  const listo = resueltas === items.length
  const imprimibles = items.length - fallaron.length

  return (
    <main className="flex-1 bg-white p-6 text-black">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
          <div>
            <h1 className="font-display text-xl text-text">Impresión de etiquetas</h1>
            <p className="mt-0.5 font-mono text-xs text-muted">
              Tamaño QR: {ladoMm} × {ladoMm} mm
            </p>
          </div>
          <Button onClick={() => window.print()} disabled={!listo || imprimibles === 0}>
            {listo ? `Imprimir (${imprimibles})` : 'Generando códigos…'}
          </Button>
        </div>

        {/* Regla operativa de pegado visible para el operador antes de imprimir */}
        <p className="mb-4 text-xs text-muted print:hidden">
          Pegá cada etiqueta en un artículo del mismo producto y variante; no importa en cuál.
        </p>

        {/* Navegación entre tandas cuando supera el tope */}
        {paginacion && paginacion.totalTandas > 1 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 print:hidden">
            <span className="text-sm font-medium text-text">
              Tanda {paginacion.tandaActual} de {paginacion.totalTandas}
              <span className="ml-1 text-xs text-muted">({paginacion.totalItems} etiquetas en total)</span>
            </span>
            <div className="flex items-center gap-2">
              {paginacion.anteriorHref ? (
                <Link
                  href={paginacion.anteriorHref}
                  className="rounded border border-border px-3 py-1.5 text-xs font-semibold hover:bg-hover"
                >
                  ← Anterior
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded border border-border px-3 py-1.5 text-xs text-muted opacity-50">
                  ← Anterior
                </span>
              )}
              {paginacion.siguienteHref ? (
                <Link
                  href={paginacion.siguienteHref}
                  className="rounded border border-border px-3 py-1.5 text-xs font-semibold hover:bg-hover"
                >
                  Siguiente →
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded border border-border px-3 py-1.5 text-xs text-muted opacity-50">
                  Siguiente →
                </span>
              )}
            </div>
          </div>
        )}

        {/* Avisos. Van arriba y fuera de la hoja: el operador tiene que
            enterarse ANTES de mandar a imprimir, no descubrirlo en el papel. */}
        {recortadoEn !== null && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-border bg-card-2 px-3 py-2 text-sm text-text print:hidden"
          >
            Se pidieron más etiquetas de las que entran en una tanda. Se imprimen las primeras{' '}
            {recortadoEn}; el resto va en otra hoja.
          </p>
        )}
        {noEncontrados.length > 0 && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-border bg-card-2 px-3 py-2 text-sm text-text print:hidden"
          >
            {noEncontrados.length === 1
              ? 'Un código no corresponde a ningún ítem y queda sin etiqueta: '
              : `${noEncontrados.length} códigos no corresponden a ningún ítem y quedan sin etiqueta: `}
            <span className="font-mono text-xs">{noEncontrados.join(', ')}</span>
          </p>
        )}
        {fallaron.length > 0 && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-border bg-card-2 px-3 py-2 text-sm text-text print:hidden"
          >
            {fallaron.length === 1
              ? 'No se pudo generar un código, así que esa etiqueta no se imprime: '
              : `No se pudieron generar ${fallaron.length} códigos, así que esas etiquetas no se imprimen: `}
            <span className="font-mono text-xs">{fallaron.join(', ')}</span>
          </p>
        )}

        <div
          data-hoja-etiquetas
          className="flex flex-wrap items-start gap-4 print:gap-2 print:p-0"
        >
          {items
            // Una etiqueta sin QR no sirve para nada: no se imprime en blanco,
            // se omite y se avisa arriba.
            .filter((item) => urls[item.qr_code])
            .map((item) => (
              <div
                key={item.qr_code}
                className="flex break-inside-avoid flex-col items-center border border-gray-300 p-2 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={urls[item.qr_code]}
                  alt={`QR ${item.qr_code}`}
                  width={ladoPx}
                  height={ladoPx}
                  style={{ width: `${ladoMm}mm`, height: `${ladoMm}mm` }}
                  className="block"
                />
                <div
                  style={{ maxWidth: `${anchoTextoMm}mm` }}
                  className="mt-2 line-clamp-2 text-xs font-semibold leading-tight"
                >
                  {item.nombre}
                </div>
                {item.descripcion?.trim() && (
                  <div
                    style={{ maxWidth: `${anchoTextoMm}mm` }}
                    className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-gray-600"
                  >
                    {item.descripcion.trim()}
                  </div>
                )}
                {item.sku && <div className="font-mono text-[10px] text-gray-500">{item.sku}</div>}
                {item.talle && (
                  <div className="mt-1 font-mono text-[10px] font-bold">Talle: {item.talle}</div>
                )}
                <div className="mt-1 font-mono text-[10px] text-black">{item.qr_code}</div>
              </div>
            ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: CSS_IMPRESION }} />
    </main>
  )
}
