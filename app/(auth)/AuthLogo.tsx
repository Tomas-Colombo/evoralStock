/**
 * Brand mark sitting above the auth forms.
 *
 * The asset is violet graphite; `--logo-auth` recolours it to the petrol
 * palette and lifts it so it does not sink into the dark auth surface.
 *
 * To swap in the full "Utopía" wordmark, drop the transparent PNG in /public
 * and change SRC below. The asset MUST have a real alpha channel; a mark on a
 * baked black background would show as a rectangle over the backdrop.
 */
const SRC = '/logo-u.webp'

export function AuthLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand mark, same rationale as components/shell/Logo.tsx
    <img
      src={SRC}
      alt="Evoraltech"
      className="h-20 w-auto shrink-0 select-none object-contain sm:h-24"
      style={{ filter: 'var(--logo-auth)' }}
    />
  )
}
