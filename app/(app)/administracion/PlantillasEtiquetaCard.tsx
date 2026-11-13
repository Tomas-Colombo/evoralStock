'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import { Etiqueta, type ItemEtiqueta } from '@/components/etiquetas/Etiqueta'
import { calcularLayout } from '@/lib/etiquetas/layout'
import {
  PLANTILLA_ALTO_MM_MAX,
  PLANTILLA_ALTO_MM_MIN,
  PLANTILLA_ANCHO_MM_MAX,
  PLANTILLA_ANCHO_MM_MIN,
  PLANTILLA_NOMBRE_MAX,
  PLANTILLAS_MAX,
} from '@/lib/etiquetas/limites'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { EtiquetaConfig, EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'
import {
  crearEtiquetaPlantillaAction,
  editarEtiquetaPlantillaAction,
  eliminarEtiquetaPlantillaAction,
  marcarEtiquetaPlantillaPredeterminadaAction,
} from './actions'

const ITEM_EJEMPLO: ItemEtiqueta = {
  qr_code: '4a6f73653132333435363738',
  codigo_ean: '2000000000015',
  nombre: 'Remera Estampada Utopía',
  talle: 'M',
  sku: 'REM-001',
}

interface FormState {
  open: boolean
  modo: 'crear' | 'editar'
  id?: string
  nombre: string
  anchoMm: string
  altoMm: string
  mostrarNombre: boolean
  mostrarTalle: boolean
  mostrarSku: boolean
  mostrarTextoCodigo: boolean
}

const FORM_INICIAL: FormState = {
  open: false,
  modo: 'crear',
  nombre: '',
  anchoMm: '40',
  altoMm: '30',
  mostrarNombre: true,
  mostrarTalle: true,
  mostrarSku: false,
  mostrarTextoCodigo: false,
}

export function PlantillasEtiquetaCard({
  plantillas,
  config,
  canCreate,
  canEdit,
  canDelete,
}: {
  plantillas: EtiquetaPlantilla[]
  config: EtiquetaConfig
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [seleccionadaId, setSeleccionadaId] = useState<string>(() => {
    const pred = plantillas.find((p) => p.predeterminada)
    return pred ? pred.id_plantilla : plantillas[0]?.id_plantilla ?? ''
  })

  const [form, setForm] = useState<FormState>(FORM_INICIAL)
  const [confirmarEliminar, setConfirmarEliminar] = useState<EtiquetaPlantilla | null>(null)

  const plantillaActiva =
    plantillas.find((p) => p.id_plantilla === seleccionadaId) ?? plantillas[0] ?? null

  const layoutActivo = plantillaActiva
    ? calcularLayout({
        plantilla: plantillaActiva,
        config,
        simbologia: config.metodo,
      })
    : null

  function abrirCrear() {
    if (!canCreate || plantillas.length >= PLANTILLAS_MAX) return
    setForm({
      open: true,
      modo: 'crear',
      nombre: '',
      anchoMm: '40',
      altoMm: '30',
      mostrarNombre: true,
      mostrarTalle: true,
      mostrarSku: false,
      mostrarTextoCodigo: false,
    })
  }

  function abrirEditar(p: EtiquetaPlantilla) {
    if (!canEdit) return
    setForm({
      open: true,
      modo: 'editar',
      id: p.id_plantilla,
      nombre: p.nombre,
      anchoMm: String(p.ancho_mm),
      altoMm: String(p.alto_mm),
      mostrarNombre: p.mostrar_nombre,
      mostrarTalle: p.mostrar_talle,
      mostrarSku: p.mostrar_sku,
      mostrarTextoCodigo: p.mostrar_texto_codigo,
    })
  }

  function cerrarForm() {
    if (pending) return
    setForm((prev) => ({ ...prev, open: false }))
  }

  function handleGuardarForm(e: React.FormEvent) {
    e.preventDefault()

    const nombreLimpio = form.nombre.trim()
    if (!nombreLimpio || nombreLimpio.length > PLANTILLA_NOMBRE_MAX) {
      return toast.error('Nombre inválido', mensajeDeError('plantilla-nombre-invalido'))
    }

    const ancho = Number(form.anchoMm)
    const alto = Number(form.altoMm)
    if (
      !Number.isFinite(ancho) ||
      ancho < PLANTILLA_ANCHO_MM_MIN ||
      ancho > PLANTILLA_ANCHO_MM_MAX ||
      !Number.isFinite(alto) ||
      alto < PLANTILLA_ALTO_MM_MIN ||
      alto > PLANTILLA_ALTO_MM_MAX
    ) {
      return toast.error('Medidas fuera de rango', mensajeDeError('plantilla-medidas-invalidas'))
    }

    start(async () => {
      if (form.modo === 'crear') {
        const res = await crearEtiquetaPlantillaAction({
          nombre: nombreLimpio,
          ancho_mm: Math.round(ancho * 100) / 100,
          alto_mm: Math.round(alto * 100) / 100,
          mostrar_nombre: form.mostrarNombre,
          mostrar_talle: form.mostrarTalle,
          mostrar_sku: form.mostrarSku,
          mostrar_texto_codigo: form.mostrarTextoCodigo,
        })

        if (!res.ok) {
          return toast.error('No se pudo crear la plantilla', mensajeDeError(res.reason))
        }

        toast.success('Plantilla creada', `La plantilla "${nombreLimpio}" fue agregada.`)
        if (res.data?.id) {
          setSeleccionadaId(res.data.id)
        }
      } else if (form.modo === 'editar' && form.id) {
        const res = await editarEtiquetaPlantillaAction({
          id: form.id,
          nombre: nombreLimpio,
          ancho_mm: Math.round(ancho * 100) / 100,
          alto_mm: Math.round(alto * 100) / 100,
          mostrar_nombre: form.mostrarNombre,
          mostrar_talle: form.mostrarTalle,
          mostrar_sku: form.mostrarSku,
          mostrar_texto_codigo: form.mostrarTextoCodigo,
        })

        if (!res.ok) {
          return toast.error('No se pudo actualizar la plantilla', mensajeDeError(res.reason))
        }

        toast.success('Plantilla actualizada', `Los cambios en "${nombreLimpio}" fueron guardados.`)
      }

      cerrarForm()
      router.refresh()
    })
  }

  function handleMarcarPredeterminada(p: EtiquetaPlantilla) {
    if (!canEdit || p.predeterminada) return
    start(async () => {
      const res = await marcarEtiquetaPlantillaPredeterminadaAction({ id: p.id_plantilla })
      if (!res.ok) {
        return toast.error('No se pudo marcar como predeterminada', mensajeDeError(res.reason))
      }
      toast.success(
        'Plantilla predeterminada',
        `"${p.nombre}" es ahora la plantilla predeterminada del negocio.`,
      )
      router.refresh()
    })
  }

  function handleEliminar(p: EtiquetaPlantilla) {
    if (!canDelete || p.predeterminada) return
    start(async () => {
      const res = await eliminarEtiquetaPlantillaAction({ id: p.id_plantilla })
      if (!res.ok) {
        return toast.error('No se pudo eliminar la plantilla', mensajeDeError(res.reason))
      }
      toast.success('Plantilla eliminada', `La plantilla "${p.nombre}" fue eliminada.`)
      setConfirmarEliminar(null)
      if (seleccionadaId === p.id_plantilla) {
        const otra = plantillas.find((item) => item.id_plantilla !== p.id_plantilla)
        if (otra) setSeleccionadaId(otra.id_plantilla)
      }
      router.refresh()
    })
  }

  return (
    <Card as="section" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg">Plantillas de etiquetas</h3>
          <p className="mt-0.5 text-sm text-muted">
            Configurá las medidas y los campos visibles para imprimir etiquetas de tus productos.
          </p>
        </div>
        {canCreate && (
          <Button
            size="sm"
            onClick={abrirCrear}
            disabled={pending || plantillas.length >= PLANTILLAS_MAX}
          >
            Nueva plantilla
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Listado de plantillas */}
        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-md border border-border">
            <ul className="divide-y divide-border">
              {plantillas.map((p) => {
                const esActiva = p.id_plantilla === seleccionadaId
                return (
                  <li
                    key={p.id_plantilla}
                    className={`flex flex-col gap-2 p-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                      esActiva ? 'bg-card-2' : 'hover:bg-card-2/50'
                    }`}
                  >
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => setSeleccionadaId(p.id_plantilla)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{p.nombre}</span>
                        {p.predeterminada && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            Predeterminada
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-mono">
                          {p.ancho_mm} × {p.alto_mm} mm
                        </span>
                        <span>·</span>
                        <span className="truncate">
                          {[
                            p.mostrar_nombre && 'Nombre',
                            p.mostrar_talle && 'Talle',
                            p.mostrar_sku && 'SKU',
                            p.mostrar_texto_codigo && 'Código',
                          ]
                            .filter(Boolean)
                            .join(', ') || 'Solo código visual'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSeleccionadaId(p.id_plantilla)}
                        disabled={pending}
                      >
                        {esActiva ? 'Viendo' : 'Ver'}
                      </Button>

                      {canEdit && !p.predeterminada && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleMarcarPredeterminada(p)}
                          disabled={pending}
                        >
                          Predeterminada
                        </Button>
                      )}

                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrirEditar(p)}
                          disabled={pending}
                        >
                          Editar
                        </Button>
                      )}

                      {canDelete && !p.predeterminada && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmarEliminar(p)}
                          disabled={pending}
                          className="text-alerta-ink hover:text-alerta-ink"
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Vista previa interactiva */}
        <div className="flex flex-col rounded-md border border-border bg-card-2 p-4 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h4 className="text-sm font-semibold text-ink">Vista previa</h4>
              <p className="text-xs text-muted">
                {plantillaActiva ? `${plantillaActiva.nombre} (${config.metodo.toUpperCase()})` : 'Sin plantilla'}
              </p>
            </div>
            {layoutActivo && (
              <span className="font-mono text-xs text-muted">
                {plantillaActiva?.ancho_mm} × {plantillaActiva?.alto_mm} mm
              </span>
            )}
          </div>

          <div className="my-4 flex min-h-[160px] flex-1 items-center justify-center rounded border border-border-2 bg-neutral-100 p-4 overflow-auto">
            {plantillaActiva ? (
              <div className="shadow-sm border border-neutral-300 rounded-none bg-white">
                <Etiqueta
                  plantilla={plantillaActiva}
                  item={ITEM_EJEMPLO}
                  simbologia={config.metodo}
                  tamanoCodigo={layoutActivo?.tamanoCodigo}
                />
              </div>
            ) : (
              <p className="text-xs text-muted">Elegí una plantilla para verla.</p>
            )}
          </div>

          {layoutActivo && layoutActivo.avisos.length > 0 && (
            <div className="rounded-md border border-alerta-border bg-alerta-bg p-3 text-xs text-alerta-ink space-y-1">
              <strong className="block font-semibold">Aviso de impresión:</strong>
              {layoutActivo.avisos.map((aviso) => (
                <p key={aviso}>{mensajeDeError(aviso)}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Alta / Edición */}
      <Modal
        open={form.open}
        title={form.modo === 'crear' ? 'Nueva plantilla de etiqueta' : 'Editar plantilla'}
        onClose={cerrarForm}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={cerrarForm} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleGuardarForm} disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar plantilla'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleGuardarForm} className="space-y-4">
          <Field htmlFor="form-nombre" label="Nombre de la plantilla">
            <Input
              id="form-nombre"
              value={form.nombre}
              onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
              placeholder="Ej.: Remera 40x30, Bijou chica"
              maxLength={PLANTILLA_NOMBRE_MAX}
              disabled={pending}
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              htmlFor="form-ancho"
              label={`Ancho (${PLANTILLA_ANCHO_MM_MIN}–${PLANTILLA_ANCHO_MM_MAX} mm)`}
            >
              <NumberInput
                id="form-ancho"
                min={PLANTILLA_ANCHO_MM_MIN}
                max={PLANTILLA_ANCHO_MM_MAX}
                step={0.5}
                value={form.anchoMm}
                onChange={(e) => setForm((prev) => ({ ...prev, anchoMm: e.target.value }))}
                disabled={pending}
                required
              />
            </Field>

            <Field
              htmlFor="form-alto"
              label={`Alto (${PLANTILLA_ALTO_MM_MIN}–${PLANTILLA_ALTO_MM_MAX} mm)`}
            >
              <NumberInput
                id="form-alto"
                min={PLANTILLA_ALTO_MM_MIN}
                max={PLANTILLA_ALTO_MM_MAX}
                step={0.5}
                value={form.altoMm}
                onChange={(e) => setForm((prev) => ({ ...prev, altoMm: e.target.value }))}
                disabled={pending}
                required
              />
            </Field>
          </div>

          <div className="border-t border-border pt-3">
            <span className="block text-xs font-semibold text-ink">Campos visibles en la etiqueta</span>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.mostrarNombre}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, mostrarNombre: e.target.checked }))
                  }
                  disabled={pending}
                  className="rounded border-border"
                />
                Nombre del producto
              </label>

              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.mostrarTalle}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, mostrarTalle: e.target.checked }))
                  }
                  disabled={pending}
                  className="rounded border-border"
                />
                Talle
              </label>

              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.mostrarSku}
                  onChange={(e) => setForm((prev) => ({ ...prev, mostrarSku: e.target.checked }))}
                  disabled={pending}
                  className="rounded border-border"
                />
                Código SKU
              </label>

              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.mostrarTextoCodigo}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, mostrarTextoCodigo: e.target.checked }))
                  }
                  disabled={pending}
                  className="rounded border-border"
                />
                Texto del código debajo del gráfico
              </label>
            </div>
          </div>
        </form>
      </Modal>

      {/* ConfirmDialog de Eliminación */}
      <ConfirmDialog
        open={confirmarEliminar !== null}
        title="Eliminar plantilla"
        description={
          confirmarEliminar
            ? `¿Seguro que querés eliminar la plantilla "${confirmarEliminar.nombre}"? Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => {
          if (confirmarEliminar) handleEliminar(confirmarEliminar)
        }}
        onCancel={() => setConfirmarEliminar(null)}
      />
    </Card>
  )
}
