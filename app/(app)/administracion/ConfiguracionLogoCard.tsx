'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { LOGO_MAX_BYTES } from '@/lib/tenant/logo'
import { quitarTenantLogoAction, updateTenantLogoAction } from './actions'
import { achicarLogo } from './achicarLogo'

const EXTENSION: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png' }

export function ConfiguracionLogoCard({
  logoActual,
  canEdit,
}: {
  logoActual: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [procesando, setProcesando] = useState(false)
  // Logo ya achicado, listo para mandar. null = no hay cambios sin guardar.
  const [archivo, setArchivo] = useState<Blob | null>(null)
  const [previewLocal, setPreviewLocal] = useState<string | null>(null)

  // Cada object URL retiene el blob en memoria hasta que se revoca.
  useEffect(() => {
    return () => {
      if (previewLocal) URL.revokeObjectURL(previewLocal)
    }
  }, [previewLocal])

  const preview = previewLocal ?? logoActual
  const ocupado = pending || procesando

  function descartarCambio() {
    setArchivo(null)
    setPreviewLocal(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Archivo no válido', mensajeDeError('logo-formato-invalido'))
      return
    }

    setProcesando(true)
    try {
      const achicado = await achicarLogo(file)
      if (achicado.size > LOGO_MAX_BYTES) {
        toast.error('Imagen demasiado pesada', mensajeDeError('logo-muy-grande'))
        return
      }
      setArchivo(achicado)
      setPreviewLocal(URL.createObjectURL(achicado))
    } catch (err) {
      toast.error('No se pudo leer la imagen', mensajeDeError((err as Error).message))
    } finally {
      setProcesando(false)
    }
  }

  function handleGuardar() {
    if (!canEdit || !archivo) return

    const formData = new FormData()
    formData.append('logo', archivo, `logo.${EXTENSION[archivo.type] ?? 'png'}`)

    start(async () => {
      const res = await updateTenantLogoAction(formData)
      if (!res.ok) {
        return toast.error('No se pudo guardar el logo', mensajeDeError(res.reason))
      }
      toast.success('Logo actualizado', 'El nuevo logo se aplicó a la barra lateral.')
      descartarCambio()
      router.refresh()
    })
  }

  function handleQuitar() {
    if (!canEdit) return

    start(async () => {
      const res = await quitarTenantLogoAction()
      if (!res.ok) {
        return toast.error('No se pudo quitar el logo', mensajeDeError(res.reason))
      }
      toast.success('Logo eliminado', 'Ahora se muestra el nombre comercial del negocio.')
      descartarCambio()
      router.refresh()
    })
  }

  return (
    <Card as="section" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg">Logo del negocio</h3>
          <p className="mt-0.5 text-sm text-muted">
            Este logo se muestra en la parte superior de la barra de navegación lateral.
            Recomendamos una imagen con fondo transparente (PNG, SVG o WebP). La ajustamos
            al tamaño de la barra automáticamente.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6 pt-2">
        {/* Preview box con el mismo fondo que la barra lateral */}
        <div className="flex h-20 w-48 shrink-0 items-center justify-center rounded-lg border border-border bg-sidebar-bg p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Logo del negocio"
              className="max-h-14 max-w-full select-none object-contain"
            />
          ) : (
            <span className="text-xs text-muted text-center italic">
              Sin logo cargado<br />(muestra el nombre)
            </span>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleFileChange}
              disabled={ocupado}
            />

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={ocupado}
              onClick={() => fileInputRef.current?.click()}
            >
              {procesando ? 'Procesando…' : preview ? 'Cambiar imagen' : 'Seleccionar imagen'}
            </Button>

            {archivo && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={ocupado}
                onClick={handleGuardar}
              >
                {pending ? 'Guardando…' : 'Guardar logo'}
              </Button>
            )}

            {logoActual && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={ocupado}
                onClick={handleQuitar}
              >
                Quitar logo
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
