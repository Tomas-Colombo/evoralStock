import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { capacidades } from '@/lib/modulos/capacidades'
import { bloquesVisibles } from '@/lib/reportes/bloques'
import { hasModuleAccess } from '@/lib/dal/guard'
import {
  getContextoPeriodo,
  getFlujo,
  getPosicion,
  getResultados,
  getSerieMensual,
  getGastosPresupuesto,
  getRankingProductos,
  getPerfilRevendedoras,
  getCumplimientoObjetivos,
  getResumenCanal,
} from '@/lib/dal/reportes'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { periodoAnterior } from '@/lib/fechas'
import { searchParamsReportesSchema } from '@/lib/validation/reportes'

import { resumenKpis } from '@/components/reportes/BloqueResumen'
import { BloqueGanancia } from '@/components/reportes/BloqueGanancia'
import { BloqueMovimientoPlata } from '@/components/reportes/BloqueMovimientoPlata'
import { GraficoTendencia } from '@/components/reportes/GraficoTendencia'
import { BloqueCobrar } from '@/components/reportes/BloqueCobrar'
import { BloqueError } from '@/components/reportes/BloqueError'
import { BloqueMercaderia } from '@/components/reportes/BloqueMercaderia'
import { BloqueProveedores } from '@/components/reportes/BloqueProveedores'
import { BloqueGastos } from '@/components/reportes/BloqueGastos'
import { BloqueRanking } from '@/components/reportes/BloqueRanking'
import { BloqueRevendedoras } from '@/components/reportes/BloqueRevendedoras'

async function tryFetch<T>(promise: Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const data = await promise
    return { ok: true, data }
  } catch {
    return { ok: false }
  }
}

