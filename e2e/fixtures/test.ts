import { test as base } from '@playwright/test'
import { AdministracionPage } from '../pages/AdministracionPage'
import { AppShell } from '../pages/AppShell'
import { ClientesPage } from '../pages/ClientesPage'
import { ClienteDetallePage, CuotasPage } from '../pages/CuotasPage'
import { GastosPage } from '../pages/GastosPage'
import {
  CategoriasPage,
  InventarioPage,
  NuevoProductoPage,
} from '../pages/InventarioPage'
import { LoginPage } from '../pages/LoginPage'
import { ControlPreciosPage, ReglasPage } from '../pages/PreciosPage'
import { ProveedoresPage } from '../pages/ProveedoresPage'
import { RevendedorasPage } from '../pages/RevendedorasPage'
import { NuevaVentaPage, VentasPage } from '../pages/VentasPage'
import { readSeed, type SeedData } from '../support/tenant'

/**
 * The suite's `test`. Every page object is a fixture so specs never
 * instantiate them by hand, and `seed` exposes the reference data the setup
 * project created (category names, supplier names, …) instead of hard-coding
 * strings that would drift the moment provisioning changes.
 */
interface Fixtures {
  shell: AppShell
  login: LoginPage
  clientes: ClientesPage
  cuotas: CuotasPage
  clienteDetalle: ClienteDetallePage
  proveedores: ProveedoresPage
  revendedoras: RevendedorasPage
  inventario: InventarioPage
  nuevoProducto: NuevoProductoPage
  categorias: CategoriasPage
  reglas: ReglasPage
  controlPrecios: ControlPreciosPage
  ventas: VentasPage
  nuevaVenta: NuevaVentaPage
  gastos: GastosPage
  administracion: AdministracionPage
}

interface WorkerFixtures {
  seed: SeedData
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Read once per worker: the file is written by the setup project and never
  // changes during a run.
  seed: [
    // Playwright parses this signature statically and REQUIRES a destructuring
    // pattern here, even when no fixture is consumed.
    async ({}, use) => {
      await use(readSeed())
    },
    { scope: 'worker' },
  ],

  shell: async ({ page }, use) => {
    await use(new AppShell(page))
  },
  login: async ({ page }, use) => {
    await use(new LoginPage(page))
  },
  clientes: async ({ page }, use) => {
    await use(new ClientesPage(page))
  },
  cuotas: async ({ page }, use) => {
    await use(new CuotasPage(page))
  },
  clienteDetalle: async ({ page }, use) => {
    await use(new ClienteDetallePage(page))
  },
  proveedores: async ({ page }, use) => {
    await use(new ProveedoresPage(page))
  },
  revendedoras: async ({ page }, use) => {
    await use(new RevendedorasPage(page))
  },
  inventario: async ({ page }, use) => {
    await use(new InventarioPage(page))
  },
  nuevoProducto: async ({ page }, use) => {
    await use(new NuevoProductoPage(page))
  },
  categorias: async ({ page }, use) => {
    await use(new CategoriasPage(page))
  },
  reglas: async ({ page }, use) => {
    await use(new ReglasPage(page))
  },
  controlPrecios: async ({ page }, use) => {
    await use(new ControlPreciosPage(page))
  },
  ventas: async ({ page }, use) => {
    await use(new VentasPage(page))
  },
  nuevaVenta: async ({ page }, use) => {
    await use(new NuevaVentaPage(page))
  },
  gastos: async ({ page }, use) => {
    await use(new GastosPage(page))
  },
  administracion: async ({ page }, use) => {
    await use(new AdministracionPage(page))
  },
})

export { expect } from '@playwright/test'
export { isoDate, unique, uniqueEmail } from '../support/data'
