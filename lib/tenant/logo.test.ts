import { describe, expect, it } from 'vitest'
import { detectarFormatoImagen } from './logo'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('detectarFormatoImagen', () => {
  it('reconoce PNG, JPEG y WebP por su firma', () => {
    expect(detectarFormatoImagen(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png')
    expect(detectarFormatoImagen(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(detectarFormatoImagen(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')))).toBe('image/webp')
  })

  it('rechaza un SVG aunque se declare como imagen', () => {
    expect(detectarFormatoImagen(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
  })

  it('rechaza un RIFF que no es WebP (WAV, AVI)', () => {
    expect(detectarFormatoImagen(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull()
  })

  it('rechaza archivos vacíos o truncados', () => {
    expect(detectarFormatoImagen(bytes())).toBeNull()
    expect(detectarFormatoImagen(bytes(0x89, 0x50, 0x4e))).toBeNull()
    expect(detectarFormatoImagen(bytes(...ascii('RIFF'), 1, 2))).toBeNull()
  })
})
