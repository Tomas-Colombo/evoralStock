import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type { CategoriaRow } from '@/lib/types/inventario'

/**
 * Listado de categorías del tenant actual. RLS filtra por tenant vía JWT.
 * Ordenadas por nombre ascendente. Incluye activas e inactivas — la UI
 * decide qué mostrar.
 */
export async function listCategorias(): Promise<CategoriaRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('categoria')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw new Error(`listCategorias: ${error.message}`)
  return (data ?? []) as CategoriaRow[]
}

/** Sólo activas — para dropdowns/SearchableSelect en formularios de alta. */
export async function listCategoriasActivas(): Promise<CategoriaRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('categoria')
    .select('*')
    .eq('activa', true)
    .order('nombre', { ascending: true })

  if (error) throw new Error(`listCategoriasActivas: ${error.message}`)
  return (data ?? []) as CategoriaRow[]
}

export async function getCategoria(id: string): Promise<CategoriaRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('categoria').select('*').eq('id_categoria', id).maybeSingle()
  if (error) throw new Error(`getCategoria: ${error.message}`)
  return (data ?? null) as CategoriaRow | null
}

/**
 * Alta directa (sin sp_ helper — la categoría es una entidad simple y no
 * requiere transición ni cambios historizados). RLS + `id_tenant` explícito
 * como belt-and-suspenders.
 */
export async function createCategoria(input: {
  tenantId: string
  nombre: string
  descripcion?: string | null
  talles?: string[]
  llevaPeso?: boolean
}): Promise<CategoriaRow> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('categoria')
    .insert({
      id_tenant: input.tenantId,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      talles: input.talles ?? [],
      lleva_peso: input.llevaPeso ?? false,
    })
    .select('*')
    .single()

  if (error) throw new Error(`createCategoria: ${error.message}`)
  return data as CategoriaRow
}

/** Update de metadatos de la categoría (nombre, descripción, talles, activa, lleva_peso). */
export async function updateCategoria(
  id: string,
  patch: {
    nombre?: string
    descripcion?: string | null
    talles?: string[]
    activa?: boolean
    lleva_peso?: boolean
  },
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('categoria').update(patch).eq('id_categoria', id)
  if (error) throw new Error(`updateCategoria: ${error.message}`)
}

export async function toggleCategoriaActiva(
  id: string,
  activa: boolean,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('categoria').update({ activa }).eq('id_categoria', id)
  if (error) throw new Error(`toggleCategoriaActiva: ${error.message}`)
}
