import { Skeleton } from '@/components/ui/Skeleton'
import { SkeletonTable, SkeletonTopbar } from '@/components/shell/PageSkeleton'
import { Card } from '@/components/ui/Card'

/** Accesos rápidos a usuarios y roles, tarjetas de configuración y tabla de auditoría. */
export default function LoadingAdministracion() {
  return (
    <>
      <SkeletonTopbar title="Administración" />
      <main className="flex-1 p-4 sm:p-6 space-y-6" aria-busy="true">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card padding="lg">
            <div className="text-sm text-muted">Usuarios</div>
            <div className="mt-2">
              <Skeleton width="45%" height="1.75rem" />
            </div>
          </Card>
          <Card padding="lg">
            <div className="text-sm text-muted">Roles</div>
            <div className="mt-2">
              <Skeleton width="45%" height="1.75rem" />
            </div>
          </Card>
          <Card padding="lg">
            <div className="text-sm text-muted">Auditoría</div>
            <div className="mt-1 font-display text-2xl">Ver</div>
          </Card>
        </section>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-display text-lg">Logo del negocio</h3>
            <div className="mt-1">
              <Skeleton width="80%" height="0.875rem" />
            </div>
          </div>
          <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-border bg-sidebar-bg p-3">
            <Skeleton width="60%" height="1.5rem" />
          </div>
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-display text-lg">Etiquetas QR de inventario</h3>
            <div className="mt-1">
              <Skeleton width="80%" height="0.875rem" />
            </div>
          </div>
          <div className="w-48">
            <Skeleton width="100%" height="2.25rem" />
          </div>
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-display text-lg">Impresora de etiquetas</h3>
            <div className="mt-1">
              <Skeleton width="80%" height="0.875rem" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-48">
              <Skeleton width="100%" height="2.25rem" />
            </div>
            <div className="w-48">
              <Skeleton width="100%" height="2.25rem" />
            </div>
          </div>
        </Card>

        <Card as="section" className="space-y-4">
          <div>
            <h3 className="font-display text-lg">Seguridad de la cuenta</h3>
            <div className="mt-1">
              <Skeleton width="80%" height="0.875rem" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-3xl pt-2">
            <Skeleton width="100%" height="2.25rem" />
            <Skeleton width="100%" height="2.25rem" />
            <Skeleton width="100%" height="2.25rem" />
          </div>
        </Card>

        <SkeletonTable title="Últimas acciones auditadas" rows={5} />
      </main>
    </>
  )
}
