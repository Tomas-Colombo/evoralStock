import type { EntradaGuia } from '../tipos'

export const GUIA_CONSIGNACIONES: readonly EntradaGuia[] = [
  {
    id: 'consignaciones-listado',
    titulo: 'Cómo consultar el listado de devoluciones a proveedor',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver'],
    pasos: [
      'Ingresá a Consignaciones desde el menú principal de navegación.',
      'Ajustá el rango de fechas con el filtro de período para acotar las operaciones.',
      'Filtrá opcionalmente por proveedor o por estado del lote (activa o cerrada).',
      'Revisá en la cabecera los indicadores de lotes, ítems pendientes y devueltos.',
      'Hacé clic en "Abrir" en cualquier fila para inspeccionar el detalle de los productos incluidos.',
    ],
  },
  {
    id: 'consignaciones-nueva',
    titulo: 'Cómo registrar una devolución de mercadería a proveedor',
    ruta: '/consignaciones/nueva',
    permisos: ['consignaciones.ver', 'consignaciones.crear'],
    pasos: [
      'En Consignaciones, hacé clic en "Nueva devolución".',
      'Seleccioná el Proveedor destinatario en el menú desplegable.',
      'Buscá los productos en consignación a devolver o escaneá sus códigos QR para sumarlos al lote.',
      'Ingresá opcionalmente el motivo de la devolución y observaciones del lote.',
      'Hacé clic en "Crear lote de devolución" para asentar la operación con los ítems en estado pendiente.',
    ],
    detalles: [
      {
        tema: 'Solo mercadería en consignación',
        texto: 'Solo se pueden seleccionar unidades que ingresaron en consignación de ese proveedor y siguen disponibles.',
      },
    ],
  },
  {
    id: 'consignaciones-confirmar-lote',
    titulo: 'Cómo confirmar la salida de un lote de devolución',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.editar'],
    pasos: [
      'Desde el listado de Consignaciones, localizá el lote en estado activa.',
      'Hacé clic en "Confirmar salida" en la fila (o abrilo y hacé clic en "Confirmar todos los pendientes").',
      'En el diálogo de confirmación, hacé clic en "Confirmar salida".',
      'El sistema asentará la salida física de todos los ítems pendientes y cerrará el lote.',
    ],
    detalles: [
      {
        tema: 'Baja del stock',
        texto: 'Al confirmar el lote, las prendas se descuentan definitivamente del inventario disponible.',
      },
    ],
  },
  {
    id: 'consignaciones-agregar-item',
    titulo: 'Cómo agregar una prenda a un lote de consignación activo',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.crear'],
    pasos: [
      'En Consignaciones, hacé clic en "Abrir" sobre el lote deseado.',
      'En la sección Agregar ítem al lote, ingresá el código QR o buscá el producto por nombre.',
      'Escribí opcionalmente el motivo por el cual devolvés la prenda.',
      'Hacé clic en "Agregar al lote" para incorporar la unidad en estado pendiente.',
    ],
  },
  {
    id: 'consignaciones-confirmar-salida-item',
    titulo: 'Cómo confirmar la devolución individual de un ítem',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.editar'],
    pasos: [
      'En Consignaciones, hacé clic en "Abrir" para acceder a la ficha del lote.',
      'En la tabla de ítems, localizá la prenda pendiente.',
      'Hacé clic en "Confirmar salida" en la fila del ítem.',
      'En el diálogo de confirmación, hacé clic en "Confirmar" para asentar la salida individual.',
    ],
  },
  {
    id: 'consignaciones-cancelar-item',
    titulo: 'Cómo cancelar la devolución de un ítem pendiente',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.editar'],
    pasos: [
      'Desde la ficha del lote en Consignaciones, buscá el ítem pendiente que no vas a devolver.',
      'Hacé clic en "Cancelar devolución" en la fila correspondiente.',
      'Ingresá el motivo por el cual la prenda permanece en el local.',
      'Hacé clic en "Cancelar ítem" para dejarlo en estado cancelado y mantenerlo en el stock disponible.',
    ],
  },
  {
    id: 'consignaciones-cerrar',
    titulo: 'Cómo cerrar un lote de consignación activo',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.editar'],
    pasos: [
      'En la lista de Consignaciones, buscá el lote activo (o hacé clic en "Abrir" para ver su detalle).',
      'Hacé clic en "Cerrar" (o en "Cerrar consignación" dentro de la ficha).',
      'En el cuadro de diálogo, hacé clic en "Cerrar lote".',
      'El lote pasará a estado cerrada y no admitirá nuevos ítems ni modificaciones.',
    ],
    detalles: [
      {
        tema: 'Pendientes no devueltos',
        texto: 'Si el lote contenía ítems pendientes al cerrarse, esos ítems se dan de baja del lote y siguen en stock.',
      },
    ],
  },
  {
    id: 'consignaciones-eliminar',
    titulo: 'Cómo eliminar un lote de devolución',
    ruta: '/consignaciones',
    permisos: ['consignaciones.ver', 'consignaciones.eliminar'],
    pasos: [
      'En el listado de Consignaciones, localizá el lote a anular.',
      'Hacé clic en "Eliminar" en la fila (o dentro de la ficha hacé clic en "Eliminar lote").',
      'Confirmá la acción haciendo clic en "Sí, eliminar" en la ventana de confirmación.',
    ],
    detalles: [
      {
        tema: 'Reintegro de stock',
        texto: 'Los ítems que ya hubiesen sido marcados como devueltos en el lote volverán automáticamente al stock disponible.',
      },
    ],
  },
  {
    id: 'rendiciones-listado',
    titulo: 'Cómo consultar el listado de rendiciones',
    ruta: '/rendiciones',
    permisos: ['rendiciones.ver'],
    pasos: [
      'Ingresá a Rendiciones desde el menú principal de navegación.',
      'Revisá en la cabecera los indicadores de cantidad total, rendiciones pendientes y monto adeudado.',
      'Consultá la tabla con la fecha, proveedor, cantidad de ítems, monto total y estado de cada rendición.',
      'Hacé clic en "Ver" en la fila correspondiente para revisar el detalle de prendas saldadas.',
    ],
  },
  {
    id: 'rendiciones-generar',
    titulo: 'Cómo generar una rendición de ventas a un proveedor',
    ruta: '/rendiciones/nueva',
    permisos: ['rendiciones.ver', 'rendiciones.crear'],
    pasos: [
      'En Rendiciones, hacé clic en "Generar rendición".',
      'Seleccioná el Proveedor en el menú desplegable para cargar las ventas pendientes de liquidar.',
      'Revisá las líneas de productos vendidos en consignación y el subtotal a pagar.',
      'Ingresá opcionalmente observaciones sobre la rendición.',
      'Hacé clic en "Generar rendición" y luego confirmá en el diálogo para asentar la deuda en estado pendiente.',
    ],
    detalles: [
      {
        tema: 'Ventas imputadas',
        texto: 'Solo se incluyen prendas vendidas de ese proveedor cuya rendición no haya sido generada ni excluida previamente.',
      },
    ],
  },
  {
    id: 'rendiciones-excluir-linea',
    titulo: 'Cómo excluir una venta de la rendición',
    ruta: '/rendiciones/nueva',
    permisos: ['rendiciones.ver', 'rendiciones.editar'],
    pasos: [
      'Desde la pantalla de Generar rendición, seleccioná el proveedor.',
      'En la tabla de ventas pendientes, localizá la línea de la prenda.',
      'Hacé clic en "Excluir" en el extremo derecho de la fila.',
      'La línea se removerá del subtotal a pagar y se marcará como excluida para no rendirse.',
    ],
    detalles: [
      {
        tema: 'Exclusión definitiva',
        texto: 'Una línea excluida no volverá a aparecer en futuras propuestas de rendición salvo que sea reincluida a mano.',
      },
    ],
  },
  {
    id: 'rendiciones-marcar-pagada',
    titulo: 'Cómo registrar el pago de una rendición',
    ruta: '/rendiciones',
    permisos: ['rendiciones.ver', 'rendiciones.editar'],
    pasos: [
      'En el listado de Rendiciones, buscá la rendición en estado pendiente y hacé clic en "Ver".',
      'En la esquina superior derecha de la ficha, hacé clic en "Marcar pagada".',
      'Indicá la fecha en la que se realizó el pago al proveedor.',
      'Hacé clic en "Confirmar" para asentar el pago y cambiar el estado a pagada.',
    ],
  },
]
