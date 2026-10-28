/**
 * wa.me exige el número en formato internacional, solo dígitos. Los
 * teléfonos se cargan como los dicta la gente ("11 5555-1234", "0351 15..."):
 * sin código de país se asume Argentina, y los móviles llevan el 9 después
 * del 54 para que WhatsApp los encuentre.
 */
export function normalizarTelefonoWhatsapp(telefono: string): string | null {
  let digitos = telefono.replace(/\D/g, '').replace(/^0+/, '')
  if (digitos.length === 10) digitos = `549${digitos}`
  else if (digitos.length === 12 && digitos.startsWith('54')) digitos = `549${digitos.slice(2)}`
  return digitos.length >= 10 && digitos.length <= 15 ? digitos : null
}

export function linkWhatsappAcceso(input: {
  telefono: string
  nombre: string
  email: string
  password: string
  urlIngreso: string
}): string | null {
  const numero = normalizarTelefonoWhatsapp(input.telefono)
  if (!numero) return null

  const texto = [
    `Hola ${input.nombre}, ya tenés tu acceso.`,
    `Ingresá en ${input.urlIngreso}`,
    `Email: ${input.email}`,
    `Contraseña temporal: ${input.password}`,
    'Apenas entres te vamos a pedir que la cambies.',
  ].join('\n')

  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}
