import type { EntradaGuia, ResultadoConsulta } from './tipos'
import type { SalidaModelo } from './salida'

/**
 * Resuelve el resultado final de la consulta.
 * Si entradaId es null (o no se encuentra en las entradas permitidas),
 * devuelve `fuera_de_opciones` y descarta el texto del modelo.
 * La ruta proviene siempre de la guía, nunca del texto devuelto por el modelo.
 */
export function resolverRespuesta(
  entradas: readonly EntradaGuia[],
  salida: SalidaModelo,
): ResultadoConsulta {
  if (salida.entradaId === null) {
    return { resultado: 'fuera_de_opciones' }
  }

  const entrada = entradas.find((e) => e.id === salida.entradaId)
  if (!entrada) {
    return { resultado: 'fuera_de_opciones' }
  }

  return {
    resultado: 'respondida',
    texto: salida.respuesta,
    entrada: {
      id: entrada.id,
      titulo: entrada.titulo,
      ...(entrada.ruta ? { ruta: entrada.ruta } : {}),
    },
  }
}
