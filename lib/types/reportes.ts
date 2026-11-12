/**
 * Tipos TS de reportes/dashboard/alertas (Etapa 8). Contra 00028.
 */

export interface GananciaPorProductoRow {
  id_producto: string
  nombre: string
  sku: string | null
  id_categoria: string
  categoria_nombre: string | null
  costo_vigente: number | null
  moneda: string | null
  precio_venta: number | null
  ganancia_unitaria: number | null
  margen_pct: number | null
}


export interface PerfilProveedorRow {
  id_proveedor: string
  nombre: string
  tipo: string
  telefono: string | null
  dias_rotacion: number | null
  items_disponibles: number
  consignaciones_activas: number
  monto_pendiente_rendicion: number
  lineas_pendientes_rendicion: number
  monto_rendido_historico: number
  rendiciones_pendientes_pago: number
}


export interface AlertaReposicion {
  id_producto: string
  nombre: string
  sku: string | null
  stock_minimo: number
  disponibles: number
  severidad: 'sin_stock' | 'bajo_minimo'
}

export interface AlertaRotacionVencida {
  id_item: string
  qr_code: string
  id_producto: string
  producto_nombre: string
  producto_sku: string | null
  fecha_ingreso: string
  id_proveedor: string
  proveedor_nombre: string
  dias_rotacion: number
  dias_transcurridos: number
  dias_excedidos: number
}

/**
 * STOCK de deuda al día de hoy. No lleva período a propósito: lo que te deben
 * es un saldo, no un flujo.
 */
export interface CuentasPorCobrar {
  a_cobrar: number
  vence_este_mes: number
  vencido: number
  cuotas_pendientes: number
  cuotas_vencidas: number
  clientes_con_deuda: number
  planes_activos: number
}

// ─── Alertas ────────────────────────────────────────────────────────

/** Un cliente con cuotas vencidas. Una fila por persona, no por cuota. */
export interface AlertaCuotaVencida {
  id_cliente: string
  cliente_nombre: string
  cliente_telefono: string | null
  cuotas_vencidas: number
  monto_vencido: number
  vencimiento_mas_viejo: string
  dias_vencido: number
}

// ─── Finanzas Lectura Única (Slice 9 / 00072-00073) ──────────────────

export interface FinanzasResultadosRow {
  mes: string
  ventas_brutas: number
  anulaciones: number
  ventas_netas: number
  costo_mercaderia: number | null
  ganancia_sobre_ventas: number | null
  gastos: number
  comision_liquidada: number
  comision_pendiente_estimada: number
  ganancia_final: number | null
  porcentaje_ganancia: number | null
  cantidad_ventas: number
  ticket_promedio: number
}

export interface FinanzasFlujoRow {
  mes: string
  cobrado: number
  devuelto_clientes: number
  costo_procesamiento: number
  neto_cobros: number
  compras_mercaderia: number | null
  pagos_proveedores: number | null
  gastos: number
  flujo_neto: number | null
  por_acreditar: Record<string, number> | null
}

export interface FinanzasSerieMensualRow {
  mes: string
  ventas_netas: number
  ganancia_sobre_ventas: number | null
  ganancia_final: number | null
  cobrado_neto: number
}

export interface FinanzasPosicion {
  capital_propio: number | null
  mercaderia_terceros: number | null
  devueltos_clientes: number | null
  valor_venta_potencial: number
  productos_sin_precio: number
  por_cobrar: CuentasPorCobrar | null
  deuda_proveedores: number | null
}

export interface FinanzasRankingRow {
  id_producto: string
  nombre: string
  unidades_vendidas: number
  monto_vendido: number
  ganancia: number | null
  porcentaje_ventas: number | null
}

export interface FinanzasPresupuestoRow {
  id_categoria_gasto: string
  nombre: string
  gastado: number
  presupuesto_mensual: number
  consumido_pct: number
}

export interface FinanzasContextoPeriodo {
  hoy: string
  mes_desde: string
  mes_hasta: string
}

// ─── Reportes Revendedoras (Slice 9 / REQ-RV-DB-08) ─────────────────

export interface PerfilRevendedoraRow {
  id_revendedora: string
  nombre: string
  apellido: string
  telefono: string | null
  email: string | null
  estado: string
  piezas_en_poder: number
  valor_en_poder: number
  total_vendido: number
  comision_liquidada: number
  comision_estimada: number
  adeudado: number
  cantidad_ventas: number
  ticket_promedio: number
  piezas_entregadas_historico: number
  rotacion_pct: number
}

export interface CumplimientoObjetivosRow {
  id_revendedora: string
  nombre: string
  apellido: string
  vendido_periodo: number
  id_regla: string | null
  tramo_actual_desde: number
  porcentaje_actual: number
  proximo_tramo_desde: number | null
  proximo_porcentaje: number | null
  falta_para_proximo: number | null
}

export interface ResumenCanalRow {
  ventas_local_monto: number
  ventas_local_cant: number
  ventas_revendedora_monto: number
  ventas_revendedora_cant: number
  comision_revendedora_monto: number
  stock_central_cant: number
  stock_central_valor: number
  stock_revendedoras_cant: number
  stock_revendedoras_valor: number
}
