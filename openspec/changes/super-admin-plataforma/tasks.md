# Tareas — super-admin-plataforma

Cadena de PRs / slices, cada uno ≤ 400 líneas cambiadas y cerrado con su verificación correspondiente (`pnpm gate:db` para DB, `pnpm gate` para app). Cada caso negativo de la spec es un test con su número en el nombre.

## Gate humano

- [ ] Spec aprobada (`proposal.md` + `specs/REQ-SA.md`)
- [ ] Slice 1 requiere modulos-opcionales PR 1 mergeado

## Slice 1 — DB: Migración, tablas, vista, SPs y aislamiento

- [x] Migración `supabase/migrations/00119_super_admin_plataforma.sql` (o siguiente número libre)
- [x] Tabla `superadmin` con clave foránea a `auth.users(id)`
- [x] Tabla `tenant_cargo` con constraints (`monto > 0`, `check (periodo = date_trunc('month', periodo)::date)`, `created_by not null`, checks de anulación coherente) y FKs
- [x] Tabla `tenant_pago` con constraints (`monto > 0`, `check (medio in ('transferencia', 'efectivo', 'mercadopago', 'otro'))`, `created_by not null`, checks de anulación coherente) y FKs
- [x] Vista `tenant_saldo` declarada `with (security_invoker = on)` (REQ-SA-04, REQ-SA-07)
- [x] Procedimiento `sp_registrar_cargo_tenant(p_id_tenant, p_periodo, p_monto, p_concepto, p_created_by)` con validación de superadmin (REQ-SA-04)
- [x] Procedimiento `sp_registrar_pago_tenant(p_id_tenant, p_fecha, p_monto, p_medio, p_nota, p_created_by)` con validación de superadmin (REQ-SA-05)
- [x] Procedimiento `sp_anular_movimiento_tenant(p_tipo, p_id_movimiento, p_anulado_por)` con validación de superadmin (REQ-SA-06)
- [x] Procedimiento `sp_toggle_tenant_modulo_admin(p_id_tenant, p_paquete, p_habilitado, p_actor, p_ip)` para habilitación por paquete (REQ-SA-03)
- [x] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en las 3 tablas sin policies
- [x] `REVOKE ALL ON ... FROM authenticated, anon, public` sobre tablas, vista y SPs (REQ-SA-08)
- [x] Trigger `tr_semilla_comision_revendedoras` en `tenant_modulo` (semilla local 0% al activar revendedoras) y reposición en comisiones.test.ts
- [x] Bloque `-- DOWN:` ejecutable completo y reversible
- [x] Suite `tests/db/plataforma.test.ts`:
  - Casos felices de cargos, pagos, saldo y anulación
  - Validación de paridad entre la constante TS de medios de pago y el CHECK de SQL
  - Casos negativos numerados de REQ-SA-03 (N1..N3), REQ-SA-04 (N1..N5), REQ-SA-05 (N1..N5) y REQ-SA-06 (N1..N4)
  - Aislamiento estricto REQ-SA-08 (N1..N4)
  - Chequeo de regresión manual de seguridad (docs/protocolo-agentes.md): quitar temporalmente revoke y RLS para confirmar que el test falla antes de fijar la guarda definitiva

## Slice 2 — Auth & Guard: `requireSuperAdmin()` y flujo de login

- [x] Helper `esSuperAdmin(idUsuario: string)` en `lib/dal/plataforma/guard.ts` (consulta con service-role a `superadmin`)
- [x] Guarda `requireSuperAdmin()` en `lib/dal/plataforma/guard.ts` (valida sesión y pertenencia a `superadmin`)
- [x] Flujo de login en `app/(auth)/login/actions.ts`: desvío a `/plataforma` si el usuario no tiene `tenant_id` pero `esSuperAdmin` es true (DR-SA-02, REQ-SA-01)
- [x] Manejo en `app/(app)/layout.tsx`: desvío de superadmin a `/plataforma` evitando rebote/bucle en `/login` (REQ-SA-01 N5)
- [x] Pruebas unitarias colocadas en `lib/dal/plataforma/guard.test.ts`
- [x] Pruebas unitarias de login en `app/(auth)/login/actions.test.ts`

## Slice 3 — DAL, validación y Server Actions

- [x] Constante `MEDIOS_PAGO_TENANT` en `lib/types/plataforma.ts` (`'transferencia'`, `'efectivo'`, `'mercadopago'`, `'otro'`) (hecho en Slice 1)
- [x] Schemas Zod en `lib/validation/plataforma.ts` con `strictObject` (cargos, pagos, anulación, toggle de paquete) y test colocado `plataforma.test.ts`
- [x] Reuso de slugs existentes: `monto-invalido` y `fecha-invalida`
- [x] Nuevos slugs de error en catálogo `lib/errores/mensajes.ts` y en `lib/errores/mensajes.test.ts` (hecho en Slice 1):
  - `concepto-invalido`
  - `periodo-invalido`
  - `medio-pago-invalido`
  - `movimiento-inexistente`
  - `movimiento-ya-anulado`
  - `tipo-movimiento-invalido`
  - `tenant-inexistente`
  - `paquete-invalido`
- [x] Funciones DAL en `lib/dal/plataforma/index.ts`:
  - `listarTenants()` (consulta consolidada de tenants, módulos y saldo en 1 query — Design for N, REQ-SA-02)
  - `obtenerTenantDetalle(idTenant)` (información, módulos y cuenta corriente, REQ-SA-07)
  - `registrarCargoTenantAction()` / DAL (REQ-SA-04)
  - `registrarPagoTenantAction()` / DAL (REQ-SA-05)
  - `anularMovimientoTenantAction()` / DAL (REQ-SA-06)
  - `togglePaqueteTenantAction()` / DAL (REQ-SA-03)
- [x] Server Actions en `app/(plataforma)/plataforma/actions.ts` implementando las 3 compuertas (Authorize -> Validate -> DAL)
- [x] Pruebas unitarias colocadas para las Server Actions

## Slice 4 — UI: Panel de plataforma

- [x] Shell de plataforma y layout en `app/(plataforma)/layout.tsx` (con `requireSuperAdmin()`)
- [x] Vista de listado general `app/(plataforma)/plataforma/page.tsx` (tabla de tenants, búsqueda, paquetes de módulos activos, estado y saldo deudor)
- [x] Vista de detalle por tenant `app/(plataforma)/plataforma/[id]/page.tsx`:
  - Ficha resumen de tenant
  - Panel de switches exclusivo para paquetes opcionales (`revendedoras`, `consignacionProveedor`); los módulos del núcleo no aparecen como toggle
  - Historial unificado de cargos y pagos con indicador de vigencia/anulación
  - Modales / formularios para: Nuevo cargo, Nuevo pago y Confirmación de anulación
- [x] Pruebas de componentes o e2e de la navegación de plataforma
