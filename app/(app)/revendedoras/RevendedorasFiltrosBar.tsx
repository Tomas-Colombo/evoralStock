'use client'

import { FilterBar } from '@/components/ui/FilterBar'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import type { OrdenPanelRevendedoras } from '@/lib/types/revendedoras'
import { ORDEN_PANEL_REVENDEDORAS_LABEL } from '@/lib/types/revendedoras'
import { Card } from '@/components/ui/Card'

interface RevendedorasFiltrosBarProps {
  q: string
  setQ: (v: string) => void
  desde: string
  setDesde: (v: string) => void
  hasta: string
  setHasta: (v: string) => void
  estado: 'todos' | 'activa' | 'inactiva'
  setEstado: (v: 'todos' | 'activa' | 'inactiva') => void
  cuenta: 'todos' | 'con_saldo' | 'atrasada' | 'declaraciones_pendientes'
  setCuenta: (v: 'todos' | 'con_saldo' | 'atrasada' | 'declaraciones_pendientes') => void
  orden: string
  setOrden: (v: string) => void
  isPending: boolean
  rangoInvertido: boolean
  onAplicar: () => void
  onLimpiar: () => void
  onExportar: () => void
  exportarDisabled: boolean
}

export function RevendedorasFiltrosBar({
  q,
  setQ,
  desde,
  setDesde,
  hasta,
  setHasta,
  estado,
  setEstado,
  cuenta,
  setCuenta,
  orden,
  setOrden,
  isPending,
  rangoInvertido,
  onAplicar,
  onLimpiar,
  onExportar,
  exportarDisabled,
}: RevendedorasFiltrosBarProps) {
  const tieneFiltrosActivos = Boolean(
    q || desde || hasta || estado !== 'todos' || cuenta !== 'todos' || orden !== 'apellido_asc',
  )

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="lg:col-span-2">
          <Field htmlFor="filtro-q" label="Buscar">
            <FilterBar
              value={q}
              onChange={setQ}
              placeholder="Buscar por nombre, apellido, email o teléfono"
            />
          </Field>
        </div>

        <div>
          <Field htmlFor="filtro-estado" label="Estado revendedora">
            <Select
              id="filtro-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as 'todos' | 'activa' | 'inactiva')}
              disabled={isPending}
            >
              <option value="todos">Todos los estados</option>
              <option value="activa">Activas</option>
              <option value="inactiva">Bajas</option>
            </Select>
          </Field>
        </div>

        <div>
          <Field htmlFor="filtro-cuenta" label="Estado de cuenta">
            <Select
              id="filtro-cuenta"
              value={cuenta}
              onChange={(e) =>
                setCuenta(
                  e.target.value as
                    | 'todos'
                    | 'con_saldo'
                    | 'atrasada'
                    | 'declaraciones_pendientes',
                )
              }
              disabled={isPending}
            >
              <option value="todos">Todas las cuentas</option>
              <option value="con_saldo">Con saldo</option>
              <option value="atrasada">Atrasada</option>
              <option value="declaraciones_pendientes">Con declaraciones pendientes</option>
            </Select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <Field
            htmlFor="filtro-desde"
            label="Desde"
            error={rangoInvertido ? 'Posterior a "Hasta"' : undefined}
          >
            <Input
              id="filtro-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              disabled={isPending}
            />
          </Field>
        </div>

        <div>
          <Field htmlFor="filtro-hasta" label="Hasta">
            <Input
              id="filtro-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              disabled={isPending}
            />
          </Field>
        </div>

        <div>
          <Field htmlFor="filtro-orden" label="Ordenar por">
            <Select
              id="filtro-orden"
              value={orden}
              onChange={(e) => setOrden(e.target.value)}
              disabled={isPending}
            >
              {(Object.keys(ORDEN_PANEL_REVENDEDORAS_LABEL) as OrdenPanelRevendedoras[]).map((k) => (
                <option key={k} value={k}>
                  {ORDEN_PANEL_REVENDEDORAS_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={onAplicar}
            disabled={isPending || rangoInvertido}
          >
            {isPending ? 'Filtrando...' : 'Aplicar filtros'}
          </Button>
          {tieneFiltrosActivos && (
            <Button
              variant="neutral"
              onClick={onLimpiar}
              disabled={isPending}
            >
              Limpiar
            </Button>
          )}
          <Button variant="secondary" onClick={onExportar} disabled={exportarDisabled}>
            Exportar CSV
          </Button>
        </div>
      </div>
    </Card>
  )
}
