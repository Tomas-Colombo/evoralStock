import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { Button } from '@/components/ui/Button'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { proyectarIngresosConResumen } from '@/lib/inventario/proyeccion-costos'
import { INGRESOS_PAGE_SIZE, listIngresosConResumen } from '@/lib/dal/inventario/ingreso'
import { IngresosTable } from './IngresosTable'

export default async function IngresosPage(props: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const { rows: rowsRaw, total } = await listIngresosConResumen({ page, pageSize: INGRESOS_PAGE_SIZE })
  const rows = proyectarIngresosConResumen(rowsRaw, puedeVerCostos)

  return (
    <>
      <Topbar
        title="Ingresos de mercadería"
        session={session}
        backHref="/inventario"
        actions={
          <Link href="/inventario/ingresos/nuevo">
            <Button size="sm">Nuevo ingreso</Button>
          </Link>
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <IngresosTable key={page} initial={rows} page={page} pageSize={INGRESOS_PAGE_SIZE} total={total} puedeVerCostos={puedeVerCostos} />
      </main>
    </>
  )
}
