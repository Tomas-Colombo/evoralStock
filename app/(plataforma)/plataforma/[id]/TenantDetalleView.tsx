'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Kpi } from '@/components/ui/Kpi'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import { StatusDot } from '@/components/ui/StatusMark'
import {
  DataTable,
  TableFrame,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/TableParts'
import { useToast } from '@/components/ui/Toast'
import {
  anularMovimientoTenantAction,
  registrarCargoTenantAction,
  registrarPagoTenantAction,
  togglePaqueteTenantAction,
} from '@/app/(plataforma)/plataforma/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  CLAVES_PAQUETES_OPCIONALES,
  MEDIOS_PAGO_TENANT,
  type MedioPagoTenant,
  type MovimientoCuentaCorriente,
  type PaqueteOpcional,
  type TenantPlataformaDetalle,
} from '@/lib/types/plataforma'
import { hoyISO } from '@/lib/utils/hoy'
import { formatearMoneda } from '@/lib/utils/moneda'

const PAQUETES_META: Record<
  PaqueteOpcional,
  { label: string; descripcion: string }
> = {
  revendedoras: {
    label: 'Revendedoras',
    descripcion:
      'Módulo de venta por catálogo, asignación de stock en poder y liquidaciones.',
  },
  consignacionProveedor: {
    label: 'Consignación de proveedor',
    descripcion:
      'Recepción de artículos en consignación y generación periódica de rendiciones.',
  },
}

const MEDIOS_PAGO_LABELS: Record<MedioPagoTenant, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  otro: 'Otro',
}

