'use client'

import { CATALOGO_PERMISOS, MODULO_NOMBRE } from '@/lib/types/administracion'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Checkbox } from '@/components/ui/Checkbox'

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
  modulosVisibles?: string[]
}) {
  const modulos = modulosVisibles
    ? Object.entries(CATALOGO_PERMISOS).filter(([mod]) => modulosVisibles.includes(mod))
    : Object.entries(CATALOGO_PERMISOS)
  function toggle(modulo: string, accion: string, on: boolean) {
    if (disabled) return
    const current = value[modulo] ?? []
    const next = on ? [...current, accion] : current.filter((a) => a !== accion)
    const map = { ...value }
    if (next.length === 0) delete map[modulo]
    else map[modulo] = next
    onChange(map)
  }

  return (
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
                {(['ver', 'crear', 'editar', 'eliminar'] as const).map((accion) => {
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
  )
}
