'use client'

import { Modal } from '@/components/ui/Modal'
import type { ProveedorRow } from '@/lib/types/inventario'
import { NuevoProveedorForm } from './NuevoProveedorForm'

/**
 * Alta de proveedor en modal: lo usan el listado de proveedores y el ingreso
 * de mercadería. `Modal` desmonta el contenido al cerrarse, así que cada
 * apertura arranca con el formulario vacío sin un `reset()` a mano.
 */
export function NuevoProveedorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (proveedor: ProveedorRow) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Nuevo proveedor" size="lg">
      <NuevoProveedorForm onSuccess={onCreated} onCancel={onClose} />
    </Modal>
  )
}
