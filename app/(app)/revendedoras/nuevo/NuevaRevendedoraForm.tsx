'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { crearRevendedoraUnificadaAction } from '../actions'
import { Checkbox } from '@/components/ui/Checkbox'
import { ClaveTemporalField } from '@/components/acceso/ClaveTemporalField'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'

export interface DatosAccesoRevendedora {
  nombre: string
  email: string
  password: string
  telefono: string | null
}

interface NuevaRevendedoraFormProps {
  canGrantAccess?: boolean
  canEditComision?: boolean
  onSuccess?: (compartir: DatosAccesoRevendedora | null) => void
  onCancel?: () => void
}

export function NuevaRevendedoraForm({
  canGrantAccess = false,
  canEditComision = false,
  onSuccess,
  onCancel,
}: NuevaRevendedoraFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const [crearAcceso, setCrearAcceso] = useState(false)
  const [password, setPassword] = useState('')
  const [compartir, setCompartir] = useState<{
    nombre: string
    email: string
    telefono: string | null
  } | null>(null)
  const [comisionPropiaCheck, setComisionPropiaCheck] = useState(false)

  async function action(formData: FormData) {
    setLoading(true)

    const payload: Record<string, unknown> = {
      nombre: (formData.get('nombre') as string)?.trim(),
      apellido: (formData.get('apellido') as string)?.trim(),
      telefono: (formData.get('telefono') as string)?.trim() || null,
      email: (formData.get('email') as string)?.trim() || null,
      notas: (formData.get('notas') as string)?.trim() || null,
      crear_acceso: crearAcceso,
    }

    if (crearAcceso) {
      payload.password_acceso = password.trim()
    }

    if (comisionPropiaCheck) {
      const com = formData.get('comision_propia')
      if (com !== null && com !== '') {
        payload.comision_propia = Number(com)
      }
    }

    const res = await crearRevendedoraUnificadaAction(payload)
    if (!res.ok) {
      toast.error(mensajeDeError(res.reason))
      setLoading(false)
      return
    }

    toast.success('Revendedora creada')
    if (crearAcceso) {
      // Reseteamos loading en cualquier camino de salida para evitar botones colgados en modo modal
      setLoading(false)
      if (onSuccess) {
        onSuccess({
          nombre: payload.nombre as string,
          email: payload.email as string,
          password: password.trim(),
          telefono: (payload.telefono as string | null) ?? null,
        })
        return
      }

      setCompartir({
        nombre: payload.nombre as string,
        email: payload.email as string,
        telefono: payload.telefono as string | null,
      })
      return
    }

    setLoading(false)
    if (onSuccess) {
      onSuccess(null)
      return
    }
    router.push('/revendedoras')
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="nr_nombre" label="Nombre" required>
          <Input id="nr_nombre" name="nombre" required autoFocus autoComplete="off" />
        </Field>
        <Field htmlFor="nr_apellido" label="Apellido" required>
          <Input id="nr_apellido" name="apellido" required autoComplete="off" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="nr_telefono" label="Teléfono">
          <Input id="nr_telefono" name="telefono" type="tel" autoComplete="off" />
        </Field>
        <Field
          htmlFor="nr_email"
          label="Email"
          required={crearAcceso}
          error={crearAcceso ? 'Obligatorio para otorgar acceso al sistema' : undefined}
        >
          <Input
            id="nr_email"
            name="email"
            type="email"
            autoComplete="off"
            required={crearAcceso}
          />
        </Field>
      </div>

      <Field htmlFor="nr_notas" label="Notas">
        <Textarea id="nr_notas" name="notas" rows={3} />
      </Field>

      {/* Acceso al sistema (opcional) */}
      {canGrantAccess && (
        <div className="rounded-md border border-border p-4 bg-card-2 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
            <Checkbox
              checked={crearAcceso}
              onChange={(e) => setCrearAcceso(e.target.checked)}
            />
            <span>Crear acceso al sistema para la revendedora</span>
          </label>

          {crearAcceso && (
            <div className="pt-2">
              <ClaveTemporalField id="nr_password" value={password} onChange={setPassword} />
            </div>
          )}
        </div>
      )}

      {/* Comisión particular (opcional) */}
      {canEditComision && (
        <div className="rounded-md border border-border p-4 bg-card-2 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
            <Checkbox
              checked={comisionPropiaCheck}
              onChange={(e) => setComisionPropiaCheck(e.target.checked)}
            />
            <span>Asignar porcentaje de comisión particular</span>
          </label>

          {comisionPropiaCheck && (
            <div className="pt-2 max-w-xs">
              <Field htmlFor="nr_comision" label="Porcentaje (%)" required>
                <Input
                  id="nr_comision"
                  name="comision_propia"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder="Ej: 15"
                  required={comisionPropiaCheck}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-3">
        <Button
          type="button"
          variant="neutral"
          onClick={onCancel ?? (() => router.push('/revendedoras'))}
          disabled={loading}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>

      {/* En modo modal (onSuccess provisto) CompartirAccesoModal se renderiza afuera
          como hermano del modal para no anidar diálogos ni perder el estado al desmontar. */}
      {!onSuccess && compartir && (
        <CompartirAccesoModal
          open
          onClose={() => router.push('/revendedoras')}
          nombre={compartir.nombre}
          email={compartir.email}
          password={password.trim()}
          telefonoInicial={compartir.telefono}
        />
      )}
    </form>
  )
}
