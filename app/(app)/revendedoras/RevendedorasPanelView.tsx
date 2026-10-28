'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Table, type Column } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
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
  const [isPending, startTransition] = useTransition()

  const [q, setQ] = useState(filtros.q ?? '')
  const [desde, setDesde] = useState(filtros.desde ?? '')
  const [hasta, setHasta] = useState(filtros.hasta ?? '')
  const [estado, setEstado] = useState(filtros.estado)
  const [cuenta, setCuenta] = useState(filtros.cuenta)
  const [orden, setOrden] = useState(filtros.orden)

  const rangoInvertido = Boolean(desde && hasta && desde > hasta)

  function aplicarFiltros(overrides: Partial<typeof filtros> = {}) {
    const nextFiltros = {
      q,
      desde,
      hasta,
      estado,
      cuenta,
      orden,
      page: 1,
      ...overrides,
    }

    const params = new URLSearchParams()
    if (nextFiltros.q) params.set('q', nextFiltros.q)
    if (nextFiltros.desde) params.set('desde', nextFiltros.desde)
    if (nextFiltros.hasta) params.set('hasta', nextFiltros.hasta)
    if (nextFiltros.estado && nextFiltros.estado !== 'todos') params.set('estado', nextFiltros.estado)
    if (nextFiltros.cuenta && nextFiltros.cuenta !== 'todos') params.set('cuenta', nextFiltros.cuenta)
    if (nextFiltros.orden && nextFiltros.orden !== 'apellido_asc') params.set('orden', nextFiltros.orden)
    if (nextFiltros.page && nextFiltros.page > 1) params.set('page', String(nextFiltros.page))

    startTransition(() => {
      router.push(`/revendedoras?${params.toString()}`)
    })
  }

  function limpiarFiltros() {
    setQ('')
    setDesde('')
    setHasta('')
    setEstado('todos')
    setCuenta('todos')
    setOrden('apellido_asc')
    aplicarFiltros({
      q: '',
      desde: '',
      hasta: '',
      estado: 'todos',
      cuenta: 'todos',
      orden: 'apellido_asc',
    })
  }

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

      {/* Acciones principales */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={exportarCsv} disabled={data.length === 0}>
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Barra de Filtros Unificada */}
      <RevendedorasFiltrosBar
        q={q}
        setQ={setQ}
        desde={desde}
        setDesde={setDesde}
        hasta={hasta}
        setHasta={setHasta}
        estado={estado}
        setEstado={setEstado}
        cuenta={cuenta}
        setCuenta={setCuenta}
        orden={orden}
        setOrden={setOrden}
        isPending={isPending}
        rangoInvertido={rangoInvertido}
        onAplicar={() => aplicarFiltros()}
        onLimpiar={limpiarFiltros}
      />

      {/* Tabla de Resultados */}
      {data.length === 0 ? (
        <EmptyState
          title="No hay revendedoras para los filtros seleccionados"
          description="Probá ajustando la búsqueda o los filtros aplicados."
          cta={{
            label: 'Limpiar filtros',
            onClick: limpiarFiltros,
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TableFrame>
            <Table
              columns={columns}
              data={data}
              getRowId={(r) => r.id_revendedora}
              loading={isPending}
            />
          </TableFrame>

          <Pagination
            page={filtros.page}
            pageSize={25}
            total={total}
            onPageChange={(p) => aplicarFiltros({ page: p })}
            disabled={isPending}
          />
        </div>
      )}
    </div>
  )
}
