import type { EntradaGuia } from '../tipos'
import { GUIA_AYUDA } from './ayuda'
import { GUIA_VENTAS } from './ventas'
import { GUIA_INVENTARIO } from './inventario'
import { GUIA_PRECIOS } from './precios'
import { GUIA_GASTOS } from './gastos'
import { GUIA_REPORTES } from './reportes'
import { GUIA_ADMINISTRACION } from './administracion'
import { GUIA_CONSIGNACIONES } from './consignaciones'
import { GUIA_REVENDEDORAS } from './revendedoras'

export const GUIA: readonly EntradaGuia[] = [
  ...GUIA_AYUDA,
  ...GUIA_VENTAS,
  ...GUIA_INVENTARIO,
  ...GUIA_PRECIOS,
  ...GUIA_GASTOS,
  ...GUIA_REPORTES,
  ...GUIA_ADMINISTRACION,
  ...GUIA_CONSIGNACIONES,
  ...GUIA_REVENDEDORAS,
]
