import Link from 'next/link'
import { logoutAction } from '@/app/(app)/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { isAuthorizationReason } from '@/lib/dal/errors'
import { verifySession } from '@/lib/dal/session'
import { MENSAJE_GENERICO, mensajeDeError } from '@/lib/errores/mensajes'
import { itemsPermitidos } from '@/lib/modulos/rutas'

interface NoAutorizadoPageProps {
  searchParams: Promise<{ e?: string }>
}

/**
 * Pantalla de acceso no autorizado.
 *
 * Muestra el motivo del rechazo validado por whitelist (AuthorizationErrorReason)
 * y una lista de accesos directos a los módulos permitidos para el usuario.
 * Si el usuario no tiene permisos en ningún módulo, se muestra una indicación
 * para contactar al administrador y la opción de cerrar sesión.
 */
export default async function NoAutorizadoPage(props: NoAutorizadoPageProps) {
  const { e } = await props.searchParams
  const validReason = e && isAuthorizationReason(e) ? e : null
  const mensaje = validReason ? mensajeDeError(validReason) : MENSAJE_GENERICO

  const session = await verifySession()
  const permitidos = itemsPermitidos(session)

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md flex flex-col gap-6" padding="lg">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl text-text">Acceso no autorizado</h1>
          <p className="text-sm text-muted">{mensaje}</p>
        </div>

        {permitidos.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">
              Módulos disponibles para tu usuario:
            </p>
            <div className="flex flex-wrap gap-2">
              {permitidos.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium text-text transition-colors hover:border-line-hover hover:bg-hover"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Tu cuenta no tiene acceso a ningún módulo. Comunicate con un administrador para que configure tus permisos.
            </p>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" className="w-full">
                Cerrar sesión
              </Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  )
}
