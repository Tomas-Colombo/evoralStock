'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'
import { InvitarUsuarioForm, type DatosAccesoCreado } from './nuevo/InvitarUsuarioForm'
import type { RevendedoraLibre } from './revendedorasLibres'

interface InvitarUsuarioModalButtonProps {
  roles: Array<{ id: string; nombre: string }>
  revendedorasLibres?: RevendedoraLibre[]
}

/**
 * Botón para invitar un usuario desde el listado sin navegar a otra página.
 * Abre el formulario dentro de un Modal. Al crearse el usuario, se cierra el
 * modal de invitación y se abre como hermano CompartirAccesoModal para evitar
 * anidarlos y para no perder la contraseña temporal al desmontar el formulario.
 */
export function InvitarUsuarioModalButton({
  roles,
  revendedorasLibres,
}: InvitarUsuarioModalButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [compartir, setCompartir] = useState<DatosAccesoCreado | null>(null)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Invitar usuario
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invitar usuario"
        size="lg"
      >
        <InvitarUsuarioForm
          roles={roles}
          revendedorasLibres={revendedorasLibres}
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
