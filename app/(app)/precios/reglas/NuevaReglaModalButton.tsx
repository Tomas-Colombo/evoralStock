'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { impactoReglaAction } from '@/app/(app)/precios/actions'
import type { ImpactoReglaCategoria, TipoRegla } from '@/lib/types/precios'
import { NuevaReglaForm, type Ref } from './NuevaReglaForm'
import { ImpactoReglaDialog } from './ImpactoReglaDialog'

export function NuevaReglaModalButton({
  categorias,
  proveedores,
  productos,
  puedeVerMargenes,
  puedeAplicar,
  puedeDeshacer,
  puedeVerCostos,
}: {
  categorias: Ref[]
  proveedores: Ref[]
  productos: Ref[]
  puedeVerMargenes: boolean
  puedeAplicar: boolean
  puedeDeshacer: boolean
  puedeVerCostos: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [dialogData, setDialogData] = useState<{
    id: string
    impacto: ImpactoReglaCategoria[]
  } | null>(null)
  const [impactoError, setImpactoError] = useState<{
    id: string
    reason: string
  } | null>(null)

  function handleOpen() {
    setDialogData(null)
    setImpactoError(null)
    setOpen(true)
  }

  function handleCloseModal() {
    setOpen(false)
    if (dialogData) {
      setDialogData(null)
    }
    if (impactoError) {
      setImpactoError(null)
    }
    router.refresh()
  }

  async function handleSuccess({ id, tipoRegla }: { id: string; tipoRegla: TipoRegla }) {
    if (tipoRegla !== 'margen') {
      toast.success('Regla creada')
      setOpen(false)
      router.refresh()
      return
    }

    const res = await impactoReglaAction(id)
    if (!res.ok) {
      toast.success('Regla creada')
      toast.error('No se pudo calcular el impacto', mensajeDeError(res.reason))
      setImpactoError({ id, reason: res.reason })
      return
    }

    setDialogData({ id, impacto: res.data?.impacto ?? [] })
  }

  return (
    <>
      <Button size="sm" onClick={handleOpen}>
        Nueva regla
      </Button>

      <Modal
        open={open}
        title={
          impactoError
            ? 'No se pudo calcular el impacto'
            : dialogData
              ? '¿Aplicar esta regla?'
              : 'Nueva regla de precio'
        }
        size="lg"
        onClose={handleCloseModal}
      >
        {/* El formulario es largo: scrollea adentro del modal para que los
            botones de acción queden siempre alcanzables. */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {impactoError ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">{mensajeDeError(impactoError.reason)}</p>
              <div className="flex items-center justify-between pt-2">
                <Link
                  href="/precios/control"
                  className="text-sm font-medium text-ink underline hover:text-text"
                  onClick={handleCloseModal}
                >
                  Ver en Control de precios
                </Link>
                <Button variant="secondary" onClick={handleCloseModal}>
                  Cerrar
                </Button>
              </div>
            </div>
          ) : dialogData ? (
            <ImpactoReglaDialog
              idRegla={dialogData.id}
              impacto={dialogData.impacto}
              puedeAplicar={puedeAplicar}
              puedeDeshacer={puedeDeshacer}
              puedeVerCostos={puedeVerCostos}
              onClose={handleCloseModal}
            />
          ) : (
            <>
              <details className="rounded-lg border border-dashed border-border bg-card-2">
                <summary className="cursor-pointer list-none px-4 py-3 font-medium text-text marker:content-none hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                  <span className="text-ink">¿Cómo funcionan las reglas de precios?</span>
                  <span className="mt-1 block text-sm font-normal text-muted">
                    La cascada de prioridad decide qué regla aplica sobre cada producto.
                  </span>
                </summary>
                <div className="space-y-2 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted">
                  <p>
                    <strong className="text-ink">1. Alcance:</strong> producto mata proveedor,
                    proveedor mata categoría, categoría mata global.
                  </p>
                  <p>
                    <strong className="text-ink">2. Prioridad:</strong> si dos reglas empatan en
                    alcance, gana la de mayor prioridad.
                  </p>
                  <p>
                    <strong className="text-ink">3. Fecha:</strong> podés programar reglas con
                    inicio futuro o vencimiento.
                  </p>
                  <p>
                    <strong className="text-ink">4. Descuentos acumulables:</strong> se suman entre
                    sí si están marcados como acumulables.
                  </p>
                </div>
              </details>

              <NuevaReglaForm
                categorias={categorias}
                proveedores={proveedores}
                productos={productos}
                puedeVerMargenes={puedeVerMargenes}
                onSuccess={handleSuccess}
                onCancel={handleCloseModal}
              />
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
