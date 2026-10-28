# Spec — modulos-opcionales / plataforma

**Change**: `modulos-opcionales` · **Requisitos**: `REQ-MODOP-01…10` · **Decisiones**: `DR-MODOP-1…4`

## Decisiones

- **DR-MODOP-1** — Núcleo: `administracion`, `inventario`, `ventas`,
  `precios`, `gastos`, `reportes`. Opcionales: `revendedoras` y el paquete
  `consignaciones` + `rendiciones`.
- **DR-MODOP-2** — La DB es la barrera: guarda en `tenant_modulo`, chequeo en
  cada `sp_*` del opcional, trigger en las tablas del núcleo que el opcional
  extiende. Action y UI se apoyan en ella, no la reemplazan.
- **DR-MODOP-3** — `lib/modulos/capacidades.ts` es la única traducción de
  módulos a capacidades. UI y zod derivan de ahí.
- **DR-MODOP-4** — Apagar un opcional con estado vivo se rechaza (falla
  cerrado), no se advierte.

## 1. Requisitos

### REQ-MODOP-01 — el núcleo no se apaga

`tenant_modulo` MUST NOT quedar con `habilitado = false` (ni sin fila) para
un código del núcleo.

- **Feliz**: provisión de tenant → los seis códigos del núcleo quedan habilitados.
- **N1**: service-role `update tenant_modulo set habilitado = false` sobre `ventas` → `modulo-nucleo`.
- **N2**: service-role `delete` de la fila de `inventario` → `modulo-nucleo`.
- **N3**: `pnpm provision-tenant --modulos revendedoras` (sin núcleo) → el núcleo se agrega igual; el script no lo deja afuera.

### REQ-MODOP-02 — el paquete de consignación va de a par

`consignaciones` y `rendiciones` MUST tener el mismo `habilitado` para un
tenant al cierre de cada transacción.

- **Feliz**: una transacción habilita los dos → ok.
- **N1**: transacción que habilita solo `consignaciones` → `modulo-paquete-incompleto`.
- **N2**: `provision-tenant --modulos rendiciones` → el script rechaza antes de escribir.

### REQ-MODOP-03 — no apagar un opcional con estado vivo

Pasar un opcional a `habilitado = false` MUST fallar si el tenant tiene
estado del opcional sin cerrar.

- **Feliz**: tenant sin stock de terceros ni rendiciones pendientes → apaga `consignacionProveedor`.
- **N1**: ítems de ingresos `consignacion` todavía en el local (disponibles o reservados) → `modulo-con-estado-vivo`.
- **N2**: devolución a proveedor abierta → `modulo-con-estado-vivo`.
- **N3**: ventas de ítems en consignación sin rendir, o rendición generada sin pagar → `modulo-con-estado-vivo`.
- **N4** (revendedoras): ítems `en_revendedora`, consignación a revendedora abierta, liquidación o declaración pendiente → `modulo-con-estado-vivo`.

### REQ-MODOP-04 — capacidades, una sola fuente

`capacidades(modulosHabilitados)` MUST devolver
`{ revendedoras, consignacionProveedor }`; `consignacionProveedor` es `true`
solo si están los dos códigos. De ahí salen `tiposIngresoPermitidos`,
`tiposProveedorPermitidos` y `modulosDePermisoVisibles`.

- **Feliz**: `['consignaciones','rendiciones', …núcleo]` → `tiposIngresoPermitidos = ['compra','consignacion']`.
- **N1**: solo uno de los dos códigos → `consignacionProveedor = false`, `['compra']`.
- **N2**: lista vacía → todo `false`, `['compra']`, `['mayorista','particular']`.

### REQ-MODOP-05 — ingreso de mercadería sin consignación

Sin `consignacionProveedor`, Ingresos MUST crear solo `compra`.

- **Feliz**: tenant sin el paquete → `/inventario/ingresos/nuevo` no muestra selector de tipo; el ingreso se crea `compra`.
- **N1**: POST a `crearIngresoCompletoAction` con `tipoIngreso: 'consignacion'` → `tipo-ingreso-invalido` (zod desde capacidades).
- **N2**: insert directo por PostgREST en `ingreso_mercaderia` con `tipo_ingreso = 'consignacion'` → `module-disabled` (trigger).
- **N3**: input con campos extra → rechazo (`strictObject`).
- **N4**: un ingreso histórico `consignacion` → se sigue viendo en el listado y la ficha.

### REQ-MODOP-06 — proveedor consignatario

Sin `consignacionProveedor`, el tipo `consignatario` MUST NOT ofrecerse ni aceptarse.

- **Feliz**: alta de proveedor (pantalla y modal de Ingresos) → solo `mayorista` / `particular`.
- **N1**: action de alta o edición con `tipo: 'consignatario'` → `tipo-proveedor-invalido`.
- **N2**: insert/update directo de `proveedor.tipo = 'consignatario'` → `module-disabled` (trigger).
- **N3**: proveedor histórico `consignatario` → se edita sin cambiarle el tipo (el trigger solo mira cuando `tipo` cambia o en alta).

### REQ-MODOP-07 — SPs del paquete chequean el módulo

