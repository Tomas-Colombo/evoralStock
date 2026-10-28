import type { MedioPago } from '@/lib/types/ventas'
import type { MedioPagoRecargo } from '@/lib/types/precios'

/**
 * Los medios que pueden tener costo. El efectivo nunca paga arancel. Antes
 * estaba declarada igual en el ABM de cuentas y en el panel de aranceles.
 */
export const MEDIOS_CON_COSTO: readonly MedioPago[] = [
  'transferencia',
  'tarjeta_debito',
  'tarjeta_credito',
]

/**
 * Los medios que pueden financiar en cuotas. El débito no tiene planes de
 * cuotas. El panel de aranceles los tenía escritos a mano como `<option>`.
 */
export const MEDIOS_FINANCIABLES: readonly MedioPagoRecargo[] = [
  'tarjeta_credito',
  'transferencia',
]
