import { describe, expect, it } from 'vitest'
import { buscarBM25, UMBRAL_MINIMO_BM25 } from './bm25'
import type { Permiso } from '@/lib/types/administracion'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'

interface CasoEvaluacion {
  pregunta: string
  esperada?: string // undefined para consultas fuera de dominio
  citasPrevias?: readonly string[]
  esMultiTurno?: boolean
}

const EVALUACION_AYUDA: readonly CasoEvaluacion[] = [
  // 1 & 2: Dos consultas con negación
  {
    pregunta: 'no me deja anular una venta de ayer',
    esperada: 'ventas-anular-venta',
  },
  {
    pregunta: 'no puedo cobrar con tarjeta sin recargo',
    esperada: 'ventas-registrar-venta',
  },

  // 3 & 4: Dos consultas multi-turno
  {
    pregunta: '¿y como le saco la factura fiscal?',
    esperada: 'ventas-emitir-comprobante',
    citasPrevias: ['ventas-registrar-venta'],
    esMultiTurno: true,
  },
  {
    pregunta: '¿donde le imprimo los codigos de barra adhesivos?',
    esperada: 'inventario-etiquetas-imprimir',
    citasPrevias: ['inventario-producto-crear'],
    esMultiTurno: true,
  },

  // 5 a 34: 30 consultas de dominio con lenguaje coloquial, sinónimos y faltas de ortografía
  {
    pregunta: 'pasar una compra por mostrador',
    esperada: 'ventas-registrar-venta',
  },
  {
    pregunta: 'hacerle el ticket a un cliente que pago efectivo',
    esperada: 'ventas-emitir-comprobante',
  },
  {
    pregunta: 'vino una clienta a cambiar un talle de remera',
    esperada: 'ventas-cambiar-producto',
  },
  {
    pregunta: 'devolverle la plata a un cliente que trajo la prenda fallada',
    esperada: 'ventas-devolver-producto',
  },
  {
    pregunta: 'donde me fijo los que deben cuotas fiadas',
    esperada: 'ventas-cuotas-listado',
  },
  {
    pregunta: 'asentar el cobro de la cuota de un cliente',
    esperada: 'ventas-cuotas-cobrar',
  },
  {
    pregunta: 'apartar un pantalon con una seña',
    esperada: 'ventas-reservas-crear',
  },
  {
    pregunta: 'limpiar las señas que vencieron y no vinieron a buscar',
    esperada: 'ventas-reservas-purgar-vencidas',
  },
  {
    pregunta: 'donde busco el celu o whatsapp de un comprador',
    esperada: 'ventas-clientes-listado',
  },
  {
    pregunta: 'cargar un cliente nuevo que vino a comprar',
    esperada: 'ventas-clientes-crear',
  },
  {
    pregunta: 'ver todo el historial de operaciones de este mes',
    esperada: 'ventas-listado',
  },
  {
    pregunta: 'dar de alta una remera o vestido nuevo',
    esperada: 'inventario-producto-crear',
  },
  {
    pregunta: 'hacer recuento fisico porque no me coincide el stock',
    esperada: 'inventario-ficha-ajuste-inventario',
  },
  {
    pregunta: 'marcar una prenda como fallada o rota para sacarla de venta',
    esperada: 'inventario-ficha-transicionar-item',
  },
  {
    pregunta: 'donde cargo los datos del mayorista que nos provee ropa',
    esperada: 'proveedores-crear',
  },
  {
    pregunta: 'entró una caja de mercaderia que mando el taller',
    esperada: 'inventario-ingresos-crear',
  },
  {
    pregunta: 'ver todas las prendas que tenemos cargadas',
    esperada: 'inventario-listado',
  },
  {
    pregunta: 'subir un diez por ciento todos los precios de golpe',
    esperada: 'precios-reglas-crear',
  },
  {
    pregunta: 'cambiar el valor del dolar blue para actualizar las listas',
    esperada: 'precios-cotizacion-editar',
  },
  {
    pregunta: 'pegarle stickers con precio a las prendas del perchero',
    esperada: 'inventario-etiquetas-imprimir',
  },
  {
    pregunta: 'pagamos la boleta de edenor y el alquiler del local',
    esperada: 'gastos-registrar',
  },
  {
    pregunta: 'donde veo todas las salidas de plata del mes',
    esperada: 'gastos-listado',
  },
  {
    pregunta: 'crear un rubro nuevo para servicios e impuestos',
    esperada: 'gastos-categorias-crear',
  },
  {
    pregunta: 'panel con las metricas de facturacion y totales',
    esperada: 'reportes-tablero-general',
  },
  {
    pregunta: 'cuales son las remeras mas vendidas de la semana',
    esperada: 'reportes-ranking-productos',
  },
  {
    pregunta: 'recibir ropa a porcentaje de una diseñadora',
    esperada: 'consignaciones-nueva',
  },
  {
    pregunta: 'rendir cuentas y pagarle a la dueña del lote en consignacion',
    esperada: 'rendiciones-generar',
  },
  {
    pregunta: 'dar de alta una chica que vende por catalogo',
    esperada: 'revendedoras-crear',
  },
  {
    pregunta: 'entregarle prendas a una revendedora para que salga a vender',
    esperada: 'revendedoras-consignar-prendas',
  },
  {
    pregunta: 'agregar una cuenta para la empleada nueva del turno tarde',
    esperada: 'administracion-usuarios-invitar',
  },

  // 35 a 40: 6 consultas fuera de dominio
  {
    pregunta: 'cómo cocinar una pizza napolitana en horno de barro',
  },
  {
    pregunta: 'receta casera para hacer torta de chocolate esponjosa',
  },
  {
    pregunta: 'quién fue la figura de la final del mundial de qatar',
  },
  {
    pregunta: 'cómo cambiar la rueda pinchada de un auto en la ruta',
  },
  {
    pregunta: 'pronóstico del clima y temperatura para el fin de semana',
  },
  {
    pregunta: 'tutorial para aprender a programar en python desde cero',
  },
]

