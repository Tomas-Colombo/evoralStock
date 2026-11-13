import 'server-only'
import { errorDeRpc } from '@/lib/dal/errors'
import { createServerClient } from '@/lib/dal/supabase'
import { ETIQUETA_CONFIG_DEFAULTS, PLANTILLAS_MAX, type ImpresoraTipo } from '@/lib/etiquetas/limites'
import type { SimbologiaId } from '@/lib/etiquetas/simbologias'

export interface EtiquetaConfig {
  metodo: SimbologiaId
  impresora_tipo: ImpresoraTipo
  margen_mm: number
  separacion_mm: number
  columnas: number | null
  offset_x_mm: number
  offset_y_mm: number
}

export interface EtiquetaPlantilla {
  id_plantilla: string
  id_tenant: string
  nombre: string
  ancho_mm: number
  alto_mm: number
  mostrar_nombre: boolean
  mostrar_talle: boolean
  mostrar_sku: boolean
  mostrar_texto_codigo: boolean
  predeterminada: boolean
  created_at: string
  updated_at: string
}

export interface SetEtiquetaConfigInput {
  metodo: SimbologiaId
  impresora_tipo: ImpresoraTipo
  margen_mm: number
  separacion_mm: number
  columnas: number | null
  offset_x_mm: number
  offset_y_mm: number
}

export interface CrearEtiquetaPlantillaInput {
  nombre: string
  ancho_mm: number
  alto_mm: number
  mostrar_nombre?: boolean
  mostrar_talle?: boolean
  mostrar_sku?: boolean
  mostrar_texto_codigo?: boolean
}

export interface EditarEtiquetaPlantillaInput {
  id: string
  nombre: string
  ancho_mm: number
  alto_mm: number
  mostrar_nombre?: boolean
  mostrar_talle?: boolean
  mostrar_sku?: boolean
  mostrar_texto_codigo?: boolean
}

/**
 * Obtiene la configuración de etiquetas del tenant actual.
 * Si no existe fila en `etiqueta_config`, devuelve los defaults definidos en `lib/etiquetas/limites`.
 */
export async function getEtiquetaConfig(): Promise<EtiquetaConfig> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('etiqueta_config')
    .select('metodo, impresora_tipo, margen_mm, separacion_mm, columnas, offset_x_mm, offset_y_mm')
    .maybeSingle()

  if (error || !data) {
    return {
      metodo: ETIQUETA_CONFIG_DEFAULTS.metodo,
      impresora_tipo: ETIQUETA_CONFIG_DEFAULTS.impresora_tipo,
      margen_mm: ETIQUETA_CONFIG_DEFAULTS.margen_mm,
      separacion_mm: ETIQUETA_CONFIG_DEFAULTS.separacion_mm,
      columnas: ETIQUETA_CONFIG_DEFAULTS.columnas,
      offset_x_mm: ETIQUETA_CONFIG_DEFAULTS.offset_x_mm,
      offset_y_mm: ETIQUETA_CONFIG_DEFAULTS.offset_y_mm,
    }
  }

  const row = data as Record<string, unknown>

  return {
    metodo: (row.metodo as SimbologiaId) ?? ETIQUETA_CONFIG_DEFAULTS.metodo,
    impresora_tipo: (row.impresora_tipo as ImpresoraTipo) ?? ETIQUETA_CONFIG_DEFAULTS.impresora_tipo,
    margen_mm: Number(row.margen_mm ?? ETIQUETA_CONFIG_DEFAULTS.margen_mm),
    separacion_mm: Number(row.separacion_mm ?? ETIQUETA_CONFIG_DEFAULTS.separacion_mm),
    columnas: row.columnas !== null && row.columnas !== undefined ? Number(row.columnas) : null,
    offset_x_mm: Number(row.offset_x_mm ?? ETIQUETA_CONFIG_DEFAULTS.offset_x_mm),
    offset_y_mm: Number(row.offset_y_mm ?? ETIQUETA_CONFIG_DEFAULTS.offset_y_mm),
  }
}

