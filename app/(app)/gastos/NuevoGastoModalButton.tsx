'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { BandAction } from '@/components/shell/BandAction'
import { NuevoGastoForm } from './nuevo/NuevoGastoForm'

interface Cat {
  id: string
  nombre: string
}

/**
 * Alta rápida de gasto en modal desde `/gastos`: evita salir del listado y
 * refresca la tabla al guardar. `/gastos/nuevo` sigue disponible para accesos
 * directos.
 */
export function NuevoGastoModalButton({ categorias }: { categorias: Cat[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <BandAction
        onClick={() => setOpen(true)}
        tone="primary"
        title="Nuevo gasto"
        description="Registrar un gasto del local."
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo gasto" size="lg">
        <NuevoGastoForm
          categorias={categorias}
          onSuccess={() => {
            setOpen(false)
            router.refresh()
          }}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  )
}
