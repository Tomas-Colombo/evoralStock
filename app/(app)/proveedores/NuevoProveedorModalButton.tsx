'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { NuevoProveedorModal } from '@/components/inventario/NuevoProveedorModal'

/**
 * Alta de proveedor sin salir del listado: el formulario se abre en un modal
 * y, al crear, refresca la tabla que está detrás. La ruta `/proveedores/nuevo`
 * sigue existiendo para enlaces directos — mismo criterio que
 * `NuevoClienteModalButton`.
 */
export function NuevoProveedorModalButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Nuevo proveedor
      </Button>

      <NuevoProveedorModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
