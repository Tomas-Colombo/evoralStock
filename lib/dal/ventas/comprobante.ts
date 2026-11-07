import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type { TipoComprobante } from '@/lib/types/ventas'
import { extraerSlugRpc } from '@/lib/dal/ventas/venta'

export async function spEmitirComprobante(input: {
  idVenta: string
  tipo: TipoComprobante
  numero: string
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_emitir_comprobante', {
    p_id_venta: input.idVenta,
    p_tipo: input.tipo,
    p_numero: input.numero,
  })
  if (error) throw new Error(extraerSlugRpc(error))
  return data as string
}
