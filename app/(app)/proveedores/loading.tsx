import { SkeletonTable, SkeletonTopbar } from '@/components/shell/PageSkeleton'

/** La page es solo el listado de proveedores en una tabla. */
export default function LoadingProveedores() {
  return (
    <>
      <SkeletonTopbar title="Proveedores" />
      <main className="flex-1 p-4 sm:p-6 space-y-6" aria-busy="true">
        <SkeletonTable rows={8} />
      </main>
    </>
  )
}