function formatearFechaImputacion(fecha: string, tipo: 'cargo' | 'pago'): string {
  if (!fecha) return '—'
  if (tipo === 'cargo' && /^\d{4}-\d{2}/.test(fecha)) {
    const periodoIso = fecha.slice(0, 7)
    return new Date(`${periodoIso}-01T00:00:00`).toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    })
  }
  const limpia = fecha.split('T')[0]
  return new Date(`${limpia}T00:00:00`).toLocaleDateString('es-AR')
}

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

  // Formulario Cargo
  const [cargoPeriodo, setCargoPeriodo] = useState(() => hoyISO().slice(0, 7))
  const [cargoMonto, setCargoMonto] = useState('')
  const [cargoConcepto, setCargoConcepto] = useState('')

  // Formulario Pago
  const [pagoFecha, setPagoFecha] = useState(() => hoyISO())
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMedio, setPagoMedio] = useState<MedioPagoTenant>('transferencia')
  const [pagoNota, setPagoNota] = useState('')

  // Diálogos de confirmación
  const [paqueteADesactivar, setPaqueteADesactivar] = useState<PaqueteOpcional | null>(null)
  const [movimientoAAnular, setMovimientoAAnular] = useState<MovimientoCuentaCorriente | null>(null)

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

  function handleCargoSubmit(e: React.FormEvent) {
    e.preventDefault()
    const montoNum = Number(cargoMonto)
    if (!cargoMonto || isNaN(montoNum) || montoNum <= 0) {
      toast.error(mensajeDeError('monto-invalido'))
      return
    }
    if (!cargoConcepto.trim()) {
      toast.error(mensajeDeError('concepto-invalido'))
      return
    }

    startTransition(async () => {
      const res = await registrarCargoTenantAction({
        idTenant: detalle.tenant.idTenant,
        periodo: cargoPeriodo,
        monto: montoNum,
        concepto: cargoConcepto.trim(),
      })
      if (res.ok) {
        toast.success('Cargo registrado.')
        setModalCargoOpen(false)
        setCargoMonto('')
        setCargoConcepto('')
        router.refresh()
      } else {
        toast.error(mensajeDeError(res.reason))
      }
    })
  }

  function handlePagoSubmit(e: React.FormEvent) {
    e.preventDefault()
    const montoNum = Number(pagoMonto)
    if (!pagoMonto || isNaN(montoNum) || montoNum <= 0) {
      toast.error(mensajeDeError('monto-invalido'))
      return
    }

    startTransition(async () => {
      const res = await registrarPagoTenantAction({
        idTenant: detalle.tenant.idTenant,
        fecha: pagoFecha,
        monto: montoNum,
        medio: pagoMedio,
        nota: pagoNota.trim() || null,
      })
      if (res.ok) {
        toast.success('Pago registrado.')
        setModalPagoOpen(false)
        setPagoMonto('')
        setPagoNota('')
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
            <Badge variant={detalle.tenant.estadoTenant === 'activo' ? 'success' : 'neutral'}>
              {detalle.tenant.estadoTenant === 'activo' ? 'Activo' : detalle.tenant.estadoTenant}
            </Badge>
          </div>
          <div className="font-mono text-xs text-muted">
            Subdominio: <span className="text-ink">{detalle.tenant.subdominio}</span>
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
      <Card padding="md" className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-ink">
            Paquetes opcionales
          </h2>
          <p className="text-xs text-muted">
            Activá o desactivá módulos adicionales para este comercio. Los módulos del núcleo están siempre habilitados.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CLAVES_PAQUETES_OPCIONALES.map((pkg) => {
            const meta = PAQUETES_META[pkg]
            const habilitado = detalle.paquetes[pkg] ?? false
            return (
              <label
                key={pkg}
                htmlFor={`paquete-${pkg}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-panel p-3 transition-colors hover:bg-hover"
              >
                <div className="pt-0.5">
                  <Checkbox
                    id={`paquete-${pkg}`}
                    checked={habilitado}
                    disabled={isPending}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        setPaqueteADesactivar(pkg)
                      } else {
                        ejecutarTogglePaquete(pkg, true)
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-ink">
                    {meta.label}
                  </span>
                  <span className="text-xs text-muted">
                    {meta.descripcion}
                  </span>
                </div>
              </label>
            )
          })}
        </div>
      </Card>

      {/* Cuenta corriente e historial */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">
              Historial de cuenta corriente
            </h2>
            <p className="text-xs text-muted">
              Movimientos registrados entre la plataforma y el comercio.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setModalCargoOpen(true)}
            >
              Nuevo cargo
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setModalPagoOpen(true)}
            >
              Nuevo pago
            </Button>
          </div>
        </div>

        <TableFrame>
          <DataTable>
            <THead>
              <Th>Tipo</Th>
              <Th>Fecha / Período</Th>
              <Th>Concepto o medio</Th>
              <Th align="right">Monto</Th>
              <Th>Estado</Th>
              <Th align="right">
                <span className="sr-only">Acciones</span>
              </Th>
            </THead>
            <TBody>
              {detalle.historial.length === 0 ? (
                <Tr>
                  <Td colSpan={6} className="py-12 text-center text-sm text-muted">
                    Sin movimientos registrados todavía.
                  </Td>
                </Tr>
              ) : (
                detalle.historial.map((m) => {
                  const esCargo = m.tipo === 'cargo'
                  return (
                    <Tr
                      key={m.id}
                      className={
                        m.anulado
                          ? 'bg-card-3/40 opacity-60'
                          : 'hover:bg-hover'
                      }
                    >
                      <Td>
                        <span
                          className={`font-semibold ${
                            esCargo ? 'text-ink' : 'text-ok'
                          }`}
                        >
                          {esCargo ? 'Cargo' : 'Pago'}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-muted">
                          {formatearFechaImputacion(m.fechaImputacion, m.tipo)}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-col">
                          <span className="text-ink">
                            {esCargo
                              ? m.concepto || m.detalle
                              : MEDIOS_PAGO_LABELS[m.medio ?? 'otro'] ?? m.medio ?? 'Pago'}
                          </span>
                          {!esCargo && m.nota && (
                            <span className="text-xs text-muted">{m.nota}</span>
                          )}
                        </div>
                      </Td>
                      <Td align="right">
                        <span
                          className={`font-figure font-medium ${
                            m.anulado
                              ? 'line-through text-muted'
                              : esCargo
                                ? 'text-text'
                                : 'text-ok'
                          }`}
                        >
                          {esCargo ? '+ ' : '- '}
                          {formatearMoneda(m.monto)}
                        </span>
                      </Td>
                      <Td>
                        {m.anulado ? (
                          <Badge variant="danger">Anulado</Badge>
                        ) : (
                          <StatusDot tone="ok">Vigente</StatusDot>
                        )}
                      </Td>
                      <Td align="right">
                        {!m.anulado ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            onClick={() => setMovimientoAAnular(m)}
                          >
                            Anular
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  )
                })
              )}
            </TBody>
          </DataTable>
        </TableFrame>
      </div>

      {/* Modal Nuevo Cargo */}
      <Modal
        open={modalCargoOpen}
        title="Registrar nuevo cargo"
        onClose={() => setModalCargoOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={() => setModalCargoOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isPending}
              onClick={handleCargoSubmit}
            >
              {isPending ? 'Guardando…' : 'Registrar cargo'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCargoSubmit} className="flex flex-col gap-4">
          <Field
            htmlFor="cargo-periodo"
            label="Período contable"
            required
            hint="Elegí el mes al que corresponde este abono"
          >
            <input
              id="cargo-periodo"
              type="month"
              required
              value={cargoPeriodo}
              onChange={(e) => setCargoPeriodo(e.target.value)}
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>

          <Field htmlFor="cargo-monto" label="Monto" required>
            <NumberInput
              id="cargo-monto"
              thousands
              required
              value={cargoMonto}
              onChange={(e) => setCargoMonto(e.target.value)}
              placeholder="0,00"
            />
          </Field>

          <Field
            htmlFor="cargo-concepto"
            label="Concepto"
            required
            hint="Motivo o descripción del cargo"
          >
            <input
              id="cargo-concepto"
              type="text"
              required
              value={cargoConcepto}
              onChange={(e) => setCargoConcepto(e.target.value)}
              placeholder="Ej. Abono mensual Plan Base"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>
        </form>
      </Modal>

      {/* Modal Nuevo Pago */}
      <Modal
        open={modalPagoOpen}
        title="Registrar nuevo pago"
        onClose={() => setModalPagoOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={() => setModalPagoOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isPending}
              onClick={handlePagoSubmit}
            >
              {isPending ? 'Guardando…' : 'Registrar pago'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handlePagoSubmit} className="flex flex-col gap-4">
          <Field
            htmlFor="pago-fecha"
            label="Fecha del pago"
            required
            hint="No puede ser una fecha futura"
          >
            <input
              id="pago-fecha"
              type="date"
              max={hoyISO()}
              required
              value={pagoFecha}
              onChange={(e) => setPagoFecha(e.target.value)}
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>

          <Field htmlFor="pago-monto" label="Monto" required>
            <NumberInput
              id="pago-monto"
              thousands
              required
              value={pagoMonto}
              onChange={(e) => setPagoMonto(e.target.value)}
              placeholder="0,00"
            />
          </Field>

          <Field htmlFor="pago-medio" label="Medio de pago" required>
            <Select
              id="pago-medio"
              required
              value={pagoMedio}
              onChange={(e) => setPagoMedio(e.target.value as MedioPagoTenant)}
            >
              {MEDIOS_PAGO_TENANT.map((m) => (
                <option key={m} value={m}>
                  {MEDIOS_PAGO_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor="pago-nota"
            label="Nota u observación"
            hint="Opcional. Código de comprobante o referencia bancaria"
          >
            <input
              id="pago-nota"
              type="text"
              value={pagoNota}
              onChange={(e) => setPagoNota(e.target.value)}
              placeholder="Ej. Transferencia Banco Galicia #44912"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>
        </form>
      </Modal>

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
    </div>
  )
}
