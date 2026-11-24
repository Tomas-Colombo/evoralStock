'use client'

import Link from 'next/link'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import {
  ORDEN_PANEL_REVENDEDORAS_LABEL,
  type OrdenPanelRevendedoras,
} from '@/lib/types/revendedoras'

interface RevendedorasFiltrosBarProps {
  filtros: {
    desde?: string
    hasta?: string
    estado: 'todos' | 'activa' | 'inactiva'
    cuenta: 'todos' | 'con_saldo' | 'atrasada' | 'declaraciones_pendientes'
    q?: string
    orden: string
  }
  onExportar: () => void
  exportarDisabled: boolean
}

export function RevendedorasFiltrosBar({
  filtros,
  onExportar,
  exportarDisabled,
}: RevendedorasFiltrosBarProps) {
  const tieneFiltrosActivos = Boolean(
    filtros.q ||
      filtros.desde ||
      filtros.hasta ||
      filtros.estado !== 'todos' ||
      filtros.cuenta !== 'todos' ||
      filtros.orden !== 'apellido_asc',
  )

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field htmlFor="revendedoras-q" label="Buscar">
            <BusquedaUrl
              valor={filtros.q ?? ''}
              placeholder="Buscar por nombre, apellido, email o teléfono"
              paramPagina="page"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          {tieneFiltrosActivos && (
            <Link
              href="/revendedoras"
              className="rounded-md border border-line-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              Limpiar
            </Link>
          )}
          <Button variant="secondary" onClick={onExportar} disabled={exportarDisabled}>
            Exportar CSV
          </Button>
        </div>
      </div>

      <FiltroPeriodo
        ariaLabel="Filtrar revendedoras por período y estado"
        idPrefix="revendedoras"
        desde={filtros.desde ?? ''}
        hasta={filtros.hasta ?? ''}
        paramPagina="page"
        extras={[
          {
            param: 'estado',
            label: 'Estado revendedora',
            value: filtros.estado,
            valorPorDefecto: 'todos',
            ancho: 'w-44',
            options: [
              { value: 'todos', label: 'Todos los estados' },
              { value: 'activa', label: 'Activas' },
              { value: 'inactiva', label: 'Bajas' },
            ],
          },
          {
            param: 'cuenta',
            label: 'Estado de cuenta',
            value: filtros.cuenta,
            valorPorDefecto: 'todos',
            ancho: 'w-52',
            options: [
              { value: 'todos', label: 'Todas las cuentas' },
              { value: 'con_saldo', label: 'Con saldo' },
              { value: 'atrasada', label: 'Atrasada' },
              { value: 'declaraciones_pendientes', label: 'Con declaraciones pendientes' },
            ],
          },
          {
            param: 'orden',
            label: 'Ordenar por',
            value: filtros.orden,
            valorPorDefecto: 'apellido_asc',
            ancho: 'w-48',
            options: (Object.keys(ORDEN_PANEL_REVENDEDORAS_LABEL) as OrdenPanelRevendedoras[]).map(
              (k) => ({
                value: k,
                label: ORDEN_PANEL_REVENDEDORAS_LABEL[k],
              }),
            ),
          },
        ]}
      />
    </Card>
  )
}
