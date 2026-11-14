'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Etiqueta } from '@/components/etiquetas/Etiqueta'
import { calcularLayout } from '@/lib/etiquetas/layout'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { ItemParaEtiqueta } from '@/lib/dal/inventario/item'
import type { EtiquetaConfig, EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'
import { SelectorPlantilla } from './SelectorPlantilla'

export interface PaginacionTandaClient {
  tandaActual: number
  totalTandas: number
  totalItems: number
  anteriorHref?: string | null
  siguienteHref?: string | null
}

const cssImpresion = (reglaPage: string, impresoraTipo: string, offsets: { xMm: number; yMm: number }) => `
@media print {
  body * { visibility: hidden; }
  [data-hoja-etiquetas], [data-hoja-etiquetas] * { visibility: visible; }
  [data-hoja-etiquetas] {
    position: absolute;
    left: ${impresoraTipo === 'rollo' ? offsets.xMm : 0}mm;
    top: ${impresoraTipo === 'rollo' ? offsets.yMm : 0}mm;
    width: 100%;
  }
  @page { ${reglaPage} }
  ${
    impresoraTipo === 'rollo'
      ? `
    [data-etiqueta-wrap] {
      page-break-after: always;
      break-after: page;
    }
  `
      : ''
  }
}
`

export function ImprimirEtiquetasClient({
  items,
  plantillas,
  plantillaSeleccionada,
  config,
  noEncontrados = [],
  recortadoEn = null,
  paginacion = null,
}: {
  items: ItemParaEtiqueta[]
  plantillas: EtiquetaPlantilla[]
  plantillaSeleccionada: EtiquetaPlantilla
  config: EtiquetaConfig
  noEncontrados?: string[]
  recortadoEn?: number | null
  paginacion?: PaginacionTandaClient | null
}) {
  const layout = calcularLayout({
    plantilla: plantillaSeleccionada,
    config,
    simbologia: config.metodo,
  })

  const tieneAvisoChico = layout.avisos.includes('etiqueta-chica-para-codigo')
  const puedeImprimir = layout.puedeImprimir && !tieneAvisoChico && items.length > 0

  return (
    <main className="flex-1 bg-white p-6 text-black">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
          <div>
            <h1 className="font-display text-xl text-text">Impresión de etiquetas</h1>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {plantillaSeleccionada.nombre} ({plantillaSeleccionada.ancho_mm} × {plantillaSeleccionada.alto_mm} mm) ·{' '}
              {config.impresora_tipo === 'rollo' ? 'Rollo continuo' : 'Hoja A4'} · Método: {config.metodo.toUpperCase()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <SelectorPlantilla
              plantillas={plantillas}
              selectedId={plantillaSeleccionada.id_plantilla}
            />
            <Button onClick={() => window.print()} disabled={!puedeImprimir}>
              Imprimir ({items.length})
            </Button>
          </div>
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

        {/* Avisos de layout (etiqueta chica / no entra en hoja) */}
        {layout.avisos.map((aviso) => (
          <p
            key={aviso}
            role="alert"
            className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger print:hidden"
          >
            {mensajeDeError(aviso)}
          </p>
        ))}

        {/* Avisos de cantidad y no encontrados */}
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

        {/* Grilla u hoja de etiquetas */}
        <div
          data-hoja-etiquetas
          className={
            layout.impresoraTipo === 'hoja'
              ? 'grid items-start print:p-0'
              : 'flex flex-col items-start gap-4 print:gap-0 print:p-0'
          }
          style={
            layout.impresoraTipo === 'hoja'
              ? {
                  gridTemplateColumns: `repeat(${layout.columnas}, ${layout.anchoEtiquetaMm}mm)`,
                  gap: `${config.separacion_mm}mm`,
                }
              : undefined
          }
        >
          {items.map((item) => (
            <div
              key={item.qr_code}
              data-etiqueta-wrap
              className={`break-inside-avoid ${layout.impresoraTipo === 'rollo' ? 'print:break-after-page' : ''}`}
            >
              <Etiqueta
                plantilla={plantillaSeleccionada}
                item={item}
                simbologia={config.metodo}
                tamanoCodigo={layout.tamanoCodigo}
                className="border border-gray-200 print:border-none"
              />
            </div>
          ))}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: cssImpresion(layout.reglaPage, layout.impresoraTipo, layout.offsets),
        }}
      />
    </main>
  )
}
