'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/Toast'
import {
  bajaCategoriaGastoAction,
  reactivarCategoriaGastoAction,
  renameCategoriaGastoAction,
  setPresupuestoAction,
} from '../../rendiciones/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Checkbox } from '@/components/ui/Checkbox'
import { NuevaCategoriaGastoInline } from '@/components/gastos/NuevaCategoriaGastoInline'

interface Cat {
  id: string
  nombre: string
  presupuesto: number | null
  activa: boolean
  fechaBaja: string | null
}

const PAGE_SIZE = 15

/**
 * Edición inline del presupuesto mensual (RF-10) y CRUD de categorías:
 * alta rápida, renombrar y dar de baja (hard si no hay gastos; soft en
 * caso contrario, marcando `fecha_baja` para el histórico).
 */
export function PresupuestosView({ initial }: { initial: Cat[] }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [values, setValues] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const c of initial) map[c.id] = c.presupuesto == null ? '' : String(c.presupuesto)
    return map
  })

  const [nombres, setNombres] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const c of initial) map[c.id] = c.nombre
    return map
  })
  const [showInactivas, setShowInactivas] = useState(false)
  const [page, setPage] = useState(1)

  const visibles = useMemo(
    () => (showInactivas ? initial : initial.filter((c) => c.activa)),
    [initial, showInactivas],
  )
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE))
  const pagina = Math.min(page, totalPaginas)
  const desde = (pagina - 1) * PAGE_SIZE
  const rows = visibles.slice(desde, desde + PAGE_SIZE)


  function guardarPresupuesto(id: string) {
    const raw = values[id]?.trim() ?? ''
    const presupuesto = raw === '' ? null : Number(raw)
    if (presupuesto != null && (!isFinite(presupuesto) || presupuesto < 0)) {
      return toast.error('Valor inválido')
    }
    start(async () => {
      const res = await setPresupuestoAction({ idCategoria: id, presupuesto })
      if (!res.ok) return toast.error('No se pudo guardar', mensajeDeError(res.reason))
      toast.success('Presupuesto actualizado')
      router.refresh()
    })
  }

  function guardarNombre(id: string, original: string) {
    const nombre = (nombres[id] ?? '').trim()
    if (nombre.length < 2) return toast.error('Nombre inválido')
    if (nombre === original) return
    start(async () => {
      const res = await renameCategoriaGastoAction({ idCategoria: id, nombre })
      if (!res.ok) return toast.error('No se pudo renombrar', mensajeDeError(res.reason))
      toast.success('Categoría renombrada')
      router.refresh()
    })
  }

  function darDeBaja(id: string, nombre: string) {
    if (!confirm(`¿Dar de baja la categoría "${nombre}"?\n\nSi tiene gastos asociados, se conserva el historial y solo deja de aparecer en el selector.`)) return
    start(async () => {
      const res = await bajaCategoriaGastoAction({ idCategoria: id })
      if (!res.ok) return toast.error('No se pudo dar de baja', mensajeDeError(res.reason))
      toast.success(res.data?.hardDeleted ? 'Categoría eliminada' : 'Categoría dada de baja')
      router.refresh()
    })
  }

  function reactivar(id: string) {
    start(async () => {
      const res = await reactivarCategoriaGastoAction({ idCategoria: id })
      if (!res.ok) return toast.error('No se pudo reactivar', mensajeDeError(res.reason))
      toast.success('Categoría reactivada')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
        Presupuesto <b>mensual</b> por categoría. Vacío = sin control. Se
        compara contra la suma de gastos del mes calendario en curso.
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <NuevaCategoriaGastoInline
          defaultExpanded
          label="Nueva categoría"
          placeholder="Ej: Alquiler, Impuestos, Servicios"
          submitLabel="Agregar categoría"
          onCreated={() => router.refresh()}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <Checkbox
            checked={showInactivas}
            onChange={(e) => {
              setShowInactivas(e.target.checked)
              setPage(1)
            }}
          />
          Mostrar dadas de baja
        </label>
        <span className="text-xs text-muted">{visibles.length} categoría(s)</span>
      </div>

      <TableFrame>
        <DataTable>
          <THead>
            <Th>Categoría</Th>
            <Th>Presupuesto mensual (ARS)</Th>
            <Th>Estado</Th>
            <Th align="right">Acciones</Th>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={4} className="px-4 py-6 text-muted">
                  Sin categorías.
                </Td>
              </Tr>
            ) : (
              rows.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Input
                      aria-label={`Nombre ${c.nombre}`}
                      value={nombres[c.id] ?? ''}
                      onChange={(e) => setNombres((n) => ({ ...n, [c.id]: e.target.value }))}
                      onBlur={() => guardarNombre(c.id, c.nombre)}
                      disabled={pending || !c.activa}
                      className="max-w-xs"
                    />
                  </Td>
                  <Td>
                    <NumberInput
                      aria-label={`Presupuesto ${c.nombre}`}
                      thousands
                      value={values[c.id] ?? ''}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [c.id]: e.target.value }))
                      }
                      onBlur={() => guardarPresupuesto(c.id)}
                      placeholder="Sin control"
                      className="max-w-xs"
                      disabled={pending || !c.activa}
                    />
                  </Td>
                  <Td>
                    {c.activa ? (
                      <span className="text-xs text-muted">Activa</span>
                    ) : (
                      <span className="text-xs text-alerta-ink">
                        Baja
                        {c.fechaBaja && (
                          <span className="text-muted">
                            {' · '}
                            {new Date(c.fechaBaja).toLocaleDateString('es-AR')}
                          </span>
                        )}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {c.activa ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => darDeBaja(c.id, c.nombre)}
                        disabled={pending}
                      >
                        Dar de baja
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => reactivar(c.id)}
                        disabled={pending}
                      >
                        Reactivar
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </DataTable>
      </TableFrame>

      <Pagination
        page={pagina}
        pageSize={PAGE_SIZE}
        total={visibles.length}
        onPageChange={setPage}
        disabled={pending}
      />
    </div>
  )
}
