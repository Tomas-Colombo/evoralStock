'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NuevoProductoForm } from './productos/nuevo/NuevoProductoForm'
import type { CategoriaRow, ProveedorRow } from '@/lib/types/inventario'

interface NuevoProductoModalButtonProps {
  categorias: CategoriaRow[]
  productos: Array<{ nombre: string }>
  proveedores: ProveedorRow[]
}

/**
 * Alta de producto en modal sin salir del listado de inventario.
 * Si no hay categorías activas, el botón deriva a la pantalla de categorías con
 * el parámetro de error correspondiente (mismo comportamiento que la redirección
 * de `/inventario/productos/nuevo`).
 * `Modal` desmonta el contenido al cerrarse, por lo que cada apertura inicia
 * con el formulario en blanco.
 */
export function NuevoProductoModalButton({
  categorias,
  productos,
  proveedores,
}: NuevoProductoModalButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Sin categorías no se puede crear producto; redirigimos a categorías al igual que /inventario/productos/nuevo.
  if (categorias.length === 0) {
    return (
      <Link href="/inventario/categorias?e=needs-categoria">
        <Button size="sm" variant="secondary">
          Nuevo producto
        </Button>
      </Link>
    )
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Nuevo producto
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo producto" size="lg">
        <NuevoProductoForm
          categorias={categorias}
          productos={productos}
          proveedores={proveedores}
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
