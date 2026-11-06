import { Skeleton } from '@/components/ui/Skeleton'
import { SkeletonKpis, SkeletonTable, SkeletonTopbar } from '@/components/shell/PageSkeleton'

/** Resumen de deuda en la franja, buscador con selector de estado y tabla de deudores. */
export default function LoadingCuotas() {
  return (
    <>
      <SkeletonTopbar title="Cuotas" />
      <main className="flex-1 p-4 sm:p-6 space-y-6" aria-busy="true">
        <SkeletonKpis />
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Skeleton width="100%" height="2.25rem" />
            </div>
            <div className="w-48">
              <Skeleton width="100%" height="2.25rem" />
            </div>
            <Skeleton width="5rem" height="2.25rem" />
          </div>
          <SkeletonTable rows={8} />
        </div>
      </main>
    </>
  )
}
