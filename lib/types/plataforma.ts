export const MEDIOS_PAGO_TENANT = ['transferencia', 'efectivo', 'mercadopago', 'otro'] as const

export type MedioPagoTenant = (typeof MEDIOS_PAGO_TENANT)[number]
