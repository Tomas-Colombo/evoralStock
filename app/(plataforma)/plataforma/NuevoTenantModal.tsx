'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { altaTenantAction } from '@/app/(plataforma)/plataforma/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  CLAVES_PAQUETES_OPCIONALES,
  type PaqueteOpcional,
} from '@/lib/modulos/catalogo'

const PAQUETES_LABELS: Record<PaqueteOpcional, { label: string; descripcion: string }> = {
  revendedoras: {
    label: 'Revendedoras',
    descripcion: 'Venta por catálogo y comisiones.',
  },
  consignacionProveedor: {
    label: 'Consignación de proveedor',
    descripcion: 'Artículos en consignación y rendiciones periódicas.',
  },
}

export interface NuevoTenantModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function NuevoTenantModal({
  open,
  onClose,
  onSuccess,
}: NuevoTenantModalProps) {
  const toast = useToast()
  const [isPending, setIsPending] = useState(false)
  const [copiado, setCopiado] = useState(false)

  // Campos del formulario
  const [nombre, setNombre] = useState('')
  const [subdominio, setSubdominio] = useState('')
  const [emailAdmin, setEmailAdmin] = useState('')
  const [nombreAdmin, setNombreAdmin] = useState('')
  const [paquetes, setPaquetes] = useState<PaqueteOpcional[]>([])

  // Estado de éxito (muestra la contraseña temporal una sola vez)
  const [resultadoExito, setResultadoExito] = useState<{
    idTenant: string
    passwordTemporal: string
  } | null>(null)

  function togglePaquete(pkg: PaqueteOpcional) {
    setPaquetes((prev) =>
      prev.includes(pkg) ? prev.filter((p) => p !== pkg) : [...prev, pkg],
    )
  }

  function handleClose() {
    setNombre('')
    setSubdominio('')
    setEmailAdmin('')
    setNombreAdmin('')
    setPaquetes([])
    setResultadoExito(null)
    setCopiado(false)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || !subdominio.trim() || !emailAdmin.trim() || !nombreAdmin.trim()) {
      return
    }

    setIsPending(true)
    try {
      const res = await altaTenantAction({
        nombre: nombre.trim(),
        subdominio: subdominio.toLowerCase().trim(),
        emailAdmin: emailAdmin.toLowerCase().trim(),
        nombreAdmin: nombreAdmin.trim(),
        paquetes,
      })

      if (res.ok) {
        toast.success('Tenant creado con éxito.')
        setResultadoExito(res.data)
        onSuccess?.()
      } else {
        toast.error(mensajeDeError(res.reason))
      }
    } catch {
      toast.error('Ocurrió un error inesperado al crear el tenant.')
    } finally {
      setIsPending(false)
    }
  }

  async function handleCopiarClave() {
    if (!resultadoExito?.passwordTemporal) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resultadoExito.passwordTemporal)
      }
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Ignorar fallo de portapapeles
    }
  }

  if (resultadoExito) {
    return (
      <Modal
        open={open}
        title="Tenant creado con éxito"
        onClose={handleClose}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={handleClose}>
              Entendido, cerrar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink">
            El comercio <strong className="font-semibold">{nombre}</strong> fue dado de alta correctamente.
          </p>

          <div className="flex flex-col gap-2 rounded-md border border-line-2 bg-card-3 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              Contraseña temporal del administrador
            </span>
            <div className="flex items-center gap-2">
              <code
                data-testid="password-temporal"
                className="flex-1 select-all break-all rounded border border-control-line bg-control px-3 py-2 font-mono text-sm font-bold text-ink"
              >
                {resultadoExito.passwordTemporal}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCopiarClave}
              >
                {copiado ? '¡Copiada!' : 'Copiar contraseña'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted">
            Copiá la contraseña temporal para enviársela al administrador. Por motivos de seguridad, esta clave no se volverá a mostrar al cerrar esta ventana.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      title="Nuevo tenant"
      onClose={handleClose}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? 'Creando…' : 'Crear tenant'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            htmlFor="tenant-nombre"
            label="Nombre comercial"
            required
            hint="Nombre visible del comercio"
          >
            <input
              id="tenant-nombre"
              type="text"
              required
              disabled={isPending}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Tienda Alpha"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>

          <Field
            htmlFor="tenant-subdominio"
            label="Subdominio"
            required
            hint="Entre 3 y 30 caracteres (minúsculas, números y guiones)"
          >
            <input
              id="tenant-subdominio"
              type="text"
              required
              disabled={isPending}
              value={subdominio}
              onChange={(e) => setSubdominio(e.target.value.toLowerCase().trim())}
              placeholder="alpha"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 font-mono text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            htmlFor="admin-nombre"
            label="Nombre del administrador"
            required
            hint="Nombre y apellido del responsable"
          >
            <input
              id="admin-nombre"
              type="text"
              required
              disabled={isPending}
              value={nombreAdmin}
              onChange={(e) => setNombreAdmin(e.target.value)}
              placeholder="Ej. María López"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>

          <Field
            htmlFor="admin-email"
            label="Email del administrador"
            required
            hint="Se utilizará para iniciar sesión"
          >
            <input
              id="admin-email"
              type="email"
              required
              disabled={isPending}
              value={emailAdmin}
              onChange={(e) => setEmailAdmin(e.target.value)}
              placeholder="admin@tiendaalpha.com"
              className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 border-t border-line-2 pt-2">
          <span className="text-xs font-semibold text-ink">
            Paquetes opcionales
          </span>
          <p className="text-xs text-muted">
            Los módulos núcleo se habilitan automáticamente. Podés sumar paquetes opcionales ahora o más adelante.
          </p>
          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            {CLAVES_PAQUETES_OPCIONALES.map((pkg) => {
              const meta = PAQUETES_LABELS[pkg]
              const checked = paquetes.includes(pkg)
              return (
                <label
                  key={pkg}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    checked
                      ? 'border-ink bg-card-2'
                      : 'border-line-2 bg-card hover:bg-hover'
                  }`}
                >
                  <Checkbox
                    id={`paquete-${pkg}`}
                    checked={checked}
                    disabled={isPending}
                    onChange={() => togglePaquete(pkg)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-ink">
                      {meta?.label ?? pkg}
                    </span>
                    <span className="text-[11.5px] text-muted">
                      {meta?.descripcion}
                    </span>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      </form>
    </Modal>
  )
}
