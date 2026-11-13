/**
 * Cálculo y validación de código de barras EAN-13 según estándar GS1.
 *
 * En espejo con la función SQL `fn_ean13_digito` (REQ-ETQ-02).
 */

/**
 * Calcula el dígito verificador GS1 para los primeros 12 dígitos de un código EAN-13.
 *
 * Algoritmo GS1:
 * - Ponderación alterna 1 y 3 de izquierda a derecha (posiciones impares × 1, pares × 3).
 * - Resto módulo 10: dígito = (10 - (suma % 10)) % 10.
 *
 * @throws Error si el parámetro no contiene exactamente 12 dígitos numéricos.
 */
export function calcularDigitoEan13(doceDigitos: string): number {
  if (typeof doceDigitos !== 'string' || !/^\d{12}$/.test(doceDigitos)) {
    throw new Error(`Se esperan exactamente 12 dígitos numéricos, recibido: "${doceDigitos}"`)
  }

  let suma = 0
  for (let i = 0; i < 12; i++) {
    const digito = doceDigitos.charCodeAt(i) - 48
    // Posición 1 (índice 0): impar (× 1), posición 2 (índice 1): par (× 3), etc.
    suma += i % 2 === 0 ? digito : digito * 3
  }

  return (10 - (suma % 10)) % 10
}

/**
 * Valida si un string es un código EAN-13 completo y válido (13 dígitos con verificador GS1).
 */
export function esEan13Valido(codigo: unknown): codigo is string {
  if (typeof codigo !== 'string' || !/^\d{13}$/.test(codigo)) {
    return false
  }

  const primeros12 = codigo.slice(0, 12)
  const digitoVerificador = codigo.charCodeAt(12) - 48

  return calcularDigitoEan13(primeros12) === digitoVerificador
}

/**
 * Genera el código EAN-13 completo a partir de los primeros 12 dígitos.
 */
export function generarEan13(doceDigitos: string): string {
  return `${doceDigitos}${calcularDigitoEan13(doceDigitos)}`
}
