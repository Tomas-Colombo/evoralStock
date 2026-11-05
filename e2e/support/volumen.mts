import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL || 'tomycolombo2009@gmail.com'
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD || ''

if (!SEED_PASSWORD) {
  console.error('Error: falta la variable de entorno SEED_ADMIN_PASSWORD.')
  process.exit(1)
}

async function main() {
  const targetArg = process.argv[2]
  const target = targetArg ? parseInt(targetArg, 10) : 20

  if (isNaN(target) || target <= 0) {
    console.error('Uso: node --env-file=.env.local --experimental-strip-types e2e/support/volumen.mts <target (ej: 20 o 200)>')
    process.exit(1)
  }

  console.log(`[volumen] Inicializando carga para volumen objetivo ~${target}...`)

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
  })

  if (authError || !authData.user) {
    throw new Error(`Error al autenticarse como usuario seed (${SEED_EMAIL}): ${authError?.message}`)
  }

  const { data: sessionCtx, error: ctxError } = await client.rpc('sp_session_context')
  if (ctxError || !sessionCtx?.ok) {
    throw new Error(`Error al obtener sp_session_context: ${ctxError?.message}`)
  }

  const tenantId = sessionCtx.tenant_id as string
  console.log(`[volumen] Autenticado como ${SEED_EMAIL} sobre tenant: ${tenantId}`)

  // Contadores actuales
  const countsBefore = await getEntityCounts(client, tenantId)
  console.log('[volumen] Estado actual:', countsBefore)

  // 1. Clientes
  if (countsBefore.clientes < target) {
    const needed = target - countsBefore.clientes
    console.log(`[volumen] Creando ${needed} clientes...`)
    for (let i = 0; i < needed; i++) {
      const idx = countsBefore.clientes + i + 1
      const { error } = await client.from('cliente').insert({
        id_tenant: tenantId,
        nombre: `Cliente ${idx}`,
        apellido: `Seed ${idx}`,
        activo: true,
        email: `cliente.volumen.${idx}.${Date.now()}@test.local`,
        telefono: `+549110000${String(idx).padStart(4, '0')}`,
      })
      if (error) console.error(`Error insert cliente ${idx}:`, error.message)
    }
  }

  // 2. Revendedoras (sp_crear_revendedora)
  if (countsBefore.revendedoras < target) {
    const needed = target - countsBefore.revendedoras
    console.log(`[volumen] Creando ${needed} revendedoras con sp_crear_revendedora...`)
    for (let i = 0; i < needed; i++) {
      const idx = countsBefore.revendedoras + i + 1
      const { error } = await client.rpc('sp_crear_revendedora', {
        p_nombre: `Revendedora`,
        p_apellido: `Seed ${idx}`,
        p_email: `revendedora.volumen.${idx}.${Date.now()}@test.local`,
        p_telefono: `+549111111${String(idx).padStart(4, '0')}`,
      })
      if (error) console.error(`Error sp_crear_revendedora ${idx}:`, error.message)
    }
  }

  // 3. Categorías disponibles para productos
  const { data: categorias } = await client
    .from('categoria')
    .select('id_categoria')
    .eq('id_tenant', tenantId)
    .limit(10)

  if (!categorias || categorias.length === 0) {
    throw new Error('No se encontraron categorías para el tenant')
  }

  // 4. Productos (sp_create_producto, sp_set_costo_producto, sp_crear_stock_directo)
  if (countsBefore.productos < target) {
    const needed = target - countsBefore.productos
    console.log(`[volumen] Creando ${needed} productos y su stock inicial...`)
    const newProdIds: string[] = []
    for (let i = 0; i < needed; i++) {
      const idx = countsBefore.productos + i + 1
      const catId = categorias[i % categorias.length].id_categoria

      const { data: prodId, error: prodErr } = await client.rpc('sp_create_producto', {
        p_id_categoria: catId,
        p_nombre: `Producto Volumen ${idx}`,
        p_stock_minimo: 2,
      })

      if (prodErr || !prodId) {
        console.error(`Error sp_create_producto ${idx}:`, prodErr?.message)
        continue
      }
      newProdIds.push(prodId)

      await client.rpc('sp_set_costo_producto', {
        p_id_producto: prodId,
        p_costo: 5000 + (idx % 10) * 500,
      })

      await client.rpc('sp_crear_stock_directo', {
        p_id_producto: prodId,
        p_costo: 5000 + (idx % 10) * 500,
        p_tipo_ingreso: 'compra',
        p_items: [
          { talle: 'M', cantidad: 3 },
          { talle: 'L', cantidad: 3 },
        ],
      })
    }

    if (newProdIds.length > 0) {
      await client.rpc('sp_recalcular_precios_batch', { p_ids: newProdIds })
    }
  }

  // Asegurar precios calculados para todos los productos existentes
  const { data: prodsSinPrecio } = await client
    .from('producto')
    .select('id_producto')
    .eq('id_tenant', tenantId)
    .is('precio_venta', null)

  if (prodsSinPrecio && prodsSinPrecio.length > 0) {
    console.log(`[volumen] Recalculando precios para ${prodsSinPrecio.length} productos...`)
    await client.rpc('sp_recalcular_precios_batch', {
      p_ids: prodsSinPrecio.map((p: { id_producto: string }) => p.id_producto),
    })
  }

  // 5. Ventas y Cuotas (sp_registrar_venta con financiación)
  if (countsBefore.ventas < target) {
    const needed = target - countsBefore.ventas
    console.log(`[volumen] Creando ${needed} ventas y cuotas con sp_registrar_venta...`)

    const { data: clientRows } = await client
      .from('cliente')
      .select('id_cliente')
      .eq('id_tenant', tenantId)
      .limit(target)

    if (!clientRows || clientRows.length === 0) {
      throw new Error('No hay clientes disponibles para asociar a las ventas')
    }

    // Buscar ítems disponibles con producto con precio
    const { data: itemsDisponibles } = await client
      .from('item_producto')
      .select('id_item, producto:producto!inner(precio_venta)')
      .eq('id_tenant', tenantId)
      .eq('estado_item', 'disponible')
      .gt('producto.precio_venta', 0)
      .limit(needed + 50)

    if (!itemsDisponibles || itemsDisponibles.length === 0) {
      console.warn('[volumen] Sin ítems disponibles con precio válido')
    } else {
      const itemsToUse = itemsDisponibles.slice(0, needed)
      for (let i = 0; i < itemsToUse.length; i++) {
        const idx = countsBefore.ventas + i + 1
        const cli = clientRows[i % clientRows.length]
        const idItem = itemsToUse[i].id_item

        const { error: ventaErr } = await client.rpc('sp_registrar_venta', {
          p_lineas: [{ id_item: idItem, ids_descuentos: [] }],
          p_forma_pago: 'efectivo',
          p_id_cliente: cli.id_cliente,
          p_financiacion: { cuotas: 1, primer_vencimiento: '2026-12-01' },
        })

        if (ventaErr) {
          console.error(`Error sp_registrar_venta ${idx}:`, ventaErr.message)
        }
      }
    }
  }

  const countsAfter = await getEntityCounts(client, tenantId)
  console.log('[volumen] Estado final tras carga objetivo ~' + target + ':', countsAfter)
}

async function getEntityCounts(client: SupabaseClient, tenantId: string) {
  const [p, c, r, v, q] = await Promise.all([
    client.from('producto').select('*', { count: 'exact', head: true }).eq('id_tenant', tenantId),
    client.from('cliente').select('*', { count: 'exact', head: true }).eq('id_tenant', tenantId),
    client.from('revendedora').select('*', { count: 'exact', head: true }).eq('id_tenant', tenantId),
    client.from('venta').select('*', { count: 'exact', head: true }).eq('id_tenant', tenantId),
    client.from('cuota_financiada').select('*', { count: 'exact', head: true }).eq('id_tenant', tenantId),
  ])

  return {
    productos: p.count ?? 0,
    clientes: c.count ?? 0,
    revendedoras: r.count ?? 0,
    ventas: v.count ?? 0,
    cuotas: q.count ?? 0,
  }
}

main().catch((err) => {
  console.error('[volumen] Error fatal:', err)
  process.exit(1)
})
