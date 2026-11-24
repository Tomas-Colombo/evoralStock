'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { AuditoriaConActor } from '@/lib/types/administracion'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'

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
  const [detalle, setDetalle] = useState<AuditoriaConActor | null>(null)
  const hayFiltros = Boolean(filtros.entidad || filtros.desde || filtros.hasta)

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <FiltroPeriodo
          ariaLabel="Filtrar auditoría"
          idPrefix="auditoria"
          desde={filtros.desde}
          hasta={filtros.hasta}
          paramPagina="page"
          extras={[
            {
              param: 'entidad',
              label: 'Entidad',
              value: filtros.entidad,
              ancho: 'w-56',
              options: [
                { value: '', label: 'Todas' },
                ...entidades.map((e) => ({ value: e, label: e })),
              ],
            },
          ]}
        />
        {hayFiltros && (
          <div>
            <Link
              href="/administracion/auditoria"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Limpiar
            </Link>
          </div>
        )}
      </div>

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

      <PaginacionUrl
        page={page}
        pageSize={pageSize}
        total={total}
        param="page"
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
