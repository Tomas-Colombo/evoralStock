'use client'

import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  CLAVES_PAQUETES_OPCIONALES,
  PAQUETES_INFO,
  type PaqueteOpcional,
} from '@/lib/modulos/catalogo'

interface PaquetesCardProps {
  paquetes: Record<PaqueteOpcional, boolean>
  isPending: boolean
  onToggle: (paquete: PaqueteOpcional, habilitado: boolean) => void
}

export function PaquetesCard({
  paquetes,
  isPending,
  onToggle,
}: PaquetesCardProps) {
  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-base font-bold text-ink">
          Paquetes opcionales
        </h2>
        <p className="text-xs text-muted">
          Activá o desactivá módulos adicionales para este comercio. Los módulos del núcleo están siempre habilitados.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CLAVES_PAQUETES_OPCIONALES.map((pkg) => {
          const meta = PAQUETES_INFO[pkg]
          const habilitado = paquetes[pkg] ?? false
          return (
            <label
              key={pkg}
              htmlFor={`paquete-${pkg}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-panel p-3 transition-colors hover:bg-hover"
            >
              <div className="pt-0.5">
                <Checkbox
                  id={`paquete-${pkg}`}
                  checked={habilitado}
                  disabled={isPending}
                  onChange={(e) => onToggle(pkg, e.target.checked)}
                />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-ink">
                  {meta.nombre}
                </span>
                <span className="text-xs text-muted">
                  {meta.descripcion}
                </span>
              </div>
            </label>
          )
        })}
      </div>
    </Card>
  )
}
