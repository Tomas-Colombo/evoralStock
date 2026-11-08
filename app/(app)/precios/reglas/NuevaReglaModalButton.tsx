'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { GuiaReglas } from '@/components/precios/GuiaReglas'
import { NuevaReglaForm, type Ref } from './NuevaReglaForm'

/**
 * Alta de regla sin salir del listado: el formulario se abre en un modal y,
 * al crear, refresca la tabla que está detrás. La ruta `/precios/reglas/nueva`
 * sigue existiendo para enlaces directos.
 */
export function NuevaReglaModalButton({
  categorias,
  proveedores,
  productos,
}: {
  categorias: Ref[]
  proveedores: Ref[]
  productos: Ref[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Nueva regla
      </Button>

      <Modal
        open={open}
        title="Nueva regla de precio"
        size="lg"
        onClose={() => setOpen(false)}
      >
        {/* El formulario es largo: scrollea adentro del modal para que los
            botones de acción queden siempre alcanzables. */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <details className="rounded-lg border border-dashed border-border bg-card-2">
            <summary className="cursor-pointer list-none px-4 py-3 font-medium text-text marker:content-none hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
              <span className="text-ink">¿Cómo funcionan las reglas de precios?</span>
              <span className="mt-1 block text-sm font-normal text-muted">
                Tipos de regla, cascada de especificidad, prioridad y un ejemplo paso a paso.
              </span>
            </summary>
            <div className="border-t border-border px-4 py-4">
              <GuiaReglas />
            </div>
          </details>

          <NuevaReglaForm
            categorias={categorias}
            proveedores={proveedores}
            productos={productos}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      </Modal>
    </>
  )
}
