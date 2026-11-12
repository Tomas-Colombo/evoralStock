'use client'

import React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { FinanzasRankingRow } from '@/lib/types/reportes'
import { Table, type Column } from '@/components/ui/Table'

function formatMoney(value: number | null | undefined) {
  if (value == null) return 'Sin permiso'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
}

interface BloqueRankingProps {
  ranking: FinanzasRankingRow[]
  ordenActual: string
}

import { escapeCsvField, downloadCsv } from '@/lib/utils/csv'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

export function BloqueRanking({ ranking, ordenActual }: BloqueRankingProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const handleOrdenChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('orden', e.target.value)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const exportarCSV = () => {
    const header = ['Producto', 'Unidades vendidas', 'Monto vendido', 'Ganancia']
    const csvRows = [header.join(',')]
    ranking.forEach(r => {
      csvRows.push([
        escapeCsvField(r.nombre),
        r.unidades_vendidas,
        r.monto_vendido,
        r.ganancia ?? 'Sin permiso'
      ].join(','))
    })
    downloadCsv(`ranking-productos-${ordenActual}.csv`, csvRows.join('\n'))
  }

  const columns: Column<FinanzasRankingRow>[] = [
    {
      key: 'nombre',
      label: 'Producto',
      render: (item) => <span className="font-medium text-ink truncate max-w-[200px]" title={item.nombre}>{item.nombre}</span>
    },
    {
      key: 'unidades_vendidas',
      label: 'Unidades',
      align: 'right',
      render: (item) => <span className="tabular-nums text-ink">{item.unidades_vendidas}</span>
    },
    {
      key: 'monto_vendido',
      label: 'Monto vendido',
      align: 'right',
      render: (item) => <span className="tabular-nums text-ink">{formatMoney(item.monto_vendido)}</span>
    },
    {
      key: 'ganancia',
      label: 'Ganancia',
      align: 'right',
      render: (item) => <span className="tabular-nums text-ink font-medium">{formatMoney(item.ganancia)}</span>
    }
  ]

  return (
    <Card as="section" padding="none" aria-labelledby="h2-ranking" className="overflow-hidden">
      <div className="p-4 border-b border-border bg-panel flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h2 id="h2-ranking" className="font-display text-lg">Los que más rinden</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select
            value={ordenActual}
            onChange={handleOrdenChange}
            className="h-9 sm:w-auto px-3 py-2 text-sm"
            aria-label="Ordenar ranking por"
          >
            <option value="ganancia">Mayor ganancia</option>
            <option value="unidades">Más unidades vendidas</option>
            <option value="monto">Mayor monto facturado</option>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportarCSV}
          >
            Exportar CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table 
          columns={columns} 
          data={ranking} 
          emptyState="No hubo ventas de productos en este período."
        />
      </div>
    </Card>
  )
}
