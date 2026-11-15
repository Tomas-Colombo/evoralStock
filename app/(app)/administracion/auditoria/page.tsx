import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import {
  listAuditoria,
  listEntidadesAuditoria,
} from '@/lib/dal/administracion/administracion'
import { AuditoriaView } from './AuditoriaView'

const PAGE_SIZE = 20

export default async function AuditoriaPage(props: {
  searchParams: Promise<{ entidad?: string; desde?: string; hasta?: string; page?: string }>
}) {
  const session = await verifySession()
  const sp = await props.searchParams
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const [auditoriaPage, entidades] = await Promise.all([
    listAuditoria({
      entidad: sp.entidad,
      desde: sp.desde ? new Date(sp.desde).toISOString() : undefined,
      hasta: sp.hasta
        ? new Date(new Date(sp.hasta).setHours(23, 59, 59, 999)).toISOString()
        : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    listEntidadesAuditoria(),
  ])

  return (
    <>
      <Topbar title="Auditoría" session={session} backHref="/administracion" />
      <main className="flex-1 p-4 sm:p-6">
        <AuditoriaView
          rows={auditoriaPage.rows}
          entidades={entidades}
          filtros={{
            entidad: sp.entidad ?? '',
            desde: sp.desde ?? '',
            hasta: sp.hasta ?? '',
          }}
          page={page}
          pageSize={PAGE_SIZE}
          total={auditoriaPage.total}
        />
      </main>
    </>
  )
}
