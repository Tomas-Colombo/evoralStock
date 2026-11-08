'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { FilterBar } from '@/components/ui/FilterBar'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { waMeLink } from '@/lib/utils/waMeLink'
import {
  ORDEN_CLIENTES_LABEL,
  type ClienteRow,
  type OrdenClientes,
} from '@/lib/types/ventas'
import { toggleClienteActivoAction } from './actions'
import { EditarClienteModal } from './EditarClienteModal'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame } from '@/components/ui/TableParts'

export function ClientesTable({
  rows,
  initialSearch,
  orden,
  page,
  pageSize,
  total,
}: {
  rows: ClienteRow[]
  initialSearch: string
  orden: OrdenClientes
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [q, setQ] = useState(initialSearch)
  const [editando, setEditando] = useState<ClienteRow | null>(null)
  const [pending, start] = useTransition()

  /**
   * Todo el estado del listado vive en la URL: el filtro es compartible y
   * sobrevive a un refresh, y el server re-consulta con el mismo recorte.
   */
  function navegar(next: { q?: string; orden?: OrdenClientes; page?: number }) {
    const params = new URLSearchParams()
    const texto = (next.q ?? q).trim()
    const ord = next.orden ?? orden
    if (texto) params.set('q', texto)
    if (ord !== 'apellido_asc') params.set('orden', ord)
    if ((next.page ?? 1) > 1) params.set('page', String(next.page))
    const qs = params.toString()
    start(() => router.push(qs ? `/clientes?${qs}` : '/clientes'))
  }

  function toggle(row: ClienteRow) {
    start(async () => {
      const res = await toggleClienteActivoAction({
        id: row.id_cliente,
        activo: !row.activo,
      })
      if (!res.ok) return toast.error('No se pudo actualizar', mensajeDeError(res.reason))
      router.refresh()
    })
  }

  const columns: Column<ClienteRow>[] = [
    // Apellido y nombre son dos entradas al mismo cliente: el ojo cae en una u
    // otra según cómo lo esté buscando, y obligarlo a apuntar siempre a la
    // misma columna es fricción sin motivo.
    {
      key: 'apellido',
      label: 'Apellido',
      render: (c) =>
        c.apellido ? (
          <Link
            href={`/clientes/${c.id_cliente}`}
            className="font-medium hover:underline"
          >
            {c.apellido}
          </Link>
        ) : (
          // Los clientes anteriores a 00058 tienen todo el nombre en `nombre`.
          // No es un dato faltante por descuido: nunca se pidió por separado.
          <span className="text-muted" title="Cargado antes de separar el apellido">
            —
          </span>
        ),
    },
    {
      key: 'nombre',
      label: 'Nombre',
      render: (c) => (
        <Link href={`/clientes/${c.id_cliente}`} className="hover:underline">
          {c.nombre}
        </Link>
      ),
    },
    {
      key: 'contacto',
      label: 'Contacto',
      render: (c) => {
        const wa = waMeLink(c.telefono)
        return (
          <div className="text-xs">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
              >
                {c.telefono} · WhatsApp
              </a>
            ) : (
              (c.telefono ?? <span className="text-muted">—</span>)
            )}
            {c.email && <div className="text-muted">{c.email}</div>}
          </div>
        )
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (c) => (
        <Badge variant={c.activo ? 'success' : 'neutral'}>
          {c.activo ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      // Una acción por columna: "Activar" y "Desactivar" no miden lo mismo y
      // en una celda compartida corrían el botón Editar de fila en fila.
      key: 'editar',
      label: '',
      align: 'right',
      render: (c) => (
        <Button size="sm" variant="ghost" onClick={() => setEditando(c)} disabled={pending}>
          Editar
        </Button>
      ),
    },
    {
      key: 'activo-toggle',
      label: '',
      align: 'right',
      render: (c) => (
        <Button size="sm" variant="ghost" onClick={() => toggle(c)} disabled={pending}>
          {c.activo ? 'Desactivar' : 'Activar'}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <FilterBar
            value={q}
            onChange={setQ}
            placeholder="Buscar por nombre, apellido, email o teléfono"
          />
        </div>
        <div className="w-52">
          <Select
            value={orden}
            onChange={(e) => navegar({ orden: e.target.value as OrdenClientes, page: 1 })}
            disabled={pending}
            aria-label="Ordenar"
          >
            {(Object.keys(ORDEN_CLIENTES_LABEL) as OrdenClientes[]).map((o) => (
              <option key={o} value={o}>
                {ORDEN_CLIENTES_LABEL[o]}
              </option>
            ))}
          </Select>
        </div>
        {/* Filtrar vuelve a la página 1: la actual no significa lo mismo
            sobre un conjunto de resultados distinto. */}
        <Button variant="secondary" onClick={() => navegar({ page: 1 })} disabled={pending}>
          Aplicar
        </Button>
      </div>

      <TableFrame>
        <Table
          columns={columns}
          data={rows}
          loading={pending}
          getRowId={(c) => c.id_cliente}
          emptyState="Sin resultados."
        />
      </TableFrame>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => navegar({ page: p })}
        disabled={pending}
      />

      <EditarClienteModal
        cliente={editando}
        open={editando !== null}
        onClose={() => setEditando(null)}
      />

      {orden !== 'nombre_asc' && rows.some((c) => !c.apellido) && (
        <p className="text-xs text-muted">
          Los clientes sin apellido quedan al final: se cargaron con el nombre
          completo en un solo campo. Editalos para separarlo.
        </p>
      )}
    </div>
  )
}
