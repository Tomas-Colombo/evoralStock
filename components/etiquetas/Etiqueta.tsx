import { PADDING_ETIQUETA_MM } from '@/lib/etiquetas/limites'
import { calcularLayout, type TamanoCodigo } from '@/lib/etiquetas/layout'
import { obtenerSimbologia, type SimbologiaId } from '@/lib/etiquetas/simbologias'
import { CodigoEtiqueta } from './CodigoEtiqueta'

export interface ItemEtiqueta {
  qr_code: string
  codigo_ean: string
  nombre: string
  talle?: string | null
  sku?: string | null
}

export interface PlantillaEtiqueta {
  ancho_mm: number
  alto_mm: number
  mostrar_nombre: boolean
  mostrar_talle: boolean
  mostrar_sku: boolean
  mostrar_texto_codigo: boolean
}

export interface EtiquetaProps {
  plantilla: PlantillaEtiqueta
  item: ItemEtiqueta
  simbologia?: SimbologiaId
  tamanoCodigo?: TamanoCodigo
  className?: string
  style?: React.CSSProperties
}

/**
 * Renderiza una etiqueta individual (código + campos visibles) a la medida exacta
 * de la plantilla (REQ-ETQ-03, REQ-ETQ-05 y §6).
 */
export function Etiqueta({
  plantilla,
  item,
  simbologia = 'qr',
  tamanoCodigo,
  className = '',
  style,
}: EtiquetaProps) {
  const sim = obtenerSimbologia(simbologia) ?? obtenerSimbologia('qr')!

  // Si no se proveyó tamaño de código, se calcula con el layout puro
  const tamano =
    tamanoCodigo ??
    calcularLayout({
      plantilla,
      simbologia: sim.id,
    }).tamanoCodigo

  const textoCodigo = sim.dimension === '2d' ? item.qr_code : item.codigo_ean

  return (
    <div
      data-etiqueta
      className={`box-border flex flex-col items-center justify-between text-center overflow-hidden break-inside-avoid bg-white text-black ${className}`}
      style={{
        width: `${plantilla.ancho_mm}mm`,
        height: `${plantilla.alto_mm}mm`,
        padding: `${PADDING_ETIQUETA_MM}mm`,
        ...style,
      }}
    >
      <div className="flex-1 flex flex-col items-center justify-center max-w-full">
        <CodigoEtiqueta
          simbologia={simbologia}
          qrCode={item.qr_code}
          codigoEan={item.codigo_ean}
          anchoMm={tamano.anchoMm}
          altoMm={tamano.altoMm}
        />
        {plantilla.mostrar_texto_codigo && (
          <div className="mt-0.5 font-mono text-[8px] leading-none text-black select-all">
            {textoCodigo}
          </div>
        )}
      </div>

      <div className="w-full flex flex-col items-center justify-end leading-tight shrink-0">
        {plantilla.mostrar_nombre && item.nombre && (
          <div className="w-full truncate text-[11px] font-semibold text-black">
            {item.nombre.trim()}
          </div>
        )}
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {plantilla.mostrar_talle && item.talle && (
            <span className="font-mono text-[10px] font-bold text-black">
              {item.talle}
            </span>
          )}
          {plantilla.mostrar_sku && item.sku && (
            <span className="font-mono text-[9px] text-black">
              {item.sku}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
