/**
 * "6,29" o "6.29" → 6.29. Vacío o no numérico → null. Los porcentajes se
 * tipean con coma decimal (es-AR) y `Number('6,29')` da `NaN`.
 */
export function parsearDecimal(raw: string): number | null {
  const n = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(n) ? n : null
}
