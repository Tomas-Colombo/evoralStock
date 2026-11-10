'use client'

import {
  ACCION_AYUDA,
  ACCION_LABEL,
  CATALOGO_PERMISOS,
  MODULO_NOMBRE,
} from '@/lib/types/administracion'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Checkbox } from '@/components/ui/Checkbox'

const ACCIONES_BASICAS = ['ver', 'crear', 'editar', 'eliminar'] as const

// Acciones exclusivas del portal de revendedoras (no asignables a roles internos de empleados,
// mismo criterio que scripts/provision-tenant.mts).
const ACCIONES_PORTAL: Record<string, readonly string[]> = {
  revendedoras: ['ver_propio', 'declarar'],
}

function esAccionEspecialVisible(modulo: string, accion: string): boolean {
  if (ACCIONES_BASICAS.includes(accion as (typeof ACCIONES_BASICAS)[number])) return false
  const excluidas = ACCIONES_PORTAL[modulo]
  if (excluidas && excluidas.includes(accion)) return false
  return true
}

/**
 * Matriz módulo × acción. Controlado. Cada checkbox agrega/quita del
 * array `permisos[modulo]`.
 */
export function PermisosEditor({
  value,
  onChange,
  disabled,
  modulosVisibles,
}: {
  value: Record<string, string[]>
  onChange: (v: Record<string, string[]>) => void
  disabled?: boolean
  modulosVisibles: string[]
}) {
  const modulos = Object.entries(CATALOGO_PERMISOS).filter(([mod]) =>
    modulosVisibles.includes(mod),
  )

  function toggle(modulo: string, accion: string, on: boolean) {
    if (disabled) return
    const current = value[modulo] ?? []
    let next = on ? [...current, accion] : current.filter((a) => a !== accion)

    // D-CPC-05: cargar_costos implica ver_costos
    if (modulo === 'inventario') {
      if (accion === 'cargar_costos' && on) {
        if (!next.includes('ver_costos')) {
          next.push('ver_costos')
        }
      } else if (accion === 'ver_costos' && !on) {
        next = next.filter((a) => a !== 'cargar_costos')
      }
    }

    const map = { ...value }
    if (next.length === 0) delete map[modulo]
    else map[modulo] = next
    onChange(map)
  }

  const modulosConEspeciales = modulos.filter(([mod, acciones]) =>
    acciones.some((a) => esAccionEspecialVisible(mod, a)),
  )

  return (
    <div className="space-y-4">
      <TableFrame>
        <DataTable>
          <THead>
            <Th>Módulo</Th>
            <Th align="center">Ver</Th>
            <Th align="center">Crear</Th>
            <Th align="center">Editar</Th>
            <Th align="center">Eliminar</Th>
          </THead>
          <TBody>
            {modulos.map(([mod, acciones]) => {
              const activas = value[mod] ?? []
              return (
                <Tr key={mod}>
                  <Td className="font-medium">
                    {MODULO_NOMBRE[mod] ?? mod}
                  </Td>
                  {ACCIONES_BASICAS.map((accion) => {
                    const disponible = acciones.includes(accion)
                    const marcada = activas.includes(accion)
                    return (
                      <Td align="center" key={accion}>
                        {disponible ? (
                          <Checkbox
                            aria-label={`${mod} ${accion}`}
                            checked={marcada}
                            onChange={(e) => toggle(mod, accion, e.target.checked)}
                            disabled={disabled}
                          />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    )
                  })}
                </Tr>
              )
            })}
          </TBody>
        </DataTable>
      </TableFrame>

      {modulosConEspeciales.length > 0 && (
        <div className="space-y-3 pt-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Permisos específicos
          </h4>
          <div className="space-y-3">
            {modulosConEspeciales.map(([mod, acciones]) => {
              const especiales = acciones.filter((a) => esAccionEspecialVisible(mod, a))
              const activas = value[mod] ?? []
              return (
                <div key={mod} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="text-xs font-semibold text-ink">
                    {MODULO_NOMBRE[mod] ?? mod}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {especiales.map((accion) => {
                      const marcada = activas.includes(accion)
                      return (
                        <label
                          key={accion}
                          className="flex items-start gap-2.5 text-sm cursor-pointer select-none"
                        >
                          <Checkbox
                            aria-label={`${mod} ${accion}`}
                            checked={marcada}
                            onChange={(e) => toggle(mod, accion, e.target.checked)}
                            disabled={disabled}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-ink">
                              {ACCION_LABEL[accion] ?? accion}
                            </div>
                            {ACCION_AYUDA[accion] && (
                              <p className="text-xs text-muted leading-tight">
                                {ACCION_AYUDA[accion]}
                              </p>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
