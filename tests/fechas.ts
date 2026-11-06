/**
 * Devuelve la fecha actual (o la de la fecha provista) en formato YYYY-MM-DD
 * en la zona horaria del tenant ('America/Argentina/Buenos_Aires').
 * Evita desfasajes entre las 21:00 y las 24:00 h locales donde new Date().toISOString()
 * evalúa al día siguiente en UTC.
 */
export function getHoyBuenosAires(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date)
}

/**
 * Devuelve el primer y último día del mes corriente en formato YYYY-MM-DD
 * en la zona horaria de Buenos Aires.
 */
export function getRangoMesBuenosAires(date: Date = new Date()): { desde: string; hasta: string } {
  const hoy = getHoyBuenosAires(date)
  const [anio, mes] = hoy.split('-').map(Number)
  const ultimoDia = new Date(anio, mes, 0).getDate()
  return {
    desde: `${hoy.slice(0, 7)}-01`,
    hasta: `${hoy.slice(0, 7)}-${String(ultimoDia).padStart(2, '0')}`,
  }
}
