// El cuadro de impacto vivía solo en estado de React: al ir a "Ver detalle" y
// volver con "atrás", se perdía. La regla abierta queda en la URL (?impacto=<id>)
// para que la pantalla lo reabra al montar, con el impacto recalculado.
export const PARAM_IMPACTO = 'impacto'

export function leerImpactoDeUrl(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM_IMPACTO)
}

export function marcarImpactoEnUrl(idRegla: string | null) {
  const url = new URL(window.location.href)
  if (idRegla) url.searchParams.set(PARAM_IMPACTO, idRegla)
  else url.searchParams.delete(PARAM_IMPACTO)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
