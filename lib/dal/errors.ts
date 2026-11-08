export const AUTHORIZATION_REASONS = [
  'no-session',
  'no-permission',
  'module-disabled',
  'tenant-mismatch',
] as const

export type AuthorizationErrorReason = (typeof AUTHORIZATION_REASONS)[number]

export function isAuthorizationReason(value: unknown): value is AuthorizationErrorReason {
  return typeof value === 'string' && (AUTHORIZATION_REASONS as readonly string[]).includes(value)
}

/**
 * Fail-closed DAL error (design §7). Every guard/session check throws this
 * instead of returning a falsy value, so a missing catch never silently
 * grants access (REQ-AUTH-10, REQ-AG-05).
 */
export class AuthorizationError extends Error {
  reason: AuthorizationErrorReason

  constructor(reason: AuthorizationErrorReason) {
    super(reason)
    this.name = 'AuthorizationError'
    this.reason = reason
  }
}

/**
 * Normaliza los errores devueltos por un RPC de Supabase.
 * Si el error es 'no-permission' (raise 42501 desde el SP), devuelve el slug limpio
 * para que las Server Actions puedan mapearlo a la razón de autorización correspondiente.
 * Para cualquier otro error, conserva el prefijo del SP y el mensaje completo original.
 */
export function errorDeRpc(sp: string, error: { message: string }): string {
  if (error.message === 'no-permission') {
    return 'no-permission'
  }
  return `${sp}: ${error.message}`
}
