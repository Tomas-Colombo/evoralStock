import { AuthLogo } from '../AuthLogo'
import { LoginForm } from './LoginForm'

export default function LoginPage() {
  return (
    <div className="relative flex w-full flex-col items-center gap-8">
      {/*
        Legibility scrim. With the card gone the form sits straight on a moving
        backdrop, so this pools the page background behind the content and
        keeps text contrast independent of whatever the shader is drawing.
        `closest-side` with no stop before the fade means it has no perceivable
        edge — it reads as depth, not as a box.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-20 -inset-y-24 -z-10"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklab, var(--bg) 88%, transparent), transparent)',
        }}
      />

      <AuthLogo />

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-2xl text-text">EvoralStock</h1>
          <p className="text-sm text-muted">
            Ingresa tus credenciales para acceder a tu cuenta.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
