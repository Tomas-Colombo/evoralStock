'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select } from '@/components/ui/Select'
import type { EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'

export function SelectorPlantilla({
  plantillas,
  selectedId,
}: {
  plantillas: EtiquetaPlantilla[]
  selectedId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nuevoId = e.target.value
    const params = new URLSearchParams(searchParams?.toString())
    params.set('plantilla', nuevoId)
    router.replace(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <label htmlFor="selector-plantilla" className="text-xs font-medium text-muted">
        Plantilla:
      </label>
      <Select
        id="selector-plantilla"
        aria-label="Seleccionar plantilla"
        value={selectedId}
        onChange={handleChange}
        className="w-auto text-xs"
      >
        {plantillas.map((p) => (
          <option key={p.id_plantilla} value={p.id_plantilla}>
            {p.nombre} ({p.ancho_mm}×{p.alto_mm} mm){p.predeterminada ? ' — Predeterminada' : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}
