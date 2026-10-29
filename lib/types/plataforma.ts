export const MEDIOS_PAGO_TENANT = ['transferencia', 'efectivo', 'mercadopago', 'otro'] as const

export type MedioPagoTenant = (typeof MEDIOS_PAGO_TENANT)[number]

export const PAQUETES_OPCIONALES = {
  revendedoras: ['revendedoras'],
  consignacionProveedor: ['consignaciones', 'rendiciones'],
} as const

export type PaqueteOpcional = keyof typeof PAQUETES_OPCIONALES
export const CLAVES_PAQUETES_OPCIONALES = Object.keys(PAQUETES_OPCIONALES) as [
  PaqueteOpcional,
  ...PaqueteOpcional[],
]

export const TIPOS_MOVIMIENTO_TENANT = ['cargo', 'pago'] as const
export type TipoMovimientoTenant = (typeof TIPOS_MOVIMIENTO_TENANT)[number]

export interface TenantPlataformaResumen {
  idTenant: string
  nombreComercial: string
  subdominio: string
  estadoTenant: string
  createdAt: string
  paquetesHabilitados: PaqueteOpcional[]
  saldo: number
  totalCargos: number
  totalPagos: number
}

export interface MovimientoCuentaCorriente {
  id: string
  tipo: TipoMovimientoTenant
  fechaImputacion: string
  monto: number
  detalle: string
  concepto?: string
  medio?: MedioPagoTenant
  nota?: string | null
  createdAt: string
  anulado: boolean
  anuladoAt?: string | null
  anuladoPor?: string | null
}

export interface TenantPlataformaDetalle {
  tenant: {
    idTenant: string
    nombreComercial: string
    subdominio: string
    logoUrl: string | null
    colorPrimario: string | null
    estadoTenant: string
    createdAt: string
  }
  paquetes: Record<PaqueteOpcional, boolean>
  saldo: number
  totalCargos: number
  totalPagos: number
  historial: MovimientoCuentaCorriente[]
}
