import { randomInt } from 'node:crypto'

/** Temp password charset, minus characters that are ambiguous when read aloud. */
export const PASSWORD_CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generarPassword(len = 16): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]
  }
  return out
}
