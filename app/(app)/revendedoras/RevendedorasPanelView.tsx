'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Table, type Column } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { escapeCsvField, downloadCsv, csvNegative } from '@/lib/utils/csv'
import type {
  PanelRevendedoraRow,
} from '@/lib/types/revendedoras'
import { RevendedorasFiltrosBar } from './RevendedorasFiltrosBar'
import { TableFrame } from '@/components/ui/TableParts'

interface RevendedorasPanelViewProps {
  data: PanelRevendedoraRow[]
  total: number
  canAsignar: boolean
  canDevolver: boolean
  filtros: {
    desde?: string
    hasta?: string
    estado: 'todos' | 'activa' | 'inactiva'
    cuenta: 'todos' | 'con_saldo' | 'atrasada' | 'declaraciones_pendientes'
    q?: string
    orden: string
    page: number
  }
}

export function RevendedorasPanelView({
  data,
  total,
  canAsignar,
  canDevolver,
  filtros,
}: RevendedorasPanelViewProps) {
  const router = useRouter()

  function exportarCsv() {
    const headers = [
      'Revendedora',
      'Email',
      'Teléfono',
      'Estado',
      'Cuenta',
      'Piezas en poder',
      'Valor en poder',
      'Vendido período',
      'Comisión liquidada',
      'Comisión estimada',
      'Adeudado al local',
      'Última venta',
      'Declaraciones pendientes',
    ]

    const rows = data.map((r) => [
      escapeCsvField(`${r.nombre} ${r.apellido}`),
      escapeCsvField(r.email ?? ''),
      escapeCsvField(r.telefono ?? ''),
      escapeCsvField(r.activo ? 'Activa' : 'Baja'),
      escapeCsvField(
        r.estado_cuenta === 'al_dia'
          ? 'Al día'
          : r.estado_cuenta === 'con_saldo'
          ? 'Con saldo'
          : 'Atrasada',
      ),
      escapeCsvField(r.items_en_poder),
      escapeCsvField(r.monto_en_poder),
      escapeCsvField(r.vendido_periodo),
      escapeCsvField(r.comision_liquidada),
      escapeCsvField(r.comision_estimada),
      escapeCsvField(r.adeudado > 0 ? csvNegative(r.adeudado) : r.adeudado),
      escapeCsvField(r.fecha_ultima_venta ?? ''),
      escapeCsvField(r.declaraciones_pendientes),
    ])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const hoy = new Date().toISOString().slice(0, 10)
    downloadCsv(`panel-revendedoras-${hoy}.csv`, csvContent)
  }

  const columns: Column<PanelRevendedoraRow>[] = [
    {
      key: 'nombre',
      label: 'Revendedora',
      render: (r) => (
        <div>
          <Link
            href={`/revendedoras/${r.id_revendedora}`}
            className="font-medium text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
          >
            {r.nombre} {r.apellido}
          </Link>
          {r.email && <div className="text-xs text-muted">{r.email}</div>}
        </div>
      ),
    },
    {
      key: 'activo',
      label: 'Estado',
      render: (r) => (
        <Badge variant={r.activo ? 'success' : 'neutral'}>
          {r.activo ? 'Activa' : 'Baja'}
        </Badge>
      ),
    },
    {
      key: 'estado_cuenta',
      label: 'Cuenta',
      render: (r) => {
        const variant =
          r.estado_cuenta === 'al_dia'
            ? 'success'
            : r.estado_cuenta === 'con_saldo'
            ? 'warning'
            : 'danger'
        const label =
          r.estado_cuenta === 'al_dia'
            ? 'Al día'
            : r.estado_cuenta === 'con_saldo'
            ? 'Con saldo'
            : 'Atrasada'
        return <Badge variant={variant}>{label}</Badge>
      },
    },
    {
      key: 'items_en_poder',
      label: 'En su poder',
      render: (r) => (
        <div>
          <span className="font-medium">{r.items_en_poder} u.</span>
          <div className="text-xs text-muted">
            $ {Number(r.monto_en_poder).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
        </div>
      ),
    },
    {
      key: 'vendido_periodo',
      label: 'Vendido',
      render: (r) => (
        <span className="font-mono">
          $ {Number(r.vendido_periodo).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'comision',
      label: 'Comisión',
      render: (r) => (
        <div className="text-xs space-y-0.5">
          <div>
            <span className="text-muted">Liq: </span>
            <span className="font-mono">
              $ {Number(r.comision_liquidada).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div>
            <span className="text-muted">Est: </span>
            <span className="font-mono">
              $ {Number(r.comision_estimada).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'adeudado',
      label: 'Adeudado',
      render: (r) => (
        <span className={`font-mono font-medium ${r.adeudado > 0 ? 'text-danger' : 'text-text'}`}>
          $ {Number(r.adeudado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'fecha_ultima_venta',
      label: 'Última venta',
      render: (r) => (
        <span className="text-sm text-muted">
          {r.fecha_ultima_venta ? new Date(r.fecha_ultima_venta).toLocaleDateString('es-AR') : '—'}
        </span>
      ),
    },
    {
      key: 'declaraciones_pendientes',
      label: 'Declaraciones',
      render: (r) => (
        <span className="text-center block text-sm">
          {r.declaraciones_pendientes}
        </span>
      ),
    },
  ]

  // Asignar y recibir mercadería son lo que más se hace en el módulo: van en
  // la fila para no pasar por el perfil y la pestaña de consignaciones. Cada
  // una en su columna: cuando una fila no tiene Devolución, Asignación no se
  // corre al borde.
  if (canAsignar) {
    columns.push({
      key: 'asignacion',
      label: '',
      align: 'right',
      render: (r) =>
        r.activo ? (
          <Link
            href={`/revendedoras/${r.id_revendedora}/consignaciones/nueva`}
            className="whitespace-nowrap rounded-md bg-block px-3 py-1.5 text-xs font-semibold text-block-ink"
          >
            Asignación
          </Link>
        ) : null,
    })
  }
  if (canDevolver) {
    columns.push({
      key: 'devolucion',
      label: '',
      align: 'right',
      render: (r) =>
        r.items_en_poder > 0 ? (
          <Link
            href={`/revendedoras/${r.id_revendedora}/devolucion`}
            className="whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-card-2"
          >
            Devolución
          </Link>
        ) : null,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Barra de filtros unificada: es la tarjeta que sube sobre la banda. */}
      <RevendedorasFiltrosBar
        filtros={filtros}
        onExportar={exportarCsv}
        exportarDisabled={data.length === 0}
      />

      {/* Tabla de Resultados */}
      {data.length === 0 ? (
        <EmptyState
          title="No hay revendedoras para los filtros seleccionados"
          description="Probá ajustando la búsqueda o los filtros aplicados."
          cta={{
            label: 'Limpiar filtros',
            onClick: () => router.push('/revendedoras'),
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TableFrame>
            <Table
              columns={columns}
              data={data}
              getRowId={(r) => r.id_revendedora}
            />
          </TableFrame>

          <PaginacionUrl
            page={filtros.page}
            pageSize={25}
            total={total}
            param="page"
          />
        </div>
      )}
    </div>
  )
}
