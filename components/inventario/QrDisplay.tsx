'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Genera el data URL de un QR. Es el ÚNICO lugar donde viven las opciones de
 * generación, para que la ficha y la hoja de etiquetas produzcan exactamente
 * el mismo código.
 *
 * Corre en el cliente con la librería `qrcode`: antes esto era una URL contra
 * `api.qrserver.com`, o sea cada código de inventario viajando a un tercero, y
 * el depósito quedaba ciego si ese servicio se caía.
 */
export function generarQrDataUrl(value: string, size: number): Promise<string> {
  return QRCode.toDataURL(value, {
    width: size,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

export type EstadoQr = 'generando' | 'listo' | 'error'

/**
 * Renderiza un QR a partir de un string. Funciona offline y no filtra nada a
 * terceros.
 *
 * La caja reserva su tamaño final desde el primer render, así que ninguno de
 * los tres estados mueve el layout.
 */
export function QrDisplay({
  value,
  size = 240,
  showText = true,
}: {
  value: string
  size?: number
  showText?: boolean
}) {
  const [copied, setCopied] = useState(false)
  // El resultado se guarda JUNTO con la clave que lo produjo, y el estado se
  // deriva comparando. Así no hace falta un `setEstado('generando')` dentro del
  // efecto (que es un setState sincrónico y dispara renders en cascada), y una
  // generación vieja que resuelve tarde no puede quedar pintada: su clave ya no
  // coincide con las props actuales.
  const [resultado, setResultado] = useState<{ clave: string; url: string | null } | null>(null)
  const clave = `${value}|${size}`

  useEffect(() => {
    let cancelado = false
    generarQrDataUrl(value, size)
      .then((url) => {
        if (!cancelado) setResultado({ clave, url })
      })
      .catch(() => {
        if (!cancelado) setResultado({ clave, url: null })
      })
    return () => {
      cancelado = true
    }
  }, [value, size, clave])

  const estado: EstadoQr =
    resultado?.clave !== clave ? 'generando' : resultado.url ? 'listo' : 'error'
  const dataUrl = resultado?.url ?? ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard puede no estar disponible en http/localhost sin permisos
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="rounded-md border border-border bg-white p-3"
        style={{ width: size + 24, height: size + 24 }}
      >
        {estado === 'listo' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={dataUrl} alt={`QR ${value}`} width={size} height={size} className="block" />
        ) : (
          /* El error se MUESTRA, no se traga. Un QR en blanco en pantalla es
             molesto; en una etiqueta impresa y pegada al artículo es un ítem
             mal identificado que nadie va a poder escanear. */
          <div
            style={{ width: size, height: size }}
            className="flex items-center justify-center p-2 text-center text-[11px] leading-tight text-gray-500"
            role={estado === 'error' ? 'alert' : undefined}
          >
            {estado === 'error' ? 'No se pudo generar el código. Recargá la página.' : ''}
          </div>
        )}
      </div>
      {showText && (
        <button
          type="button"
          onClick={handleCopy}
          className="font-mono text-xs text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded px-2 py-1"
          aria-label="Copiar código"
        >
          {copied ? '¡Copiado!' : value}
        </button>
      )}
    </div>
  )
}
