'use client'

import { Modal } from '@/components/ui/Modal'
import type { CategoriaRow } from '@/lib/types/inventario'
import { EditarProductoForm, type ProductoEditable } from './EditarProductoForm'

/**
 * Edición inline del producto en un modal — antes vivía en una página propia
 * pero son cinco campos y el usuario prefiere no perder el contexto del listado
 * o de la ficha. Al guardar, el formulario refresca el árbol para que el
 * listado y la ficha se re-hidraten con los nuevos datos.
 *
 * `Modal` desmonta el contenido al cerrarse y la `key` remonta el formulario
 * si cambia el producto: reabrir siempre arranca con los datos guardados y
 * descarta lo que el usuario dejó sin guardar.
 */
export function EditarProductoModal({
  open,
  producto,
  categorias,
  onClose,
}: {
  open: boolean
  producto: ProductoEditable | null
  categorias: CategoriaRow[]
  onClose: () => void
}) {
  return (
    <Modal
      open={open && producto !== null}
      onClose={onClose}
      title={producto ? `Editar: ${producto.nombre}` : 'Editar producto'}
      size="lg"
    >
      {producto && (
        <EditarProductoForm
          key={producto.id_producto}
          producto={producto}
          categorias={categorias}
          onSuccess={onClose}
          onCancel={onClose}
        />
      )}
    </Modal>
  )
}
