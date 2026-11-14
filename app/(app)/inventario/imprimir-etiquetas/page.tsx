import { Topbar } from '@/components/shell/Topbar'
import {
  getEtiquetaConfig,
  listEtiquetaPlantillas,
  type EtiquetaPlantilla,
} from '@/lib/dal/etiquetas/etiquetas'
import { verifySession } from '@/lib/dal/session'
import {
  ETIQUETAS_MAX,
  listItemsParaEtiquetas,
  listItemsParaEtiquetasPorOrigen,
} from '@/lib/dal/inventario/item'
import {
  buildEtiquetasIngresoHref,
  buildEtiquetasProductoHref,
  calcularPaginacionTanda,
  parsearParamsEtiquetas,
} from '@/lib/inventario/etiquetas'
import { ImprimirEtiquetasClient } from './ImprimirEtiquetasClient'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PLANTILLA_FALLBACK: EtiquetaPlantilla = {
  id_plantilla: '00000000-0000-0000-0000-000000000000',
  id_tenant: '',
  nombre: 'Predeterminada',
  ancho_mm: 50,
  alto_mm: 30,
  mostrar_nombre: true,
  mostrar_talle: true,
  mostrar_sku: false,
  mostrar_texto_codigo: false,
  predeterminada: true,
  created_at: '',
  updated_at: '',
}

/**
 * Hoja de etiquetas para imprimir, armada desde:
 * 1. Un ingreso: `?ingreso=<uuid>&tanda=<n>`
 * 2. Un producto (opcionalmente de un talle): `?producto=<uuid>&talle=<talle|__sin__>&incluir_reservados=1&tanda=<n>`
 * 3. Lista puntual de QRs: `?qrs=a,b,c`
 *
 * El permiso lo resuelve `app/(app)/inventario/layout.tsx`, que exige
 * `inventario:ver` antes de renderizar cualquier página del módulo.
 */
export default async function ImprimirEtiquetasPage(props: {
  searchParams: Promise<{
    qrs?: string
    ingreso?: string
    producto?: string
    talle?: string
    incluir_reservados?: string
    tanda?: string
    plantilla?: string
  }>
}) {
  const session = await verifySession()
  const rawParams = await props.searchParams
  const origen = parsearParamsEtiquetas(rawParams)

  if (origen.tipo === 'vacio') {
    return (
      <>
        <Topbar title="Imprimir etiquetas" session={session} backHref="/inventario" />
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
            <p className="font-display text-lg mb-2">No hay códigos para imprimir</p>
            <p className="text-sm text-muted">
              Entrá desde un ingreso o la ficha de un producto/ítem y usá el botón de imprimir etiquetas.
            </p>
          </div>
        </main>
      </>
    )
  }

  if (origen.tipo === 'invalido') {
    return (
      <>
        <Topbar title="Imprimir etiquetas" session={session} backHref="/inventario" />
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
            <p className="font-display text-lg mb-2 text-danger">Parámetros inválidos</p>
            <p className="text-sm text-muted">
              Verificá el enlace de impresión o volvé a entrar desde la ficha o el ingreso.
            </p>
          </div>
        </main>
      </>
    )
  }

  const [config, plantillas] = await Promise.all([
    getEtiquetaConfig(),
    listEtiquetaPlantillas(),
  ])

  const predeterminada =
    plantillas.find((p) => p.predeterminada) ?? plantillas[0] ?? PLANTILLA_FALLBACK

  let plantillaSeleccionada = predeterminada
  if (rawParams.plantilla && UUID_RE.test(rawParams.plantilla)) {
    const encontrada = plantillas.find((p) => p.id_plantilla === rawParams.plantilla)
    if (encontrada) {
      plantillaSeleccionada = encontrada
    }
  }

  if (origen.tipo === 'qrs') {
    const items = await listItemsParaEtiquetas(origen.aBuscar)

    const encontrados = new Set(items.map((i) => i.qr_code))
    const noEncontrados = origen.aBuscar.filter((qr) => !encontrados.has(qr))

    return (
      <>
        <Topbar title="Imprimir etiquetas" session={session} backHref="/inventario" />
        <ImprimirEtiquetasClient
          items={items}
          plantillas={plantillas.length > 0 ? plantillas : [plantillaSeleccionada]}
          plantillaSeleccionada={plantillaSeleccionada}
          config={config}
          noEncontrados={noEncontrados}
          recortadoEn={origen.recortado ? ETIQUETAS_MAX : null}
        />
      </>
    )
  }

  // Origen por ingreso o producto con paginación de tanda
  const { items, total } = await listItemsParaEtiquetasPorOrigen(origen)

  const paginacion = calcularPaginacionTanda(total, origen.tanda)

  let anteriorHref: string | null = null
  let siguienteHref: string | null = null

  if (paginacion.tieneAnterior) {
    anteriorHref =
      origen.tipo === 'ingreso'
        ? buildEtiquetasIngresoHref(origen.idIngreso, paginacion.tandaActual - 1)
        : buildEtiquetasProductoHref({
            idProducto: origen.idProducto,
            talle: origen.talle,
            incluirReservados: origen.incluirReservados,
            tanda: paginacion.tandaActual - 1,
          })
    if (rawParams.plantilla && UUID_RE.test(rawParams.plantilla)) {
      anteriorHref += `&plantilla=${encodeURIComponent(rawParams.plantilla)}`
    }
  }

  if (paginacion.tieneSiguiente) {
    siguienteHref =
      origen.tipo === 'ingreso'
        ? buildEtiquetasIngresoHref(origen.idIngreso, paginacion.tandaActual + 1)
        : buildEtiquetasProductoHref({
            idProducto: origen.idProducto,
            talle: origen.talle,
            incluirReservados: origen.incluirReservados,
            tanda: paginacion.tandaActual + 1,
          })
    if (rawParams.plantilla && UUID_RE.test(rawParams.plantilla)) {
      siguienteHref += `&plantilla=${encodeURIComponent(rawParams.plantilla)}`
    }
  }

  return (
    <>
      <Topbar title="Imprimir etiquetas" session={session} backHref="/inventario" />
      <ImprimirEtiquetasClient
        items={items}
        plantillas={plantillas.length > 0 ? plantillas : [plantillaSeleccionada]}
        plantillaSeleccionada={plantillaSeleccionada}
        config={config}
        noEncontrados={[]}
        recortadoEn={null}
        paginacion={{
          tandaActual: paginacion.tandaActual,
          totalTandas: paginacion.totalTandas,
          totalItems: total,
          anteriorHref,
          siguienteHref,
        }}
      />
    </>
  )
}
