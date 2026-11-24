'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { SelectUrl } from '@/components/filtros/SelectUrl'
import { Table, type Column } from '@/components/ui/Table'
import { waMeLink } from '@/lib/utils/waMeLink'
import {
  FILTRO_ESTADO_CUOTAS_LABEL,
  nombreCliente,
  type FiltroEstadoCuotas,
} from '@/lib/types/ventas'
import type { DeudorRow } from '@/lib/dal/cuotas/cuota'
import { TableFrame } from '@/components/ui/TableParts'

/**
 * Listado de deudores. Cada fila es un cliente y todo lo que se puede hacer
 * con él está en su ficha: cobrar una cuota concreta exige elegir CUÁL, y esa
 * decisión necesita ver el plan completo.
 */
export function CuotasView({
  rows,
  estado,
  initialSearch,
  page,
  pageSize,
  total,
  hoy,
}: {
  rows: DeudorRow[]
  estado: FiltroEstadoCuotas
  initialSearch: string
  page: number
  pageSize: number
  total: number
  /** `YYYY-MM-DD` del server: la misma con la que se calcularon los KPIs. */
  hoy: string
}) {
  /** La ficha vuelve a Cuotas y no a Clientes cuando se entra desde acá. */
  function href(d: DeudorRow): string {
    return `/clientes/${d.id_cliente}?from=cuotas`
  }

  const columns: Column<DeudorRow>[] = [
    {
      key: 'cliente',
      label: 'Cliente',
      render: (d) => {
        const wa = waMeLink(d.cliente?.telefono ?? null)
        return (
          <div>
            <Link href={href(d)} className="font-medium hover:underline">
              {nombreCliente(d.cliente)}
            </Link>
            {wa && (
              <div>
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                >
                  WhatsApp
                </a>
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'pendientes',
      label: 'Pendientes',
      align: 'right',
      render: (d) => (
        <div>
          <span className="font-mono">{d.pendientes}</span>
          {/* Dos compras financiadas son dos planes distintos que caen en los
              mismos meses. Sin este dato, doce cuotas parecen un solo plan. */}
          {d.planes > 1 && (
            <div className="text-xs text-muted">en {d.planes} compras</div>
          )}
        </div>
      ),
    },
    {
      key: 'adeudado',
      label: 'Adeudado',
      align: 'right',
      render: (d) => <span className="font-mono font-semibold">{money(d.adeudado)}</span>,
    },
    {
      key: 'vencido',
      label: 'Vencido',
      align: 'right',
      // El monto solo no distingue dos días de atraso de tres meses, y esa
      // diferencia ES la gestión: uno es un recordatorio y el otro una
      // llamada. Por eso la antigüedad de la cuota más vieja va debajo del
      // monto, y no escondida en la ficha del cliente.
      render: (d) => {
        if (d.vencido <= 0) return <span className="text-muted">—</span>
        const atraso = d.vencida_desde ? diasHasta(d.vencida_desde, hoy) : 0
        return (
          <div>
            <span className="font-mono font-semibold text-alerta-ink">
              {money(d.vencido)}
            </span>
            <div className="text-xs text-muted">
              {d.vencidas} cuota{d.vencidas === 1 ? '' : 's'}
              {atraso > 0 && ` · ${textoAtraso(atraso)}`}
            </div>
          </div>
        )
      },
    },
    {
      key: 'proximo',
      label: 'Próximo vence',
      render: (d) => {
        if (d.vencido > 0 && !d.proximo_vencimiento) {
          return <Badge variant="danger">Todo vencido</Badge>
        }
        if (!d.proximo_vencimiento) return <span className="text-muted">—</span>
        const dias = diasHasta(hoy, d.proximo_vencimiento)
        // Hoy y mañana son los dos días en los que todavía se puede hacer
        // algo, y por eso son los únicos que llevan chapa. Antes vencía hoy y
        // se leía igual que "en 23 días": texto chico y gris.
        if (dias <= 1) {
          return (
            <div className="space-y-1">
              <Badge variant={dias === 0 ? 'warning' : 'info'}>
                {dias === 0 ? 'Vence hoy' : 'Vence mañana'}
              </Badge>
              <div className="text-xs text-muted">{fecha(d.proximo_vencimiento)}</div>
            </div>
          )
        }
        return (
          <div>
            <div>{fecha(d.proximo_vencimiento)}</div>
            <div className="text-xs text-muted">
              en {dias} día{dias === 1 ? '' : 's'}
            </div>
          </div>
        )
      },
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (d) => (
        <Link href={href(d)}>
          <Button size="sm" variant="ghost">
            Ver cuotas
          </Button>
        </Link>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <BusquedaUrl
            valor={initialSearch}
            placeholder="Buscar por nombre o apellido"
            paramPagina="page"
          />
        </div>
        <div className="w-48">
          <SelectUrl
            id="cuotas-estado"
            param="estado"
            valor={estado}
            valorPorDefecto="con_deuda"
            ariaLabel="Estado"
            paramPagina="page"
            opciones={(Object.keys(FILTRO_ESTADO_CUOTAS_LABEL) as FiltroEstadoCuotas[]).map((k) => ({
              value: k,
              label: FILTRO_ESTADO_CUOTAS_LABEL[k],
            }))}
          />
        </div>
      </div>

      <TableFrame>
        <Table
          columns={columns}
          data={rows}
          getRowId={(d) => d.id_cliente}
          emptyState={
            estado === 'con_deuda'
              ? 'Sin deuda pendiente. Nadie te debe nada.'
              : 'Ningún cliente coincide con el filtro.'
          }
        />
      </TableFrame>

      <PaginacionUrl
        page={page}
        pageSize={pageSize}
        total={total}
        param="page"
      />
    </div>
  )
}

/**
 * Atraso legible. Los días sueltos importan la primera semana; después lo que
 * se lee es la magnitud, y "hace 97 días" obliga a dividir mentalmente.
 */
function textoAtraso(dias: number): string {
  if (dias < 7) return `hace ${dias} día${dias === 1 ? '' : 's'}`
  if (dias < 60) {
    const semanas = Math.floor(dias / 7)
    return `hace ${semanas} semana${semanas === 1 ? '' : 's'}`
  }
  const meses = Math.floor(dias / 30)
  return `hace ${meses} meses`
}

/** Días desde `hoy` hasta `iso`. Negativo = ya venció. */
function diasHasta(hoy: string, iso: string): number {
  const a = Date.parse(`${hoy}T00:00:00Z`)
  const b = Date.parse(`${iso}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

function fecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR')
}

function money(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
