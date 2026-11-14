'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { impactoReglaAction } from '@/app/(app)/precios/actions'
import type { ImpactoReglaCategoria, TipoRegla } from '@/lib/types/precios'
import { NuevaReglaForm, type Ref } from '../NuevaReglaForm'
import { ImpactoReglaDialog } from '../ImpactoReglaDialog'

export function NuevaReglaView({
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
  const [dialogData, setDialogData] = useState<{
    id: string
    impacto: ImpactoReglaCategoria[]
  } | null>(null)
  const [impactoError, setImpactoError] = useState<{
    id: string
    reason: string
  } | null>(null)

  async function handleSuccess({ id, tipoRegla }: { id: string; tipoRegla: TipoRegla }) {
    if (tipoRegla !== 'margen') {
      toast.success('Regla creada')
      router.push('/precios/reglas')
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

  function handleCloseDialog() {
    setDialogData(null)
    router.push('/precios/reglas')
  }

  return (
    <>
      <Card padding="none" className="max-w-2xl p-6">
        {impactoError ? (
          <div className="space-y-4">
            <h3 className="text-base font-semibold">No se pudo calcular el impacto</h3>
            <p className="text-sm text-muted">{mensajeDeError(impactoError.reason)}</p>
            <div className="flex items-center justify-between pt-2">
              <Link
                href="/precios/control"
                className="text-sm font-medium text-ink underline hover:text-text"
              >
                Ver en Control de precios
              </Link>
              <Button variant="secondary" onClick={() => router.push('/precios/reglas')}>
                Volver a reglas
              </Button>
            </div>
          </div>
        ) : (
          <NuevaReglaForm
            categorias={categorias}
            proveedores={proveedores}
            productos={productos}
            puedeVerMargenes={puedeVerMargenes}
            onSuccess={handleSuccess}
            onCancel={() => router.push('/precios/reglas')}
          />
        )}
      </Card>

      <Modal
        open={!!dialogData}
        title="¿Aplicar esta regla?"
        size="lg"
        onClose={handleCloseDialog}
      >
        {dialogData && (
          <ImpactoReglaDialog
            idRegla={dialogData.id}
            impacto={dialogData.impacto}
            puedeAplicar={puedeAplicar}
            puedeDeshacer={puedeDeshacer}
            puedeVerCostos={puedeVerCostos}
            onClose={handleCloseDialog}
          />
        )}
      </Modal>
    </>
  )
}
