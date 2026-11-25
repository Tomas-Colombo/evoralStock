'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, buttonClassName } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { aplicarReglaAction, bajaReglaAction } from '@/app/(app)/precios/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { ImpactoReglaCategoria } from '@/lib/types/precios'

export interface ImpactoReglaDialogProps {
  idRegla: string
  impacto: ImpactoReglaCategoria[]
  puedeAplicar: boolean
  puedeDeshacer: boolean
  puedeVerCostos: boolean
  onClose: () => void
}

export function ImpactoReglaDialog({
  idRegla,
  impacto,
  puedeAplicar,
  puedeDeshacer,
  puedeVerCostos,
  onClose,
}: ImpactoReglaDialogProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [aplicada, setAplicada] = useState(false)

  const totalProductos = impacto.reduce((sum, c) => sum + c.productos, 0)
  const totalCambian = impacto.reduce((sum, c) => sum + (c.cambian ?? 0), 0)
  const totalSinCosto = impacto.reduce((sum, c) => sum + (c.sin_costo ?? 0), 0)

  // Al reabrir el cuadro después de aplicar, el impacto recalculado da cambian = 0.
  const yaAplicada = aplicada || (puedeVerCostos && totalProductos > 0 && totalCambian === 0)
  const puedeMostrarAplicar = puedeAplicar && puedeVerCostos && totalCambian > 0 && !yaAplicada

  async function handleAplicar() {
    if (loading) return
    setLoading(true)
    try {
      const res = await aplicarReglaAction(idRegla)
      if (!res.ok) {
        toast.error('No se pudo aplicar', mensajeDeError(res.reason))
        return
      }
      const n = res.data?.recalculados ?? 0
      toast.success(`${n} ${n === 1 ? 'producto recalculado' : 'productos recalculados'}`)
      setAplicada(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeshacer() {
    if (loading) return
    setLoading(true)
    try {
      const res = await bajaReglaAction(idRegla)
      if (!res.ok) {
        toast.error('No se pudo deshacer la regla', mensajeDeError(res.reason))
        return
      }
      toast.success('Regla deshecha')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {totalProductos === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card-2 p-4 text-sm">
          <p className="font-medium text-text">Esta regla no cambia ningún precio ahora</p>
          <p className="mt-1 text-muted">
            Puede estar tapada por otra regla más específica o tener una vigencia futura.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card-2 p-3">
            <ul className="space-y-1.5 text-sm">
              {impacto.map((c, i) => (
                <li key={c.id_categoria ?? `sin-cat-${i}`} className="text-text">
                  {puedeVerCostos
                    ? `${c.categoria_nombre} — ${c.productos} ${c.productos === 1 ? 'producto' : 'productos'} (suben ${c.suben ?? 0}, bajan ${c.bajan ?? 0})`
                    : `${c.categoria_nombre} — ${c.productos} ${c.productos === 1 ? 'producto pasa' : 'productos pasan'} a esta regla`}
                </li>
              ))}
            </ul>
          </div>

          {!puedeVerCostos && (
            <p className="text-xs text-muted">
              Otra persona con permiso para ver costos puede aplicar los precios desde Control.
            </p>
          )}

          {puedeVerCostos && totalSinCosto > 0 && (
            <p className="text-xs text-muted">
              {totalSinCosto}{' '}
              {totalSinCosto === 1
                ? 'producto no tiene costo y no se va a recalcular.'
                : 'productos no tienen costo y no se van a recalcular.'}
            </p>
          )}
        </div>
      )}

      {yaAplicada ? (
        <p className="text-sm font-medium text-text">
          Precios aplicados: los productos de esta regla ya tienen el precio nuevo.
        </p>
      ) : (
        <p className="text-xs text-muted">
          La regla queda guardada y los precios sin aplicar.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {puedeDeshacer && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={loading}
            onClick={handleDeshacer}
          >
            Deshacer regla
          </Button>
        )}

        {loading ? (
          <Button type="button" variant="secondary" size="sm" disabled>
            Ver detalle
          </Button>
        ) : (
          <Link
            href={`/precios/control?regla=${idRegla}`}
            className={buttonClassName('secondary', 'sm')}
          >
            Ver detalle
          </Link>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={onClose}
        >
          Cerrar
        </Button>

        {puedeMostrarAplicar && (
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={handleAplicar}
          >
            Aplicar a {totalCambian} {totalCambian === 1 ? 'producto' : 'productos'}
          </Button>
        )}
      </div>
    </div>
  )
}