describe('Suite de Evaluación BM25 (REQ-AYUDA-V2-03 / 04 / 05)', () => {
  const todosLosPermisos = new Set<Permiso>(
    Object.entries(CATALOGO_PERMISOS).flatMap(([modulo, acciones]) =>
      acciones.map((accion) => `${modulo}.${accion}` as Permiso),
    ),
  )

  it('evalúa recall@5 y comportamiento de fuera de dominio', () => {
    const casosDominio = EVALUACION_AYUDA.filter((c) => c.esperada !== undefined)
    const casosFueraDominio = EVALUACION_AYUDA.filter((c) => c.esperada === undefined)

    expect(EVALUACION_AYUDA.length).toBe(40)
    expect(casosDominio.length).toBe(34)
    expect(casosFueraDominio.length).toBe(6)

    let aciertosTop5 = 0
    const fallos: Array<{ pregunta: string; esperada: string; top5: string[]; scores: number[] }> = []

    for (const caso of casosDominio) {
      const resultados = buscarBM25(caso.pregunta, todosLosPermisos, {
        citasPrevias: caso.citasPrevias,
        topK: 5,
      })

      const top5Ids = resultados.map((r) => r.entrada.id)
      const top5Scores = resultados.map((r) => r.score)

      if (top5Ids.includes(caso.esperada!)) {
        aciertosTop5++
      } else {
        fallos.push({
          pregunta: caso.pregunta,
          esperada: caso.esperada!,
          top5: top5Ids,
          scores: top5Scores,
        })
      }
    }

    const recall5 = aciertosTop5 / casosDominio.length
    console.log(`\n=== RESULTADOS EVALUACIÓN BM25 ===`)
    console.log(`Casos de dominio: ${casosDominio.length}`)
    console.log(`Aciertos en top 5: ${aciertosTop5}`)
    console.log(`Recall@5: ${(recall5 * 100).toFixed(1)}%`)

    // Log in-domain top 1 scores
    const inDomainTopScores = casosDominio.map(c => {
      const res = buscarBM25(c.pregunta, todosLosPermisos, { citasPrevias: c.citasPrevias, topK: 1 })
      return { pregunta: c.pregunta, score: res[0]?.score ?? 0 }
    })
    const minInDomain = Math.min(...inDomainTopScores.map(s => s.score))
    console.log(`Min in-domain top score: ${minInDomain.toFixed(2)}`)
    inDomainTopScores.sort((a, b) => a.score - b.score)
    console.log('Lowest 5 in-domain scores:', inDomainTopScores.slice(0, 5))

    if (fallos.length > 0) {
      console.log(`Fallos (${fallos.length}):`)
      for (const f of fallos) {
        console.log(`  - "${f.pregunta}" -> esperada: ${f.esperada}, obtenido: [${f.top5.join(', ')}]`)
      }
    }

    // Evaluación fuera de dominio
    let fueraDominioSuperanUmbral = 0
    const fueraDominioDetalle: Array<{ pregunta: string; scoreMax: number; entrada: string }> = []

    for (const caso of casosFueraDominio) {
      const resultados = buscarBM25(caso.pregunta, todosLosPermisos, { topK: 5 })
      const maxScore = resultados[0]?.score ?? 0

      if (maxScore >= UMBRAL_MINIMO_BM25) {
        fueraDominioSuperanUmbral++
        fueraDominioDetalle.push({
          pregunta: caso.pregunta,
          scoreMax: maxScore,
          entrada: resultados[0].entrada.id,
        })
      }
    }

    console.log(`Casos fuera de dominio: ${casosFueraDominio.length}`)
    console.log(`Fuera de dominio que superan umbral (${UMBRAL_MINIMO_BM25}): ${fueraDominioSuperanUmbral}`)
    if (fueraDominioDetalle.length > 0) {
      for (const d of fueraDominioDetalle) {
        console.log(`  - "${d.pregunta}" superó con score ${d.scoreMax.toFixed(2)} (${d.entrada})`)
      }
    }

    // Requisitos mínimos de la spec:
    // 1. recall@5 >= 90% para casos de dominio
    expect(
      recall5,
      `Recall@5 debe ser al menos 90% (actual: ${(recall5 * 100).toFixed(1)}%)`,
    ).toBeGreaterThanOrEqual(0.9)

    // 2. Las consultas fuera de dominio deben quedar bajo el umbral (0 deben superarlo)
    expect(
      fueraDominioSuperanUmbral,
      `Consultas fuera de dominio superaron el umbral: ${JSON.stringify(fueraDominioDetalle)}`,
    ).toBe(0)
  })
})
