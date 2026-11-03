import type { Permiso } from '@/lib/types/administracion'
import { filtrarGuia } from './filtrar'
import { GUIA } from './guia'
import { armarPrompt } from './prompt'
import { resolverRespuesta } from './resolver'
import { salidaSchema } from './salida'
import type { MensajeHistorial, ModeloAyuda, ResultadoConsulta } from './tipos'

export interface ConsultarAyudaInput {
  pregunta: string
  historial: readonly MensajeHistorial[]
  focoId: string | null
  permisos: ReadonlySet<Permiso>
}

/**
 * Orquesta un turno de consulta de ayuda.
 * Usa GUIA filtrada por permisos. Si no hay opciones permitidas,
 * devuelve fuera_de_opciones sin invocar al modelo.
 * Realiza un máximo de 2 llamadas al modelo si la primera solicita detalle adicional.
 */
export async function consultarAyuda(
  input: ConsultarAyudaInput,
  modelo: ModeloAyuda,
): Promise<ResultadoConsulta> {
  const permitidas = filtrarGuia(GUIA, input.permisos)

  if (permitidas.length === 0) {
    return { resultado: 'fuera_de_opciones' }
  }

  const idsPermitidos = permitidas.map((e) => e.id) as [string, ...string[]]

  // Un focoId que no está entre las permitidas se trata como null
  const focoInicial = input.focoId
    ? permitidas.find((e) => e.id === input.focoId) ?? null
    : null

  const prompt1 = armarPrompt({
    entradas: permitidas,
    foco: focoInicial,
    historial: input.historial,
    pregunta: input.pregunta,
  })

  const respuesta1 = await modelo(prompt1, idsPermitidos)
  if (!respuesta1.ok) {
    return { resultado: 'error', error: respuesta1.error }
  }

  const parse1 = salidaSchema(idsPermitidos).safeParse(respuesta1.salida)
  if (!parse1.success) {
    return { resultado: 'error', error: 'formato' }
  }

  const salida1 = parse1.data

  // Si necesitaDetalle y entradaId ≠ foco, se hace UNA segunda llamada con esa entrada en foco
  if (
    salida1.necesitaDetalle &&
    salida1.entradaId !== null &&
    salida1.entradaId !== focoInicial?.id
  ) {
    const nuevoFoco = permitidas.find((e) => e.id === salida1.entradaId)
    if (nuevoFoco) {
      const prompt2 = armarPrompt({
        entradas: permitidas,
        foco: nuevoFoco,
        historial: input.historial,
        pregunta: input.pregunta,
      })

      const respuesta2 = await modelo(prompt2, idsPermitidos)
      if (respuesta2.ok) {
        const parse2 = salidaSchema(idsPermitidos).safeParse(respuesta2.salida)
        if (parse2.success) {
          // La segunda llamada fue exitosa; máximo 2 llamadas, no hay tercera (REQ-AYUDA-07 N1)
          return resolverRespuesta(permitidas, parse2.data)
        }
      }
      // Si la segunda llamada falla (red, timeout o formato), vale la primera respuesta (DR-AYUDA-6, REQ-AYUDA-07 N3)
    }
  }

  return resolverRespuesta(permitidas, salida1)
}