/**
 * Lista las plantillas de etiqueta del tenant actual, ordenada por predeterminada desc
 * y luego por nombre asc, con un tope de `PLANTILLAS_MAX`.
 */
export async function listEtiquetaPlantillas(): Promise<EtiquetaPlantilla[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('etiqueta_plantilla')
    .select(
      'id_plantilla, id_tenant, nombre, ancho_mm, alto_mm, mostrar_nombre, mostrar_talle, mostrar_sku, mostrar_texto_codigo, predeterminada, created_at, updated_at',
    )
    .order('predeterminada', { ascending: false })
    .order('nombre', { ascending: true })
    .limit(PLANTILLAS_MAX)

  if (error) {
    throw new Error(`listEtiquetaPlantillas: ${error.message}`)
  }

  const rows = (data ?? []) as Record<string, unknown>[]

  return rows.map((r) => ({
    id_plantilla: r.id_plantilla as string,
    id_tenant: r.id_tenant as string,
    nombre: r.nombre as string,
    ancho_mm: Number(r.ancho_mm),
    alto_mm: Number(r.alto_mm),
    mostrar_nombre: Boolean(r.mostrar_nombre),
    mostrar_talle: Boolean(r.mostrar_talle),
    mostrar_sku: Boolean(r.mostrar_sku),
    mostrar_texto_codigo: Boolean(r.mostrar_texto_codigo),
    predeterminada: Boolean(r.predeterminada),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }))
}

export async function spSetEtiquetaConfig(
  input: SetEtiquetaConfigInput,
  ip?: string | null,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_set_etiqueta_config', {
    p_metodo: input.metodo,
    p_impresora_tipo: input.impresora_tipo,
    p_margen_mm: input.margen_mm,
    p_separacion_mm: input.separacion_mm,
    p_columnas: input.columnas,
    p_offset_x_mm: input.offset_x_mm,
    p_offset_y_mm: input.offset_y_mm,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_set_etiqueta_config', error))
}

export async function spCrearEtiquetaPlantilla(
  input: CrearEtiquetaPlantillaInput,
  ip?: string | null,
): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_crear_etiqueta_plantilla', {
    p_nombre: input.nombre,
    p_ancho_mm: input.ancho_mm,
    p_alto_mm: input.alto_mm,
    p_mostrar_nombre: input.mostrar_nombre ?? true,
    p_mostrar_talle: input.mostrar_talle ?? true,
    p_mostrar_sku: input.mostrar_sku ?? true,
    p_mostrar_texto_codigo: input.mostrar_texto_codigo ?? true,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_crear_etiqueta_plantilla', error))
  return data as string
}

export async function spEditarEtiquetaPlantilla(
  input: EditarEtiquetaPlantillaInput,
  ip?: string | null,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_editar_etiqueta_plantilla', {
    p_id_plantilla: input.id,
    p_nombre: input.nombre,
    p_ancho_mm: input.ancho_mm,
    p_alto_mm: input.alto_mm,
    p_mostrar_nombre: input.mostrar_nombre ?? true,
    p_mostrar_talle: input.mostrar_talle ?? true,
    p_mostrar_sku: input.mostrar_sku ?? true,
    p_mostrar_texto_codigo: input.mostrar_texto_codigo ?? true,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_editar_etiqueta_plantilla', error))
}

export async function spMarcarEtiquetaPlantillaPredeterminada(
  idPlantilla: string,
  ip?: string | null,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_marcar_etiqueta_plantilla_predeterminada', {
    p_id_plantilla: idPlantilla,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_marcar_etiqueta_plantilla_predeterminada', error))
}

export async function spEliminarEtiquetaPlantilla(
  idPlantilla: string,
  ip?: string | null,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_eliminar_etiqueta_plantilla', {
    p_id_plantilla: idPlantilla,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_eliminar_etiqueta_plantilla', error))
}
