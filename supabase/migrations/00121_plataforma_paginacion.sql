-- 00121_plataforma_paginacion.sql
-- Vistas tenant_listado y tenant_movimiento para paginación y filtros en /plataforma.
-- REQ-SA-11. D1, D5.
--
-- UP:
--   1. Vista tenant_listado (with security_invoker = on, consolidado de tenant con saldo, cargos y pagos).
--   2. Vista tenant_movimiento (with security_invoker = on, union all de cargos y pagos).
--   3. Revocar permisos de ambas vistas a anon, authenticated y public.
--
-- DOWN:
-- drop view if exists tenant_movimiento;
-- drop view if exists tenant_listado;

-- ─── 1. VISTA tenant_listado ─────────────────────────────────────────
create or replace view tenant_listado
with (security_invoker = on) as
select
  t.id_tenant,
  t.nombre_comercial,
  t.subdominio,
  t.logo_url,
  t.color_primario,
  t.estado_tenant,
  t.created_at,
  t.updated_at,
  s.saldo,
  s.total_cargos,
  s.total_pagos
from tenant t
-- El saldo sale de tenant_saldo (00119): una sola fórmula, o el listado y el
-- detalle terminan mostrando números distintos para el mismo tenant.
join tenant_saldo s on s.id_tenant = t.id_tenant;

revoke all on tenant_listado from authenticated, anon, public;

-- ─── 2. VISTA tenant_movimiento ──────────────────────────────────────
create or replace view tenant_movimiento
with (security_invoker = on) as
select
  id,
  id_tenant,
  'cargo'::text as tipo,
  periodo as fecha,
  monto,
  concepto,
  null::text as medio,
  null::text as nota,
  created_at,
  anulado_at,
  anulado_por
from tenant_cargo
union all
select
  id,
  id_tenant,
  'pago'::text as tipo,
  fecha,
  monto,
  null::text as concepto,
  medio,
  nota,
  created_at,
  anulado_at,
  anulado_por
from tenant_pago;

revoke all on tenant_movimiento from authenticated, anon, public;
