'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { Button } from '@/components/ui/Button'

/**
 * Escáner de QR por cámara (web). Usa @zxing/browser sobre getUserMedia con
 * la cámara trasera (`facingMode: environment`). Escaneo continuo: cada
 * lectura dispara `onDetected`, con anti-rebote para no leer el mismo código
 * dos veces seguidas. El consumidor decide qué hacer con el texto (puede ser
 * un QR de ítem o un SKU tipeado en un rótulo).
 *
 * Requiere contexto seguro (HTTPS o localhost) — getUserMedia no corre en
 * HTTP plano.
 */
export function QrScanner({
  onDetected,
  onClose,
  dedupeMs = 2000,
}: {
  onDetected: (text: string) => void
  onClose: () => void
  /** Ignora el mismo código si se relee dentro de esta ventana (ms). */
  dedupeMs?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 })
  const [error, setError] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserMultiFormatReader()

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result) => {
          if (!result) return
          const text = result.getText().trim()
          const now = Date.now()
          if (text === lastRef.current.text && now - lastRef.current.ts < dedupeMs) return
          lastRef.current = { text, ts: now }
          setUltimo(text)
          onDetected(text)
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      })
      .catch((e: unknown) => {
        setError(traducirErrorCamara(e))
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
    // onDetected/dedupeMs estables por diseño; el efecto corre una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
        <video
          ref={videoRef}
          className="aspect-square w-full object-cover"
          muted
          playsInline
        />
        {/* Mira de encuadre */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1/2 w-1/2 rounded-lg border-2 border-band-ink/80" />
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn-ink">
          {error}
        </p>
      ) : (
        <p className="text-center text-xs text-muted">
          Escaneá el código. {ultimo && <>Último: <span className="font-mono">{ultimo}</span></>}
        </p>
      )}

      <Button variant="secondary" className="w-full" onClick={onClose}>
        Cerrar cámara
      </Button>
    </div>
  )
}

function traducirErrorCamara(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permiso de cámara denegado. Habilitá el acceso en el navegador y reintentá.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No se encontró una cámara disponible en este dispositivo.'
  }
  if (name === 'NotReadableError') {
    return 'La cámara está en uso por otra aplicación.'
  }
  return 'No se pudo iniciar la cámara. Verificá que estés en HTTPS y que el navegador tenga permiso.'
}
