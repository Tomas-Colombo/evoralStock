'use client'

import { PasswordChangeForm } from '../PasswordChangeForm'

export interface SettingsViewProps {
  email: string
  /**
   * Display name of the user's role. The caller resolves it from the session
   * and substitutes a readable label when no role is assigned, so this view
   * never has to render an empty cell.
   */
  roleName: string
}

/**
 * Per-user settings screen (REQ-AUTH-08, spec 3.6). Reachable equally by
 * every role — profile info is read-only here; password change is the only
 * mutation this slice ships.
 */
export function SettingsView({ email, roleName }: SettingsViewProps) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl text-text">Settings</h1>
        <p className="text-sm text-muted">Manage your personal profile and security.</p>
      </div>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-6">
        <h2 className="font-display text-lg text-text">Profile</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="text-text">{email}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="text-text">{roleName}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-6">
        <h2 className="font-display text-lg text-text">Change password</h2>
        <PasswordChangeForm />
      </section>
    </div>
  )
}
