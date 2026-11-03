import type { EntradaGuia } from '../tipos'

export const GUIA_GASTOS: readonly EntradaGuia[] = [
  {
    id: 'gastos-listado',
    titulo: 'Cómo consultar el listado de gastos',
    ruta: '/gastos',
    permisos: ['gastos.ver'],
    pasos: [
      'Ingresá a Gastos desde el menú principal de navegación.',
      'Revisá en la cabecera los indicadores de monto gastado en el mes y categorías excedidas o cerca del límite.',
      'En la sección Presupuestos del mes, verificá el progreso y consumo de cada rubro.',
      'Filtrá los últimos gastos registrados por fecha desde y hasta, por categoría o cambiá el orden.',
    ],
  },
  {
    id: 'gastos-registrar',
    titulo: 'Cómo registrar un gasto',
    ruta: '/gastos/nuevo',
    permisos: ['gastos.ver', 'gastos.crear'],
    pasos: [
      'En Gastos, hacé clic en "Nuevo gasto" (o ingresá a la pantalla de Nuevo gasto).',
      'Seleccioná la categoría correspondiente al gasto (o creá una nueva si no existe).',
      'Ingresá el monto y la fecha del comprobante.',
      'Escribí opcionalmente una descripción del gasto y el número de factura o recibo en referencia.',
      'Hacé clic en "Guardar gasto" para asentar el movimiento.',
    ],
    detalles: [
      {
        tema: 'Categorías requeridas',
        texto: 'Es obligatorio contar con al menos una categoría de gasto activa para poder registrar una erogación.',
      },
    ],
  },
  {
    id: 'gastos-eliminar',
    titulo: 'Cómo eliminar un gasto registrado',
    ruta: '/gastos',
    permisos: ['gastos.ver', 'gastos.editar'],
    pasos: [
      'Desde el listado de Gastos, localizá el gasto en la tabla de últimos gastos registrados.',
      'Hacé clic en el botón de eliminar (ícono de papelera) en la fila correspondiente.',
      'En el cuadro de confirmación, hacé clic en "Eliminar" para borrar el registro físico.',
    ],
    detalles: [
      {
        tema: 'Borrado físico',
        texto: 'La eliminación de un gasto es permanente y descuenta de inmediato el importe del total acumulado del mes.',
      },
    ],
  },
  {
    id: 'gastos-presupuestos-listado',
    titulo: 'Cómo consultar los presupuestos por categoría',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver'],
    pasos: [
      'Ingresá a Gastos y hacé clic en el botón "Presupuestos" en la barra superior (o en "Ajustar presupuestos").',
      'Consultá la lista de categorías con su presupuesto mensual asignado y su estado.',
      'Marcá la casilla "Mostrar dadas de baja" si deseás revisar rubros inactivos.',
    ],
  },
  {
    id: 'gastos-categorias-crear',
    titulo: 'Cómo crear una categoría de gasto',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver', 'gastos.crear'],
    pasos: [
      'En Presupuestos por categoría, ubicá la sección Nueva categoría.',
      'Escribí el nombre de la categoría (por ejemplo Alquiler, Impuestos o Servicios).',
      'Hacé clic en el botón "Agregar categoría" para darla de alta.',
    ],
    detalles: [
      {
        tema: 'Longitud del nombre',
        texto: 'El nombre de la categoría debe tener al menos dos caracteres.',
      },
    ],
  },
  {
    id: 'gastos-presupuestos-asignar',
    titulo: 'Cómo definir el presupuesto mensual de una categoría',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver', 'gastos.editar'],
    pasos: [
      'En la tabla de Presupuestos por categoría, buscá la fila del rubro a configurar.',
      'Hacé clic en el campo de la columna "Presupuesto mensual (ARS)" e ingresá el tope en pesos.',
      'Hacé clic fuera del campo para guardar automáticamente el límite.',
    ],
    detalles: [
      {
        tema: 'Sin límite de presupuesto',
        texto: 'Si dejás el campo de presupuesto vacío, el sistema no emitirá alertas de exceso de gasto para esa categoría.',
      },
    ],
  },
  {
    id: 'gastos-categorias-renombrar',
    titulo: 'Cómo cambiar el nombre de una categoría de gasto',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver', 'gastos.editar'],
    pasos: [
      'En Presupuestos por categoría, localizá la categoría en la tabla.',
      'Modificá el texto directamente en el campo de la columna Categoría.',
      'Hacé clic fuera del campo para guardar el nuevo nombre.',
    ],
  },
  {
    id: 'gastos-categorias-dar-de-baja',
    titulo: 'Cómo dar de baja una categoría de gasto',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver', 'gastos.editar'],
    pasos: [
      'En la tabla de Presupuestos por categoría, ubicá la categoría activa.',
      'Hacé clic en el botón "Dar de baja" de esa fila.',
      'Aceptá el cuadro de confirmación del navegador.',
    ],
    detalles: [
      {
        tema: 'Historial de gastos',
        texto: 'Si la categoría posee gastos registrados, la baja es lógica para preservar el histórico contable.',
      },
    ],
  },
  {
    id: 'gastos-categorias-reactivar',
    titulo: 'Cómo reactivar una categoría de gasto dada de baja',
    ruta: '/gastos/presupuestos',
    permisos: ['gastos.ver', 'gastos.editar'],
    pasos: [
      'En Presupuestos por categoría, tildá la casilla "Mostrar dadas de baja".',
      'Localizá la categoría inactiva en la lista.',
      'Hacé clic en el botón "Reactivar" en la columna de acciones para volver a habilitarla.',
    ],
  },
]
