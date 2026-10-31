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
} as const

export type PaqueteOpcional = keyof typeof PAQUETES_OPCIONALES

export const CLAVES_PAQUETES_OPCIONALES = Object.keys(PAQUETES_OPCIONALES) as [
  PaqueteOpcional,
  ...PaqueteOpcional[],
]
