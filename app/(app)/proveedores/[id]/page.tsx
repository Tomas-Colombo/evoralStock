import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { Kpi } from '@/components/ui/Kpi'
import { verifySession } from '@/lib/dal/session'
import { hasModuleAccess, hasPermission } from '@/lib/dal/guard'
import { proyectarIngresosConResumen } from '@/lib/inventario/proyeccion-costos'
import { capacidades } from '@/lib/modulos/capacidades'
import {
  getPerfilProveedorPorId,
  getProveedor,
} from '@/lib/dal/inventario/proveedor'
import { listIngresosDeProveedor } from '@/lib/dal/inventario/ingreso'
import { listConsignaciones } from '@/lib/dal/consignaciones/consignacion'
import { listRendiciones } from '@/lib/dal/rendiciones/rendicion'
import { waMeLink } from '@/lib/utils/waMeLink'
import { ESTADO_CONSIGNACION_LABEL } from '@/lib/types/consignaciones'
import { ESTADO_RENDICION_LABEL } from '@/lib/types/rendiciones'
import { BajaProveedorButton } from './BajaProveedorButton'
import { EditarProveedorButton } from './EditarProveedorButton'
import { PerfilPeriodoForm } from './PerfilPeriodoForm'
import { PerfilPaginacion } from './PerfilPaginacion'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

const PAGE_SIZE = 10

