import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PORT = process.env.PORT || '3000'
const BASE_URL = `http://utopia-local.localhost:${PORT}`

async function main() {
  console.log('[recorrido] Iniciando recorrido de pantallas Fase 2...')

  // Obtener IDs de prueba de la base para detalle
  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: tenant } = await db.from('tenant').select('id_tenant').eq('subdominio', 'utopia-local').single()
  const tenantId = tenant?.id_tenant

  const { data: venta } = await db.from('venta').select('id_venta').eq('id_tenant', tenantId).limit(1).maybeSingle()
  const { data: revendedora } = await db.from('revendedora').select('id_revendedora').eq('id_tenant', tenantId).limit(1).maybeSingle()

  const idVenta = venta?.id_venta
  const idRevendedora = revendedora?.id_revendedora

  console.log('[recorrido] IDs para detalle:', { idVenta, idRevendedora })

  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({ baseURL: BASE_URL })
    const page = await context.newPage()

    console.log('[recorrido] 1. Login como Admin...')
    await page.goto('/login')
    await page.getByLabel('Correo electrónico').fill('tomycolombo2009@gmail.com')
    await page.getByLabel('Contraseña').fill('Admin123!')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await page.waitForURL('**/ventas')
    console.log('[recorrido] Login admin exitoso.')

    const routes = [
      { name: 'inicio', path: '/' },
      { name: 'inventario', path: '/inventario' },
      { name: 'productos', path: '/inventario/productos' },
      { name: 'precios', path: '/precios' },
      { name: 'ventas (lista)', path: '/ventas' },
      ...(idVenta ? [{ name: 'ventas (detalle)', path: `/ventas/${idVenta}` }] : []),
      { name: 'reservas', path: '/ventas/reservas' },
      { name: 'clientes', path: '/clientes' },
      { name: 'cuotas', path: '/cuotas' },
      { name: 'consignaciones', path: '/consignaciones' },
      { name: 'rendiciones', path: '/rendiciones' },
      { name: 'revendedoras (lista)', path: '/revendedoras' },
      ...(idRevendedora ? [{ name: 'revendedoras (detalle)', path: `/revendedoras/${idRevendedora}` }] : []),
      { name: 'gastos', path: '/gastos' },
      { name: 'reportes', path: '/reportes' },
      { name: 'administracion', path: '/administracion' },
    ]

    for (const r of routes) {
      console.log(`[recorrido] Navegando a ${r.name} (${r.path})...`)
      try {
        await page.goto(r.path, { waitUntil: 'networkidle', timeout: 30000 })
      } catch (err: unknown) {
        console.warn(`[recorrido] Advertencia en ${r.name}:`, err instanceof Error ? err.message : String(err))
      }
    }

    await context.close()

    // Plataforma con Superadmin
    console.log('[recorrido] 2. Login como Superadmin para plataforma...')
    const saContext = await browser.newContext({ baseURL: `http://localhost:${PORT}` })
    const saPage = await saContext.newPage()
    try {
      await saPage.goto('/login')
      await saPage.getByLabel('Correo electrónico').fill('superadmin@utopia.test')
      await saPage.getByLabel('Contraseña').fill('Admin123!')
      await saPage.getByRole('button', { name: 'Ingresar' }).click()
      await saPage.waitForURL('**/plataforma', { timeout: 15000 })
      console.log('[recorrido] Navegando a plataforma...')
      await saPage.goto('/plataforma', { waitUntil: 'networkidle', timeout: 30000 })
    } catch (err: unknown) {
      console.warn('[recorrido] Error en plataforma:', err instanceof Error ? err.message : String(err))
    } finally {
      await saContext.close()
    }

    // Portal mi-cuenta
    console.log('[recorrido] 3. Verificando portal mi-cuenta...')
    const mcContext = await browser.newContext({ baseURL: BASE_URL })
    const mcPage = await mcContext.newPage()
    try {
      await mcPage.goto('/mi-cuenta', { waitUntil: 'networkidle', timeout: 15000 })
    } catch (err: unknown) {
      console.warn('[recorrido] mi-cuenta:', err instanceof Error ? err.message : String(err))
    } finally {
      await mcContext.close()
    }

    console.log('[recorrido] Recorrido completado exitosamente.')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('[recorrido] Error fatal:', err)
  process.exit(1)
})
