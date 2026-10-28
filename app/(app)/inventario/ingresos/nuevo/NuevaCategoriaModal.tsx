'use client'

import { Modal } from '@/components/ui/Modal'
import { CategoriaForm } from '@/components/inventario/CategoriaForm'
import type { CategoriaRow } from '@/lib/types/inventario'

/**
 * Alta rápida de categoría desde la carga de un ingreso, sin abandonar la
 * pantalla. Usa el mismo formulario que `/inventario/categorias`; al crear
 * devuelve la fila para preseleccionarla en la línea que disparó el alta.
 * `Modal` desmonta el contenido al cerrarse: cada apertura arranca vacía.
 */
export function NuevaCategoriaModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (categoria: CategoriaRow) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Nueva categoría">
      <CategoriaForm onSaved={onCreated} onCancel={onClose} />
    </Modal>
  )
}
