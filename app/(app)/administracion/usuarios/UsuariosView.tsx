'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  USUARIO_ESTADO_LABEL,
  type UsuarioConRol,
  type UsuarioEstado,
} from '@/lib/types/administracion'
import { asignarRolAction, toggleUsuarioEstadoAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { ClaveTemporalField } from '@/components/acceso/ClaveTemporalField'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'
import { restablecerClaveAction } from './actions'

const ESTADO_VARIANT: Record<UsuarioEstado, 'success' | 'neutral' | 'warning'> = {
  activo: 'success',
  inactivo: 'neutral',
  invitado: 'warning',
}

/**
 * ABM de usuarios. NO permite crear (la creación real pasa por
 * `supabase.auth.admin.createUser` que requiere service_role — fuera
 * de scope de esta pantalla). Sí permite:
 *   - Cambiar estado (activo|inactivo|invitado).
 *   - Reasignar rol.
 *
 * El alta de usuarios reales se hace por invitación (que carga la fila
 * en usuario vía trigger o inserción manual del admin de tenant).
 */
export function UsuariosView({
  initial,
  roles,
}: {
  initial: UsuarioConRol[]
  roles: Array<{ id: string; nombre: string }>
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [rows, setRows] = useState(initial)
  const [restablecer, setRestablecer] = useState<UsuarioConRol | null>(null)
  const [password, setPassword] = useState('')
  const [compartir, setCompartir] = useState<{ nombre: string; email: string } | null>(null)

  function abrirRestablecer(u: UsuarioConRol) {
    setPassword('')
    setRestablecer(u)
  }

  function confirmarRestablecer() {
    if (!restablecer) return
    const u = restablecer
    start(async () => {
      const res = await restablecerClaveAction({ idUsuario: u.id_usuario, password })
      if (!res.ok) return toast.error('No se pudo restablecer', mensajeDeError(res.reason))
      setRestablecer(null)
      setCompartir({ nombre: res.data.nombre || res.data.email, email: res.data.email })
    })
  }

  function cambiarEstado(u: UsuarioConRol, next: UsuarioEstado) {
    start(async () => {
      const res = await toggleUsuarioEstadoAction({ idUsuario: u.id_usuario, estado: next })
      if (!res.ok) return toast.error('No se pudo actualizar', mensajeDeError(res.reason))
      toast.success('Estado actualizado')
      setRows((rs) =>
        rs.map((r) =>
          r.id_usuario === u.id_usuario ? { ...r, estado_usuario: next } : r,
        ),
      )
      router.refresh()
    })
  }

  function cambiarRol(u: UsuarioConRol, idRol: string) {
    if (!idRol) return
    start(async () => {
      const res = await asignarRolAction({
        idUsuario: u.id_usuario,
        idRol,
        nombreCompleto: u.nombre_completo ?? '',
      })
      if (!res.ok) return toast.error('No se pudo asignar rol', mensajeDeError(res.reason))
      toast.success('Rol actualizado')
      const nuevoRol = roles.find((r) => r.id === idRol) ?? null
      setRows((rs) =>
        rs.map((r) =>
          r.id_usuario === u.id_usuario
            ? {
                ...r,
                id_rol: idRol,
                rol: nuevoRol ? { id_rol: nuevoRol.id, nombre: nuevoRol.nombre } : null,
              }
            : r,
        ),
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
        El alta de nuevos usuarios se hace por invitación (Supabase Auth).
        Esta pantalla permite gestionar rol y estado de los existentes.
      </div>

      <TableFrame>
        <DataTable>
          <THead>
            <Th>Usuario</Th>
            <Th>Rol</Th>
            <Th>Estado</Th>
            <Th></Th>
            <Th></Th>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={5} className="px-4 py-6 text-muted">
                  Sin usuarios en este tenant.
                </Td>
              </Tr>
            ) : (
              rows.map((u) => (
                <Tr key={u.id_usuario}>
                  <Td>
                    <div className="font-medium">{u.nombre_completo || u.email}</div>
                    {u.nombre_completo && (
                      <div className="text-xs text-muted">{u.email}</div>
                    )}
                  </Td>
                  <Td>
                    <Select
                      value={u.id_rol ?? ''}
                      onChange={(e) => cambiarRol(u, e.target.value)}
                      disabled={pending}
                      aria-label={`Rol de ${u.email}`}
                      className="w-auto"
                    >
                      <option value="">— Sin rol —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.nombre}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Badge variant={ESTADO_VARIANT[u.estado_usuario]}>
                      {USUARIO_ESTADO_LABEL[u.estado_usuario]}
                    </Badge>
                  </Td>
                  {/* Una acción por celda: así cada botón queda en su columna
                      aunque "Activar" y "Desactivar" no midan lo mismo. */}
                  <Td align="right" className="w-px whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => abrirRestablecer(u)} disabled={pending}>
                      Restablecer clave
                    </Button>
                  </Td>
                  <Td align="right" className="w-px whitespace-nowrap">
                    {u.estado_usuario === 'activo' ? (
                      <Button size="sm" variant="ghost" onClick={() => cambiarEstado(u, 'inactivo')} disabled={pending}>
                        Desactivar
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => cambiarEstado(u, 'activo')} disabled={pending}>
                        Activar
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </DataTable>
      </TableFrame>

      <Modal
        open={restablecer !== null}
        onClose={() => {
          if (!pending) setRestablecer(null)
        }}
        title="Restablecer clave"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRestablecer(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmarRestablecer} disabled={pending || password.trim().length < 8}>
              {pending ? 'Restableciendo...' : 'Restablecer'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {restablecer?.nombre_completo || restablecer?.email} va a entrar con esta contraseña
            temporal y la va a tener que cambiar apenas ingrese. La anterior deja de funcionar.
          </p>
          <ClaveTemporalField id="rc_password" value={password} onChange={setPassword} />
        </div>
      </Modal>

      {compartir && (
        <CompartirAccesoModal
          open
          onClose={() => setCompartir(null)}
          nombre={compartir.nombre}
          email={compartir.email}
          password={password}
        />
      )}
    </div>
  )
}
