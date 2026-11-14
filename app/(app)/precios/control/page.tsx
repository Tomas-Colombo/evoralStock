import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasModuleAccess, hasPermission } from '@/lib/dal/guard'
import { proyectarControlDePrecios } from '@/lib/precios/proyeccion'
import { listControlDePrecios } from '@/lib/dal/precios/resolucion'
import { countProductosCostoUsdVigentes } from '@/lib/dal/precios/cotizacion'
import { getReglaPrecio } from '@/lib/dal/precios/regla'
import { reglaIdSchema } from '@/lib/validation/precios'
import { ControlDePreciosView } from './ControlDePreciosView'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function ControlDePreciosPage(props: PageProps) {
  const [session, searchParams] = await Promise.all([
    verifySession(),
    props.searchParams,
  ])

  const canRevaluar = hasPermission(session, 'precios', 'editar_cotizacion')
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const puedeVerMargenes = hasModuleAccess(session, 'precios', 'ver_margenes')
  const puedeEditarPrecios = hasPermission(session, 'precios', 'editar')
  const puedeAplicar = puedeEditarPrecios && puedeVerCostos && puedeVerMargenes

  const rawRegla = typeof searchParams.regla === 'string' ? searchParams.regla : undefined
  const parsedRegla = rawRegla ? reglaIdSchema.safeParse({ idRegla: rawRegla }) : null
  const idReglaValido = parsedRegla?.success ? parsedRegla.data.idRegla : null

  const [rows, cantidadUsd, reglaObj] = await Promise.all([
    listControlDePrecios(),
    canRevaluar && puedeVerCostos
      ? countProductosCostoUsdVigentes(undefined, { puedeVerCostos })
      : Promise.resolve(null),
    idReglaValido && puedeVerMargenes
      ? getReglaPrecio(idReglaValido)
      : Promise.resolve(null),
  ])

  const proyectadas = proyectarControlDePrecios(rows, { puedeVerCostos, puedeVerMargenes })

  let initial = proyectadas
  let regla: { id: string; nombre: string } | undefined
  let aviso: string | undefined

  if (idReglaValido) {
    if (!puedeVerMargenes) {
      initial = []
      aviso = 'No tenés permiso para ver reglas de margen.'
    } else if (!reglaObj) {
      initial = []
      aviso = 'Esa regla ya no existe.'
    } else {
      initial = proyectadas.filter((r) => r.id_regla_margen_resuelta === idReglaValido)
      regla = { id: reglaObj.id_regla, nombre: reglaObj.nombre }
    }
  }

  return (
    <>
      <Topbar title="Control de precios" session={session} backHref="/precios" />
      <main className="flex-1 p-4 sm:p-6">
        <ControlDePreciosView
          key={idReglaValido ?? 'todos'}
          initial={initial}
          canRevaluar={canRevaluar}
          cantidadUsd={cantidadUsd}
          puedeVerCostos={puedeVerCostos}
          puedeVerMargenes={puedeVerMargenes}
          puedeAplicar={puedeAplicar}
          regla={regla}
          aviso={aviso}
        />
      </main>
    </>
  )
}
