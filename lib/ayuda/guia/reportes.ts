import type { EntradaGuia } from '../tipos'

export const GUIA_REPORTES: readonly EntradaGuia[] = [
  {
    id: 'reportes-tablero-general',
    titulo: 'Cómo consultar el tablero financiero general',
    ruta: '/reportes',
    permisos: ['reportes.ver'],
    pasos: [
      'Ingresá a Reportes desde el menú principal de navegación.',
      'Ajustá el período de consulta seleccionando las fechas desde y hasta en el filtro superior.',
      'Revisá los indicadores principales de ventas, ganancia bruta, flujo de fondos y saldo a cobrar.',
      'Consultá el desglose de ingresos, costo de mercadería y gastos operativos en el bloque de Ganancia.',
      'Analizá el gráfico de tendencia mensual con la evolución de facturación y resultados.',
    ],
    detalles: [
      {
        tema: 'Comparativa de períodos',
        texto: 'Los indicadores del tablero comparan las cifras contra el período inmediatamente anterior de igual duración.',
      },
    ],
  },
  {
    id: 'reportes-ranking-productos',
    titulo: 'Cómo consultar el ranking de productos en reportes',
    ruta: '/reportes',
    permisos: ['reportes.ver', 'inventario.ver'],
    pasos: [
      'Ingresá a Reportes y desplazate hasta la sección Ranking de productos.',
      'Elegí el criterio de ordenamiento entre Mayor ganancia, Más unidades o Mayor facturación.',
      'Revisá la lista de artículos destacados con sus unidades vendidas y montos acumulados en el período.',
    ],
  },
  {
    id: 'reportes-consignaciones',
    titulo: 'Cómo consultar mercadería en consignación y proveedores en reportes',
    ruta: '/reportes',
    permisos: ['reportes.ver', 'consignaciones.ver'],
    pasos: [
      'Ingresá al tablero de Reportes con el paquete de consignaciones contratado.',
      'En el bloque Movimiento de plata, revisá los pagos realizados a proveedores consignatarios.',
      'En el bloque Mercadería, consultá la valorización del stock propio versus stock recibido en consignación.',
      'En el bloque Proveedores, verificá la deuda acumulada pendiente de rendición.',
    ],
    detalles: [
      {
        tema: 'Paquete de consignación',
        texto: 'El bloque de deuda a proveedores y la separación de stock en consignación requieren el paquete de consignaciones activo.',
      },
    ],
  },
  {
    id: 'reportes-revendedoras',
    titulo: 'Cómo consultar el rendimiento del canal de revendedoras en reportes',
    ruta: '/reportes',
    permisos: ['reportes.ver', 'revendedoras.ver'],
    pasos: [
      'Ingresá a Reportes teniendo contratado el paquete de revendedoras.',
      'Desplazate hasta el bloque inferior Canal revendedoras.',
      'Consultá la facturación total del canal, comisiones generadas y ganancia neta aportada.',
      'Revisá la tabla de cumplimiento de objetivos por revendedora y su estado en el período.',
      'Filtrá opcionalmente por una revendedora específica para ver su perfil y métricas individuales.',
    ],
    detalles: [
      {
        tema: 'Paquete de revendedoras',
        texto: 'Las métricas y el cumplimiento de objetivos del canal revendedoras solo están disponibles con el paquete contratado.',
      },
    ],
  },
]
