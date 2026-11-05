import type { EntradaGuia } from '../tipos'

export const GUIA_INVENTARIO: readonly EntradaGuia[] = [
  {
    id: 'inventario-listado',
    titulo: 'Cómo consultar el inventario de productos',
    ruta: '/inventario',
    permisos: ['inventario.ver'],
    pasos: [
      'Ingresá a Inventario desde el menú principal.',
      'Revisá los indicadores de stock disponible, productos activos, productos bajo mínimo y cantidad de proveedores.',
      'Revisá los paneles de Reposición urgente y Rotación vencida en caso de requerir reponer mercadería o devolver unidades.',
      'Utilizá el buscador para filtrar por nombre o código SKU, o seleccioná una categoría en el filtro.',
      'Hacé clic en cualquier producto de la tabla para abrir su ficha y ver el detalle.',
    ],
  },
  {
    id: 'inventario-producto-crear',
    titulo: 'Cómo registrar un nuevo producto',
    ruta: '/inventario/productos/nuevo',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'En Inventario, hacé clic en "Nuevo producto" (o ingresá desde el acceso directo).',
      'Ingresá el Nombre del producto y seleccioná su Categoría.',
      'Definí opcionalmente el Stock mínimo y el Costo inicial con su moneda (ARS o USD).',
      'Si querés vincular el alta inicial a un proveedor, elegí el Proveedor en el desplegable.',
      'Indicá el stock inicial cargando unidades por talle o el stock total si la categoría no maneja talles.',
      'Hacé clic en "Crear producto" para registrar el artículo y generar sus ítems físicos.',
    ],
    detalles: [
      {
        tema: 'Generación automática de SKU',
        texto: 'El código SKU se autogenera en el sistema al guardar; no es necesario cargarlo manualmente.',
      },
      {
        tema: 'Control de nombres duplicados',
        texto: 'El sistema no permite crear un producto con el mismo nombre que otro ya existente en el catálogo.',
      },
      {
        tema: 'Costo en dólares y conversión oficial',
        texto: 'Si seleccionás moneda USD para el costo inicial, el sistema muestra la cotización oficial del BCRA y un estimado en pesos. Al guardar, el costo se convierte a pesos al tipo de cambio vigente y se preserva el importe original en dólares.',
      },
    ],
  },
  {
    id: 'inventario-producto-ficha',
    titulo: 'Cómo consultar la ficha de un producto',
    ruta: '/inventario',
    permisos: ['inventario.ver'],
    pasos: [
      'Ingresá a Inventario desde el menú de navegación.',
      'Buscá el producto en la tabla y hacé clic en su fila.',
      'Consultá en la cabecera los indicadores de stock disponible, stock total, stock mínimo y precio de venta.',
      'Revisá la tabla de stock por talle para verificar cantidades disponibles, reservadas y vendidas.',
      'Si necesitás analizar un período histórico puntual, ajustá los filtros de fecha Desde y Hasta.',
      'Consultá el listado de códigos QR individuales para reimprimir etiquetas o rastrear unidades.',
    ],
  },
  {
    id: 'inventario-producto-editar',
    titulo: 'Cómo editar un producto',
    ruta: '/inventario',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'En el listado de Inventario, hacé clic sobre el producto para abrir su ficha.',
      'En la parte superior derecha, hacé clic en "Editar".',
      'Modificá el Nombre, la Categoría, el Stock mínimo o la Descripción en el formulario.',
      'Marcá o desmarcá la casilla "Producto activo" para cambiar su disponibilidad comercial.',
      'Hacé clic en "Guardar cambios" para actualizar el producto.',
    ],
    detalles: [
      {
        tema: 'Desactivación de producto',
        texto: 'Un producto inactivo deja de aparecer en los selectores de ventas e ingresos, pero mantiene su historial.',
      },
    ],
  },
  {
    id: 'inventario-producto-asignar-talles',
    titulo: 'Cómo asignar talles a stock ingresado sin talle',
    ruta: '/inventario',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Desde Inventario, hacé clic en el producto para acceder a su ficha.',
      'Si hay unidades disponibles sin talle, localizá el bloque "Productos sin talle" y hacé clic en "Asignar talles".',
      'Distribuí la cantidad de unidades disponibles entre los talles de la categoría.',
      'Hacé clic en "Asignar talles" para confirmar la actualización.',
    ],
    detalles: [
      {
        tema: 'Unidades modificables',
        texto: 'La asignación retroactiva se aplica empezando por los artículos que ingresaron primero, únicamente sobre los artículos que siguen en estado disponible; los ítems vendidos o reservados no se modifican.',
      },
    ],
  },
  {
    id: 'inventario-producto-restock',
    titulo: 'Cómo reponer stock de un producto existente',
    ruta: '/inventario',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'En Inventario, localizá el producto y hacé clic en su fila para abrir la ficha.',
      'En la cabecera de la ficha, hacé clic en el botón "Restock".',
      'El sistema abrirá la pantalla de nuevo ingreso con el producto, su proveedor habitual y su costo anterior ya cargados.',
      'Ingresá la cantidad de unidades recibidas y desglosá las cantidades por talle en "Cargar talles".',
      'Hacé clic en "Guardar" y confirmá la operación para generar los ítems con sus códigos QR.',
    ],
    detalles: [
      {
        tema: 'Proveedor habitual fijado',
        texto: 'En el modo restock el proveedor queda bloqueado porque cada producto en el sistema está vinculado a un único proveedor.',
      },
    ],
  },
  {
    id: 'inventario-categorias-listado',
    titulo: 'Cómo consultar las categorías de inventario',
    ruta: '/inventario/categorias',
    permisos: ['inventario.ver'],
    pasos: [
      'Ingresá a Inventario desde el menú principal.',
      'En la barra superior de acciones y filtros, hacé clic en "Categorías".',
      'Revisá la tabla de categorías existentes con su lista de talles asociados y su estado (Activa o Inactiva).',
    ],
  },
  {
    id: 'inventario-categorias-crear',
    titulo: 'Cómo registrar una nueva categoría',
    ruta: '/inventario/categorias',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'En la pantalla de Categorías, hacé clic en "Nueva categoría".',
      'Completá el Nombre de la categoría (con al menos 2 caracteres).',
      'Ingresá una Descripción opcional.',
      'Agregá los talles correspondientes escribiendo cada uno y presionando la opción para sumarlo.',
      'Hacé clic en "Crear categoría" para guardar el registro.',
    ],
    detalles: [
      {
        tema: 'Talles para productos',
        texto: 'Los talles definidos en la categoría estarán disponibles para desglosar el stock al crear productos o ingresar mercadería.',
      },
    ],
  },
  {
    id: 'inventario-categorias-editar',
    titulo: 'Cómo editar una categoría',
    ruta: '/inventario/categorias',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Desde la pantalla de Categorías, localizá la categoría en la lista y hacé clic en "Editar".',
      'Modificá el Nombre, la Descripción o agregá y quitá talles según corresponda.',
      'Hacé clic en "Guardar cambios" para actualizar la información.',
    ],
  },
  {
    id: 'inventario-categorias-toggle-activa',
    titulo: 'Cómo activar o desactivar una categoría',
    ruta: '/inventario/categorias',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Ingresá a la sección de Categorías.',
      'En la fila de la categoría correspondiente, hacé clic en "Desactivar" (o "Activar" si se encuentra inactiva).',
      'El estado se actualizará de inmediato reflejándose en la columna Estado.',
    ],
    detalles: [
      {
        tema: 'Efecto de desactivar',
        texto: 'Una categoría inactiva no se ofrece al crear nuevos productos o ingresos, pero preserva los productos asociados existentes.',
      },
    ],
  },
  {
    id: 'inventario-ficha-escanear',
    titulo: 'Cómo escanear o buscar la ficha de un ítem',
    ruta: '/inventario/ficha',
    permisos: ['inventario.ver'],
    pasos: [
      'Desde Inventario, hacé clic en "Escanear QR" (o ingresá a la pantalla Escanear ítem).',
      'Apuntá la cámara al código QR de la etiqueta para leerlo automáticamente.',
      'Si no tenés cámara, ingresá el nombre o código en el campo "Buscar por nombre o código" y hacé clic en "Buscar ítem".',
      'El sistema abrirá la ficha del ítem mostrando su producto, talle, estado actual, proveedor e historial.',
    ],
  },
  {
    id: 'inventario-ficha-transicionar-item',
    titulo: 'Cómo cambiar el estado de un ítem desde su ficha',
    ruta: '/inventario/ficha',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Accedé a la ficha del ítem escaneando su QR o buscándolo por código.',
      'En la sección "Acciones", hacé clic en el botón según el estado ("Devolver al proveedor", "Dar de baja", "Liberar reserva" o "Reponer a disponible").',
      'Si la acción requiere confirmación, leé la advertencia y hacé clic en "Sí, continuar".',
      'El sistema actualizará el estado del ítem y registrará el movimiento correspondiente en el Historial.',
    ],
    detalles: [
      {
        tema: 'Baja permanente',
        texto: 'La baja de un ítem es definitiva e irreversible; se utiliza ante roturas, pérdidas o robo de mercadería.',
      },
      {
        tema: 'Devolución al proveedor',
        texto: 'Solo se pueden devolver al proveedor ítems que se encuentren en estado disponible.',
      },
    ],
  },
  {
    id: 'inventario-ficha-ajuste-inventario',
    titulo: 'Cómo registrar un ajuste de inventario en un ítem',
    ruta: '/inventario/ficha',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Ingresá a la ficha del ítem escaneando su código QR.',
      'En la tarjeta "Ajuste de inventario", hacé clic en el botón "Ajuste de inventario".',
      'Revisá la Cantidad en sistema e ingresá la Cantidad contada según el relevamiento físico.',
      'Si el ítem físico no se encuentra, marcá la opción "Dar de baja el ítem".',
      'Escribí obligatoriamente el motivo del desvío en el campo Observaciones.',
      'Hacé clic en "Registrar ajuste" para guardar el movimiento auditable.',
    ],
    detalles: [
      {
        tema: 'Diferencia obligatoria',
        texto: 'No se puede guardar un ajuste si la cantidad contada coincide con la del sistema, a menos que se marque la opción de dar de baja el ítem.',
      },
    ],
  },
  {
    id: 'inventario-etiquetas-imprimir',
    titulo: 'Cómo imprimir etiquetas con código QR',
    ruta: '/inventario/imprimir-etiquetas',
    permisos: ['inventario.ver'],
    pasos: [
      'Accedé a la pantalla de impresión desde un ingreso confirmado ("Imprimir etiquetas") o desde la ficha de un producto o ítem.',
      'Si la cantidad de etiquetas supera el límite por tanda, navegá entre tandas con "← Anterior" o "Siguiente →".',
      'Verificá que los códigos QR hayan terminado de generarse en pantalla.',
      'Hacé clic en "Imprimir" para enviar la tanda a la impresora.',
    ],
    detalles: [
      {
        tema: 'Criterio de pegado',
        texto: 'Cada etiqueta puede pegarse en cualquier artículo del mismo producto y variante; no importa en cuál.',
      },
      {
        tema: 'Artículos imprimibles',
        texto: 'Solo se generan etiquetas para unidades en estado disponible o reservado.',
      },
    ],
  },
  {
    id: 'inventario-ingresos-listado',
    titulo: 'Cómo consultar el listado de ingresos de mercadería',
    ruta: '/inventario/ingresos',
    permisos: ['inventario.ver'],
    pasos: [
      'Ingresá a Ingresos desde el menú principal de navegación (o hacé clic en "Nuevo ingreso" en Inventario).',
      'Revisá la lista con fecha, proveedor, tipo de ingreso, remito, líneas, unidades, costo total y estado.',
      'Hacé clic en "Abrir" para consultar o continuar la carga de un ingreso.',
    ],
  },
  {
    id: 'inventario-ingresos-crear',
    titulo: 'Cómo registrar un ingreso de mercadería',
    ruta: '/inventario/ingresos/nuevo',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'Desde Ingresos, hacé clic en "Nuevo ingreso".',
      'Seleccioná el Proveedor en el desplegable (o dejalo vacío para alta directa sin proveedor).',
      'Ingresá opcionalmente el Número de remito y las Observaciones.',
      'Si tenés el remito en PDF, hacé clic en "Importar PDF", o hacé clic en "+ Agregar producto" para cargar líneas a mano.',
      'En cada línea definí si el producto es nuevo o del inventario, su talle, cantidad y costo unitario.',
      'Hacé clic en "Guardar" y luego en "Confirmar" en el diálogo para generar los ítems físicos con código QR único.',
    ],
    detalles: [
      {
        tema: 'Número de remito único',
        texto: 'No se permite registrar dos ingresos con el mismo número de remito para un mismo proveedor.',
      },
      {
        tema: 'Moneda del comprobante y conversión',
        texto: 'Podés elegir si el comprobante está expresado en ARS o USD. Con USD, se toma la cotización oficial del día de carga para registrar el costo unitario en pesos de las unidades físicas ingresadas.',
      },
    ],
  },
  {
    id: 'inventario-ingresos-consignacion',
    titulo: 'Cómo registrar un ingreso de mercadería en consignación',
    ruta: '/inventario/ingresos/nuevo',
    permisos: ['inventario.ver', 'inventario.crear', 'consignaciones.ver'],
    pasos: [
      'Ingresá a Ingresos y hacé clic en "Nuevo ingreso".',
      'Seleccioná el proveedor consignatario en el desplegable Proveedor.',
      'En Tipo de ingreso elegí "Consignación (paga al vender)".',
      'Completá el número de remito opcional y cargá los productos a ingresar con sus cantidades, talles y costos pactados.',
      'Hacé clic en "Guardar".',
      'En el diálogo de confirmación, hacé clic en "Confirmar" para asentar el ingreso y generar los códigos QR.',
    ],
    detalles: [
      {
        tema: 'Pago al vender',
        texto: 'La mercadería ingresada por consignación no genera deuda inmediata al local; la deuda se acumula recién cuando los artículos se venden y se liquidan en una rendición.',
      },
    ],
  },
  {
    id: 'inventario-ingresos-importar-pdf',
    titulo: 'Cómo importar un remito PDF en un ingreso',
    ruta: '/inventario/ingresos/nuevo',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'En la pantalla de Nuevo ingreso (o en un ingreso borrador), hacé clic en "Importar PDF".',
      'Seleccioná el archivo PDF del remito provisto por el proveedor.',
      'El sistema extraerá las líneas de productos, cantidades y costos unitarios automáticamente.',
      'Revisá cada línea para confirmar si es un producto "Nuevo" con su categoría o "Vincular" a un artículo existente.',
      'Si los artículos cuentan con talles, hacé clic en "Cargar talles" para desglosar las unidades.',
      'Hacé clic en "Guardar" y confirmá la operación para dar de alta los ítems.',
    ],
    detalles: [
      {
        tema: 'Tope de archivo PDF',
        texto: 'El remito en formato PDF debe pesar como máximo 5 MB.',
      },
      {
        tema: 'Renglones no interpretados',
        texto: 'Si el lector no puede interpretar algún renglón del remito, mostrará una lista de advertencias para que puedas cargarlo a mano.',
      },
      {
        tema: 'Moneda del remito y conversión',
        texto: 'En la parte superior de las líneas importadas podés seleccionar si los costos leídos del remito están en ARS o USD. Si están en USD, el sistema calcula el equivalente en pesos según la cotización oficial del día.',
      },
    ],
  },
  {
    id: 'inventario-ingresos-confirmar-borrador',
    titulo: 'Cómo confirmar un ingreso borrador',
    ruta: '/inventario/ingresos',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'Desde Ingresos, hacé clic en "Abrir" sobre un ingreso que se encuentre en estado Borrador.',
      'Verificá que todas las líneas de productos, talles y costos estén correctamente cargadas.',
      'En la tarjeta inferior, hacé clic en "Confirmar ingreso".',
      'En el diálogo de confirmación, hacé clic en "Confirmar".',
      'El sistema generará los ítems con QR único y el ingreso pasará a estado Confirmado.',
    ],
    detalles: [
      {
        tema: 'Confirmación irreversible',
        texto: 'Una vez confirmado el ingreso se generan los ítems físicos en stock y no se pueden agregar nuevas líneas al comprobante.',
      },
    ],
  },
  {
    id: 'inventario-ingresos-agregar-linea',
    titulo: 'Cómo agregar productos a un ingreso borrador',
    ruta: '/inventario/ingresos',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'En Ingresos, hacé clic en "Abrir" sobre el ingreso borrador.',
      'En el formulario "Agregar producto a mano", seleccioná si el artículo "Es nuevo" o "Del inventario".',
      'Ingresá o elegí el nombre del producto, la categoría (si es nuevo), el talle, la cantidad y el costo unitario.',
      'Hacé clic en "Agregar línea" para sumarlo a la tabla del ingreso.',
    ],
  },
  {
    id: 'inventario-ingresos-quitar-linea',
    titulo: 'Cómo quitar una línea de un ingreso borrador',
    ruta: '/inventario/ingresos',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Desde la lista de Ingresos, hacé clic en "Abrir" en el ingreso borrador.',
      'En la tabla de productos del ingreso, localizá la fila que deseás eliminar.',
      'En el extremo derecho de la fila, hacé clic en "Quitar".',
      'La línea se eliminará del ingreso y se recalcularán las unidades y el costo total.',
    ],
  },
  {
    id: 'inventario-ingresos-cancelar',
    titulo: 'Cómo cancelar o eliminar un ingreso de mercadería',
    ruta: '/inventario/ingresos',
    permisos: ['inventario.ver', 'inventario.eliminar'],
    pasos: [
      'En el listado de Ingresos de mercadería, localizá el ingreso a dar de baja.',
      'En la columna de acciones hacé clic en "Cancelar" (si está confirmado) o en "Eliminar" (si es borrador).',
      'Leé la advertencia en el diálogo de confirmación.',
      'Hacé clic en "Cancelar ingreso" o "Eliminar" según corresponda para confirmar la baja.',
    ],
    detalles: [
      {
        tema: 'Condición para cancelar ingresos confirmados',
        texto: 'Solo se puede cancelar un ingreso confirmado si ninguno de sus ítems físicos fue vendido, reservado o apartado; la cancelación retira las unidades del inventario.',
      },
    ],
  },
  {
    id: 'proveedores-listado',
    titulo: 'Cómo consultar el listado de proveedores',
    ruta: '/proveedores',
    permisos: ['inventario.ver'],
    pasos: [
      'Ingresá a Proveedores desde el menú de navegación.',
      'Revisá la lista de proveedores con nombre, tipo, teléfono, días de rotación y estado.',
      'Si el proveedor tiene teléfono cargado, podés hacer clic en el enlace para iniciar un chat de WhatsApp.',
      'Hacé clic en "Ver" en la fila correspondiente para acceder al perfil y movimientos del proveedor.',
    ],
  },
  {
    id: 'proveedores-crear',
    titulo: 'Cómo registrar un nuevo proveedor',
    ruta: '/proveedores/nuevo',
    permisos: ['inventario.ver', 'inventario.crear'],
    pasos: [
      'Ingresá a Proveedores y hacé clic en "Nuevo proveedor" (o accedé a la pantalla de nuevo proveedor).',
      'Ingresá el Nombre del proveedor (mínimo 2 caracteres).',
      'Seleccioná el Tipo entre Mayorista o Particular.',
      'Completá opcionalmente los Días de rotación esperados, Teléfono, Email, CUIT y Notas.',
      'Hacé clic en "Crear proveedor" para guardar el registro.',
    ],
  },
  {
    id: 'proveedores-consignatario',
    titulo: 'Cómo registrar un proveedor de tipo consignatario',
    ruta: '/proveedores/nuevo',
    permisos: ['inventario.ver', 'inventario.crear', 'consignaciones.ver'],
    pasos: [
      'Desde Proveedores, hacé clic en "Nuevo proveedor".',
      'Completá el Nombre del proveedor.',
      'En el desplegable Tipo seleccioná "Consignatario".',
      'Ingresá los datos de contacto como teléfono, correo electrónico, CUIT o notas adicionales.',
      'Hacé clic en "Crear proveedor" para guardarlo en la nómina.',
    ],
    detalles: [
      {
        tema: 'Módulo de consignaciones',
        texto: 'Los proveedores consignatarios permiten ingresar mercadería bajo modalidad de consignación y liquidar las ventas correspondientes en rendiciones periódicas.',
      },
    ],
  },
  {
    id: 'proveedores-perfil',
    titulo: 'Cómo consultar el perfil de un proveedor',
    ruta: '/proveedores',
    permisos: ['inventario.ver'],
    pasos: [
      'En el listado de Proveedores, hacé clic en "Ver" sobre el proveedor a consultar.',
      'Revisá los datos de contacto, CUIT, días de rotación y notas en la cabecera.',
      'Ajustá el filtro de período con fechas Desde y Hasta para delimitar los comprobantes a visualizar.',
      'Revisá el historial de ingresos de mercadería asociados al proveedor.',
    ],
  },
  {
    id: 'proveedores-perfil-consignacion',
    titulo: 'Cómo consultar el estado de cuenta y consignaciones de un proveedor',
    ruta: '/proveedores',
    permisos: ['inventario.ver', 'consignaciones.ver', 'rendiciones.ver'],
    pasos: [
      'Desde Proveedores, hacé clic en "Ver" sobre el proveedor consignatario.',
      'Revisá los indicadores de deuda total, valor de stock en consignación y monto pendiente de rendir.',
      'Consultá las rendiciones pendientes de pago y las consignaciones activas.',
      'Ajustá el filtro de período con fechas Desde y Hasta para acotar los movimientos.',
      'Revisá las tablas de consignaciones recibidas y rendiciones generadas del proveedor.',
    ],
    detalles: [
      {
        tema: 'Cálculo de deuda total',
        texto: 'La deuda total suma el monto de ventas pendientes de rendir más el valor a costo de todos los ítems en consignación que siguen en stock.',
      },
    ],
  },
  {
    id: 'proveedores-toggle-activo',
    titulo: 'Cómo dar de baja o reactivar un proveedor',
    ruta: '/proveedores',
    permisos: ['inventario.ver', 'inventario.editar'],
    pasos: [
      'Ingresá al listado de Proveedores y hacé clic en "Ver" en la fila del proveedor.',
      'En la cabecera de la ficha, hacé clic en "Dar de baja" (o "Reactivar" si estaba inactivo).',
      'Revisá el mensaje de confirmación y hacé clic en "Confirmar baja" o "Confirmar reactivar".',
    ],
    detalles: [
      {
        tema: 'Efecto de la baja',
        texto: 'Un proveedor dado de baja no se muestra en los selectores de nuevos ingresos ni altas de productos, pero conserva todo su historial y deudas.',
      },
    ],
  },
]
