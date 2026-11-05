import type { EntradaGuia } from '../tipos'

export const GUIA_PRECIOS: readonly EntradaGuia[] = [
  {
    id: 'precios-resumen',
    titulo: 'Cómo consultar el panel de precios y ganancia proyectada',
    ruta: '/precios',
    permisos: ['precios.ver'],
    pasos: [
      'Ingresá a Precios desde el menú principal de navegación.',
      'Revisá en la cabecera los indicadores de reglas activas, precios desactualizados, productos sin precio y con margen aplicado.',
      'En la sección Ganancia proyectada por producto, buscá por nombre o SKU, o filtrá por categoría.',
      'Verificá el costo vigente, precio de venta, ganancia en pesos y margen porcentual de cada artículo.',
    ],
  },
  {
    id: 'precios-control-listado',
    titulo: 'Cómo consultar el control de precios',
    ruta: '/precios/control',
    permisos: ['precios.ver'],
    pasos: [
      'Ingresá a Precios y hacé clic en "Control de precios" en la barra de cabecera.',
      'Filtrá los productos por estado: solo desactualizados, sin precio de venta, sin regla de margen o todos.',
      'Utilizá la barra de búsqueda para filtrar por nombre, SKU o categoría.',
      'Compará el costo vigente con el precio actual, el precio proyectado y la variación porcentual.',
    ],
  },
  {
    id: 'precios-control-recalcular-individual',
    titulo: 'Cómo recalcular el precio de un producto',
    ruta: '/precios/control',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'Desde Control de precios, localizá el producto que tenga el precio desactualizado.',
      'En el extremo derecho de la fila, hacé clic en el botón "Recalcular".',
      'El sistema aplicará las reglas de margen vigentes sobre el costo y actualizará el precio de venta.',
    ],
    detalles: [
      {
        tema: 'Costo vigente requerido',
        texto: 'El recálculo exige que el producto tenga un costo vigente registrado en el sistema.',
      },
    ],
  },
  {
    id: 'precios-control-recalcular-lote',
    titulo: 'Cómo recalcular precios de forma masiva',
    ruta: '/precios/control',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Control de precios, tildá la casilla de cada producto o hacé clic en "Seleccionar visibles".',
      'Revisá la cantidad de artículos marcados en la barra superior.',
      'Hacé clic en el botón "Recalcular" con la cantidad de seleccionados.',
      'El sistema procesará los productos y actualizará sus precios en lote.',
    ],
    detalles: [
      {
        tema: 'Límite de productos por lote',
        texto: 'El recálculo masivo admite procesar hasta un máximo de 500 productos por operación.',
      },
    ],
  },
  {
    id: 'precios-control-revaluar-usd',
    titulo: 'Cómo revaluar costos en dólares al tipo de cambio vigente',
    ruta: '/precios/control',
    permisos: ['precios.ver', 'precios.editar_cotizacion'],
    pasos: [
      'Ingresá a Precios y seleccioná "Control de precios".',
      'En la barra superior de acciones, hacé clic en "Revaluar costos USD al dólar vigente".',
      'En el cuadro de confirmación, revisá cuántos productos con costo en USD se verán afectados.',
      'Hacé clic en "Revaluar costos" para ejecutar la actualización masiva.',
      'Revisá el resumen con la cantidad de productos revaluados, sin cambios u omitidos.',
    ],
    detalles: [
      {
        tema: 'Productos alcanzados',
        texto: 'La revaluación toma todos los productos con costo vigente en USD, calcula su nuevo costo en pesos al tipo de cambio oficial actual y marca sus precios de venta como desactualizados para recalcularlos.',
      },
      {
        tema: 'Productos omitidos',
        texto: 'Los productos omitidos corresponden a costos que fueron cargados en USD antes de implementar este mecanismo y que carecen de su costo original registrado, por lo que no pueden convertirse automáticamente.',
      },
      {
        tema: 'Invariante de stock físico',
        texto: 'La revaluación masiva solo actualiza el costo de catálogo y marca el precio de venta; los costos de ingreso de las unidades físicas ya existentes en stock no se modifican.',
      },
    ],
  },
  {
    id: 'precios-cotizacion-consultar',
    titulo: 'Cómo consultar la cotización oficial del dólar',
    ruta: '/precios/cotizacion',
    permisos: ['precios.ver'],
    pasos: [
      'Ingresá a Precios y hacé clic en la tarjeta "Cotización USD".',
      'Verificá el tipo de cambio vigente, el origen (Oficial BCRA o Manual) y la fecha del valor oficial reportado.',
      'Si la cotización figura como desactualizada, revisá el aviso de advertencia.',
      'Si contás con permiso de edición, podés conmutar entre modo Automático (BCRA) o Manual.',
    ],
    detalles: [
      {
        tema: 'Dólar oficial vs. billete',
        texto: 'La cotización automática toma la cotización oficial publicada por el BCRA al cierre del último día hábil, no el dólar billete ni cotizaciones financieras. Para operar con dólar billete o fijar un tipo de cambio comercial propio, cambiá a modo manual.',
      },
      {
        tema: 'Modo manual',
        texto: 'En modo manual podés ingresar cualquier tipo de cambio mayor a cero y guardarlo para que rija en las conversiones de costos.',
      },
      {
        tema: 'Reintento de sincronización',
        texto: 'Si el servicio del BCRA no respondió o la cotización quedó desactualizada, hacé clic en "Reintentar" para forzar una nueva consulta al servidor del Banco Central.',
      },
    ],
  },
  {
    id: 'precios-cotizacion-editar',
    titulo: 'Cómo cambiar el modo o fijar una cotización manual',
    ruta: '/precios/cotizacion',
    permisos: ['precios.ver', 'precios.editar_cotizacion'],
    pasos: [
      'Desde Cotización USD, hacé clic en el botón "Manual" en la sección de configuración de modo.',
      'Ingresá el valor en pesos por cada dólar en el campo "Cotización manual del dólar".',
      'Hacé clic en "Guardar" para registrar la cotización y conmutar el modo.',
      'Para volver al valor del Banco Central, hacé clic en "Automático (BCRA)".',
    ],
    detalles: [
      {
        tema: 'Impacto en nuevos registros',
        texto: 'El cambio de modo y valor manual impacta de inmediato en las nuevas cargas de productos, ingresos y remitos en dólares.',
      },
      {
        tema: 'Permiso requerido',
        texto: 'Solo los usuarios con el permiso dedicado precios.editar_cotizacion pueden alternar el modo o modificar el tipo de cambio.',
      },
    ],
  },
  {
    id: 'precios-reglas-listado',
    titulo: 'Cómo consultar las reglas de precios',
    ruta: '/precios/reglas',
    permisos: ['precios.ver'],
    pasos: [
      'Ingresá a Precios y hacé clic en la tarjeta "Reglas de precios".',
      'Revisá las reglas agrupadas por tipo: Margen, Descuento y Recargo.',
      'Cambiá el orden de prioridad entre mayor a menor o menor a mayor si necesitás analizar la cascada.',
      'Consultá el alcance, forma de pago aplicable, valor y período de vigencia de cada regla.',
    ],
  },
  {
    id: 'precios-reglas-crear',
    titulo: 'Cómo crear una regla de precio',
    ruta: '/precios/reglas/nueva',
    permisos: ['precios.ver', 'precios.crear'],
    pasos: [
      'Ingresá a Reglas de precios y hacé clic en "Nueva regla" (o ingresá a Nueva regla de precio).',
      'Escribí un nombre descriptivo para identificar la regla.',
      'Elegí el tipo de regla entre Margen sobre costo, Descuento o Recargo.',
      'Definí el alcance (Global, Por categoría, Por proveedor o Por producto) y seleccioná el ítem correspondiente.',
      'Ingresá el valor en porcentaje o monto fijo, la prioridad y opcionalmente el rango de vigencia.',
      'Hacé clic en "Crear regla" para guardar la configuración.',
    ],
    detalles: [
      {
        tema: 'Cascada de prioridad',
        texto: 'Ante dos reglas del mismo tipo y alcance, se aplica la que tenga mayor número de prioridad.',
      },
    ],
  },
  {
    id: 'precios-reglas-dar-de-baja',
    titulo: 'Cómo dar de baja una regla de precio',
    ruta: '/precios/reglas',
    permisos: ['precios.ver', 'precios.eliminar'],
    pasos: [
      'En el listado de Reglas de precios, localizá la regla a eliminar.',
      'Hacé clic en el botón "Dar de baja" en el extremo derecho de la fila.',
      'En el cuadro de confirmación, hacé clic en "Sí, dar de baja".',
    ],
    detalles: [
      {
        tema: 'Productos desactualizados',
        texto: 'Al dar de baja una regla de margen, los productos alcanzados pasan a estado desactualizado para recalcular su precio.',
      },
    ],
  },
  {
    id: 'precios-cuotas-agregar-plan',
    titulo: 'Cómo agregar un plan de cuotas',
    ruta: '/precios/reglas',
    permisos: ['precios.ver', 'precios.crear'],
    pasos: [
      'Desde Reglas de precios, hacé clic en el botón "Editar cuotas".',
      'En el campo "Agregar plan", ingresá la cantidad de cuotas deseada.',
      'Hacé clic en "Agregar" para habilitar el plan de pagos.',
    ],
    detalles: [
      {
        tema: 'Rango de cuotas permitido',
        texto: 'Solo se pueden configurar planes de cuotas enteros en el rango de 2 a 60 cuotas.',
      },
    ],
  },
  {
    id: 'precios-cuotas-alternar-plan',
    titulo: 'Cómo activar o desactivar un plan de cuotas',
    ruta: '/precios/reglas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Reglas de precios, hacé clic en "Editar cuotas".',
      'En la lista de planes, ubicá la cantidad de cuotas a modificar.',
      'Hacé clic en "Quitar" para desactivarlo (o "Reactivar" si estaba inactivo).',
    ],
    detalles: [
      {
        tema: 'Baja lógica',
        texto: 'Desactivar un plan de cuotas no afecta las ventas históricas ni las reglas de recargo ya asociadas.',
      },
    ],
  },
  {
    id: 'precios-cuentas-listado',
    titulo: 'Cómo consultar las cuentas de cobro y recargos',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver'],
    pasos: [
      'Ingresá a Precios y hacé clic en la tarjeta "Cuentas de cobro".',
      'Revisá la tabla de cuentas destino con su tipo, identificador y estado.',
      'Verificá qué cuenta se encuentra marcada como Predeterminada para los cobros.',
      'Desplazate hacia abajo para consultar el panel de Recargos por cuotas y márgenes frente al arancel.',
    ],
  },
  {
    id: 'precios-cuentas-crear',
    titulo: 'Cómo crear una cuenta de cobro',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.crear'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Nueva cuenta".',
      'Ingresá el nombre de la cuenta (como Caja, Banco o billetera virtual).',
      'Seleccioná el tipo de cuenta entre efectivo, banco o billetera virtual.',
      'Completá opcionalmente el titular y el identificador como CBU o alias.',
      'Si cobra comisiones, desplegá "+ Cargar costo de cobro" para cargar aranceles y retenciones.',
      'Hacé clic en "Crear cuenta" para guardar el registro.',
    ],
    detalles: [
      {
        tema: 'Cuentas en efectivo',
        texto: 'Las cuentas de tipo efectivo no pagan aranceles ni comisiones a procesadores.',
      },
    ],
  },
  {
    id: 'precios-cuentas-alternar-activa',
    titulo: 'Cómo activar o desactivar una cuenta de cobro',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En el listado de Cuentas y recargos, ubicá la cuenta en la tabla.',
      'En la columna de acciones, hacé clic en "Desactivar" (o "Activar" si estaba inactiva).',
      'La cuenta se actualizará de inmediato para no aparecer en los selectores de cobro del mostrador.',
    ],
    detalles: [
      {
        tema: 'Cuenta predeterminada',
        texto: 'La cuenta predeterminada no se puede desactivar para evitar ventas sin destino de cobro.',
      },
    ],
  },
  {
    id: 'precios-cuentas-cargar-arancel',
    titulo: 'Cómo cargar un arancel de cobro para una cuenta',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.crear'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Costo de cobro" en la fila de la cuenta deseada.',
      'En el bloque Aranceles vigentes, hacé clic en "+ Arancel".',
      'Seleccioná el medio de pago y las cuotas correspondientes si es tarjeta de crédito.',
      'Ingresá el arancel en porcentaje, el IVA sobre arancel y los días de acreditación.',
      'Hacé clic en "Cargar arancel" para registrar la comisión del procesador.',
    ],
    detalles: [
      {
        tema: 'Arancel sin cargar',
        texto: 'Si un medio de pago no tiene arancel configurado, el sistema asume costo cero en sus liquidaciones.',
      },
    ],
  },
  {
    id: 'precios-cuentas-editar-arancel',
    titulo: 'Cómo editar un arancel de cobro',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Costo de cobro" sobre la cuenta correspondiente.',
      'En la tabla de aranceles vigentes, localizá la fila del medio y hacé clic en "Editar".',
      'Modificá el porcentaje de arancel, el IVA o los días de acreditación.',
      'Hacé clic en "Guardar" para asentar los cambios en el tarifario.',
    ],
  },
  {
    id: 'precios-cuentas-dar-de-baja-arancel',
    titulo: 'Cómo dar de baja un arancel de cobro',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Costo de cobro" sobre la cuenta correspondiente.',
      'En la tabla de aranceles vigentes, ubicá el medio y hacé clic en "Dar de baja".',
      'En el cuadro de confirmación, hacé clic en "Sí, dar de baja".',
    ],
    detalles: [
      {
        tema: 'Cierre de vigencia',
        texto: 'Dar de baja un arancel cierra su fecha de vigencia sin eliminar el registro histórico del tarifario.',
      },
    ],
  },
  {
    id: 'precios-cuentas-editar-retenciones',
    titulo: 'Cómo configurar retenciones fiscales en una cuenta',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Costo de cobro" sobre la cuenta a configurar.',
      'En la sección Retenciones fiscales, hacé clic en "Editar retenciones".',
      'Ingresá las alícuotas porcentuales de Retención IVA, Ganancias, Ingresos Brutos e Impuesto al Débito/Crédito.',
      'Hacé clic en "Guardar retenciones" para actualizar la posición fiscal de la cuenta.',
    ],
  },
  {
    id: 'precios-recargos-crear',
    titulo: 'Cómo crear un recargo por cuotas',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.crear'],
    pasos: [
      'En Cuentas y recargos, desplazate al panel Recargo por cuotas y hacé clic en "Nuevo recargo".',
      'Seleccioná la cantidad de cuotas entre los planes activos.',
      'Elegí si aplica a cualquier procesador o filtrá por cuenta destino y medio de pago específico.',
      'Ingresá el valor del recargo porcentual a cobrar al cliente.',
      'Hacé clic en "Crear recargo" para aplicar el interés a las ventas financiadas.',
    ],
    detalles: [
      {
        tema: 'Financiación propia',
        texto: 'Si el recargo corresponde a crédito de la casa, no se puede asociar a una cuenta de destino ni a un procesador externo.',
      },
    ],
  },
  {
    id: 'precios-recargos-editar',
    titulo: 'Cómo editar un recargo por cuotas',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En Cuentas y recargos, hacé clic en "Costo de cobro" sobre la cuenta correspondiente.',
      'Desplazate hasta el bloque Recargo por cuotas.',
      'Ubicá la fila del plan a modificar y hacé clic en "Editar".',
      'Modificá el valor porcentual del recargo en el campo de texto.',
      'Hacé clic en "Guardar" para asentar el nuevo recargo.',
    ],
  },
  {
    id: 'precios-recargos-dar-de-baja',
    titulo: 'Cómo dar de baja un recargo por cuotas',
    ruta: '/precios/cuentas',
    permisos: ['precios.ver', 'precios.editar'],
    pasos: [
      'En el panel Recargo por cuotas de Cuentas y recargos, buscá la fila correspondiente.',
      'Hacé clic en el botón "Dar de baja".',
      'El recargo finalizará su vigencia en la fecha actual y dejará de sumarse en las ventas.',
    ],
  },
]
