'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Table, type Column } from '@/components/ui/Table'
import type { ConsignacionRevendedoraListItem } from '@/lib/types/revendedoras'

export function ConsignacionesRevendedoraTable({
  idRevendedora,
  consignaciones,
}: {
  idRevendedora: string
  consignaciones: ConsignacionRevendedoraListItem[]
}) {
  const columns: Column<ConsignacionRevendedoraListItem>[] = [
    {
      key: 'estado',
      label: 'Estado',
      render: (r) => {
        if (!r.confirmada) {
          return <Badge variant="warning">Sin confirmar</Badge>
        }
        if (r.estado === 'abierta') {
          return <Badge variant="success">Abierta</Badge>
        }
        return <Badge variant="neutral">Cerrada</Badge>
      },
    },
    {
      key: 'periodo',
      label: 'Período',
      render: (r) => {
        if (!r.periodo_desde && !r.periodo_hasta) return <span className="text-muted">—</span>
        return (
          <span className="font-mono text-xs">
            {r.periodo_desde || '…'} al {r.periodo_hasta || '…'}
          </span>
        )
      },
    },
    {
      key: 'items',
      label: 'Ítems (Total / En poder)',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-sm">
          {r.total_items} / {r.items_en_poder}
        </span>
      ),
    },
    {
      key: 'observaciones',
      label: 'Observaciones',
      render: (r) =>
        r.observaciones ? (
          <span className="truncate max-w-xs block text-sm">{r.observaciones}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'created_at',
      label: 'Fecha alta',
      render: (r) => (
        <span className="font-mono text-xs">
          {new Date(r.created_at).toLocaleDateString('es-AR')}
        </span>
      ),
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (r) => (
        <Link
          href={`/revendedoras/${idRevendedora}/consignaciones/${r.id_consignacion_revendedora}`}
          className="text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink text-sm font-medium"
        >
          Ver detalle
        </Link>
      ),
    },
  ]

  return (
    <Table
      data={consignaciones}
      columns={columns}
      getRowId={(r) => r.id_consignacion_revendedora}
    />
  )
}
