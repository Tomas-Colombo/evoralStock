'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import type { AuditoriaConActor } from '@/lib/types/administracion'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'

/**
 * Visor de auditoría (Etapa 9 §L140). Read-only.
 * Filtros: entidad + rango de fechas. Modal de detalle para ver
 * el JSON `cambios` completo.
 */
export function AuditoriaView({
  rows,
  entidades,
  filtros,
  page,
  pageSize,
  total,
}: {
  rows: AuditoriaConActor[]
  entidades: string[]
  filtros: { entidad: string; desde: string; hasta: string }
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [entidad, setEntidad] = useState(filtros.entidad)
  const [desde, setDesde] = useState(filtros.desde)
  const [hasta, setHasta] = useState(filtros.hasta)
  const [detalle, setDetalle] = useState<AuditoriaConActor | null>(null)

  const invertido = desde && hasta && desde > hasta

  function navigate(params: URLSearchParams) {
    const qs = params.toString()
    startTransition(() =>
      router.push(qs ? `/administracion/auditoria?${qs}` : '/administracion/auditoria'),
    )
  }

  function buildParams(nextPage: number) {
    const params = new URLSearchParams()
    if (entidad) params.set('entidad', entidad)
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    if (nextPage > 1) params.set('page', String(nextPage))
    return params
  }

  function aplicar() {
    if (invertido) return
    navigate(buildParams(1))
  }

  function limpiar() {
    setEntidad('')
    setDesde('')
    setHasta('')
    navigate(new URLSearchParams())
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          aplicar()
        }}
        className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-end gap-3"
        aria-label="Filtrar auditoría"
      >
        <div className="w-56">
          <Field htmlFor="a-ent" label="Entidad">
            <Select
              id="a-ent"
              value={entidad}
              onChange={(e) => setEntidad(e.target.value)}
              disabled={pending}
            >
              <option value="">Todas</option>
              {entidades.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-40">
          <Field
            htmlFor="a-d"
            label="Desde"
            error={invertido ? 'Posterior a "Hasta"' : undefined}
          >
            <Input
              id="a-d"
              type="date"
              value={desde}
              max={hasta || undefined}
              invalid={!!invertido}
              onChange={(e) => setDesde(e.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="w-40">
          <Field htmlFor="a-h" label="Hasta">
            <Input
              id="a-h"
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="secondary" onClick={limpiar} disabled={pending}>
            Limpiar
          </Button>
          <Button type="submit" disabled={pending || !!invertido}>
            {pending ? 'Filtrando…' : 'Aplicar'}
          </Button>
        </div>
      </form>

      <TableFrame>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            Sin registros para estos filtros.
          </div>
        ) : (
          <DataTable>
            <THead>
              <Th>Fecha</Th>
              <Th>Actor</Th>
              <Th>Entidad</Th>
              <Th>Acción</Th>
              <Th>ID</Th>
              <Th align="right">
                <span className="sr-only">Acciones</span>
              </Th>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id_auditoria}>
                  <Td className="whitespace-nowrap text-xs">
                    {new Date(r.ts).toLocaleString('es-AR')}
                  </Td>
                  <Td>
                    {r.actor_nombre || r.actor_email || <span className="text-muted">(sistema)</span>}
                  </Td>
                  <Td>
                    <Badge variant="neutral">{r.entidad}</Badge>
                  </Td>
                  <Td className="font-mono text-xs uppercase">{r.accion}</Td>
                  <Td className="font-mono text-xs text-muted">
                    {r.entidad_id ? r.entidad_id.slice(0, 8) : '—'}
                  </Td>
                  <Td align="right">
                    <Button size="sm" variant="ghost" onClick={() => setDetalle(r)}>
                      Ver detalle
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        )}
      </TableFrame>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => navigate(buildParams(p))}
        disabled={pending}
      />

      <Modal
        open={!!detalle}
        title="Detalle de auditoría"
        onClose={() => setDetalle(null)}
        size="xl"
      >
        {detalle && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Meta label="Entidad" value={detalle.entidad} />
              <Meta label="Acción" value={detalle.accion} />
              <Meta label="ID entidad" value={detalle.entidad_id ?? '—'} mono />
              <Meta label="Fecha" value={new Date(detalle.ts).toLocaleString('es-AR')} />
              <Meta label="Actor" value={detalle.actor_email ?? '(sistema)'} />
              <Meta label="IP" value={detalle.ip ?? '—'} mono />
            </div>
            <div>
              <div className="text-xs uppercase font-mono text-muted mb-1">Cambios</div>
              <pre className="rounded-md border border-border bg-card-2 p-3 text-xs overflow-auto max-h-[50vh]">
                {JSON.stringify(detalle.cambios, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase font-mono text-muted">{label}</div>
      <div className={mono ? 'font-mono text-xs' : ''}>{value}</div>
    </div>
  )
}