export default async function ProveedorPerfilPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    desde?: string
    hasta?: string
    ing_page?: string
    cons_page?: string
    rend_page?: string
  }>
}) {
  const session = await verifySession()
  const puedeEditar = hasPermission(session, 'inventario', 'editar')
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const puedeVerRendiciones = hasModuleAccess(session, 'rendiciones', 'ver')
  const puedeVerMontosProveedor = puedeVerCostos || puedeVerRendiciones
  const cap = capacidades(session.modulosHabilitados)
  const { id } = await props.params
  const sp = await props.searchParams

  const proveedor = await getProveedor(id)
  if (!proveedor) notFound()

  const [perfil, ingresosAll, consignacionesAll, rendicionesAll] = await Promise.all([
    cap.consignacionProveedor
      ? getPerfilProveedorPorId(id, { puedeVerCostos, puedeVerRendiciones })
      : null,
    listIngresosDeProveedor(id).then((r) => proyectarIngresosConResumen(r, puedeVerCostos)),
    cap.consignacionProveedor ? listConsignaciones({ idProveedor: id }) : Promise.resolve([]),
    cap.consignacionProveedor && puedeVerMontosProveedor
      ? listRendiciones({ idProveedor: id })
      : Promise.resolve([]),
  ])

  // Filtro de fechas compartido (vacío = sin filtro). El input <input type="date">
  // manda 'YYYY-MM-DD'; sumamos 23:59:59 al hasta para que sea inclusive.
  const desdeMs = sp.desde ? new Date(sp.desde).getTime() : null
  const hastaMs = sp.hasta
    ? new Date(new Date(sp.hasta).setHours(23, 59, 59, 999)).getTime()
    : null

  function enRango(iso: string): boolean {
    if (!desdeMs && !hastaMs) return true
    const t = new Date(iso).getTime()
    if (desdeMs && t < desdeMs) return false
    if (hastaMs && t > hastaMs) return false
    return true
  }

  const ingresosFiltrados = ingresosAll.filter((i) => enRango(i.fecha))
  const consignacionesFiltradas = consignacionesAll.filter((c) => enRango(c.fecha))
  const rendicionesFiltradas = rendicionesAll.filter((r) => enRango(r.fecha_generacion))

  const ingPage = Math.max(1, Number.parseInt(sp.ing_page ?? '1', 10) || 1)
  const consPage = Math.max(1, Number.parseInt(sp.cons_page ?? '1', 10) || 1)
  const rendPage = Math.max(1, Number.parseInt(sp.rend_page ?? '1', 10) || 1)

  const ingresos = ingresosFiltrados.slice((ingPage - 1) * PAGE_SIZE, ingPage * PAGE_SIZE)
  const consignaciones = consignacionesFiltradas.slice((consPage - 1) * PAGE_SIZE, consPage * PAGE_SIZE)
  const rendiciones = rendicionesFiltradas.slice((rendPage - 1) * PAGE_SIZE, rendPage * PAGE_SIZE)

  const wa = waMeLink(proveedor.telefono)

  // Se vuelve por donde se vino: los detalles a los que salta este perfil
  // reciben un `?from=` con la URL actual, así el botón "volver" del Topbar
  // devuelve acá y no al listado de la otra sección. Cada tabla propaga SU
  // paginación (el resto ya está en la primera página, no hace falta fijarla).
  function volverAqui(pageKey: 'ing_page' | 'cons_page' | 'rend_page', page: number): string {
    const qs = new URLSearchParams()
    if (sp.desde) qs.set('desde', sp.desde)
    if (sp.hasta) qs.set('hasta', sp.hasta)
    if (page > 1) qs.set(pageKey, String(page))
    const query = qs.toString()
    return `/proveedores/${id}${query ? `?${query}` : ''}`
  }

  return (
    <>
      <Topbar title={proveedor.nombre} session={session} backHref="/proveedores" />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        {/* ─── Cabecera ─────────────────────────────────── */}
        <Card as="section" padding="none">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 space-y-1.5">
              <h2 className="font-display text-2xl leading-tight">{proveedor.nombre}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={proveedor.activo ? 'success' : 'neutral'}>
                  {proveedor.activo ? 'Activo' : 'Inactivo'}
                </Badge>
                <span className="font-mono text-xs uppercase text-muted">{proveedor.tipo}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {puedeEditar && <EditarProveedorButton proveedor={proveedor} />}
              <BajaProveedorButton
                id={proveedor.id_proveedor}
                activo={proveedor.activo}
                tieneDeudaPendiente={Boolean(
                  perfil &&
                    perfil.monto_pendiente_rendicion != null &&
                    perfil.monto_pendiente_rendicion > 0,
                )}
              />
            </div>
          </header>

          <dl className="grid grid-cols-1 gap-y-3 gap-x-8 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dato label="Teléfono">
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                >
                  {proveedor.telefono} · WhatsApp
                </a>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Dato>
            <Dato label="Email">
              {proveedor.email ?? <span className="text-muted">—</span>}
            </Dato>
            <Dato label="CUIT">
              {proveedor.cuit ?? <span className="text-muted">—</span>}
            </Dato>
            <Dato label="Días de rotación">
              {proveedor.dias_rotacion != null
                ? `${proveedor.dias_rotacion} días`
                : <span className="text-muted">—</span>}
            </Dato>
          </dl>

          {proveedor.notas && (
            <div className="border-t border-border px-5 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
                Notas
              </div>
              <p className="text-sm text-text whitespace-pre-wrap">{proveedor.notas}</p>
            </div>
          )}
        </Card>

        {/* ─── Deuda y contadores ──────────────────────── */}
        {cap.consignacionProveedor && perfil && (
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {puedeVerMontosProveedor && perfil.deuda_total_consignacion != null && (
            <Kpi
              label="Deuda total"
              value={fmtMoney(perfil.deuda_total_consignacion)}
              sub="Pendiente de rendir + valor stock consig."
              variant={perfil.deuda_total_consignacion > 0 ? 'alert' : 'default'}
            />
          )}
          {puedeVerCostos && perfil.valor_stock_consignacion != null && (
            <Kpi
              label="Valor stock consig."
              value={fmtMoney(perfil.valor_stock_consignacion)}
              sub={`${perfil.items_en_stock_consignacion ?? 0} ítem${perfil.items_en_stock_consignacion === 1 ? '' : 's'} a costo${(perfil.items_costo_pendiente_consignacion ?? 0) > 0 ? ` · ${perfil.items_costo_pendiente_consignacion} con costo pendiente` : ''}`}
            />
          )}
          {puedeVerMontosProveedor && perfil.monto_pendiente_rendicion != null && (
            <Kpi
              label="Pendiente de rendir"
              value={fmtMoney(perfil.monto_pendiente_rendicion)}
              sub={`${perfil.lineas_pendientes_rendicion ?? 0} línea${perfil.lineas_pendientes_rendicion === 1 ? '' : 's'} vendida${perfil.lineas_pendientes_rendicion === 1 ? '' : 's'} sin rendir`}
              variant={perfil.monto_pendiente_rendicion > 0 ? 'alert' : 'default'}
            />
          )}
          {puedeVerMontosProveedor && perfil.rendiciones_pendientes_pago != null && (
            <Kpi
              label="Rendiciones sin pagar"
              value={perfil.rendiciones_pendientes_pago.toString()}
              variant={perfil.rendiciones_pendientes_pago > 0 ? 'alert' : 'default'}
            />
          )}
          {puedeVerMontosProveedor && perfil.monto_rendido_historico != null && (
            <Kpi
              label="Rendido histórico"
              value={fmtMoney(perfil.monto_rendido_historico)}
            />
          )}
          <Kpi
            label="Consignaciones activas"
            value={perfil.consignaciones_activas.toString()}
          />
        </section>

        )}

        {/* ─── Filtro de período compartido ────────────── */}
        <PerfilPeriodoForm id={id} desde={sp.desde ?? ''} hasta={sp.hasta ?? ''} />

        {/* ─── Ingresos ────────────────────────────────── */}
        <section className="space-y-2">
          <TableFrame>
            <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg">Ingresos de mercadería</h3>
              <span className="text-xs text-muted font-mono">
                {ingresosFiltrados.length} en el período
              </span>
            </div>
            {ingresos.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">
                Sin ingresos en el período seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable>
                  <THead>
                    <Th>Fecha</Th>
                    <Th>Tipo</Th>
                    <Th>Remito</Th>
                    <Th align="right">Líneas</Th>
                    <Th align="right">Cantidad</Th>
                    {puedeVerCostos && <Th align="right">Costo total</Th>}
                    <Th />
                  </THead>
                  <TBody>
                    {ingresos.map((i) => (
                      <Tr key={i.id_ingreso}>
                        <Td className="text-xs text-muted">
                          {new Date(i.fecha).toLocaleDateString('es-AR')}
                        </Td>
                        <Td>
                          <span className="font-mono text-xs uppercase">{i.tipo_ingreso}</span>
                        </Td>
                        <Td className="font-mono text-xs">
                          {i.numero_remito ?? <span className="text-muted">—</span>}
                        </Td>
                        <Td align="right" className="font-mono">{i.total_lineas}</Td>
                        <Td align="right" className="font-mono">{i.total_cantidad}</Td>
                        {puedeVerCostos && <Td align="right" className="font-mono">{i.total_costo != null ? fmtMoney(i.total_costo) : '—'}</Td>}
                        <Td align="right">
                          <Link
                            href={`/inventario/ingresos/${i.id_ingreso}?from=${encodeURIComponent(volverAqui('ing_page', ingPage))}`}
                            className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                          >
                            Ver
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </DataTable>
              </div>
            )}
          </TableFrame>
          <PerfilPaginacion
            id={id}
            paramKey="ing_page"
            page={ingPage}
            pageSize={PAGE_SIZE}
            total={ingresosFiltrados.length}
          />
        </section>

        {/* ─── Consignaciones ─────────────────────────── */}
        {cap.consignacionProveedor && (
        <section className="space-y-2">
          <TableFrame>
            <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg">Consignaciones</h3>
              <span className="text-xs text-muted font-mono">
                {consignacionesFiltradas.length} en el período
              </span>
            </div>
            {consignaciones.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">
                Sin consignaciones en el período seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable>
                  <THead>
                    <Th>Fecha</Th>
                    <Th>Estado</Th>
                    <Th align="right">Ítems</Th>
                    <Th align="right">Pendientes</Th>
                    <Th align="right">Devueltos</Th>
                    <Th />
                  </THead>
                  <TBody>
                    {consignaciones.map((c) => (
                      <Tr key={c.id_consignacion}>
                        <Td className="text-xs text-muted">
                          {new Date(c.fecha).toLocaleDateString('es-AR')}
                        </Td>
                        <Td>
                          <Badge variant={c.estado === 'activa' ? 'warning' : 'neutral'}>
                            {ESTADO_CONSIGNACION_LABEL[c.estado]}
                          </Badge>
                        </Td>
                        <Td align="right" className="font-mono">{c.total_items}</Td>
                        <Td align="right" className="font-mono">{c.pendientes}</Td>
                        <Td align="right" className="font-mono">{c.devueltos}</Td>
                        <Td align="right">
                          <Link
                            href={`/consignaciones/${c.id_consignacion}?from=${encodeURIComponent(volverAqui('cons_page', consPage))}`}
                            className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                          >
                            Ver
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </DataTable>
              </div>
            )}
          </TableFrame>
          <PerfilPaginacion
            id={id}
            paramKey="cons_page"
            page={consPage}
            pageSize={PAGE_SIZE}
            total={consignacionesFiltradas.length}
          />
        </section>

        )}

        {/* ─── Rendiciones ────────────────────────────── */}
        {cap.consignacionProveedor && (
        <section className="space-y-2">
          <TableFrame>
            <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg">Rendiciones</h3>
              <span className="text-xs text-muted font-mono">
                {rendicionesFiltradas.length} en el período
              </span>
            </div>
            {rendiciones.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">
                Sin rendiciones en el período seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable>
                  <THead>
                    <Th>Fecha</Th>
                    <Th>Período</Th>
                    <Th>Estado</Th>
                    <Th align="right">Líneas</Th>
                    <Th align="right">Monto</Th>
                    <Th />
                  </THead>
                  <TBody>
                    {rendiciones.map((r) => (
                      <Tr key={r.id_rendicion}>
                        <Td className="text-xs text-muted">
                          {new Date(r.fecha_generacion).toLocaleDateString('es-AR')}
                        </Td>
                        <Td className="text-xs text-muted">
                          {r.periodo_desde && r.periodo_hasta
                            ? `${new Date(r.periodo_desde).toLocaleDateString('es-AR')} → ${new Date(r.periodo_hasta).toLocaleDateString('es-AR')}`
                            : <span className="text-muted">—</span>}
                        </Td>
                        <Td>
                          <Badge variant={r.estado === 'pendiente' ? 'warning' : 'success'}>
                            {ESTADO_RENDICION_LABEL[r.estado]}
                          </Badge>
                        </Td>
                        <Td align="right" className="font-mono">{r.cantidad_lineas}</Td>
                        <Td align="right" className="font-mono">{fmtMoney(r.monto_total)}</Td>
                        <Td align="right">
                          <Link
                            href={`/rendiciones/${r.id_rendicion}?from=${encodeURIComponent(volverAqui('rend_page', rendPage))}`}
                            className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                          >
                            Ver
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </DataTable>
              </div>
            )}
          </TableFrame>
          <PerfilPaginacion
            id={id}
            paramKey="rend_page"
            page={rendPage}
            pageSize={PAGE_SIZE}
            total={rendicionesFiltradas.length}
          />
        </section>
        )}
      </main>
    </>
  )
}

function fmtMoney(n: number): string {
  return `$ ${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-text truncate">{children}</dd>
    </div>
  )
}

