'use client'

import { SelectUrl } from '@/components/filtros/SelectUrl'
import type { EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'

export function SelectorPlantilla({
  plantillas,
  selectedId,
}: {
  plantillas: EtiquetaPlantilla[]
  selectedId: string
}) {
  return (
    <div className="flex items-center gap-2 print:hidden">
      <label htmlFor="selector-plantilla" className="text-xs font-medium text-muted">
        Plantilla:
      </label>
      <SelectUrl
        id="selector-plantilla"
        param="plantilla"
        valor={selectedId}
        ariaLabel="Seleccionar plantilla"
        className="w-auto text-xs"
        opciones={plantillas.map((p) => ({
          value: p.id_plantilla,
          label: `${p.nombre} (${p.ancho_mm}×${p.alto_mm} mm)${p.predeterminada ? ' — Predeterminada' : ''}`,
        }))}
      />
    </div>
  )
}
