'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { resolverArancel } from '@/lib/cobros/calcular-costo'
import {
  MEDIO_PAGO_LABEL,
  type ArancelCobroRow,
  type CuentaDestinoRow,
  type MedioPago,
} from '@/lib/types/ventas'
import type { PlanCuotasRow, RecargoCuotasRow } from '@/lib/types/precios'
import { hoyISO } from '@/lib/utils/hoy'
import { cerrarVigenciaRecargoAction } from '../actions'
import { RecargoForm } from './RecargoForm'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

/**
 * Recargo por cuotas, enfrentado al arancel que pretende cubrir.
 *
 * Esta es la pantalla que justifica que Cuentas viva dentro de Precios. Los
 * dos números existen desde 00057 y 00063, pero hasta ahora vivían separados:
 * el arancel en el tarifario de la cuenta, el recargo en las reglas de precio.
 * Separados, nadie podía contestar la única pregunta que importa — ¿lo que le
 * cobro de más al cliente alcanza para cubrir lo que me retiene el
 * procesador?
 *
 * El margen que se muestra en cada fila ES esa respuesta.
 */
export function RecargosPanel({
  cuentas,
  recargos,
  aranceles,
  planesCuotas,
}: {
  cuentas: CuentaDestinoRow[]
  recargos: RecargoCuotasRow[]
  aranceles: ArancelCobroRow[]
  planesCuotas: PlanCuotasRow[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [creando, setCreando] = useState(false)
  const hayPlanes = planesCuotas.some((p) => p.activo)

  /**
   * Una fila por recargo vigente, con el arancel que le corresponde al lado.
   *
   * El arancel sólo se puede resolver cuando el recargo nombra una cuenta Y un
   * medio: el tarifario cuelga de esa combinación. Un recargo comodín no tiene
   * un arancel único que enfrentarle — tiene todos — así que ahí la comparación
   * se omite en vez de inventar un promedio.
   */
  const filas = useMemo(
    () =>
      recargos
        .filter((r) => r.vigente_hasta === null)
        .map((r) => {
          const arancel =
            !r.propia && r.id_cuenta_destino && r.medio
              ? resolverArancel(
                  aranceles,
                  r.id_cuenta_destino,
                  r.medio as MedioPago,
                  r.cuotas,
                )
              : null
          // El arancel tiene IVA sobre la comisión: comparar sólo el
          // `arancel_pct` subestimaría el costo real en un 21% de sí mismo.
          const costoPct = arancel
            ? arancel.arancel_pct * (1 + arancel.iva_arancel_pct / 100)
            : null
          const margen =
            costoPct !== null && r.tipo_valor === 'porcentaje'
              ? r.valor - costoPct
              : null
          return { r, costoPct, margen }
        })
        .sort((a, b) => a.r.cuotas - b.r.cuotas || etiqueta(a.r, cuentas).localeCompare(etiqueta(b.r, cuentas))),
    [recargos, aranceles, cuentas],
  )

  function cerrar(id: string) {
    start(async () => {
      const res = await cerrarVigenciaRecargoAction({
        id,
        // Fecha del negocio, no UTC: desde las 21 h de Argentina
        // `toISOString()` ya da mañana y la baja quedaba fechada un día tarde.
        hasta: hoyISO(),
      })
      if (!res.ok) return toast.error(mensajeDeError(res.reason))
      toast.success('Recargo dado de baja')
      router.refresh()
    })
  }

  if (!hayPlanes) {
    return (
      <Card as="section">
        <h2 className="font-display text-lg text-text">Recargo por cuotas</h2>
        <p className="mt-2 text-sm text-muted">
          Todavía no hay planes de cuotas configurados. Cargá al menos uno en
          Precios antes de definir cuánto se cobra de más por cada plan: el
          recargo cuelga del plan, no al revés.
        </p>
      </Card>
    )
  }

  return (
    <Card as="section" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-text">Recargo por cuotas</h2>
          <p className="text-sm text-muted">
            Lo que le cobrás de más al cliente por pagar en partes, enfrentado a
            lo que te retiene el procesador.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCreando((v) => !v)}
          disabled={pending}
        >
          {creando ? 'Cancelar' : 'Nuevo recargo'}
        </Button>
      </div>

      {creando && (
        <RecargoForm
          cuentas={cuentas}
          planesCuotas={planesCuotas}
          onCreated={() => setCreando(false)}
        />
      )}

      {filas.length === 0 ? (
        <p className="rounded-md border border-border bg-card-2 px-3 py-4 text-sm text-muted">
          No hay recargos cargados. Sin ellos, vender en cuotas sale al mismo
          precio que al contado y el arancel del procesador te lo comés entero.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <DataTable>
            <THead>
              <Th className="px-3 py-2">Plan</Th>
              <Th className="px-3 py-2">Quién financia</Th>
              <Th align="right" className="px-3 py-2">Te cobran</Th>
              <Th align="right" className="px-3 py-2">Cobrás</Th>
              <Th align="right" className="px-3 py-2">Te queda</Th>
              <Th className="px-3 py-2"></Th>
            </THead>
            <TBody>
              {filas.map(({ r, costoPct, margen }) => (
                <Tr key={r.id_recargo_cuotas}>
                  <Td className="px-3 py-2 font-medium">{r.cuotas} cuotas</Td>
                  <Td className="px-3 py-2">
                    {etiqueta(r, cuentas)}
                    {r.propia && (
                      <Badge variant="warning">
                        <span className="ml-1">propia</span>
                      </Badge>
                    )}
                  </Td>
                  <Td align="right" className="px-3 py-2 font-mono text-muted">
                    {costoPct === null ? '—' : `${pct(costoPct)}%`}
                  </Td>
                  <Td align="right" className="px-3 py-2 font-mono">
                    {r.tipo_valor === 'porcentaje'
                      ? `+${pct(r.valor)}%`
                      : `+$ ${r.valor.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                  </Td>
                  <Td align="right"
                    className={`px-3 py-2 font-mono ${
                      margen !== null && margen < 0 ? 'text-warn-ink' : ''
                    }`}
                  >
                    {margen === null ? '—' : `${margen >= 0 ? '+' : ''}${pct(margen)}%`}
                  </Td>
                  <Td align="right" className="px-3 py-2">
                    <Button
                      variant="bare"
                      type="button"
                      onClick={() => cerrar(r.id_recargo_cuotas)}
                      disabled={pending}
                      className="text-xs text-muted underline-offset-2 hover:text-alerta-ink hover:underline"
                      title="Cierra la vigencia. El recargo no se borra: deja de aplicar desde hoy."
                    >
                      Dar de baja
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </div>
      )}

      {filas.some((f) => f.margen !== null && f.margen < 0) && (
        <p className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-xs text-alerta-ink">
          Hay planes donde el recargo no cubre el arancel: cada venta en esas
          condiciones te deja menos de lo que muestra el precio.
        </p>
      )}

      <p className="text-xs text-muted">
        &laquo;Te cobran&raquo; incluye el IVA sobre la comisión, que es la
        parte que se suele olvidar. Los recargos comodín no muestran
        comparación: aplican a varios procesadores con aranceles distintos, y
        promediarlos sería inventar un número.
      </p>
    </Card>
  )
}

/** Cómo se lee un financiador en la tabla. */
function etiqueta(r: RecargoCuotasRow, cuentas: CuentaDestinoRow[]): string {
  if (r.propia) return 'Crédito del local'
  const medio = r.medio ? MEDIO_PAGO_LABEL[r.medio as MedioPago].toLowerCase() : null
  if (r.id_cuenta_destino) {
    const c = cuentas.find((x) => x.id_cuenta_destino === r.id_cuenta_destino)
    const nombre = c?.nombre ?? 'Cuenta eliminada'
    return medio ? `${nombre} · ${medio}` : nombre
  }
  if (medio) return `Cualquier ${medio}`
  return 'Cualquier destino'
}

function pct(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}
