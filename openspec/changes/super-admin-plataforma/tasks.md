# Tareas — super-admin-plataforma

Cadena de PRs / slices, cada uno ≤ 400 líneas cambiadas y cerrado con su verificación correspondiente (`pnpm gate:db` para DB, `pnpm gate` para app). Cada caso negativo de la spec es un test con su número en el nombre.

## Gate humano

- [ ] Spec aprobada (`proposal.md` + `specs/REQ-SA.md` + Decisiones DR-SA-01 y DR-SA-02 con OK humano)

## Slice 1 — DB: Migración, tablas, vista, SPs y aislamiento

- [ ] Migración `supabase/migrations/00118_super_admin_plataforma.sql` (o siguiente número libre)
- [ ] Tabla `superadmin` con clave foránea a `auth.users(id)`
- [ ] Tabla `tenant_cargo` con constraints (`monto > 0`, checks de anulación coherente) y FKs
- [ ] Tabla `tenant_pago` con constraints (`monto > 0`, checks de anulación coherente) y FKs
- [ ] Vista `tenant_saldo` (Σ cargos vigentes − Σ pagos vigentes por tenant)
- [ ] Procedimiento `sp_registrar_cargo_tenant` (REQ-SA-04)
- [ ] Procedimiento `sp_registrar_pago_tenant` (REQ-SA-05)
- [ ] Procedimiento `sp_anular_movimiento_tenant` (REQ-SA-06)
- [ ] Procedimiento `sp_toggle_tenant_modulo_admin` (REQ-SA-03)
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en las 3 tablas sin policies
- [ ] `REVOKE ALL ON ... FROM authenticated, anon, public` sobre tablas, vista y SPs (REQ-SA-08)
- [ ] Bloque `-- DOWN:` ejecutable completo
- [ ] Suite `tests/db/plataforma.test.ts` cubriendo casos felices, cálculo de saldo (REQ-SA-07), aislamiento estricto (REQ-SA-08 N1..N4) y casos negativos de mutación (N1..N4 de REQ-SA-04, REQ-SA-05 y REQ-SA-06)

## Slice 2 — Auth & Guard: `requireSuperAdmin()` y flujo de login

- [ ] Guarda `requireSuperAdmin()` en `lib/dal/plataforma/guard.ts` (valida JWT activo y pertenencia a tabla `superadmin` vía service-role)
- [ ] Flujo de login en `app/(auth)/login/actions.ts`: redirección a `/plataforma` si el usuario carece de `tenant_id` pero es superadmin (DR-SA-02, REQ-SA-01)
- [ ] Pruebas unitarias colocadas en `lib/dal/plataforma/guard.test.ts`
- [ ] Pruebas unitarias de login en `app/(auth)/login/actions.test.ts`

## Slice 3 — DAL, validación y Server Actions

- [ ] Schemas Zod en `lib/validation/plataforma.ts` con `strictObject` (cargos, pagos, anulación, toggle de módulo) y test colocado `plataforma.test.ts`
- [ ] Nuevos slugs de error en catálogo `lib/errores/mensajes.ts` y sincronización con `lib/errores/mensajes.test.ts`:
  - `monto-invalido`
  - `concepto-invalido`
  - `medio-pago-invalido`
  - `movimiento-inexistente`
  - `movimiento-ya-anulado`
  - `tipo-movimiento-invalido`
  - `tenant-inexistente`
  - `modulo-invalido`
- [ ] Funciones DAL en `lib/dal/plataforma/index.ts`:
  - `listarTenants()` (consulta consolidada de tenants, módulos y saldo en 1 query — Design for N, REQ-SA-02)
  - `obtenerTenantDetalle(idTenant)` (información, módulos y cuenta corriente, REQ-SA-07)
  - `registrarCargoTenantAction()` / DAL
  - `registrarPagoTenantAction()` / DAL
  - `anularMovimientoTenantAction()` / DAL
  - `toggleModuloTenantAction()` / DAL
- [ ] Server Actions en `app/(plataforma)/plataforma/actions.ts` implementando las 3 compuertas (Authorize -> Validate -> DAL)
- [ ] Pruebas unitarias colocadas para las Server Actions

## Slice 4 — UI: Panel de plataforma

- [ ] Shell de plataforma y layout en `app/(plataforma)/layout.tsx` (con `requireSuperAdmin()`)
- [ ] Vista de listado general `app/(plataforma)/plataforma/page.tsx` (tabla de tenants, búsqueda, módulos habilitados, estado y saldo deudor)
- [ ] Vista de detalle por tenant `app/(plataforma)/plataforma/[id]/page.tsx`:
  - Ficha resumen de tenant
  - Panel de switches para toggle de módulos opcionales
  - Historial unificado de cargos y pagos con indicador de anulación
  - Modales / formularios para: Nuevo cargo, Nuevo pago y Confirmación de anulación
- [ ] Pruebas de componentes o e2e de la navegación de plataforma
