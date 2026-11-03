import type { EntradaGuia } from '../tipos'

export const GUIA_VENTAS: readonly EntradaGuia[] = [
  {
    id: 'ventas-listado',
    titulo: 'Cómo consultar el listado de ventas',
    ruta: '/ventas',
    permisos: ['ventas.ver'],
    pasos: [
      'Ingresá a Ventas desde el menú principal.',
      'Ajustá el filtro de período con las fechas desde y hasta para definir el rango a consultar.',
      'Si tenés el módulo de revendedoras activo, podés filtrar además por canal local o revendedora.',
      'Revisá los indicadores de operaciones registradas y facturación del período en la cabecera.',
      'Hacé clic en "Ver" en la fila correspondiente para abrir el detalle completo de una venta.',
    ],
  },
  {
    id: 'ventas-registrar-venta',
    titulo: 'Cómo registrar una venta',
    ruta: '/ventas/nueva',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'Ingresá a Ventas y hacé clic en "Nueva venta" para abrir el mostrador.',
      'Escaneá el código QR del producto o buscalo manualmente por nombre o código para sumarlo a la lista.',
      'Seleccioná el cliente si deseás asociar la compra o si vas a financiar en cuotas.',
      'Elegí la forma de pago principal entre efectivo, débito, crédito, transferencia o cuotas.',
      'Hacé clic en "Continuar al cobro" para desglosar importes, medios de pago y cuentas de destino.',
      'Hacé clic en "Confirmar venta" para asentar la operación y descontar el stock.',
    ],
    detalles: [
      {
        tema: 'Financiación en cuotas',
        texto: 'Si seleccionás venta en cuotas, es obligatorio vincular un cliente para poder generar su plan de pagos.',
      },
      {
        tema: 'Venta por revendedora',
        texto: 'Si elegís canal revendedora, tenés que seleccionar la revendedora asignada antes de confirmar.',
      },
    ],
  },
  {
    id: 'ventas-emitir-comprobante',
    titulo: 'Cómo emitir un comprobante de venta',
    ruta: '/ventas',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'Desde el listado de Ventas, buscá la venta y hacé clic en "Ver" para abrir su ficha.',
      'En la tarjeta superior de datos de la venta, hacé clic en "Emitir comprobante".',
      'Seleccioná el tipo de comprobante en el desplegable (Factura A, Factura B, Factura C, Remito o Ticket).',
      'Ingresá el número de comprobante.',
      'Hacé clic en "Emitir" para asociar el comprobante a la venta.',
    ],
    detalles: [
      {
        tema: 'Comprobante único',
        texto: 'Solo se puede emitir un comprobante por venta y no está disponible si la venta se encuentra anulada.',
      },
    ],
  },
  {
    id: 'ventas-anular-venta',
    titulo: 'Cómo anular una venta',
    ruta: '/ventas',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'En el listado de Ventas, localizá la operación y hacé clic en "Ver".',
      'En la parte superior derecha de la ficha, hacé clic en el botón "Anular venta".',
      'Ingresá opcionalmente el motivo de la anulación en el cuadro de texto.',
      'Hacé clic en "Confirmar" para asentar la anulación.',
    ],
    detalles: [
      {
        tema: 'Reintegro de stock y caja',
        texto: 'Al anular la venta, los ítems vuelven automáticamente a stock disponible y se revierten los movimientos de fondos.',
      },
    ],
  },
  {
    id: 'ventas-cambiar-producto',
    titulo: 'Cómo registrar el cambio de un producto vendido',
    ruta: '/ventas',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'Desde el listado de Ventas, hacé clic en "Ver" sobre la venta original.',
      'En la tabla de líneas de venta, buscá el ítem a cambiar y hacé clic en "Cambiar".',
      'Escaneá el código QR o ingresá el código del producto entregado en reemplazo.',
      'Si el artículo nuevo tiene variantes, seleccioná el talle a entregar.',
      'Si hay diferencia de precio a favor del local, seleccioná el medio de cobro y la cuenta de destino.',
      'Hacé clic en "Confirmar cambio" para actualizar los ítems y asentar el cobro de la diferencia.',
    ],
    detalles: [
      {
        tema: 'Diferencia de precio',
        texto: 'No se permiten cambios con diferencia negativa (donde el nuevo producto cueste menos que el original).',
      },
    ],
  },
  {
    id: 'ventas-devolver-producto',
    titulo: 'Cómo registrar la devolución de un producto vendido',
    ruta: '/ventas',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'En el listado de Ventas, hacé clic en "Ver" en la operación correspondiente.',
      'En la tabla de líneas de venta, buscá el ítem devuelto y hacé clic en "Devolver".',
      'Si corresponde reintegrar dinero al cliente, seleccioná el medio de pago y la cuenta origen.',
      'Hacé clic en "Sí, devolver" para confirmar la operación.',
    ],
    detalles: [
      {
        tema: 'Estado del ítem',
        texto: 'El producto devuelto pasa a estado "devuelto por cliente" sin anular el resto de la venta.',
      },
    ],
  },
  {
    id: 'ventas-reservas-listado',
    titulo: 'Cómo consultar el listado de reservas',
    ruta: '/ventas/reservas',
    permisos: ['ventas.ver'],
    pasos: [
      'Ingresá a la sección Reservas desde el menú o desde el botón "Reservas" en Ventas.',
      'Revisá la lista con cliente, fecha de alta, fecha de vencimiento, cantidad de ítems y estado.',
      'Si una reserva activa está lista para cobrarse, hacé clic en "Vender" para cargarla directo en el mostrador.',
      'Hacé clic en "Abrir" en cualquier fila para revisar los ítems reservados o cancelarla.',
    ],
  },
  {
    id: 'ventas-reservas-purgar-vencidas',
    titulo: 'Cómo purgar reservas vencidas',
    ruta: '/ventas/reservas',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'Ingresá a la sección Reservas.',
      'En el extremo superior derecho, hacé clic en el botón "Purgar vencidas".',
      'El sistema buscará las reservas cuya fecha límite expiró y las marcará como vencidas.',
    ],
    detalles: [
      {
        tema: 'Liberación de ítems',
        texto: 'Al purgar reservas vencidas, todos los ítems asociados quedan liberados de inmediato para nuevas ventas.',
      },
    ],
  },
  {
    id: 'ventas-reservas-crear',
    titulo: 'Cómo crear una reserva de productos',
    ruta: '/ventas/reservas/nueva',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'Desde el listado de Reservas, hacé clic en "Nueva reserva".',
      'Escaneá el código QR de cada ítem o buscalo por código para sumarlo a la reserva.',
      'Seleccioná el cliente en el desplegable, o hacé clic en "+ Nuevo" para darlo de alta en el momento.',
      'Ingresá la fecha de vencimiento hasta la cual se guardarán los productos.',
      'Escribí observaciones opcionales si necesitás dejar constancia de algún detalle.',
      'Hacé clic en "Crear reserva" para bloquear los ítems en inventario.',
    ],
    detalles: [
      {
        tema: 'Disponibilidad de stock',
        texto: 'Los productos reservados no pueden ser agregados a otras ventas ni a nuevas reservas mientras continúen activos.',
      },
    ],
  },
  {
    id: 'ventas-reservas-cancelar',
    titulo: 'Cómo cancelar una reserva',
    ruta: '/ventas/reservas',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'Desde el listado de Reservas, hacé clic en "Abrir" en la reserva activa que quieras dar de baja.',
      'En la tarjeta superior con los datos de la reserva, hacé clic en "Cancelar reserva".',
      'En el cuadro de confirmación, hacé clic en "Sí, cancelar".',
    ],
    detalles: [
      {
        tema: 'Desbloqueo de stock',
        texto: 'Al cancelar la reserva, los ítems se liberan inmediatamente para volver a venderse o reservarse.',
      },
    ],
  },
  {
    id: 'ventas-reservas-convertir-venta',
    titulo: 'Cómo convertir una reserva en venta',
    ruta: '/ventas/reservas',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'En el listado de Reservas hacé clic en "Vender", o hacé clic en "Abrir" y seleccioná "Convertir en venta".',
      'El sistema abrirá la pantalla de Nueva venta con los ítems, el cliente y las notas ya cargados.',
      'Verificá los productos en el carrito y hacé clic en "Continuar al cobro".',
      'Elegí los medios de pago y las cuentas correspondientes.',
      'Hacé clic en "Confirmar venta" para cerrar la operación.',
    ],
    detalles: [
      {
        tema: 'Cierre automático de la reserva',
        texto: 'Una vez confirmada la venta, la reserva pasa automáticamente a estado "convertida en venta".',
      },
    ],
  },
  {
    id: 'ventas-clientes-listado',
    titulo: 'Cómo consultar la cartera de clientes',
    ruta: '/clientes',
    permisos: ['ventas.ver'],
    pasos: [
      'Ingresá a Clientes desde el menú principal de navegación.',
      'Buscá por nombre, apellido, teléfono o email en la barra de búsqueda y hacé clic en "Aplicar".',
      'Utilizá el selector de orden para listar por apellido o nombre según necesites.',
      'Hacé clic sobre el nombre o apellido de cualquier cliente para acceder a su ficha detallada.',
    ],
  },
  {
    id: 'ventas-clientes-crear',
    titulo: 'Cómo registrar un nuevo cliente',
    ruta: '/clientes/nuevo',
    permisos: ['ventas.ver', 'ventas.crear'],
    pasos: [
      'Ingresá a la pantalla de Nuevo cliente (o hacé clic en "Nuevo cliente" desde la cabecera del listado).',
      'Completá el apellido y el nombre del cliente (ambos son campos obligatorios).',
      'Ingresá el número de teléfono, correo electrónico o notas si contás con esos datos.',
      'Hacé clic en "Crear cliente" para guardar el nuevo registro en la cartera.',
    ],
    detalles: [
      {
        tema: 'Apellido obligatorio',
        texto: 'El apellido es requerido para poder indexar y localizar deudores en la cartera.',
      },
    ],
  },
  {
    id: 'ventas-clientes-editar',
    titulo: 'Cómo editar los datos de un cliente',
    ruta: '/clientes',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'En la tabla de Clientes, hacé clic en el botón "Editar" en la fila correspondiente (o hacelo desde su ficha con "Editar cliente").',
      'Modificá el apellido, nombre, teléfono, email o notas en el formulario.',
      'Hacé clic en "Guardar cambios" para actualizar la información.',
    ],
  },
  {
    id: 'ventas-clientes-toggle-activo',
    titulo: 'Cómo activar o desactivar un cliente',
    ruta: '/clientes',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'En la tabla de Clientes, localizá al cliente en el listado.',
      'En la columna de acciones hacé clic en "Desactivar" (o "Activar" si se encontraba inactivo).',
      'El estado se actualizará de inmediato reflejándose en la columna Estado.',
    ],
    detalles: [
      {
        tema: 'Efecto de la desactivación',
        texto: 'Un cliente inactivo no se muestra en los selectores de nueva venta ni reservas, pero preserva todo su historial de compras y pagos.',
      },
    ],
  },
  {
    id: 'ventas-cuotas-listado',
    titulo: 'Cómo consultar el panel de control de cuotas',
    ruta: '/cuotas',
    permisos: ['ventas.ver'],
    pasos: [
      'Ingresá a Cuotas desde el menú de navegación.',
      'Revisá en la franja superior los indicadores de monto vencido, lo que vence hoy, lo que vence en el mes y el total a cobrar.',
      'Filtrá los deudores por estado de cuotas (con deuda, vencidas, al día o todas) o buscá por nombre.',
      'Hacé clic en el nombre del cliente para acceder a su ficha y revisar su cronograma de pagos.',
    ],
  },
  {
    id: 'ventas-cuotas-cobrar',
    titulo: 'Cómo registrar el cobro de una cuota',
    ruta: '/clientes',
    permisos: ['ventas.ver', 'ventas.editar'],
    pasos: [
      'Accedé a Clientes (o a Cuotas) y hacé clic en el nombre del cliente para abrir su ficha.',
      'Desplazate hasta la sección Cuotas y localizá la cuota pendiente o parcial.',
      'Hacé clic en el botón "Cobrar" de esa cuota.',
      'Ingresá el monto cobrado (puede ser total o parcial), el medio de pago y la cuenta de destino.',
      'Hacé clic en "Confirmar cobro" para registrar el ingreso en caja.',
    ],
    detalles: [
      {
        tema: 'Cobros parciales',
        texto: 'Si el cliente entrega un importe menor al total adeudado, el sistema descuenta el pago y mantiene la cuota en estado parcial.',
      },
    ],
  },
  {
    id: 'ventas-cuotas-marcar-incobrable',
    titulo: 'Cómo marcar una cuota como incobrable',
    ruta: '/clientes',
    permisos: ['ventas.ver', 'ventas.eliminar'],
    pasos: [
      'Ingresá a Clientes (o Cuotas) y hacé clic sobre el cliente para entrar a su ficha.',
      'En la sección Cuotas, ubicá la cuota adeudada y hacé clic en el botón "Incobrable".',
      'Revisá en el diálogo las cuotas posteriores del mismo plan de compra que se verán afectadas.',
      'Escribí obligatoriamente el motivo por el cual se da por perdida la deuda.',
      'Hacé clic en "Confirmar" para asentar la pérdida y dar de baja el saldo.',
    ],
    detalles: [
      {
        tema: 'Arrastre a cuotas posteriores',
        texto: 'Al declarar incobrable una cuota, el sistema da por perdidas de manera automática esa cuota y todas las siguientes de la misma compra financiada.',
      },
      {
        tema: 'Asiento contable de pérdida',
        texto: 'La operación genera automáticamente un asiento de gasto contable por el importe total impago.',
      },
    ],
  },
]
