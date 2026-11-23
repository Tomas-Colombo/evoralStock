'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Table, type Column } from '@/components/ui/Table'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { estimarComision } from '@/lib/comisiones/resolver-comision'
import type { AmbitoComision, ReglaComisionConEscalas } from '@/lib/types/comisiones'
import { crearReglaGeneralAction, terminarReglaAction } from './actions'
import { Card } from '@/components/ui/Card'

interface ReglasComisionViewProps {
  reglas: ReglaComisionConEscalas[]
  canEdit: boolean
}

export function ReglasComisionView({ reglas, canEdit }: ReglasComisionViewProps) {
  const router = useRouter()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Formulario nueva regla general
  const hoy = new Date().toISOString().split('T')[0]
  const [ambito, setAmbito] = useState<AmbitoComision>('revendedora')
  const [nombre, setNombre] = useState('')
  const [vigenteDesde, setVigenteDesde] = useState(hoy)
  const [vigenteHasta, setVigenteHasta] = useState('')
  const [tramos, setTramos] = useState<Array<{ objetivo_desde: number; porcentaje: number }>>([
    { objetivo_desde: 0, porcentaje: 10 },
  ])

  // Preview de estimación
  const [montoPrueba, setMontoPrueba] = useState(50000)

  const handleAgregarTramo = () => {
    const ultimoObjetivo = tramos[tramos.length - 1]?.objetivo_desde ?? 0
    setTramos([...tramos, { objetivo_desde: ultimoObjetivo + 50000, porcentaje: 15 }])
  }

  const handleQuitarTramo = (idx: number) => {
    if (tramos.length <= 1) return
    setTramos(tramos.filter((_, i) => i !== idx))
  }

  const handleUpdateTramo = (idx: number, campo: 'objetivo_desde' | 'porcentaje', valor: number) => {
    const nuevos = [...tramos]
    nuevos[idx] = { ...nuevos[idx], [campo]: valor }
    setTramos(nuevos)
  }

  const handleCrearRegla = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSubmitting(true)

    try {
      const res = await crearReglaGeneralAction({
        ambito,
        nombre: nombre.trim(),
        vigente_desde: vigenteDesde,
        vigente_hasta: vigenteHasta ? vigenteHasta : null,
        escalas: tramos.map((t) => ({
          objetivo_desde: Number(t.objetivo_desde),
          porcentaje: Number(t.porcentaje),
        })),
      })

      if (!res.ok) {
        setErrorMsg(mensajeDeError(res.reason))
        setSubmitting(false)
        return
      }

      setModalAbierto(false)
      setNombre('')
      setTramos([{ objetivo_desde: 0, porcentaje: 10 }])
      router.refresh()
    } catch {
      setErrorMsg('Ocurrió un error inesperado al guardar la regla.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleTerminarRegla = async (idRegla: string) => {
    if (!confirm('¿Querés finalizar la vigencia de esta regla a partir de hoy?')) return
    setErrorMsg(null)

    const res = await terminarReglaAction({
      id_regla: idRegla,
      vigente_hasta: hoy,
    })

    if (!res.ok) {
      alert(mensajeDeError(res.reason))
      return
    }

    router.refresh()
  }

  // Tramos ordenados para el preview
  const tramosOrdenados = [...tramos].sort((a, b) => b.objetivo_desde - a.objetivo_desde)
  const tramoPreview = tramosOrdenados.find((t) => t.objetivo_desde <= montoPrueba)
  const pctPreview = tramoPreview?.porcentaje ?? 0
  const preview = estimarComision(montoPrueba, pctPreview)

  const columns: Column<ReglaComisionConEscalas>[] = [
    {
      key: 'ambito',
      label: 'Ámbito',
      render: (r) => (
        <Badge variant={r.ambito === 'revendedora' ? 'info' : 'neutral'}>
          {r.ambito === 'revendedora' ? 'Revendedor' : 'Local'}
        </Badge>
      ),
    },
    {
      key: 'nombre',
      label: 'Nombre / Descripción',
      render: (r) => (
        <div>
          <div className="font-medium text-foreground">{r.nombre || 'Sin nombre'}</div>
          {r.id_revendedora && (
            <div className="text-xs text-muted-foreground">Comisión propia personalizada</div>
          )}
        </div>
      ),
    },
    {
      key: 'escalas',
      label: 'Tramos de comisión',
      render: (r) => (
        <div className="text-sm space-y-1">
          {r.escalas.length === 0 ? (
            <span className="text-muted-foreground text-xs">Sin tramos</span>
          ) : (
            r.escalas.map((e) => (
              <div key={e.id_escala}>
                Desde ${e.objetivo_desde.toLocaleString('es-AR')}:{' '}
                <span className="font-semibold">{e.porcentaje}%</span>
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'vigente_desde',
      label: 'Vigencia',
      render: (r) => {
        const estaVencida = r.vigente_hasta && r.vigente_hasta < hoy
        return (
          <div className="text-xs">
            <div>Desde: {r.vigente_desde}</div>
            <div>Hasta: {r.vigente_hasta || 'Indefinida'}</div>
            <div className="mt-1">
              {estaVencida ? (
                <Badge variant="neutral">Finalizada</Badge>
              ) : (
                <Badge variant="success">Vigente</Badge>
              )}
            </div>
          </div>
        )
      },
    },
    {
      key: 'acciones',
      label: 'Acciones',
      render: (r) => {
        const puedeFinalizar = canEdit && (!r.vigente_hasta || r.vigente_hasta >= hoy)
        if (!puedeFinalizar) return null
        return (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleTerminarRegla(r.id_regla)}
          >
            Finalizar hoy
          </Button>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {errorMsg && (
        <div className="rounded-md border border-error/20 bg-error/10 p-4 text-sm text-error">
          {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Reglas generales de comisión</h2>
          <p className="text-sm text-muted-foreground">
            Definí las escalas de porcentaje según los objetivos alcanzados en el período.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setModalAbierto(true)}>
            Nueva regla general
          </Button>
        )}
      </div>

      <Card padding="none" className="overflow-x-auto">
        <Table columns={columns} data={reglas} />
      </Card>

      {modalAbierto && (
        <Modal
          open={modalAbierto}
          title="Nueva regla general de comisión"
          onClose={() => setModalAbierto(false)}
        >
          <form onSubmit={handleCrearRegla} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Ámbito</label>
                <Select
                  value={ambito}
                  onChange={(e) => setAmbito(e.target.value as AmbitoComision)}
                >
                  <option value="revendedora">Revendedor (General)</option>
                  <option value="local">Vendedor Local</option>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Nombre de la regla</label>
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Escala estándar 2026"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Vigente desde</label>
                <Input
                  type="date"
                  value={vigenteDesde}
                  onChange={(e) => setVigenteDesde(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Vigente hasta (opcional)</label>
                <Input
                  type="date"
                  value={vigenteHasta}
                  onChange={(e) => setVigenteHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Tramos de la escala</span>
                <Button type="button" size="sm" variant="secondary" onClick={handleAgregarTramo}>
                  + Agregar tramo
                </Button>
              </div>

              {tramos.map((t, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Objetivo desde ($)</label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={t.objetivo_desde}
                      onChange={(e) =>
                        handleUpdateTramo(idx, 'objetivo_desde', Number(e.target.value))
                      }
                      required
                    />
                  </div>
                  <div className="w-32">
                    <label className="text-xs text-muted-foreground">Comisión (%)</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={t.porcentaje}
                      onChange={(e) =>
                        handleUpdateTramo(idx, 'porcentaje', Number(e.target.value))
                      }
                      required
                    />
                  </div>
                  {tramos.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-4 text-error"
                      onClick={() => handleQuitarTramo(idx)}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Simulador / Preview en vivo rotulado "estimación" */}
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Simulador de cálculo</span>
                <span className="text-ink">Estimación</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Monto vendido en período ($)</label>
                  <Input
                    type="number"
                    value={montoPrueba}
                    onChange={(e) => setMontoPrueba(Number(e.target.value))}
                  />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-xs text-muted-foreground">Comisión resultante</div>
                  <div className="text-lg font-bold text-foreground">
                    {preview.porcentaje}% (${preview.montoEstimado.toLocaleString('es-AR')})
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="secondary" onClick={() => setModalAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Guardando...' : 'Guardar regla'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
