import { Topbar } from '@/components/shell/Topbar'
import { BuscadorFicha } from '@/components/inventario/BuscadorFicha'
import { verifySession } from '@/lib/dal/session'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'

export default async function FichaEntradaPage() {
  const session = await verifySession()
  const productos = await listProductosSinCosto({ soloActivos: true })
  return (
    <>
      <Topbar title="Escanear ítem" session={session} backHref="/inventario" />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-md">
          <BuscadorFicha productos={productos} />
        </div>
      </main>
    </>
  )
}
