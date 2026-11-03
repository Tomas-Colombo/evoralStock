/**
 * Catálogo central de módulos del sistema: módulos núcleo y paquetes opcionales.
 * Fuente única de verdad en TypeScript, en paridad con `fn_modulo_es_nucleo`
 * y `fn_codigos_paquete` en Postgres (DR-MODOP-3).
 */

export const MODULOS_NUCLEO = [
  'administracion',
  'inventario',
  'ventas',
  'precios',
  'gastos',
  'reportes',
] as const

export type ModuloNucleo = (typeof MODULOS_NUCLEO)[number]

export const PAQUETES_OPCIONALES = {
  revendedoras: ['revendedoras'],
  consignacionProveedor: ['consignaciones', 'rendiciones'],
  ayuda: ['ayuda'],
} as const

export type PaqueteOpcional = keyof typeof PAQUETES_OPCIONALES

export const CLAVES_PAQUETES_OPCIONALES = Object.keys(PAQUETES_OPCIONALES) as [
  PaqueteOpcional,
  ...PaqueteOpcional[],
]

export const PAQUETES_INFO: Record<
  PaqueteOpcional,
  { nombre: string; descripcion: string }
> = {
  revendedoras: {
    nombre: 'Revendedoras',
    descripcion:
      'Módulo de venta por catálogo, asignación de stock en poder y liquidaciones.',
  },
  consignacionProveedor: {
    nombre: 'Consignación de proveedor',
    descripcion:
      'Recepción de artículos en consignación y generación periódica de rendiciones.',
  },
  ayuda: {
    nombre: 'Asistente de ayuda',
    descripcion:
      'Chat que guía al usuario a la pantalla correcta. Cada consulta tiene costo.',
  },
}
