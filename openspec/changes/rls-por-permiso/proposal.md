# Propuesta — rls-por-permiso

**Change**: `rls-por-permiso` · **Spec**: `proposal.md` (+ `specs/REQ-RLSP.md` en Fase 2) · **Tareas**: `tasks.md`

## 1. Problema

Toda policy de dominio es `using (id_tenant = auth_tenant_id())`. La única capa
adicional es la de revendedoras (`00078_rls_revendedoras.sql`): policies
`restrictive` con `auth_revendedora_id() is null`, que bloquean a una
revendedora en todas las tablas de dominio.

Un **empleado con rol limitado** (por ejemplo, sin `reportes`, `gastos` ni
permiso sobre costos) no tiene esa capa:

- Su JWT trae el `tenant_id` y RLS no mira nada más.
- La anon key es pública (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) y la sesión es
  accesible desde el navegador.
- `requireModuleRole` (`lib/dal/guard.ts`) es una guarda de aplicación: corre
  solo dentro de las Server Actions y no limita lo que se lee por PostgREST.

Resultado: desde la consola del navegador puede leer `costo_producto`,
`gasto_negocio`, `proveedor`, `rendicion_proveedor` y el resto del tenant. Si
los `sp_*` de escritura no chequean permiso (los límites viven en las guardas,
según AGENTS.md), también podría invocar escrituras que la UI no le ofrece.

## 2. Objetivo

Que la base de datos, y no solo la guarda, impida que un usuario lea o escriba
datos de un módulo para el que su rol no tiene permiso. La aislación por tenant
y la de revendedoras no cambian.

## 3. Enfoque

Mismo patrón que revendedoras: policies `restrictive` que se suman a las de
tenant (un `AND`), sin tocar las policies existentes.

1. **Helper `auth_tiene_permiso(p_modulo text, p_accion text) returns boolean`**,
   `stable`, INVOKER. Lee `usuario.id_rol → rol.permisos` del usuario de
   `auth.uid()` en el tenant del JWT.
   - Lee de la tabla y no de un claim: un permiso revocado deja de valer en la
     siguiente consulta, no cuando expira el token (hasta 1 h).
   - En las policies va como `(select auth_tiene_permiso(...))` para que se
     evalúe una vez por consulta (initplan) y no por fila.
   - Si INVOKER no alcanza (recursión de RLS sobre `usuario`/`rol`), PARAR y
     preguntar: DEFINER sería una excepción nueva a AGENTS.md.
2. **Policies restrictivas por fases**, empezando por las tablas que pertenecen
   a un solo módulo (las que el inventario de Fase 1 confirme como exclusivas).
3. **Chequeo de permiso dentro de los `sp_*` de escritura** (defensa en
   profundidad para escrituras). Cada `sp_*` parte de `pnpm sp:last`: un
   `create or replace` armado sobre una definición vieja pisa sin error lo que
   agregó otro cambio (por ejemplo, la conversión USD de `cotizacion-usd`).
4. **Matriz de tests** en `tests/db/rls-por-permiso.test.ts`: rol × tabla ×
   operación, al estilo de `tests/db/rvp-lecturas.test.ts`.

## 4. Fuera de alcance (va en otro cambio)

- **Columnas de costo en tablas compartidas** (`detalle_venta.costo_snapshot`,
  `monto_ganancia` y equivalentes). Un vendedor necesita las filas de venta
  pero no esas columnas, y RLS filtra filas, no columnas. Las salidas posibles
  (revocar el SELECT de las columnas, mover los costos a una tabla aparte, o
  leer costos solo vía `rf_*`) se deciden con el inventario en la mano, en un
  cambio `costos-por-columna`.
- Cambiar el modelo de permisos (`CATALOGO_PERMISOS`, `rol.permisos`).
- Habilitación de módulos por tenant en RLS (`tenant_modulo`): hoy la resuelve
  la guarda; se evalúa en Fase 2.

## 5. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Restringir una tabla que otro módulo lee rompe una pantalla legítima | Fase 1 mapea cada lectura de `lib/dal/**` a su módulo y permiso antes de escribir SQL |
| Un `sp_*` INVOKER que cruza una tabla restringida devuelve menos filas a quien sí tiene permiso de su módulo | Columna "lecturas cruzadas" del inventario; cada caso se resuelve en la spec (§4 de la plantilla) |
| Costo por fila del helper | `(select ...)` + verificar índice del lookup `auth.uid() → usuario`; medir en Fase 3 |
| Choque con otros cambios en curso | Número de migración: el siguiente libre al aplicar. Fase 5 parte de `pnpm sp:last`. `pnpm gate:db` nunca en paralelo con otro agente |
| El rol Administrador queda sin acceso | Tests explícitos del rol Administrador en la matriz |

## 6. Preguntas que cierra la Fase 1

1. ¿Qué tablas lee o escribe cada módulo de permisos (no cada carpeta)?
2. ¿Cuáles son exclusivas de un módulo y cuáles compartidas?
3. ¿Qué `sp_*`/`rf_*` INVOKER cruzan tablas de otro módulo?
4. ¿Qué `sp_*` de escritura hoy no chequean permiso?
5. ¿Cómo se identifica al administrador (permisos completos en `rol.permisos`, nombre de rol, otro flag)?
