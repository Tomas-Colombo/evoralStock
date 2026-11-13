import { describe, expect, test } from 'vitest'
import { hasTestDb, runPsql } from './_helpers'

/**
 * Suite de arquitectura para hacer cumplir la regla de tablas satélites de costo (Fase 3E.4 / REQ-CPC).
 *
 * Invariante arquitectónico:
 * Una columna de costo de mercadería, margen o monto a proveedor vive SOLO en una tabla
 * satélite (item_costo, detalle_venta_costo, detalle_venta_rendicion, devolucion_venta_costo,
 * ingreso_detalle_costo) o en costo_producto, con policy restrictiva de SELECT por permiso.
 */
describe.skipIf(!hasTestDb)('Regla de satélites de costo (Fase 3E.4 / REQ-CPC)', () => {
  /**
   * Tablas de costo permitidas explícitamente.
   * Deben tener policy restrictiva de SELECT.
   */
  const TABLAS_COSTO_PERMITIDAS = [
    'costo_producto',          // Catálogo de costos vigentes e históricos por producto
    'item_costo',              // Satélite de costo de adquisición individual por ítem (00156)
    'detalle_venta_costo',     // Satélite de snapshot de costo y ganancia por línea de venta (00156)
    'detalle_venta_rendicion', // Satélite de monto a rendir al proveedor por línea en consignación (00156)
    'devolucion_venta_costo',  // Satélite de costo recuperado por devolución (00156)
    'ingreso_detalle_costo',   // Satélite de costo unitario y cotización en remito de ingreso (00157)
  ]

  /**
   * Tablas legítimas del sistema que contienen columnas con patrón de nombre de costo,
   * pero que NO corresponden a costo de mercadería ni margen ni rendición a proveedor.
   */
  const TABLAS_LEGITIMAS_NO_COSTO: Record<string, string> = {
    pago_venta: 'costo_cobro: retención y arancel financiero bancario percibido al cobrar (00057, D-CPC-04)',
  }

  const TODAS_LAS_PERMITIDAS = [
    ...TABLAS_COSTO_PERMITIDAS,
    ...Object.keys(TABLAS_LEGITIMAS_NO_COSTO),
  ]

  test('1. Columnas de costo solo aparecen en tablas permitidas explícitas', () => {
    // Consultar information_schema.columns para tablas base de public
    const query = "select json_agg(t) from (select c.table_name, c.column_name from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and (c.column_name like 'costo%' or c.column_name = 'monto_proveedor' or c.column_name = 'monto_ganancia' or c.column_name = 'costo_recuperado' or c.column_name = 'costo_original_usd' or c.column_name = 'cotizacion_aplicada' or c.column_name = 'cotizacion_fecha_valor') order by c.table_name, c.column_name) t;"
    const output = runPsql(query)
    const matches = JSON.parse(output || '[]') as Array<{ table_name: string; column_name: string }>

    expect(matches.length).toBeGreaterThan(0)

    for (const match of matches) {
      expect(
        TODAS_LAS_PERMITIDAS,
        `Columna de costo '${match.column_name}' encontrada en tabla no permitida '${match.table_name}'`
      ).toContain(match.table_name)
    }

    // Verificar que las tablas legítimas no-costo solo contengan sus columnas esperadas documentadas
    const colsEnPagoVenta = matches.filter((m) => m.table_name === 'pago_venta').map((m) => m.column_name)
    expect(colsEnPagoVenta).toEqual(['costo_cobro'])
  })

  test('2. Cada tabla de costo tiene una policy restrictiva de SELECT por permiso', () => {
    const query = "select json_agg(t) from (select tablename, policyname, permissive, cmd, qual from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE' and (cmd = 'SELECT' or cmd = 'ALL')) t;"
    const output = runPsql(query)
    const policies = JSON.parse(output || '[]') as Array<{
      tablename: string
      policyname: string
      permissive: string
      cmd: string
      qual: string
    }>

    for (const tabla of TABLAS_COSTO_PERMITIDAS) {
      const pols = policies.filter(
        (p) => p.tablename === tabla && (p.cmd === 'SELECT' || p.cmd === 'ALL')
      )
      // Debe existir al menos una policy restrictiva de SELECT que chequee permisos con auth_tiene_permiso
      const hasRlspSelect = pols.some(
        (p) => p.cmd === 'SELECT' && p.qual && p.qual.includes('auth_tiene_permiso')
      )
      expect(
        hasRlspSelect,
        `La tabla de costo '${tabla}' no tiene policy RESTRICTIVE de SELECT que evalúe permisos en pg_policies`
      ).toBe(true)
    }
  })
})
