import { listarTenants } from '@/lib/dal/plataforma'
import { TenantsView } from './TenantsView'

export default async function PlataformaPage() {
  const tenants = await listarTenants()
  return <TenantsView tenants={tenants} />
}