Cada `sp_*` de consignación a proveedor y de rendición MUST levantar
`module-disabled` si su código no está habilitado.

- **Feliz**: paquete habilitado → comportamiento actual sin cambios.
- **N1**: paquete apagado → `module-disabled` en cada función de la matriz §2.
- **N2**: otro tenant con el paquete habilitado → no cambia nada (el chequeo usa `auth_tenant_id()`).

### REQ-MODOP-08 — puntos de extensión en la UI

Sin la capacidad, la UI MUST NOT mostrar lo del opcional.

- **Feliz** (`consignacionProveedor` apagado):
  - ficha de proveedor sin KPIs de consignación/rendición ni sus tablas;
  - Reportes sin "Mercadería de terceros" en `BloqueMercaderia` ni "Pagos a proveedores" en `BloqueMovimientoPlata`;
  - el bloque Proveedores de Reportes pasa a depender de la capacidad.
- **N1**: un rol con permiso `rendiciones:ver` en un tenant sin el paquete → nada de lo anterior aparece (manda la capacidad, no el permiso).

### REQ-MODOP-09 — editor de permisos y roles

El editor de permisos MUST listar solo módulos del núcleo y opcionales
habilitados. El rol "Revendedora" MUST NOT listarse sin `revendedoras`.

- **Feliz**: tenant sin opcionales → el editor muestra los seis del núcleo.
- **N1**: `createRol` / `updateRol` con permisos de un módulo no habilitado → rechazo con el slug que ya devuelve `createRolSchema` / `updateRolSchema` (el schema pasa a construirse desde capacidades + `CATALOGO_PERMISOS`).

### REQ-MODOP-10 — SP de service-role no expuesto

`sp_reactivar_acceso_revendedora` MUST ejecutarse solo como service-role.

- **Feliz**: el DAL (service-role) reactiva el acceso → ok.
- **N1**: `authenticated` llama al RPC → `permission denied`.

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| guarda de `tenant_modulo` (trigger) | — (solo service-role escribe, 00117) | sin privilegio | sin privilegio | n/a | n/a |
| `fn_modulo_habilitado(tenant, codigo)` | bool | bool | bool | `false` | solo su tenant por parámetro; la llaman triggers y SPs |
| trigger `ingreso_mercaderia` | ok | lo frena la action | rechazo (RLS restrictiva) | `module-disabled` si `consignacion` | RLS |
| trigger `proveedor` | ok | lo frena la action | rechazo | `module-disabled` si `consignatario` | RLS |
| `sp_crear_consignacion_con_items` | ok | `no-permission` (action) | rechazo | `module-disabled` | 0 filas |
| `sp_editar_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_eliminar_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_agregar_item_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_cancelar_item_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_confirmar_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_confirmar_salida_item` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_cerrar_consignacion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `preview_rendicion` | filas | — | 0 filas | `module-disabled` | 0 filas |
| `sp_generar_rendicion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_excluir_detalle_rendicion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_reincluir_detalle_rendicion` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_marcar_rendicion_pagada` | ok | `no-permission` | rechazo | `module-disabled` | 0 filas |
| `sp_reactivar_acceso_revendedora` | solo service-role | denegado | denegado | n/a | n/a |

No se tocan, a propósito (núcleo sobre historia): `sp_anular_venta`,
`sp_registrar_devolucion_cliente` (escribe `rendicion_proveedor` al devolver
un ítem en consignación ya rendido), `sp_registrar_ajuste_inventario`.

## 3. Cifras financieras

No aplica: ninguna cifra cambia de criterio. Reportes solo oculta filas que
sin el paquete valen 0.

## 4. INVOKER contra RLS restrictiva

- `fn_modulo_habilitado` es INVOKER y recibe `p_tenant`: los triggers corren
  también bajo service-role (donde `auth_tenant_id()` es null), por eso toma
  el tenant de `NEW.id_tenant`. Lee `tenant_modulo`, que tiene policy
  restrictiva para revendedoras: para ellas devuelve `false`, y es correcto
  porque una revendedora no escribe ingresos, proveedores ni rendiciones.
- Los SPs del paquete siguen INVOKER; el chequeo usa `auth_tenant_id()`.
- Ningún DEFINER nuevo.

## 5. Migraciones

Número: el siguiente libre al aplicar. Cada SP se modifica partiendo de
`pnpm sp:last <nombre>`, mostrando solo el diff del chequeo.

1. `fn_modulo_habilitado`, guarda de `tenant_modulo` (núcleo, paquete como
   constraint trigger diferido, estado vivo), `revoke` de
   `sp_reactivar_acceso_revendedora`.
2. Triggers de `ingreso_mercaderia` y `proveedor`.
3. Chequeo de módulo en los 8 SPs de consignación a proveedor.
4. Chequeo de módulo en `preview_rendicion` y los 4 SPs de rendición.

Slugs nuevos al catálogo de `lib/errores/mensajes.ts` y al inventario de su
test: `modulo-nucleo`, `modulo-paquete-incompleto`, `modulo-con-estado-vivo`,
`tipo-ingreso-invalido`, `tipo-proveedor-invalido`.
