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

/**
 * Set original de evaluación (~40 preguntas) utilizado para calibración inicial.
 */
export const EVALUACION_AYUDA: readonly CasoEvaluacion[] = [
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
    esperada: 'inventario-ingresos-consignacion',
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

  // 35 a 40: 6 consultas fuera de dominio generales
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

/**
 * =========================================================================
 * SET DE CONTROL SEPARADO (≥15 de dominio sin mirar alias + ≥6 fuera de dominio cercanas)
 * =========================================================================
 * Preguntas de dominio redactadas SIN mirar los alias (otras palabras, otras pantallas).
 */
export const SET_CONTROL_DOMINIO: readonly CasoEvaluacion[] = [
  {
    pregunta: 'cómo convertir una reserva en venta para cobrar el saldo restante',
    esperada: 'ventas-reservas-convertir-venta',
  },
  {
    pregunta: 'cómo cancelar una reserva de productos para liberar el stock al salón',
    esperada: 'ventas-reservas-cancelar',
  },
  {
    pregunta: 'cómo marcar una cuota como incobrable cuando un cliente moroso no paga',
    esperada: 'ventas-cuotas-marcar-incobrable',
  },
  {
    pregunta: 'cómo editar los datos de contacto o dirección de un cliente registrado',
    esperada: 'ventas-clientes-editar',
  },
  {
    pregunta: 'cómo reponer stock de un producto agregando unidades por talle',
    esperada: 'inventario-producto-restock',
  },
  {
    pregunta: 'cómo crear una nueva categoría de productos en el catálogo',
    esperada: 'inventario-categorias-crear',
  },
  {
    pregunta: 'dónde consultar el listado de categorías de productos y sus talles',
    esperada: 'inventario-categorias-listado',
  },
  {
    pregunta: 'cómo importar un remito o factura en PDF para cargar un ingreso de mercadería',
    esperada: 'inventario-ingresos-importar-pdf',
  },
  {
    pregunta: 'cómo consultar la lista de proveedores registrados con sus contactos',
    esperada: 'proveedores-listado',
  },
  {
    pregunta: 'cómo consultar el perfil completo y compras históricas de un proveedor',
    esperada: 'proveedores-perfil',
  },
  {
    pregunta: 'cómo crear una nueva cuenta de cobro bancaria o billetera virtual',
    esperada: 'precios-cuentas-crear',
  },
  {
    pregunta: 'cómo agregar un nuevo plan de cuotas con recargo financiero',
    esperada: 'precios-cuotas-agregar-plan',
  },
  {
    pregunta: 'cómo revaluar productos en dólares con la nueva cotización oficial',
    esperada: 'precios-control-revaluar-usd',
  },
  {
    pregunta: 'dónde consultar el reporte de compras y costos por proveedor',
    esperada: 'reportes-proveedores',
  },
  {
    pregunta: 'dónde consultar el reporte de ventas y comisiones por revendedora',
    esperada: 'reportes-revendedoras',
  },
  {
    pregunta: 'cómo liquidar las ventas del período a una revendedora',
    esperada: 'revendedoras-liquidar',
  },
  {
    pregunta: 'cómo crear un nuevo rol con permisos personalizados para usuarios',
    esperada: 'administracion-roles-crear',
  },
  {
    pregunta: 'cómo consultar el registro de auditoría de acciones de los usuarios',
    esperada: 'administracion-auditoria-consultar',
  },
]

/**
 * Preguntas fuera de dominio CERCANAS al negocio comercial (sueldos, ARCA, ML, wifi, etc.)
 */
export const SET_CONTROL_FUERA_DOMINIO: readonly CasoEvaluacion[] = [
  {
    pregunta: 'cómo liquidar los sueldos de los empleados del local',
  },
  {
    pregunta: 'cómo hacer la declaración jurada en ARCA',
  },
  {
    pregunta: 'cómo publicar productos en Mercado Libre',
  },
  {
    pregunta: 'cuál es la contraseña del wifi del local',
  },
  {
    pregunta: 'cómo calcular el aguinaldo del personal de maestranza',
  },
  {
    pregunta: 'cómo tramitar un posnet para cobrar con tarjeta',
  },
  {
    pregunta: 'diseño y decoración para la vidriera del local',
  },
]

describe('Suite de Evaluación BM25 (REQ-AYUDA-V2-03 / 04 / 05)', () => {
  const todosLosPermisos = new Set<Permiso>(
    Object.entries(CATALOGO_PERMISOS).flatMap(([modulo, acciones]) =>
      acciones.map((accion) => `${modulo}.${accion}` as Permiso),
    ),
  )

  it('evalúa recall@5 del set original (34 casos de dominio)', () => {
    const casosDominio = EVALUACION_AYUDA.filter((c) => c.esperada !== undefined)
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
    console.log(`\n=== SET ORIGINAL ===`)
    console.log(`Casos de dominio: ${casosDominio.length}`)
    console.log(`Aciertos en top 5: ${aciertosTop5}`)
    console.log(`Recall@5 Original: ${(recall5 * 100).toFixed(1)}%`)

    if (fallos.length > 0) {
      console.log(`Fallos (${fallos.length}):`)
      for (const f of fallos) {
        console.log(`  - "${f.pregunta}" -> esperada: ${f.esperada}, obtenido: [${f.top5.join(', ')}]`)
      }
    }

    expect(recall5).toBeGreaterThanOrEqual(0.9)
  })

  it('evalúa set de control: recall@5 (18 casos) y discriminación fuera de dominio cercano (7 casos)', () => {
    // 1. In-domain control set
    let aciertosControl = 0
    const fallosControl: Array<{ pregunta: string; esperada: string; top5: string[]; scores: number[] }> = []
    const scoresControl: Array<{ pregunta: string; score: number }> = []

    for (const caso of SET_CONTROL_DOMINIO) {
      const resultados = buscarBM25(caso.pregunta, todosLosPermisos, { topK: 5 })
      const top5Ids = resultados.map((r) => r.entrada.id)
      const top5Scores = resultados.map((r) => r.score)

      const hallado = top5Ids.includes(caso.esperada!)
      if (hallado) {
        aciertosControl++
      } else {
        fallosControl.push({
          pregunta: caso.pregunta,
          esperada: caso.esperada!,
          top5: top5Ids,
          scores: top5Scores,
        })
      }

      const scoreEsperada = resultados.find((r) => r.entrada.id === caso.esperada!)?.score ?? 0
      scoresControl.push({ pregunta: caso.pregunta, score: scoreEsperada })
    }

    const recall5Control = aciertosControl / SET_CONTROL_DOMINIO.length
    console.log(`\n=== SET DE CONTROL ===`)
    console.log(`Casos de dominio: ${SET_CONTROL_DOMINIO.length}`)
    console.log(`Aciertos en top 5: ${aciertosControl}`)
    console.log(`Recall@5 Control: ${(recall5Control * 100).toFixed(1)}%`)
    const minScoreDominioControl = Math.min(...scoresControl.map(s => s.score))
    console.log(`Score mínimo entrada esperada (Control): ${minScoreDominioControl.toFixed(2)}`)

    if (fallosControl.length > 0) {
      console.log(`Fallos Control (${fallosControl.length}):`)
      for (const f of fallosControl) {
        console.log(`  - "${f.pregunta}" -> esperada: ${f.esperada}, obtenido: [${f.top5.join(', ')}]`)
      }
    }

    // 2. Out-of-domain control set (cercanas al negocio)
    let scoreMaxFueraDominio = 0
    const fueraDominioDetalle: Array<{ pregunta: string; scoreMax: number; entrada?: string }> = []

    const todasFueraDominio = [
      ...EVALUACION_AYUDA.filter((c) => c.esperada === undefined),
      ...SET_CONTROL_FUERA_DOMINIO,
    ]

    for (const caso of todasFueraDominio) {
      const resultados = buscarBM25(caso.pregunta, todosLosPermisos, { topK: 5 })
      const top1Score = resultados[0]?.score ?? 0
      if (top1Score > scoreMaxFueraDominio) {
        scoreMaxFueraDominio = top1Score
      }
      fueraDominioDetalle.push({
        pregunta: caso.pregunta,
        scoreMax: top1Score,
        entrada: resultados[0]?.entrada.id,
      })
    }

    console.log(`\n=== FUERA DE DOMINIO (${todasFueraDominio.length} casos) ===`)
    console.log(`Score máximo fuera de dominio: ${scoreMaxFueraDominio.toFixed(2)}`)
    for (const d of fueraDominioDetalle) {
      console.log(`  - "${d.pregunta}": score=${d.scoreMax.toFixed(2)} (${d.entrada ?? 'ninguna'})`)
    }

    console.log(`\nUmbral actual (UMBRAL_MINIMO_BM25): ${UMBRAL_MINIMO_BM25}`)

    // Verificaciones:
    // 1. Recall@5 en set de control >= 90%
    expect(
      recall5Control,
      `Recall@5 en set de control debe ser al menos 90% (actual: ${(recall5Control * 100).toFixed(1)}%)`,
    ).toBeGreaterThanOrEqual(0.9)

    // 2. Toda consulta fuera de dominio debe quedar estrictamente por debajo de UMBRAL_MINIMO_BM25
    expect(
      scoreMaxFueraDominio,
      `El score máximo fuera de dominio (${scoreMaxFueraDominio.toFixed(2)}) debe ser menor a UMBRAL_MINIMO_BM25 (${UMBRAL_MINIMO_BM25})`,
    ).toBeLessThan(UMBRAL_MINIMO_BM25)
  })
})
