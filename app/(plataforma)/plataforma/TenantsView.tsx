'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import {
  DataTable,
  TableFrame,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/TableParts'
import type { TenantPlataformaResumen } from '@/lib/types/plataforma'
import { formatearMoneda } from '@/lib/utils/moneda'
import { NuevoTenantModal } from './NuevoTenantModal'

const PAQUETES_LABELS: Record<string, string> = {
  revendedoras: 'Revendedoras',
  consignacionProveedor: 'Consignación de proveedor',
}

interface TenantsViewProps {
  tenants: TenantPlataformaResumen[]
}

export function TenantsView({ tenants }: TenantsViewProps) {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [modalNuevoOpen, setModalNuevoOpen] = useState(false)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(
      (t) =>
        t.nombreComercial.toLowerCase().includes(q) ||
        t.subdominio.toLowerCase().includes(q),
    )
  }, [tenants, busqueda])

  if (tenants.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <EmptyState
          title="Sin comercios todavía"
          description="No hay comercios registrados en la plataforma."
          cta={{
            label: 'Nuevo tenant',
            onClick: () => setModalNuevoOpen(true),
          }}
        />
        <NuevoTenantModal
          open={modalNuevoOpen}
          onClose={() => setModalNuevoOpen(false)}
          onSuccess={() => router.refresh()}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Comercios
          </h1>
          <p className="text-sm text-muted">
            Listado general de tenants, módulos habilitados y estado de cuenta corriente.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setModalNuevoOpen(true)}
        >
          Nuevo tenant
        </Button>
      </div>

      <div className="w-full max-w-md">
        <FilterBar
          value={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar por nombre o subdominio"
        />
      </div>

      <TableFrame>
        <DataTable>
          <THead>
            <Th>Comercio</Th>
            <Th>Subdominio</Th>
            <Th>Estado</Th>
            <Th>Paquetes</Th>
            <Th align="right">Saldo</Th>
            <Th align="right">
              <span className="sr-only">Acciones</span>
            </Th>
          </THead>
          <TBody>
            {filtrados.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="py-12 text-center text-sm text-muted">
                  No se encontraron comercios que coincidan con &ldquo;{busqueda}&rdquo;.
                </Td>
              </Tr>
            ) : (
              filtrados.map((t) => (
                <Tr key={t.idTenant} className="hover:bg-hover">
                  <Td>
                    <Link
                      href={`/plataforma/${t.idTenant}`}
                      className="font-medium text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      {t.nombreComercial}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-muted">
                      {t.subdominio}
                    </span>
                  </Td>
                  <Td>
                    <Badge variant={t.estadoTenant === 'activo' ? 'success' : 'danger'}>
                      {t.estadoTenant === 'activo' ? 'Activo' : 'Suspendido'}
                    </Badge>
                  </Td>
                  <Td>
                    {t.paquetesHabilitados.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {t.paquetesHabilitados.map((pkg) => (
                          <Badge key={pkg} variant="neutral">
                            {PAQUETES_LABELS[pkg] ?? pkg}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    {t.saldo > 0 ? (
                      <span className="font-figure font-medium text-alerta-ink">
                        {formatearMoneda(t.saldo)} (deuda)
                      </span>
                    ) : t.saldo === 0 ? (
                      <Badge variant="success">Al día</Badge>
                    ) : (
                      <span className="font-figure font-medium text-ok">
                        {formatearMoneda(Math.abs(t.saldo))} a favor
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Link
                      href={`/plataforma/${t.idTenant}`}
                      className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      Ver detalle
                    </Link>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </DataTable>
      </TableFrame>

      <NuevoTenantModal
        open={modalNuevoOpen}
        onClose={() => setModalNuevoOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
