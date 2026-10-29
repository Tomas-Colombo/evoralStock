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

export const PAGE_SIZE_PLATAFORMA = 25

export const ESTADOS_TENANT_FILTRO = ['todos', 'activo', 'suspendido'] as const
export type EstadoTenantFiltro = (typeof ESTADOS_TENANT_FILTRO)[number]

export const ESTADOS_TENANT_LABEL: Record<EstadoTenantFiltro, string> = {
  todos: 'Todos los estados',
  activo: 'Activo',
  suspendido: 'Suspendido',
}

export const DEUDA_TENANT_FILTRO = ['todos', 'con-deuda', 'al-dia'] as const
export type DeudaTenantFiltro = (typeof DEUDA_TENANT_FILTRO)[number]

export const DEUDA_TENANT_LABEL: Record<DeudaTenantFiltro, string> = {
  todos: 'Todas las cuentas',
  'con-deuda': 'Con deuda',
  'al-dia': 'Al día',
}

export const ORDEN_TENANT_FILTRO = ['nombre_asc', 'saldo_desc', 'alta_desc'] as const
export type OrdenTenantFiltro = (typeof ORDEN_TENANT_FILTRO)[number]

export const ORDEN_TENANT_LABEL: Record<OrdenTenantFiltro, string> = {
  nombre_asc: 'Nombre comercial (A-Z)',
  saldo_desc: 'Mayor deuda',
  alta_desc: 'Más recientes',
}

export interface ListarTenantsPaginadoOptions {
  page: number
  pageSize?: number
  q?: string
  estado?: EstadoTenantFiltro
  deuda?: DeudaTenantFiltro
  orden?: OrdenTenantFiltro
}

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
  totalHistorial?: number
  hpage?: number
  hpageSize?: number
}
