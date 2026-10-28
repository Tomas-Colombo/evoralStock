'use client'

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, type Column } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { CategoriaForm } from '@/components/inventario/CategoriaForm'
import type { CategoriaRow } from '@/lib/types/inventario'
import { toggleCategoriaActivaAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame } from '@/components/ui/TableParts'

export function CategoriasView({ initial }: { initial: CategoriaRow[] }) {
  const [rows, setRows] = useState<CategoriaRow[]>(initial)
  const [open, setOpen] = useState(false)
  // `null` = alta; una fila = edición. El formulario se siembra al montar,
  // así que la `key` lo remonta al pasar de una categoría a otra.
  const [editando, setEditando] = useState<CategoriaRow | null>(null)
  const [pending, startTransition] = useTransition()
  const toast = useToast()

  function abrirNueva() {
    setEditando(null)
    setOpen(true)
  }

  function abrirEditar(row: CategoriaRow) {
    setEditando(row)
    setOpen(true)
  }

  function cerrar() {
    setOpen(false)
    setEditando(null)
  }

  function guardada(cat: CategoriaRow) {
    setRows((r) =>
      r.some((c) => c.id_categoria === cat.id_categoria)
        ? r.map((c) => (c.id_categoria === cat.id_categoria ? cat : c))
        : [...r, cat],
    )
    cerrar()
  }

  function toggle(row: CategoriaRow) {
    startTransition(async () => {
      const res = await toggleCategoriaActivaAction({
        id: row.id_categoria,
        activa: !row.activa,
      })
      if (!res.ok) return toast.error('No se pudo actualizar', mensajeDeError(res.reason))
      setRows((rs) =>
        rs.map((r) => (r.id_categoria === row.id_categoria ? { ...r, activa: !r.activa } : r)),
      )
    })
  }

  const columns: Column<CategoriaRow>[] = [
    { key: 'nombre', label: 'Nombre' },
    {
      key: 'talles',
      label: 'Talles',
      render: (r) =>
        r.talles && r.talles.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.talles.map((t) => (
              <span key={t} className="rounded-full border border-border bg-card-2 px-2 py-0.5 text-xs">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'activa',
      label: 'Estado',
      render: (r) => (
        <Badge variant={r.activa ? 'success' : 'neutral'}>
          {r.activa ? 'Activa' : 'Inactiva'}
        </Badge>
      ),
    },
    {
      // Una acción por columna: "Activar" y "Desactivar" no miden lo mismo y
      // en una celda compartida corrían el botón Editar de fila en fila.
      key: 'editar',
      label: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => abrirEditar(r)} disabled={pending}>
          Editar
        </Button>
      ),
    },
    {
      key: 'activa-toggle',
      label: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => toggle(r)} disabled={pending}>
          {r.activa ? 'Desactivar' : 'Activar'}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={abrirNueva}>Nueva categoría</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin categorías todavía"
          description="Creá la primera categoría para clasificar tus productos."
          cta={{ label: 'Nueva categoría', onClick: abrirNueva }}
        />
      ) : (
        <TableFrame>
          <Table columns={columns} data={rows} getRowId={(r) => r.id_categoria} />
        </TableFrame>
      )}

      <Modal
        open={open}
        title={editando ? 'Editar categoría' : 'Nueva categoría'}
        onClose={cerrar}
      >
        <CategoriaForm
          key={editando?.id_categoria ?? 'nueva'}
          categoria={editando ?? undefined}
          onSaved={guardada}
          onCancel={cerrar}
        />
      </Modal>
    </div>
  )
}
