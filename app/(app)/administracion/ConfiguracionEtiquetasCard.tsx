'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  IMPRESORA_COLUMNAS_MAX,
  IMPRESORA_COLUMNAS_MIN,
  IMPRESORA_MARGEN_MM_MAX,
  IMPRESORA_MARGEN_MM_MIN,
  IMPRESORA_OFFSET_MM_MAX,
  IMPRESORA_OFFSET_MM_MIN,
  IMPRESORA_SEPARACION_MM_MAX,
  IMPRESORA_SEPARACION_MM_MIN,
  type ImpresoraTipo,
} from '@/lib/etiquetas/limites'
import { SIMBOLOGIAS, type SimbologiaId } from '@/lib/etiquetas/simbologias'
import type { EtiquetaConfig } from '@/lib/dal/etiquetas/etiquetas'
import { setEtiquetaConfigAction } from './actions'

export function ConfiguracionEtiquetasCard({
  inicial,
  canEdit,
}: {
  inicial: EtiquetaConfig
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [metodo, setMetodo] = useState<SimbologiaId>(inicial.metodo)
  const [impresoraTipo, setImpresoraTipo] = useState<ImpresoraTipo>(inicial.impresora_tipo)
  const [margenMm, setMargenMm] = useState(String(inicial.margen_mm))
  const [separacionMm, setSeparacionMm] = useState(String(inicial.separacion_mm))
  const [columnas, setColumnas] = useState(inicial.columnas !== null ? String(inicial.columnas) : '')
  const [offsetX, setOffsetX] = useState(String(inicial.offset_x_mm))
  const [offsetY, setOffsetY] = useState(String(inicial.offset_y_mm))

  // Parseos y validaciones numéricas
  const margenNum = Number(margenMm)
  const margenValido =
    margenMm.trim() !== '' &&
    Number.isFinite(margenNum) &&
    margenNum >= IMPRESORA_MARGEN_MM_MIN &&
    margenNum <= IMPRESORA_MARGEN_MM_MAX

  const sepNum = Number(separacionMm)
  const sepValida =
    separacionMm.trim() !== '' &&
    Number.isFinite(sepNum) &&
    sepNum >= IMPRESORA_SEPARACION_MM_MIN &&
    sepNum <= IMPRESORA_SEPARACION_MM_MAX

  const colsTrim = columnas.trim()
  const colsNum = colsTrim === '' ? null : Number(colsTrim)
  const colsValidas =
    colsNum === null ||
    (Number.isInteger(colsNum) &&
      colsNum >= IMPRESORA_COLUMNAS_MIN &&
      colsNum <= IMPRESORA_COLUMNAS_MAX)

  const ofsXNum = Number(offsetX)
  const ofsXValido =
    offsetX.trim() !== '' &&
    Number.isFinite(ofsXNum) &&
    ofsXNum >= IMPRESORA_OFFSET_MM_MIN &&
    ofsXNum <= IMPRESORA_OFFSET_MM_MAX

  const ofsYNum = Number(offsetY)
  const ofsYValido =
    offsetY.trim() !== '' &&
    Number.isFinite(ofsYNum) &&
    ofsYNum >= IMPRESORA_OFFSET_MM_MIN &&
    ofsYNum <= IMPRESORA_OFFSET_MM_MAX

  const valido = margenValido && sepValida && colsValidas && ofsXValido && ofsYValido

  const sinCambios =
    valido &&
    metodo === inicial.metodo &&
    impresoraTipo === inicial.impresora_tipo &&
    margenNum === inicial.margen_mm &&
    sepNum === inicial.separacion_mm &&
    colsNum === inicial.columnas &&
    ofsXNum === inicial.offset_x_mm &&
    ofsYNum === inicial.offset_y_mm

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return

    if (!valido) {
      return toast.error('Datos inválidos', mensajeDeError('etiqueta-config-invalida'))
    }

    start(async () => {
      const res = await setEtiquetaConfigAction({
        metodo,
        impresora_tipo: impresoraTipo,
        margen_mm: Math.round(margenNum * 100) / 100,
        separacion_mm: Math.round(sepNum * 100) / 100,
        columnas: colsNum,
        offset_x_mm: Math.round(ofsXNum * 100) / 100,
        offset_y_mm: Math.round(ofsYNum * 100) / 100,
      })

      if (!res.ok) {
        return toast.error('No se pudo guardar', mensajeDeError(res.reason))
      }

      toast.success(
        'Configuración guardada',
        'El método y el perfil de la impresora fueron actualizados con éxito.',
      )
      router.refresh()
    })
  }

  const LABELS_SIMBOLOGIA: Record<SimbologiaId, string> = {
    qr: 'QR (2D — predeterminado)',
    datamatrix: 'DataMatrix (2D — alta densidad)',
    code128: 'Code 128 (1D — barras compacto)',
    ean13: 'EAN-13 (1D — estándar GS1)',
  }

  return (
    <Card as="section" className="space-y-5">
      <div>
        <h3 className="font-display text-lg">Configuración de etiquetas e impresora</h3>
        <p className="mt-0.5 text-sm text-muted">
          Elegí el método de identificación de los ítems de tu negocio y el formato físico de impresión.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Field htmlFor="cfg-metodo" label="Método de identificación">
              <Select
                id="cfg-metodo"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as SimbologiaId)}
                disabled={!canEdit || pending}
              >
                {SIMBOLOGIAS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {LABELS_SIMBOLOGIA[s.id] ?? s.id}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-1 text-xs text-muted">
              Cambiar el método aplica a las etiquetas nuevas sin invalidar las ya emitidas.
            </p>
          </div>

          <div>
            <Field htmlFor="cfg-impresora-tipo" label="Tipo de impresora">
              <Select
                id="cfg-impresora-tipo"
                value={impresoraTipo}
                onChange={(e) => setImpresoraTipo(e.target.value as ImpresoraTipo)}
                disabled={!canEdit || pending}
              >
                <option value="hoja">Hoja A4 (grilla)</option>
                <option value="rollo">Rollo continuo (térmica)</option>
              </Select>
            </Field>
            <p className="mt-1 text-xs text-muted">
              {impresoraTipo === 'hoja'
                ? 'Imprime en hojas tamaño A4 aprovechando varias etiquetas por página.'
                : 'Imprime una etiqueta por página con la medida exacta de la plantilla.'}
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-semibold text-ink">Márgenes y distribución</h4>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Field
                htmlFor="cfg-margen"
                label={`Margen de hoja (${IMPRESORA_MARGEN_MM_MIN}–${IMPRESORA_MARGEN_MM_MAX} mm)`}
              >
                <NumberInput
                  id="cfg-margen"
                  min={IMPRESORA_MARGEN_MM_MIN}
                  max={IMPRESORA_MARGEN_MM_MAX}
                  step={0.1}
                  value={margenMm}
                  onChange={(e) => setMargenMm(e.target.value)}
                  disabled={!canEdit || pending}
                />
              </Field>
            </div>

            <div>
              <Field
                htmlFor="cfg-separacion"
                label={`Separación (${IMPRESORA_SEPARACION_MM_MIN}–${IMPRESORA_SEPARACION_MM_MAX} mm)`}
              >
                <NumberInput
                  id="cfg-separacion"
                  min={IMPRESORA_SEPARACION_MM_MIN}
                  max={IMPRESORA_SEPARACION_MM_MAX}
                  step={0.1}
                  value={separacionMm}
                  onChange={(e) => setSeparacionMm(e.target.value)}
                  disabled={!canEdit || pending}
                />
              </Field>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <Field
                htmlFor="cfg-columnas"
                label={`Columnas (${IMPRESORA_COLUMNAS_MIN}–${IMPRESORA_COLUMNAS_MAX} o vacío)`}
              >
                <NumberInput
                  id="cfg-columnas"
                  min={IMPRESORA_COLUMNAS_MIN}
                  max={IMPRESORA_COLUMNAS_MAX}
                  step={1}
                  placeholder="Automático"
                  value={columnas}
                  onChange={(e) => setColumnas(e.target.value)}
                  disabled={!canEdit || pending || impresoraTipo === 'rollo'}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-semibold text-ink">Calibración de impresión (offsets)</h4>
          <p className="mt-0.5 text-xs text-muted">
            Desplazá la impresión en milímetros si las etiquetas salen corridas de su posición.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2 max-w-sm">
            <div>
              <Field
                htmlFor="cfg-offset-x"
                label={`Desplazamiento horizontal (${IMPRESORA_OFFSET_MM_MIN}–${IMPRESORA_OFFSET_MM_MAX} mm)`}
              >
                <NumberInput
                  id="cfg-offset-x"
                  min={IMPRESORA_OFFSET_MM_MIN}
                  max={IMPRESORA_OFFSET_MM_MAX}
                  step={0.1}
                  value={offsetX}
                  onChange={(e) => setOffsetX(e.target.value)}
                  disabled={!canEdit || pending}
                />
              </Field>
            </div>

            <div>
              <Field
                htmlFor="cfg-offset-y"
                label={`Desplazamiento vertical (${IMPRESORA_OFFSET_MM_MIN}–${IMPRESORA_OFFSET_MM_MAX} mm)`}
              >
                <NumberInput
                  id="cfg-offset-y"
                  min={IMPRESORA_OFFSET_MM_MIN}
                  max={IMPRESORA_OFFSET_MM_MAX}
                  step={0.1}
                  value={offsetY}
                  onChange={(e) => setOffsetY(e.target.value)}
                  disabled={!canEdit || pending}
                />
              </Field>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="pt-2">
            <Button type="submit" size="sm" disabled={pending || !valido || sinCambios}>
              {pending ? 'Guardando…' : 'Guardar configuración'}
            </Button>
          </div>
        )}
      </form>
    </Card>
  )
}
