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