export default async function ReportesPage(props: {
  searchParams: Promise<{ desde?: string; hasta?: string; limite?: string; orden?: string }>
}) {
  const session = await verifySession()
  const sp = await props.searchParams

  const contexto = await getContextoPeriodo()
  if (!contexto) throw new Error('No se pudo obtener el contexto del período')

  const parsed = searchParamsReportesSchema.safeParse(sp)
  
  const desde = parsed.success ? parsed.data.desde : contexto.mes_desde
  const hasta = parsed.success ? parsed.data.hasta : contexto.mes_hasta
  const prev = periodoAnterior(desde, hasta)
  const orden = parsed.success ? parsed.data.orden : 'ganancia'
  const limite = parsed.success ? parsed.data.limite : 5

  const puedeVerVentas = hasModuleAccess(session, 'ventas', 'ver')
  const puedeVerInventario = hasModuleAccess(session, 'inventario', 'ver')
  const puedeVerRevendedoras = hasModuleAccess(session, 'revendedoras', 'ver')
  const tieneGastos = session.modulosHabilitados.includes('gastos')
  const cap = capacidades(session.modulosHabilitados)
  const bloques = bloquesVisibles(session)
  const puedeVerProveedores = bloques.includes('proveedores')
  const idRevendedora = parsed.success ? parsed.data.id_revendedora : undefined

  // Las funciones rf_finanzas_* reciben fechas y tratan `hasta` como inclusivo:
  // se pasan tal cual. Sumarle un día (como en las consultas por timestamp)
  // metía el 1° del mes siguiente en el período y corría la serie mensual.
  const [
    resultadosReq, resultadosPrevReq,
    flujoReq, flujoPrevReq,
    posicionReq, serieReq,
    rankingReq, gastosReq,
    resumenCanalReq, perfilRevendedorasReq, objetivosReq,
  ] = await Promise.all([
    tryFetch(getResultados(desde, hasta)),
    tryFetch(getResultados(prev.desde, prev.hasta)),
    tryFetch(getFlujo(desde, hasta)),
    tryFetch(getFlujo(prev.desde, prev.hasta)),
    tryFetch(getPosicion()),
    tryFetch(getSerieMensual(hasta, 12)),
    tryFetch(getRankingProductos(desde, hasta, limite, orden)),
    tieneGastos ? tryFetch(getGastosPresupuesto(hasta)) : Promise.resolve({ ok: false as const }),
    puedeVerRevendedoras ? tryFetch(getResumenCanal(desde, hasta)) : Promise.resolve({ ok: false as const }),
    puedeVerRevendedoras ? tryFetch(getPerfilRevendedoras(desde, hasta, idRevendedora)) : Promise.resolve({ ok: false as const }),
    puedeVerRevendedoras ? tryFetch(getCumplimientoObjetivos(desde, hasta, idRevendedora)) : Promise.resolve({ ok: false as const }),
  ])

  return (
    <>
      <Topbar
        title="Tablero financiero"
        session={session}
        filters={
          <FiltroPeriodo
            basePath="/reportes"
            ariaLabel="Filtrar tablero por período"
            idPrefix="rp"
            desde={desde}
            hasta={hasta}
          />
        }
        kpis={
          puedeVerVentas && resultadosReq.ok && flujoReq.ok
            ? resumenKpis({
                resultados: resultadosReq.data!,
                resultadosPrev: resultadosPrevReq.ok ? resultadosPrevReq.data : null,
                flujo: flujoReq.data!,
                flujoPrev: flujoPrevReq.ok ? flujoPrevReq.data : null,
                posicion: posicionReq.ok ? posicionReq.data : null,
                tieneGastos,
              })
            : undefined
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        {puedeVerVentas && !(resultadosReq.ok && flujoReq.ok) && <BloqueError />}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {resultadosReq.ok ? (
            <BloqueGanancia resultados={resultadosReq.data!} tieneGastos={tieneGastos} />
          ) : (
            <BloqueError />
          )}

          {flujoReq.ok ? (
            <BloqueMovimientoPlata flujo={flujoReq.data!} tieneGastos={tieneGastos} tieneConsignacion={cap.consignacionProveedor} />
          ) : (
            <BloqueError />
          )}
        </div>

        {serieReq.ok ? (
          <GraficoTendencia serie={serieReq.data!} tieneGastos={tieneGastos} />
        ) : (
          <BloqueError />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {posicionReq.ok ? (
            <div className="md:col-span-1 xl:col-span-1">
              <BloqueCobrar porCobrar={posicionReq.data?.por_cobrar ?? null} puedeVerVentas={puedeVerVentas} />
            </div>
          ) : (
            <div className="md:col-span-1 xl:col-span-1">
              <BloqueError />
            </div>
          )}

          {puedeVerInventario && (
            posicionReq.ok ? (
              <div className="md:col-span-1 xl:col-span-1">
                <BloqueMercaderia posicion={posicionReq.data!} tieneConsignacion={cap.consignacionProveedor} />
              </div>
            ) : (
              <div className="md:col-span-1 xl:col-span-1">
                <BloqueError />
              </div>
            )
          )}

          {puedeVerProveedores && (
            posicionReq.ok ? (
              <div className="md:col-span-1 xl:col-span-1">
                <BloqueProveedores posicion={posicionReq.data!} />
              </div>
            ) : (
              <div className="md:col-span-1 xl:col-span-1">
                <BloqueError />
              </div>
            )
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {tieneGastos && (
            gastosReq.ok ? (
              <BloqueGastos presupuestos={gastosReq.data!} mesHasta={hasta} />
            ) : (
              <BloqueError />
            )
          )}
          
          {puedeVerInventario && (
            rankingReq.ok ? (
              <BloqueRanking ranking={rankingReq.data!} ordenActual={orden} />
            ) : (
              <BloqueError />
            )
          )}
        </div>

        {puedeVerRevendedoras && (
          resumenCanalReq.ok && perfilRevendedorasReq.ok && objetivosReq.ok ? (
            <BloqueRevendedoras
              resumenCanal={resumenCanalReq.data}
              perfiles={perfilRevendedorasReq.data}
              objetivos={objetivosReq.data}
              desde={desde}
              hasta={hasta}
            />
          ) : (
            <BloqueError />
          )
        )}
      </main>
    </>
  )
}


