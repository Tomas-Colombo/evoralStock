'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { generarQrDataUrl } from '@/components/inventario/QrDisplay'
import {
  IMPRESORA_MARGEN_MM,
  IMPRESORA_SEPARACION_MM,
  QR_LADO_MM_DEFAULT,
} from '@/lib/inventario/limites'
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
const cssImpresion = (page: string) => `
@media print {
  body * { visibility: hidden; }
  [data-hoja-etiquetas], [data-hoja-etiquetas] * { visibility: visible; }
  [data-hoja-etiquetas] { position: absolute; left: 0; top: 0; width: 100%; }
  @page { ${page} }
}
`

// Sin medida de impresora la dimensión que falte es la de una hoja A4.
const A4_ANCHO_MM = 210
const A4_ALTO_MM = 297
const PADDING_ETIQUETA_MM = 1

export function ImprimirEtiquetasClient({
  items,
  noEncontrados,
  recortadoEn,
  ladoMm = QR_LADO_MM_DEFAULT,
  impresora = null,
  paginacion = null,
}: {
  /** Medida de página de la impresora (mm); null en ambas = hoja A4 con margen de 1 cm. */
  impresora?: { anchoMm: number | null; altoMm: number | null } | null
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
  // Con medida de impresora la etiqueta mide exacto (QR + padding) y se arma
  // una grilla con las columnas que entran en el ancho útil de la página.
  const conImpresora = impresora?.anchoMm != null || impresora?.altoMm != null
  const anchoPaginaMm = impresora?.anchoMm ?? A4_ANCHO_MM
  const altoPaginaMm = impresora?.altoMm ?? A4_ALTO_MM
  const anchoEtiquetaMm = ladoMm + 2 * PADDING_ETIQUETA_MM
  const columnas = Math.max(
    1,
    Math.floor(
      (anchoPaginaMm - 2 * IMPRESORA_MARGEN_MM + IMPRESORA_SEPARACION_MM) /
        (anchoEtiquetaMm + IMPRESORA_SEPARACION_MM),
    ),
  )
  const anchoTextoMm = conImpresora ? ladoMm : Math.max(ladoMm, 25)
  const MAX_CARACTERES_NOMBRE = 10
  const LADO_MIN_CON_NOMBRE_MM = 20

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
          className={
            conImpresora ? 'grid items-start print:p-0' : 'flex flex-wrap items-start gap-4 print:gap-2 print:p-0'
          }
          style={
            conImpresora
              ? {
                  gridTemplateColumns: `repeat(${columnas}, ${anchoEtiquetaMm}mm)`,
                  gap: `${IMPRESORA_SEPARACION_MM}mm`,
                }
              : undefined
          }
        >
          {items
            // Una etiqueta sin QR no sirve para nada: no se imprime en blanco,
            // se omite y se avisa arriba.
            .filter((item) => urls[item.qr_code])
            .map((item) => (
              <div
                key={item.qr_code}
                className={`flex break-inside-avoid flex-col items-center text-center ${
                  conImpresora ? '' : 'border border-gray-300 p-2'
                }`}
                style={conImpresora ? { padding: `${PADDING_ETIQUETA_MM}mm` } : undefined}
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
                {/* Etiqueta mínima: el QR ya identifica la unidad, así que el
                    código, el SKU y la descripción solo ocupaban lugar. Por
                    debajo de 2 cm no entra ni el nombre: queda el talle. */}
                {ladoMm >= LADO_MIN_CON_NOMBRE_MM && (
                  <div
                    style={{ maxWidth: `${anchoTextoMm}mm` }}
                    className="mt-2 truncate text-xs font-semibold leading-tight"
                  >
                    {item.nombre.trim().slice(0, MAX_CARACTERES_NOMBRE)}
                  </div>
                )}
                {item.talle && (
                  <div className="mt-1 font-mono text-[10px] font-bold">{item.talle}</div>
                )}
              </div>
            ))}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: cssImpresion(
            conImpresora
              ? `size: ${anchoPaginaMm}mm ${altoPaginaMm}mm; margin: ${IMPRESORA_MARGEN_MM}mm;`
              : 'margin: 1cm;',
          ),
        }}
      />
    </main>
  )
}
