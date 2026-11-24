'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { SelectUrl } from '@/components/filtros/SelectUrl'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  DataTable,
  TableFrame,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/TableParts'
import {
  ESTADOS_TENANT_FILTRO,
  ESTADOS_TENANT_LABEL,
  DEUDA_TENANT_FILTRO,
  DEUDA_TENANT_LABEL,
  ORDEN_TENANT_FILTRO,
  ORDEN_TENANT_LABEL,
  type TenantPlataformaResumen,
} from '@/lib/types/plataforma'
import type { FiltrosTenantsParsed } from '@/lib/validation/plataforma'
import { PAQUETES_INFO } from '@/lib/modulos/catalogo'
import { formatearMoneda } from '@/lib/utils/moneda'
import { NuevoTenantModal } from './NuevoTenantModal'

export interface TenantsViewProps {
  tenants: TenantPlataformaResumen[]
  total: number
  page: number
  pageSize: number
  filtros: FiltrosTenantsParsed
}

export function TenantsView({
  tenants,
  total,
  page,
  pageSize,
  filtros,
}: TenantsViewProps) {
  const router = useRouter()
  const [modalNuevoOpen, setModalNuevoOpen] = useState(false)

  const hayFiltrosActivos = Boolean(
    filtros.q || filtros.estado !== 'todos' || filtros.deuda !== 'todos',
  )

  // Estado vacío absoluto (sin comercios en toda la plataforma)
  if (total === 0 && !hayFiltrosActivos) {
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
      {/* Cabecera */}
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

      {/* Barra de filtros (D2, D7) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <BusquedaUrl
            valor={filtros.q}
            placeholder="Buscá por comercio o subdominio"
            paramPagina="page"
          />
        </div>
        <div className="w-full sm:w-44">
          <SelectUrl
            id="tenants-estado"
            param="estado"
            valor={filtros.estado}
            valorPorDefecto="todos"
            ariaLabel="Filtrar por estado"
            paramPagina="page"
            opciones={ESTADOS_TENANT_FILTRO.map((est) => ({
              value: est,
              label: ESTADOS_TENANT_LABEL[est],
            }))}
          />
        </div>
        <div className="w-full sm:w-44">
          <SelectUrl
            id="tenants-deuda"
            param="deuda"
            valor={filtros.deuda}
            valorPorDefecto="todos"
            ariaLabel="Filtrar por deuda"
            paramPagina="page"
            opciones={DEUDA_TENANT_FILTRO.map((deu) => ({
              value: deu,
              label: DEUDA_TENANT_LABEL[deu],
            }))}
          />
        </div>
        <div className="w-full sm:w-48">
          <SelectUrl
            id="tenants-orden"
            param="orden"
            valor={filtros.orden}
            valorPorDefecto="nombre_asc"
            ariaLabel="Ordenar comercios"
            paramPagina="page"
            opciones={ORDEN_TENANT_FILTRO.map((ord) => ({
              value: ord,
              label: ORDEN_TENANT_LABEL[ord],
            }))}
          />
        </div>
        {hayFiltrosActivos && (
          <Link
            href="/plataforma"
            className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Limpiar
          </Link>
        )}
      </div>

      {/* Tabla de resultados */}
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
            {tenants.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="py-12 text-center text-sm text-muted">
                  No se encontraron comercios para los filtros aplicados.
                </Td>
              </Tr>
            ) : (
              tenants.map((t) => (
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
                            {PAQUETES_INFO[pkg].nombre}
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

      {/* Paginación */}
      <PaginacionUrl
        page={page}
        pageSize={pageSize}
        total={total}
        param="page"
      />

      <NuevoTenantModal
        open={modalNuevoOpen}
        onClose={() => setModalNuevoOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
