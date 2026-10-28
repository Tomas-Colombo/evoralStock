# Propuesta — modulos-opcionales

**Change**: `modulos-opcionales` · **Spec**: `specs/REQ-MODOP.md` · **Tareas**: `tasks.md`

## Problema

`tenant_modulo` dice qué contrató cada cliente, pero solo Revendedoras se
comporta como un módulo apagable. El resto no está preparado:

- Apagar `ventas` deja la app en un bucle de redirects (`/` → `/ventas` →
  `/?e=module-disabled` → `/ventas`).
- Apagar `consignaciones` / `rendiciones` deja a la vista el tipo de ingreso
  "Consignación", el tipo de proveedor "Consignatario", la deuda de
  consignación en la ficha del proveedor y las cifras de terceros en Reportes.
  `crearIngresoCompletoAction` recibe `tipoIngreso` sin zod, así que por POST
  se puede crear stock en consignación igual.
- Los `sp_*` de consignación y rendición no miran `tenant_modulo`: con la
  action como única barrera, cualquier otra ruta de escritura pasa.
- Nada impide al operador apagar un módulo con estado vivo (stock de
  terceros, rendiciones o liquidaciones pendientes): el cliente queda con
  deuda que no puede ver ni pagar.

## Decisión

**Núcleo, siempre habilitado** (permisos `administracion`, `inventario`,
`ventas`, `precios`, `gastos`, `reportes`): Ventas, Inventario, Ingresos,
Precios y cuentas, Clientes, Cuotas, Proveedores, Gastos, Reportes,
Administración.

**Opcionales**, cada uno un paquete de códigos de `modulo`:

| Paquete | Códigos | Qué agrega al núcleo |
| --- | --- | --- |
| `revendedoras` | `revendedoras` | canal de venta, stock en poder, portal, liquidaciones |
| `consignacionProveedor` | `consignaciones` + `rendiciones` | ingreso por consignación, proveedor consignatario, devoluciones a proveedor, rendiciones |

Los dos códigos de `consignacionProveedor` siguen siendo dos permisos (un rol
puede ver rendiciones sin poder devolver mercadería), pero la habilitación
es de a par: o están los dos o ninguno.

**Regla de dependencia**: el núcleo nunca depende de un opcional. Un opcional
se engancha en puntos de extensión del núcleo, y cada punto pregunta por la
capacidad, no por el código de módulo.

**Defensa en tres capas**, igual que Revendedoras:

1. **DB** (la que manda): `tenant_modulo` no acepta apagar el núcleo, ni
   romper un paquete, ni apagar un opcional con estado vivo. Los `sp_*` del
   opcional y los triggers sobre las tablas del núcleo que lo extienden
   (`ingreso_mercaderia.tipo_ingreso`, `proveedor.tipo`) levantan
   `module-disabled`.
2. **Server Action**: `requireModuleRole` + zod construido desde las
   capacidades (una sola lista para UI y validación).
3. **UI**: los puntos de extensión no muestran lo que el tenant no tiene.

**Una sola fuente**: `lib/modulos/capacidades.ts` (lógica pura, testeada)
traduce `session.modulosHabilitados` a capacidades y deriva las listas
(`tiposIngresoPermitidos`, `tiposProveedorPermitidos`, módulos del editor de
permisos). Prohibido `modulosHabilitados.includes('consignaciones')` suelto
en componentes: siempre por la capa.

**Historia sí, alta no**: apagar un opcional saca las opciones para *crear*
cosas suyas. Los registros históricos (un ingreso viejo `consignacion`, una
venta de canal revendedora) se siguen mostrando y los flujos del núcleo
sobre ellos (anular venta, devolución de cliente) siguen funcionando.

## Fuera de alcance

- Fusionar `consignaciones` y `rendiciones` en un solo código de módulo
  (tocaría `CATALOGO_PERMISOS` y el JSON de todos los roles).
- Pasar a `sp_*` las escrituras directas de `proveedor` e
  `ingreso_mercaderia` desde el DAL (deuda existente; acá se blindan con
  trigger, no se mueven).
- Refactorizar los chequeos inline de Revendedoras al helper nuevo.
- La deuda conocida de RLS solo por tenant (`usuario_all_own_tenant`).

## Auditoría de Revendedoras (2026-10-27)

Cumple el estándar en las tres capas, con estas excepciones que este cambio
corrige:

| Hallazgo | Capa | Corrección |
| --- | --- | --- |
| `sp_reactivar_acceso_revendedora` (00112) es solo para service-role pero `authenticated` lo puede ejecutar: el grant por defecto de 00056 lo cubre y no tiene `revoke`. No chequea módulo. | DB | `revoke execute ... from public, anon, authenticated` |
| El editor de permisos de roles lista `revendedoras` (y `consignaciones`, `rendiciones`) aunque el tenant no lo tenga. | UI | filtrar por capacidades |
| El rol "Revendedora" (lo crea `fn_auto_crear_rol_revendedora`) sigue en la lista de roles con el módulo apagado. | UI | ocultarlo sin la capacidad |
| Se puede apagar el módulo con stock en poder de revendedoras o liquidaciones pendientes. | DB | guarda de estado vivo en `tenant_modulo` |

Verificado bien: layouts de `revendedoras/` y `mi-cuenta/`, las 25 actions
(cada archivo tiene al menos una llamada a `requireModuleRole(session,
'revendedoras', …)` por action), la API
`/api/revendedoras/lookup-item`, todos los `sp_*` de escritura del módulo y
todas las `rf_*` / `rvp_*` (chequean `tenant_modulo`), el bloque de
Reportes (no consulta si está apagado), Ventas e Inventario
(`hasModuleAccess`). `sp_anular_venta` y `sp_registrar_devolucion_cliente`
no chequean el módulo a propósito: son flujos del núcleo sobre historia.
`sp_entregar_consignacion_revendedora` y `sp_devolver_items_revendedora`
(00115, sin commitear al momento de la auditoría) delegan en SPs que sí
chequean.
