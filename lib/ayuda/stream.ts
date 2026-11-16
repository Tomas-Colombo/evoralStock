import type { EntradaGuia, EventoStreamAyuda } from './tipos'

const LIMITE_BUFFER_CITA = 80

enum EstadoParser {
  TEXTO = 'TEXTO',
  POSIBLE_APERTURA = 'POSIBLE_APERTURA',
  CITA = 'CITA',
}

/**
 * REQ-AYUDA-V2-08: TransformStream para parsing de streaming de texto del LLM.
 * - Detecta delimitadores [[id]] y los convierte en eventos estructurados de link { tipo: 'link', id, titulo, ruta }
 * - Valida el id contra las entradas autorizadas del turno; descarta si no existe
 * - Buffer de hasta 80 caracteres: si desborda sin cerrar ]], se emite como texto literal
 * - Delimitador [ suelto seguido de otro carácter se emite como texto en el acto
 * - En flush, vacía cualquier buffer pendiente como texto
 * - Expone los ids citados en orden de aparición sin deduplicar
 */
export class TransformStreamAyuda extends TransformStream<string, EventoStreamAyuda> {
  readonly idsCitados: string[]

  constructor(entradasAutorizadas: readonly EntradaGuia[]) {
    const idsCitados: string[] = []

    let estado = EstadoParser.TEXTO
    let bufferDelimitador = ''
    let textoAcumulado = ''

    super({
      transform(chunk: string, controller) {
        let i = 0
        while (i < chunk.length) {
          const char = chunk[i]

          switch (estado) {
            case EstadoParser.TEXTO: {
              if (char === '[') {
                if (textoAcumulado.length > 0) {
                  controller.enqueue({ tipo: 'texto', contenido: textoAcumulado })
                  textoAcumulado = ''
                }
                bufferDelimitador = '['
                estado = EstadoParser.POSIBLE_APERTURA
                i++
              } else {
                textoAcumulado += char
                i++
              }
              break
            }

            case EstadoParser.POSIBLE_APERTURA: {
              if (char === '[') {
                bufferDelimitador = '[['
                estado = EstadoParser.CITA
                i++
              } else {
                // [ suelto seguido de otra cosa: se emite como texto en el acto
                controller.enqueue({ tipo: 'texto', contenido: '[' })
                bufferDelimitador = ''
                estado = EstadoParser.TEXTO
                // El carácter actual se procesa en estado TEXTO sin avanzar i
              }
              break
            }

            case EstadoParser.CITA: {
              bufferDelimitador += char
              i++

              if (bufferDelimitador.endsWith(']]')) {
                const candidateId = bufferDelimitador.slice(2, -2).trim()
                const entrada = entradasAutorizadas.find((e) => e.id === candidateId)

                if (entrada) {
                  if (entrada.ruta) {
                    controller.enqueue({
                      tipo: 'link',
                      id: entrada.id,
                      titulo: entrada.titulo,
                      ruta: entrada.ruta,
                    })
                  } else {
                    controller.enqueue({
                      tipo: 'texto',
                      contenido: entrada.titulo,
                    })
                  }
                  idsCitados.push(entrada.id)
                }
                // Si la entrada es inválida, se descarta silenciosamente la cita

                bufferDelimitador = ''
                estado = EstadoParser.TEXTO
              } else if (bufferDelimitador.length > LIMITE_BUFFER_CITA) {
                // Tope de 80 caracteres superado sin cerrar: emitir como texto literal
                controller.enqueue({ tipo: 'texto', contenido: bufferDelimitador })
                bufferDelimitador = ''
                estado = EstadoParser.TEXTO
              }
              break
            }
          }
        }

        if (estado === EstadoParser.TEXTO && textoAcumulado.length > 0) {
          controller.enqueue({ tipo: 'texto', contenido: textoAcumulado })
          textoAcumulado = ''
        }
      },

      flush(controller) {
        if (estado === EstadoParser.TEXTO && textoAcumulado.length > 0) {
          controller.enqueue({ tipo: 'texto', contenido: textoAcumulado })
          textoAcumulado = ''
        } else if (estado === EstadoParser.POSIBLE_APERTURA) {
          controller.enqueue({ tipo: 'texto', contenido: bufferDelimitador })
          bufferDelimitador = ''
        } else if (estado === EstadoParser.CITA && bufferDelimitador.length > 0) {
          controller.enqueue({ tipo: 'texto', contenido: bufferDelimitador })
          bufferDelimitador = ''
        }
      },
    })

    this.idsCitados = idsCitados
  }
}

export function crearParserStream(entradasAutorizadas: readonly EntradaGuia[]): {
  stream: TransformStreamAyuda
  idsCitados: string[]
} {
  const parser = new TransformStreamAyuda(entradasAutorizadas)
  return {
    stream: parser,
    idsCitados: parser.idsCitados,
  }
}
