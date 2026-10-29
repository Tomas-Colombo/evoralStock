'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Kpi } from '@/components/ui/Kpi'
import { useToast } from '@/components/ui/Toast'
import {
  anularMovimientoTenantAction,
  cambiarEstadoTenantAction,
  registrarCargoTenantAction,
  registrarPagoTenantAction,
  togglePaqueteTenantAction,
} from '@/app/(plataforma)/plataforma/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type {
  MedioPagoTenant,
  MovimientoCuentaCorriente,
  PaqueteOpcional,
  TenantPlataformaDetalle,
} from '@/lib/types/plataforma'
import { formatearMoneda } from '@/lib/utils/moneda'
import { HistorialTable } from './HistorialTable'
import { NuevoCargoModal } from './NuevoCargoModal'
import { NuevoPagoModal } from './NuevoPagoModal'
import { PAQUETES_META, PaquetesCard } from './PaquetesCard'

interface TenantDetalleViewProps {
  detalle: TenantPlataformaDetalle
}

export function TenantDetalleView({ detalle }: TenantDetalleViewProps) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  // Estado para modales de alta
  const [modalCargoOpen, setModalCargoOpen] = useState(false)
  const [modalPagoOpen, setModalPagoOpen] = useState(false)

  // Diálogos de confirmación
  const [paqueteADesactivar, setPaqueteADesactivar] = useState<PaqueteOpcional | null>(null)
  const [movimientoAAnular, setMovimientoAAnular] = useState<MovimientoCuentaCorriente | null>(null)
  const [modalSuspenderReactivarOpen, setModalSuspenderReactivarOpen] = useState(false)

  function ejecutarTogglePaquete(paquete: PaqueteOpcional, habilitado: boolean) {
    startTransition(async () => {
      const res = await togglePaqueteTenantAction({
        idTenant: detalle.tenant.idTenant,
        paquete,
        habilitado,
      })
      if (res.ok) {
        toast.success(`Paquete ${habilitado ? 'activado' : 'desactivado'}.`)
        setPaqueteADesactivar(null)
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
        setPaqueteADesactivar(null)
      }
    })
  }

  function handleTogglePaquete(paquete: PaqueteOpcional, habilitado: boolean) {
    if (!habilitado) {
      setPaqueteADesactivar(paquete)
    } else {
      ejecutarTogglePaquete(paquete, true)
    }
  }

  function handleCargoSubmit(datos: {
    periodo: string
    monto: number
    concepto: string
  }) {
    if (!datos.monto || isNaN(datos.monto) || datos.monto <= 0) {
      toast.error(mensajeDeError('monto-invalido'))
      return
    }
    if (!datos.concepto.trim()) {
      toast.error(mensajeDeError('concepto-invalido'))
      return
    }

    startTransition(async () => {
      const res = await registrarCargoTenantAction({
        idTenant: detalle.tenant.idTenant,
        periodo: datos.periodo,
        monto: datos.monto,
        concepto: datos.concepto.trim(),
      })
      if (res.ok) {
        toast.success('Cargo registrado.')
        setModalCargoOpen(false)
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
      }
    })
  }

  function handlePagoSubmit(datos: {
    fecha: string
    monto: number
    medio: MedioPagoTenant
    nota: string | null
  }) {
    if (!datos.monto || isNaN(datos.monto) || datos.monto <= 0) {
      toast.error(mensajeDeError('monto-invalido'))
      return
    }

    startTransition(async () => {
      const res = await registrarPagoTenantAction({
        idTenant: detalle.tenant.idTenant,
        fecha: datos.fecha,
        monto: datos.monto,
        medio: datos.medio,
        nota: datos.nota ? datos.nota.trim() : null,
      })
      if (res.ok) {
        toast.success('Pago registrado.')
        setModalPagoOpen(false)
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
      }
    })
  }

  function ejecutarAnulacion() {
    if (!movimientoAAnular) return
    startTransition(async () => {
      const res = await anularMovimientoTenantAction({
        tipo: movimientoAAnular.tipo,
        idMovimiento: movimientoAAnular.id,
      })
      if (res.ok) {
        toast.success('Movimiento anulado.')
        setMovimientoAAnular(null)
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
        setMovimientoAAnular(null)
      }
    })
  }

  function ejecutarCambioEstado() {
    const nuevoEstado = detalle.tenant.estadoTenant === 'activo' ? 'suspendido' : 'activo'
    startTransition(async () => {
      const res = await cambiarEstadoTenantAction({
        idTenant: detalle.tenant.idTenant,
        estado: nuevoEstado,
      })
      if (res.ok) {
        toast.success(
          nuevoEstado === 'suspendido'
            ? 'Comercio suspendido.'
            : 'Comercio reactivado.',
        )
        setModalSuspenderReactivarOpen(false)
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
        setModalSuspenderReactivarOpen(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cabecera / Ficha */}
      <div className="flex flex-col gap-2">
        <div>
          <Link
            href="/plataforma"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            ← Volver a comercios
          </Link>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              {detalle.tenant.nombreComercial}
            </h1>
            <Badge variant={detalle.tenant.estadoTenant === 'activo' ? 'success' : 'danger'}>
              {detalle.tenant.estadoTenant === 'activo' ? 'Activo' : 'Suspendido'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="font-mono text-xs text-muted">
              Subdominio: <span className="text-ink">{detalle.tenant.subdominio}</span>
            </div>
            {detalle.tenant.estadoTenant === 'activo' ? (
              <Button
                variant="danger"
                size="sm"
                disabled={isPending}
                onClick={() => setModalSuspenderReactivarOpen(true)}
              >
                Suspender comercio
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={isPending}
                onClick={() => setModalSuspenderReactivarOpen(true)}
              >
                Reactivar comercio
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          label="Saldo de cuenta corriente"
          value={formatearMoneda(Math.abs(detalle.saldo))}
          sub={
            detalle.saldo > 0
              ? 'Deuda pendiente de cobro'
              : detalle.saldo === 0
                ? 'Al día'
                : 'Saldo a favor del comercio'
          }
          variant={detalle.saldo > 0 ? 'alert' : 'default'}
        />
        <Kpi
          label="Total cargos acumulados"
          value={formatearMoneda(detalle.totalCargos)}
          sub="Cargos facturados vigentes"
        />
        <Kpi
          label="Total pagos recibidos"
          value={formatearMoneda(detalle.totalPagos)}
          sub="Pagos acreditados vigentes"
        />
      </div>

      {/* Panel de Paquetes opcionales */}
      <PaquetesCard
        paquetes={detalle.paquetes}
        isPending={isPending}
        onToggle={handleTogglePaquete}
      />

      {/* Cuenta corriente e historial */}
      <HistorialTable
        historial={detalle.historial}
        isPending={isPending}
        onSolicitarAnular={setMovimientoAAnular}
        onAbrirNuevoCargo={() => setModalCargoOpen(true)}
        onAbrirNuevoPago={() => setModalPagoOpen(true)}
      />

      {/* Modal Nuevo Cargo */}
      <NuevoCargoModal
        open={modalCargoOpen}
        isPending={isPending}
        onClose={() => setModalCargoOpen(false)}
        onSubmit={handleCargoSubmit}
      />

      {/* Modal Nuevo Pago */}
      <NuevoPagoModal
        open={modalPagoOpen}
        isPending={isPending}
        onClose={() => setModalPagoOpen(false)}
        onSubmit={handlePagoSubmit}
      />

      {/* ConfirmDialog Desactivar Paquete */}
      <ConfirmDialog
        open={paqueteADesactivar !== null}
        title={
          paqueteADesactivar
            ? `¿Desactivar paquete ${PAQUETES_META[paqueteADesactivar].label}?`
            : ''
        }
        description="Al desactivar este paquete se ocultarán los accesos y funciones para este comercio. Si tiene mercadería asociada o estado vivo, la base de datos rechazará la operación."
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          if (paqueteADesactivar) {
            ejecutarTogglePaquete(paqueteADesactivar, false)
          }
        }}
        onCancel={() => setPaqueteADesactivar(null)}
      />

      {/* ConfirmDialog Anular Movimiento */}
      <ConfirmDialog
        open={movimientoAAnular !== null}
        title={
          movimientoAAnular
            ? `¿Anular este ${movimientoAAnular.tipo === 'cargo' ? 'cargo' : 'pago'}?`
            : ''
        }
        description={
          movimientoAAnular
            ? `Se anulará el ${movimientoAAnular.tipo} de ${formatearMoneda(movimientoAAnular.monto)}. El saldo del comercio se recalculará automáticamente sin este movimiento. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Anular movimiento"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={ejecutarAnulacion}
        onCancel={() => setMovimientoAAnular(null)}
      />

      {/* ConfirmDialog Suspender/Reactivar Tenant */}
      <ConfirmDialog
        open={modalSuspenderReactivarOpen}
        title={
          detalle.tenant.estadoTenant === 'activo'
            ? `¿Suspender ${detalle.tenant.nombreComercial}?`
            : `¿Reactivar ${detalle.tenant.nombreComercial}?`
        }
        description={
          detalle.tenant.estadoTenant === 'activo'
            ? 'Al suspender este comercio, los usuarios no podrán ingresar al sistema ni operar hasta que sea reactivado. Las sesiones activas caducarán en su próximo intento de autenticación.'
            : 'El comercio volverá a estar activo y sus usuarios podrán iniciar sesión y operar normalmente.'
        }
        confirmLabel={
          detalle.tenant.estadoTenant === 'activo'
            ? 'Suspender comercio'
            : 'Reactivar comercio'
        }
        cancelLabel="Cancelar"
        variant={detalle.tenant.estadoTenant === 'activo' ? 'danger' : 'default'}
        onConfirm={ejecutarCambioEstado}
        onCancel={() => setModalSuspenderReactivarOpen(false)}
      />
    </div>
  )
}
