import { PageBand } from '@/components/shell/PageBand'
import { SkeletonTable } from '@/components/shell/PageSkeleton'

export default function LoadingVentas() {
  return (
    <>
      {/* Mismo título y mismos rótulos que la page real: sólo los valores
          van a guion hasta que lleguen los datos. */}
      <PageBand
        breadcrumb={['Ventas']}
        title="Ventas"
        kpis={[
          { label: 'Ventas del período', value: '—' },
          { label: 'Facturado en el período', value: '—' },
          { label: 'Reservas activas', value: '—' },
          { label: 'Vencen pronto', value: '—' },
        ]}
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6" aria-busy="true">
        <SkeletonTable title="Ventas del período" rows={10} />
      </main>
    </>
  )
}
