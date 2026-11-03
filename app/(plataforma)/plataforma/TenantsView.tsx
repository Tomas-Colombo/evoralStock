'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
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
  type EstadoTenantFiltro,
  type DeudaTenantFiltro,
  type OrdenTenantFiltro,
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
  const [pending, startTransition] = useTransition()

  const [q, setQ] = useState(filtros.q)
  const [estado, setEstado] = useState<EstadoTenantFiltro>(filtros.estado)
  const [deuda, setDeuda] = useState<DeudaTenantFiltro>(filtros.deuda)
  const [orden, setOrden] = useState<OrdenTenantFiltro>(filtros.orden)
  const [modalNuevoOpen, setModalNuevoOpen] = useState(false)

  const hayFiltrosActivos = Boolean(
    filtros.q || filtros.estado !== 'todos' || filtros.deuda !== 'todos',
  )

  function navegar(next: {
    q?: string
    estado?: EstadoTenantFiltro
    deuda?: DeudaTenantFiltro
    orden?: OrdenTenantFiltro
    page?: number
  }) {
    const params = new URLSearchParams()
    const texto = (next.q !== undefined ? next.q : q).trim()
    const est = next.estado ?? estado
    const deu = next.deuda ?? deuda
    const ord = next.orden ?? orden
    const pag = next.page ?? 1

    if (texto) params.set('q', texto)
    if (est && est !== 'todos') params.set('estado', est)
    if (deu && deu !== 'todos') params.set('deuda', deu)
    if (ord && ord !== 'nombre_asc') params.set('orden', ord)
    if (pag > 1) params.set('page', String(pag))

    const qs = params.toString()
    startTransition(() => router.push(qs ? `/plataforma?${qs}` : '/plataforma'))
  }

  function limpiarFiltros() {
    setQ('')
    setEstado('todos')
    setDeuda('todos')
    setOrden('nombre_asc')
    startTransition(() => router.push('/plataforma'))
  }

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
          <FilterBar
            value={q}
            onChange={setQ}
            placeholder="Buscá por comercio o subdominio"
          />
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={estado}
            onChange={(e) => {
              const val = e.target.value as EstadoTenantFiltro
              setEstado(val)
              navegar({ estado: val, page: 1 })
            }}
            disabled={pending}
            aria-label="Filtrar por estado"
          >
            {ESTADOS_TENANT_FILTRO.map((est) => (
              <option key={est} value={est}>
                {ESTADOS_TENANT_LABEL[est]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={deuda}
            onChange={(e) => {
              const val = e.target.value as DeudaTenantFiltro
              setDeuda(val)
              navegar({ deuda: val, page: 1 })
            }}
            disabled={pending}
            aria-label="Filtrar por deuda"
          >
            {DEUDA_TENANT_FILTRO.map((deu) => (
              <option key={deu} value={deu}>
                {DEUDA_TENANT_LABEL[deu]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={orden}
            onChange={(e) => {
              const val = e.target.value as OrdenTenantFiltro
              setOrden(val)
              navegar({ orden: val, page: 1 })
            }}
            disabled={pending}
            aria-label="Ordenar comercios"
          >
            {ORDEN_TENANT_FILTRO.map((ord) => (
              <option key={ord} value={ord}>
                {ORDEN_TENANT_LABEL[ord]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => navegar({ q, page: 1 })}
            disabled={pending}
          >
            Filtrar
          </Button>
          {hayFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              disabled={pending}
            >
              Limpiar
            </Button>
          )}
        </div>
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
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => navegar({ page: p })}
        disabled={pending}
      />

      <NuevoTenantModal
        open={modalNuevoOpen}
        onClose={() => setModalNuevoOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
