'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BandAction } from '@/components/shell/BandAction'
import { Modal } from '@/components/ui/Modal'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'
import {
  NuevaRevendedoraForm,
  type DatosAccesoRevendedora,
} from './nuevo/NuevaRevendedoraForm'

interface NuevaRevendedoraModalButtonProps {
  canGrantAccess?: boolean
  canEditComision?: boolean
}

/**
 * Disparador y modal para crear una revendedora directamente desde el listado.
 * Renderiza CompartirAccesoModal como hermano del Modal principal para no anidar
 * dos diálogos y preservar la contraseña temporal en memoria volátil de React
 * sin exponerla en URL ni en almacenamiento persistente.
 */
export function NuevaRevendedoraModalButton({
  canGrantAccess,
  canEditComision,
}: NuevaRevendedoraModalButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [compartir, setCompartir] = useState<DatosAccesoRevendedora | null>(null)

  return (
    <>
      <BandAction
        onClick={() => setOpen(true)}
        tone="primary"
        title="Nueva revendedora"
        description="Dar de alta y asignar mercadería."
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva revendedora"
        size="lg"
      >
        <NuevaRevendedoraForm
          canGrantAccess={canGrantAccess}
          canEditComision={canEditComision}
          onSuccess={(datos) => {
            setOpen(false)
            setCompartir(datos)
            router.refresh()
          }}
          onCancel={() => setOpen(false)}
        />
      </Modal>

      <CompartirAccesoModal
        open={compartir !== null}
        onClose={() => setCompartir(null)}
        nombre={compartir?.nombre ?? ''}
        email={compartir?.email ?? ''}
        password={compartir?.password ?? ''}
        telefonoInicial={compartir?.telefono}
      />
    </>
  )
}
