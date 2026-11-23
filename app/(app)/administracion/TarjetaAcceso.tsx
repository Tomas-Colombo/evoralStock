/**
 * Piel compartida de las tarjetas de acceso de Configuración (Usuarios, Roles,
 * Auditoría). Roles es un `<button>` que abre un modal y las otras dos son
 * `<Link>`: comparten la clase y el contenido, no el elemento.
 */
export const TARJETA_ACCESO_CLASS =
  'band-lift group flex items-end justify-between gap-4 rounded-lg border border-line-2 bg-card p-5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-petrol focus:outline-none focus-visible:ring-2 focus-visible:ring-ink'

export function TarjetaAccesoContenido({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="flex min-w-0 flex-col gap-2">
        <span className="eyebrow text-petrol">{label}</span>
        <span className="font-display text-2xl leading-none">{value}</span>
      </span>
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-band text-band-ink"
      >
        →
      </span>
    </>
  )
}
