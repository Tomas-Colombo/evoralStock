# Spec — costos-por-columna / Segregación de Costos y Márgenes

**Change**: `costos-por-columna` · **Requisitos**: `REQ-CPC-01…08` · **Decisiones Pendientes**: `DP-CPC-01…05`

---

## 0. Decisiones de la persona (STOP AND ASK — AGENTS.md)

**Resueltas** (2026-11-10, registradas en `proposal.md §7`): DP-CPC-01 → 1.B (D-CPC-03); DP-CPC-02 → Enfoque B con selladores (D-CPC-02); DP-CPC-03 → 3.B (D-CPC-04); DP-CPC-04 → 4.A (D-CPC-05); DP-CPC-05 → 5.A (D-CPC-06). Las opciones se conservan abajo como registro.

> [!IMPORTANT]
> Siguiendo el protocolo de `AGENTS.md`, la spec **PROPONE** y la **PERSONA DECIDE**. Todo cambio que afecte la lógica financiera (precio de venta, cálculo de márgenes, rendiciones a proveedores), la convivencia de esquemas de stock o la introducción de excepciones `SECURITY DEFINER` queda catalogado a continuación con sus opciones y tradeoffs técnicos.

### DP-CPC-01 — Representación del "Costo Pendiente" y efecto sobre la venta y márgenes

Hoy en base de datos:
- `item_producto.costo_ingreso` es `numeric(14, 2) NOT NULL CHECK (costo_ingreso >= 0)`.
- `ingreso_mercaderia_detalle.costo_unitario` es `numeric(14, 2) NOT NULL CHECK (costo_unitario >= 0)`.
- `sp_recalcular_precio_venta` deriva el precio de venta a partir del `costo_producto.costo` vigente; si no hay costo, fija `precio_venta = null`.
- `sp_registrar_venta` falla si `precio_venta` no es resoluble o si `costo_snapshot` viola el constraint `NOT NULL`.

**Opciones**:

1. **Opción 1.A (Estricta — Bloqueo de venta hasta costeo por Administrador)**:
   - *Mecanismo*: Se permite ingresar mercadería con `costo_unitario = null` e `item_producto.costo_ingreso = null` (eliminando el constraint `NOT NULL` o agregando estado `costo_pendiente = true`).
   - *Comportamiento*: El ítem entra al depósito pero queda en un nuevo estado de ítem `pendiente_costeo` y `sp_registrar_venta` prohíbe vender ítems sin costo fijado.
   - *Tradeoff*:
     - **A favor**: Integridad financiera pura. Ninguna prenda se vende sin precio de venta real ni genera distorsiones en márgenes ni en rendición a proveedores.
     - **En contra**: Bloquea la operación física en el local: si llega mercadería a la tienda un sábado y el dueño no está para cargar costos, las vendedoras no pueden colgarla ni venderla en el mostrador.

2. **Opción 1.B (Operativa con Herencia de Costo Vigente + Bloqueo de Novedades sin Costo)**:
   - *Mecanismo*:
     - Si el producto ya tiene un costo vigente histórico en `costo_producto` (reposición de stock habitual), el ingreso sin costo **hereda automáticamente** ese costo vigente para los ítems y mantiene el precio de venta ya resuelto.
     - Si es un producto nuevo sin costo previo, se registra con `costo_ingreso = null` y estado `pendiente_costeo` (o bandera `costo_pendiente = true`), impidiendo su venta hasta que el Administrador defina el costo y precio iniciales. (Se descarta el "costo 0 provisional" porque proposal §7 prohíbe falsear márgenes y rendiciones).
   - *Tradeoff*:
     - **A favor**: Máxima fluidez operativa para reposición de stock habitual (la mayoría de los ingresos). No falsea márgenes con ceros ficticios.
     - **En contra**: Si el proveedor aumentó el costo en ese remito particular, la venta temporal computará margen con el costo vigente anterior hasta que el administrador actualice el remito.

3. **Opción 1.C (Post-conciliación financiera con Ajuste Retroactivo)**:
   - *Mecanismo*: Se permite vender sin costo (`costo_snapshot = null`). Cuando el administrador carga el costo del remito, un procedimiento batch actualiza retroactivamente `costo_snapshot`, `monto_ganancia` y `monto_proveedor` en las ventas ya realizadas.
   - *Tradeoff*:
     - **A favor**: Desacopla totalmente la logística física de la administración financiera.
     - **En contra**: Viola la inmutabilidad histórica de `detalle_venta` (garantizada por `tg_detalle_venta_inmutable` en `00088`), complejiza auditorías y puede alterar rendiciones ya emitidas si no se congelan por periodo.

---

### DP-CPC-02 — Enfoque de segregación técnica en base de datos y excepciones DEFINER

> [!WARNING]
> **Premisa fundamental de Postgres en Supabase**: Cualquier `REVOKE SELECT (col) ON tabla FROM authenticated` afecta a **TODOS** los usuarios conectados vía API o cliente web, **incluido el rol Administrador**. Supabase Auth conecta a todo usuario bajo el rol Postgres `authenticated`. En Postgres, los privilegios de columna son a nivel de rol de conexión, no distinguen roles lógicos de aplicación (`rol.nombre`).

En el proceso de venta, cambio y devolución, para poder congelar los snapshots en `detalle_venta_costo`, la base de datos **necesita leer el costo de adquisición** de cada ítem. Si la vendedora no tiene permiso para ver costos, una función INVOKER ve 0 filas bajo RLS: la "inserción a ciegas" no existe (no se puede insertar un snapshot que la función no puede leer). Un helper DEFINER que simplemente *devuelva* el costo tampoco sirve, porque PostgREST lo expondría vía RPC al navegador.

La solución arquitectónica exige **selladores `SECURITY DEFINER` chicos que no devuelven nada (`RETURNS void`)** o la conversión masiva de lectores:

**Opciones**:

1. **Opción 2.A (Enfoque A Puro: Revocación de columnas a `authenticated`)**:
   - *Mecanismo*: Se ejecuta `REVOKE SELECT` sobre las columnas de costo en `item_producto`, `detalle_venta`, etc., para el rol Postgres `authenticated`.
   - *Consecuencia*: Como el Administrador también es `authenticated`, ninguna consulta INVOKER ni PostgREST puede leer costos. Toda lectura administrativa (`getItemConDetalle`, `listIngresos`), todos los reportes (`rf_finanzas_*`) y las rendiciones deben convertirse en funciones `SECURITY DEFINER`.
   - *Recuento de funciones DEFINER necesarias*: **16 funciones DEFINER** (5 de mutación/recálculo + 11 de lectura con chequeo de permiso).
   - *Tradeoff*: Imposibilidad de fuga por PostgREST sobre tablas base, pero crea una superficie de 16 excepciones DEFINER a `AGENTS.md`.

2. **Opción 2.B (Enfoque B Recomendado: Tablas satélites con RLS + Selladores DEFINER chicos)**:
   - *Mecanismo*:
     - Se extraen los costos a tablas 1:1: `item_costo(id_item, costo_ingreso)`, `detalle_venta_costo(id_detalle_venta, costo_snapshot, monto_ganancia)`, `ingreso_detalle_costo(id_detalle, ...)` y `devolucion_venta_costo(id_devolucion, costo_recuperado)`.
     - `costo_producto` y las tablas satélites reciben políticas RLS basadas en `auth_tiene_permiso('inventario', 'ver_costos')`.
     - `sp_registrar_venta`, `sp_registrar_cambio` y `sp_registrar_devolucion_cliente` **permanecen `SECURITY INVOKER`**.
     - Tras insertar las líneas comerciales normales, los SPs principales invocan selladores DEFINER chicos (`fn_sellar_costo_venta`, etc.) que leen internamente el costo y persisten el snapshot en la tabla satélite. Cada sellador retorna `void`, impidiendo cualquier fuga por RPC.
     - Toda consulta de lectura administrativa y reportes se mantiene **`SECURITY INVOKER`** (quien tiene permiso lee directamente bajo RLS).
   - *Recuento de funciones DEFINER necesarias*: **3 selladores DEFINER chicos** (más 0 o 1 según DP-CPC-05) y **CERO (0) funciones DEFINER de lectura**.
   - *Tradeoff*:
     - **A favor**: Minimiza las excepciones DEFINER a funciones microscópicas de escritura que retornan `void`. 0 DEFINER de lectura.
     - **En contra**: Migración DDL para crear las tablas satélites y mover datos.

---

### DP-CPC-03 — Secreto de aranceles bancarios y retenciones impositivas

En `pago_venta`, `arancel_cobro` y `cuenta_destino`:
- Las columnas `arancel_pct`, `iva_arancel_pct`, `ret_iva_pct`, `ret_ganancias_pct`, `ret_iibb_pct` e `imp_deb_cred_pct` calculan el costo financiero del cobro.
- En mostrador (`CobranzaPanel.tsx`), el cajero visualiza el recargo o descuento según la cuenta de destino elegida.

**Opciones**:
1. **Opción 3.A**: Tratar los aranceles/retenciones como confidenciales (ocultos al vendedor). El desglose financiero en `pago_venta` solo lo ven roles con permiso financiero/costos. En el mostrador se le informa al cliente el recargo final sin exponer las tasas fiscales internas del negocio.
2. **Opción 3.B**: Mantener aranceles y retenciones como configuración operativa de ventas accesible con `ventas.ver` / `precios.ver`, circunscribiendo el concepto de "secreto de costos" exclusivamente al costo de mercadería y márgenes comerciales brutos.

---

### DP-CPC-04 — Coherencia entre Carga de Costos y Visualización (`sp_aplicar_ultimo_costo`)

`sp_aplicar_ultimo_costo` ejecuta:
```sql
UPDATE costo_producto SET vigente_hasta = now() WHERE vigente_hasta IS NULL;
```
Bajo RLS, si un usuario posee `inventario.cargar_costos` pero NO `inventario.ver_costos`, la consulta no ve la fila vigente activa y el `UPDATE` no actualiza ninguna fila (sin arrojar error). Como consecuencia, la inserción subsiguiente genera **dos filas vigentes simultáneas** (`vigente_hasta IS NULL`) para el mismo producto, corrompiendo silenciosamente el historial de costos.

**Opciones**:
1. **Opción 4.A (Acople por integridad contable)**: `inventario.cargar_costos` **implica obligatoriamente** `inventario.ver_costos` (el permiso de cargar costos otorga o exige implícitamente la lectura de costos).
2. **Opción 4.B (Sellador de costo DEFINER)**: La carga de costos a ciegas se efectiviza mediante un sellador `SECURITY DEFINER` (`fn_sellar_costo_producto`) que actualiza la vigencia anterior y crea la nueva sin exponer los registros al usuario.

---

### DP-CPC-05 — Recálculo de Precio de Venta por Rol con `precios.editar` sin `ver_costos`

`sp_recalcular_precio_venta` se invoca exclusivamente desde `app/(app)/precios/actions.ts` (`recalcularPrecioAction` y `recalcularBatchAction`) y exige `precios.editar` (`00146:159`). No interviene en el escaneo de mostrador. Si un operador con `precios.editar` no tiene `inventario.ver_costos`:

**Opciones**:
1. **Opción 5.A (Exigencia de ambos permisos — INVOKER Puro)**: `sp_recalcular_precio_venta` permanece `SECURITY INVOKER` y exige explícitamente `precios.editar` E `inventario.ver_costos`. Si el usuario no tiene permiso de ver costos, la función aborta con `no-permission` (`42501`) preservando el `precio_venta` actual sin anularlo ni alterar nada. (Cero DEFINER).
2. **Opción 5.B (Función DEFINER que retorna solo el precio)**: `sp_recalcular_precio_venta` se declara `SECURITY DEFINER`. Lee internamente el costo vigente en `costo_producto`, aplica la regla de margen, persiste `producto.precio_venta` y devuelve únicamente el valor numérico del precio público resultante (`numeric`), sin revelar el costo de adquisición ni el porcentaje de margen.

---

## 1. Modelo de permisos propuesto (según D-CPC-01)

### 1.1. Acciones propuestas en `CATALOGO_PERMISOS`

Se propone incorporar en `lib/types/administracion.ts` dos acciones específicas dentro del módulo `inventario` y una acción complementaria en `precios`:

```ts
inventario: [
  'ver',
  'crear',
  'editar',
  'eliminar',
  'ver_costos',    // Habilita lectura de costo_producto, item_costo y costos de ingreso
  'cargar_costos',  // Habilita ingresar valores monetarios de costo en remitos y altas
],
precios: [
  'ver',
  'crear',
  'editar',
  'eliminar',
  'editar_cotizacion',
  'ver_margenes',   // Habilita ver regla_precio.valor ('margen'), v_ganancia_por_producto y montos de ganancia
]
```

### 1.2. Pantallas y operaciones habilitadas por acción

| Acción | Pantallas / Vistas que Habilita | Operaciones / Endpoints Habilitados |
|---|---|---|
| `inventario.ver_costos` | Columna de costo en `/inventario`, bloque de costos en `/inventario/ficha/[qr]`, costos históricos en ficha de producto, costo unitario en `/inventario/ingresos/[id]`. | Lectura del campo `costo_vigente` en `sp_listar_productos`, acceso a `costo_producto`, `item_costo`, `ingreso_detalle_costo`. |
| `inventario.cargar_costos` | Inputs de costo unitario y costo en USD en `/inventario/ingresos/nuevo` y `/inventario/productos/nuevo`. | Envío de `costoInicial` y `costoUnitario` en Server Actions `confirmarIngresoAction`, `createProductoAction`, `importarRemitoAction`. |
| `precios.ver_margenes` | Columnas de margen porcentual y costo en `/precios/control`, vista de reglas de margen en `/precios/reglas`, reportes de margen en `/reportes/mercaderia`. | Lectura de márgenes en `sp_control_de_precios` y vista `v_ganancia_por_producto`. |

### 1.3. Encaje del rol real "Vendedora-Local"

El rol en producción "Vendedora-Local" posee la siguiente configuración exacta de permisos:
- `gastos`: `['ver', 'crear']`
- `ventas`: `['crear', 'editar']` (**SIN `ver`**, no accede al listado general de ventas)
- `precios`: `['ver']` (SIN `ver_margenes`, no ve márgenes comerciales ni costos)
- `inventario`: `['ver', 'crear', 'editar']` (SIN `ver_costos` ni `cargar_costos`)
- `revendedoras`: `['ver']`

**Comportamiento resultante para Vendedora-Local**:
1. **En Mostrador (`/ventas/nueva`)**: Vende normalmente escaneando ítems o buscando en el catálogo. No se filtra ningún costo en las props ni en la interfaz. El precio de venta al público se resuelve íntegro.
2. **En Depósito (`/inventario/ingresos/nuevo`)**: Puede recibir paquetes de mercadería, tipear cantidades por talle y generar etiquetas QR sin ver ni ingresar precios de compra.
3. **En Consulta de Precios (`/precios`)**: Ve el precio final de venta al público de cada prenda para asesorar clientes, pero las pantallas de control de precios y márgenes omiten el costo de compra y el margen comercial.
4. **En Escáner (`/inventario/ficha/[qr]`)**: Puede escanear una prenda para chequear su talle, color y estado de tenencia (si está reservada o en revendedora), sin ver el costo de adquisición de la unidad.

---

## 2. Requisitos (Formato Estándar con Casos Negativos Numerados)

### REQ-CPC-01 — Segregación de lectura en catálogo y productos

Un usuario sin permiso `inventario.ver_costos` MUST NOT poder obtener el costo vigente de los productos por ningún canal (PostgREST directo sobre `costo_producto`, RPC `sp_listar_productos` o props de Server Components).

- **Feliz**: Operador con `inventario.ver` e `inventario.ver_costos` consulta productos vía `sp_listar_productos` o catálogo DAL; recibe `costo_vigente` numérico real y moneda asociada.
- **N1**: Operador autenticado sin `inventario.ver_costos` llama a `sp_listar_productos` → la función devuelve filas completas de productos pero con `costo_vigente = null`.
- **N2**: Operador autenticado sin `inventario.ver_costos` intenta `SELECT * FROM costo_producto` vía PostgREST → la consulta retorna 0 filas por RLS.
- **N3**: Operador de otro tenant → retorna 0 filas por aislamiento de tenant.
- **N4**: Usuario revendedora autenticado → retorna 0 filas en `costo_producto` y `costo_vigente = null` en listados.

### REQ-CPC-02 — Venta en mostrador por rol sin permiso de costos

Un operador con `ventas.crear` pero sin `inventario.ver_costos` MUST poder ejecutar `sp_registrar_venta` con éxito, congelando los snapshots de costo en el backend mediante un sellador DEFINER sin retornar costos al cliente.

- **Feliz**: Vendedora escanea prendas y confirma venta por mostrador; `sp_registrar_venta` (INVOKER) descuenta stock, inserta la venta y delega en `fn_sellar_costo_venta(p_id_venta)` la lectura de `item_costo` y el sellado de `detalle_venta_costo`. La función principal finaliza retornando únicamente el `id_venta`.
- **N1**: Vendedora intenta consultar directamente `detalle_venta_costo` por PostgREST → retorna 0 filas por RLS.
- **N2**: Intento de venta en otro tenant → aborta con `item-not-found` (`42704`).
- **N3**: Módulo ventas o revendedoras deshabilitado en tenant → aborta con error de módulo deshabilitado.
- **N4**: Vendedora sin permiso `ventas.crear` → aborta con `no-permission` (`42501`).

### REQ-CPC-03 — Cambios y devoluciones de clientes sin exposición de costo

Un operador con permisos de cambio y devolución (`ventas.crear` / `ventas.editar`) sin permiso de costos MUST poder cambiar prendas o reintegrar stock sin que la transacción falle por falta de permisos de costo.

- **Feliz**: Vendedora procesa cambio de talle en mostrador; `sp_registrar_cambio` (INVOKER) genera el nuevo detalle y delega en `fn_sellar_costo_cambio(p_id_detalle_venta)` el sellado del snapshot en `detalle_venta_costo`, retornando solo el nuevo `id_detalle_venta`.
- **N1**: Operador sin `ventas.crear` intenta ejecutar cambio → rechazo `no-permission` (`42501`).
- **N2**: Operador intenta procesar devolución de ítem de otro tenant → rechazo `venta-not-found` o `item-not-found` (`42704`).
- **N3**: Operador consulta recupero de costos vía API → 0 filas por RLS sobre `devolucion_venta_costo`.

### REQ-CPC-04 — Ingreso de mercadería sin costo y prevención de corrupción de vigencias

Un operador con `inventario.crear` pero sin `inventario.cargar_costos` MUST poder registrar y confirmar remitos físicos sin costo. Asimismo, ninguna operación de costo MUST corromper el histórico de vigencias en `costo_producto`.

- **Feliz**: Vendedora carga cantidades recibidas por talle y confirma remito; el sistema da de alta las unidades físicas en `item_producto` con sus códigos QR listos para etiquetar, marcando el remito como pendiente de valorización según DP-CPC-01.
- **N1**: Operador sin `inventario.cargar_costos` intenta enviar valores monetarios de costo en el payload de `confirmarIngresoAction` → la acción sanea el input y descarta el costo o rechaza con `no-permission-costo`.
- **N2**: Operador sin `inventario.crear` intenta dar de alta ingreso → rechazo `no-permission` (`42501`).
- **N3**: Confirmación de ingreso en otro tenant → rechazo `ingreso-not-found` (`42704`).
- **N4 (Prevención de duplicación de vigencias en `sp_aplicar_ultimo_costo`)**: Si un operador sin `inventario.ver_costos` intentara ejecutar actualización de costo (bajo Opción 4.A de DP-CPC-04), la operación es rechazada inmediatamente con `no-permission` (`42501`), impidiendo que un `UPDATE ... WHERE vigente_hasta IS NULL` fallido deje múltiples filas con `vigente_hasta IS NULL`.

### REQ-CPC-05 — Recálculo de precio de venta por rol con `precios.editar`

`sp_recalcular_precio_venta` se invoca únicamente desde acciones administrativas de precios (`app/(app)/precios/actions.ts`) y exige `precios.editar`. Su ejecución MUST NOT anular precios existentes por falta de permisos de costos.

- **Feliz**: Operador con `precios.editar` (e `inventario.ver_costos` según DP-CPC-05) ejecuta recálculo; la función actualiza `producto.precio_venta` y retorna el nuevo precio público.
- **N1 (Resolución de recálculo según DP-CPC-05)**: Operador con `precios.editar` sin `inventario.ver_costos` ejecuta recálculo desde `/precios/control`:
  - Bajo Opción 5.A: Es rechazado con `no-permission` (`42501`) y el `precio_venta` actual se mantiene inalterado.
  - Bajo Opción 5.B: La función corre como DEFINER, actualiza `producto.precio_venta` en base al costo del tenant y devuelve solo el nuevo precio público numérico.
  - En ningún caso `precio_venta` se fija en NULL por falta de permisos del actor.
- **N2**: Recálculo sobre un producto que genuinamente NO tiene ningún costo registrado en el tenant → fija `precio_venta = null` y marca `precio_venta_desactualizado = true`.
- **N3**: Invocación sin permiso `precios.editar` → aborta con `no-permission` (`42501`).

### REQ-CPC-06 — Prevención de fuga hacia el navegador en Server Components y Rutas de API

Ningún Server Component, Layout o Endpoint de API (`app/api/**`) MUST pasar propiedades que contengan `costo_vigente`, `costo_ingreso`, `costo_snapshot`, `arancel_pct` o retenciones impositivas a un Client Component (`'use client'`) o cliente HTTP cuando la sesión carezca de los permisos correspondientes.

- **Feliz**: Operador con permisos abre `/ventas/nueva`; el payload RSC viaja con los datos operativos necesarios.
- **N1**: Vendedora sin permiso de costos abre `/ventas/nueva` → las props `productos` del componente `NuevaVentaView` no contienen la clave `costo_vigente` (o viaja `null`).
- **N2**: Vendedora abre `/inventario` → las props `rows` y `catalogo` de `ProductosTableClient` viajan sin `costo_vigente`.
- **N3**: Vendedora escanea ítem en `/inventario/ficha/[qr]` → la tarjeta omite el renglón de "Costo de ingreso".
- **N4**: Vendedora consulta `/api/consignaciones/lookup-item?qr=...` → la respuesta JSON no incluye la propiedad `costo_ingreso`.

### REQ-CPC-07 — Cierre de fugas en funciones de lectura no-`sp_*` (`preview_rendicion`, `rf_*`)

Las funciones de lectura `preview_rendicion`, `sp_perdida_incobrable_venta` y las funciones de reporte `rf_*` que leen costos o márgenes de producto MUST exigir explícitamente `auth_tiene_permiso` de sus respectivos módulos (`rendiciones.ver`, `ventas.ver`, `reportes.ver`) antes de proyectar datos sensibles.

- **Feliz**: Operador con `rendiciones.ver` ejecuta `preview_rendicion`; recibe las líneas pendientes con `dv.costo_snapshot` y `dv.monto_proveedor`.
- **N1 (Fuga actual cerrada)**: Vendedora autenticada sin `rendiciones.ver` llama a `preview_rendicion` vía RPC → la función aborta inmediatamente con `no-permission` (`42501`) en lugar de devolver los costos de proveedores.
- **N2**: Operador sin `reportes.ver` ejecuta `rf_finanzas_resultados` vía RPC → la función aborta con `no-permission` (`42501`).
- **N3**: Operador sin `ventas.ver` ejecuta `sp_perdida_incobrable_venta` vía RPC → la función aborta con `no-permission` (`42501`).
- **N4**: Operador sin `reportes.ver` ejecuta `rf_finanzas_ranking_productos` vía RPC → la función aborta con `no-permission` (`42501`).

### REQ-CPC-08 — Consulta de stock disponible y lookups de venta por QR

Los endpoints y funciones de búsqueda de stock (`findItemByQr`, `/api/ventas/lookup-item`, `listItemsDisponibles`) consumidos por el mostrador MUST retornar únicamente los datos indispensables para identificar el producto y su precio, sin incluir `costo_ingreso`.

- **Feliz**: Vendedora escanea código QR en mostrador; el lookup devuelve `id_item`, `id_producto`, `nombre`, `precio_venta`, `talle`.
- **N1**: Inspección del JSON retornado por `/api/ventas/lookup-item` en DevTools → no contiene la propiedad `costo_ingreso`.
- **N2**: QR correspondiente a otro tenant → retorna 404 / `null`.

---

## 3. Matriz de permisos

| Función / Procedimiento | Modo | Operador con Permiso Costos | Operador sin Permiso Costos (Vendedora) | Revendedora | Módulo Apagado | Otro Tenant |
|---|---|---|---|---|---|---|
| `sp_listar_productos` | INVOKER | Devuelve filas con `costo_vigente` | Devuelve filas con `costo_vigente = null` | `costo_vigente = null` | `module-disabled` | 0 filas |
| `sp_control_de_precios` | INVOKER | Devuelve costos y márgenes | Devuelve filas con costo y margen `null` | Rechazo / vacío | `module-disabled` | 0 filas |
| `sp_recalcular_precio_venta` | DEFINER* / INVOKER | Recalcula y actualiza `precio_venta` | Según DP-CPC-05 (Rechazo o Solo Precio) | Rechazo | `module-disabled` | Rechazo (`42501`) |
| `sp_aplicar_ultimo_costo` | INVOKER | Actualiza `costo_producto` y sincroniza | Rechazo `no-permission` (REQ-CPC-04 N4) | Rechazo | `module-disabled` | Rechazo (`42501`) |
| `sp_registrar_venta` | INVOKER | Registra venta y llama sellador | Registra venta y llama sellador sin ver costo | Rechazo (ACC-07) | `module-disabled` | Rechazo (`42704`) |
| `fn_sellar_costo_venta` | DEFINER | Sella `detalle_venta_costo` | Sella `detalle_venta_costo` (retorna void) | Rechazo | `module-disabled` | 0 filas |
| `sp_registrar_cambio` | INVOKER | Registra cambio y llama sellador | Registra cambio y llama sellador | Rechazo | `module-disabled` | Rechazo (`42704`) |
| `fn_sellar_costo_cambio` | DEFINER | Sella línea de cambio | Sella línea de cambio (retorna void) | Rechazo | `module-disabled` | 0 filas |
| `sp_registrar_devolucion_cliente` | INVOKER | Registra devolución y llama sellador | Registra devolución y llama sellador | Rechazo | `module-disabled` | Rechazo (`42704`) |
| `fn_sellar_costo_devolucion` | DEFINER | Sella recupero | Sella recupero (retorna void) | Rechazo | `module-disabled` | 0 filas |
| `sp_confirmar_ingreso` | INVOKER | Confirma remito y sincroniza costos | Confirma remito como costo pendiente (DP-CPC-01) | Rechazo | `module-disabled` | Rechazo (`42704`) |
| `preview_rendicion` | INVOKER | Devuelve detalle con `costo_snapshot` | Rechazo `no-permission` (REQ-CPC-07) | Rechazo | `module-disabled` | 0 filas |
| `sp_perdida_incobrable_venta` | INVOKER | Devuelve cálculo de costo no cubierto | Rechazo `no-permission` (REQ-CPC-07) | Rechazo | `module-disabled` | 0 filas |
| `rf_finanzas_resultados` | INVOKER | Calcula resultados y margen bruto | Rechazo `no-permission` (REQ-CPC-07) | Rechazo | `module-disabled` | 0 filas |
| `rf_finanzas_ranking_productos` | INVOKER | Devuelve ranking con márgenes | Rechazo `no-permission` (REQ-CPC-07) | Rechazo | `module-disabled` | 0 filas |

*\* Sujeto a resolución de DP-CPC-05.*

---

## 4. Enfoque por columna y Destino en Enfoque B

> [!NOTE]
> **Insuficiencia de la policy de 00142 en `ingreso_mercaderia_detalle`**: La migración `00142` aplicó RLS exigiendo `inventario.ver`. Sin embargo, el rol "Vendedora-Local" **sí posee `inventario.ver`** (§1.3). Por lo tanto, dicha política de fila no protege los costos frente a roles operativos de inventario; bajo Enfoque B, las columnas de costo deben segregarse físicamente a una tabla satélite protegida por `inventario.ver_costos`.

### 4.1. Catálogo completo de las 35 columnas de `inventario.md §1` y su destino en Enfoque B

| # | Tabla Origen | Columna Sensible | Destino / Mecanismo en Enfoque B | Justificación / Política de Acceso |
|---|---|---|---|---|
| 1 | `costo_producto` | `id_costo` | Policy en tabla existente | `costo_producto` ya es tabla independiente. Recibe RLS restrictiva `auth_tiene_permiso('inventario', 'ver_costos')`. |
| 2 | `costo_producto` | `id_tenant` | Policy en tabla existente | Aislamiento tenant + RLS `inventario.ver_costos`. |
| 3 | `costo_producto` | `id_producto` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 4 | `costo_producto` | `costo` | Policy en tabla existente | Costo vigente/histórico. RLS `inventario.ver_costos`. |
| 5 | `costo_producto` | `moneda` | Policy en tabla existente | Moneda de costeo. RLS `inventario.ver_costos`. |
| 6 | `costo_producto` | `vigente_desde` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 7 | `costo_producto` | `vigente_hasta` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 8 | `costo_producto` | `id_usuario_alta` | Policy en tabla existente | Auditoría de costo. RLS `inventario.ver_costos`. |
| 9 | `costo_producto` | `motivo` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 10 | `costo_producto` | `created_at` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 11 | `costo_producto` | `costo_original_usd` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 12 | `costo_producto` | `cotizacion_aplicada` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 13 | `costo_producto` | `cotizacion_fecha_valor` | Policy en tabla existente | RLS `inventario.ver_costos`. |
| 14 | `item_producto` | `costo_ingreso` | **Tabla satélite `item_costo`** | Migra a `item_costo(id_item, costo_ingreso)` con RLS `inventario.ver_costos`. Desacopla la tabla física `item_producto`. |
| 15 | `detalle_venta` | `costo_snapshot` | **Tabla satélite `detalle_venta_costo`** | Migra a `detalle_venta_costo(id_detalle_venta, costo_snapshot, monto_ganancia)` con RLS `inventario.ver_costos`. Sellada por `fn_sellar_costo_venta`. |
| 16 | `detalle_venta` | `monto_ganancia` | **Tabla satélite `detalle_venta_costo`** | Migra a `detalle_venta_costo`. Sellada por `fn_sellar_costo_venta`. |
| 17 | `detalle_venta` | `porcentaje_comision_preview` | Fuera de alcance (Revendedoras) | Comisión informativa de revendedora. El portal la lee por `rvp_*`. Deuda abierta, fuera de este cambio: `detalle_venta` no tiene policy por módulo y Vendedora-Local tiene `revendedoras.ver`, así que hoy la lee cualquier empleado del tenant. |
| 18 | `detalle_venta` | `monto_comision` | Fuera de alcance (Revendedoras) | Comisión liquidada de revendedora. Deuda abierta, fuera de este cambio: `detalle_venta` no tiene policy por módulo y Vendedora-Local tiene `revendedoras.ver`, así que hoy la lee cualquier empleado del tenant. |
| 19 | `ingreso_mercaderia_detalle` | `costo_unitario` | **Tabla satélite `ingreso_detalle_costo`** | Migra a `ingreso_detalle_costo(id_detalle, costo_unitario, ...)`. La policy de `00142` (`inventario.ver`) no alcanza porque Vendedora-Local tiene `inventario.ver`. RLS exige `inventario.ver_costos`. |
| 20 | `ingreso_mercaderia_detalle` | `costo_original_usd` | **Tabla satélite `ingreso_detalle_costo`** | Migra a `ingreso_detalle_costo` con RLS `inventario.ver_costos`. |
| 21 | `ingreso_mercaderia_detalle` | `cotizacion_aplicada` | **Tabla satélite `ingreso_detalle_costo`** | Migra a `ingreso_detalle_costo` con RLS `inventario.ver_costos`. |
| 22 | `ingreso_mercaderia_detalle` | `cotizacion_fecha_valor` | **Tabla satélite `ingreso_detalle_costo`** | Migra a `ingreso_detalle_costo` con RLS `inventario.ver_costos`. |
| 23 | `devolucion_venta` | `costo_recuperado` | **Tabla satélite `devolucion_venta_costo`** | Migra a `devolucion_venta_costo(id_devolucion, costo_recuperado)` con RLS `inventario.ver_costos`. Sellada por `fn_sellar_costo_devolucion`. |
| 24 | `pago_venta` | `costo_cobro` | Fuera de alcance por DP-03 | Costo financiero bancario. Sujeto a resolución de DP-CPC-03 (configuración operativa de caja vs secreto). |
| 25 | `pago_venta` | `desglose_costo` | Fuera de alcance por DP-03 | Desglose jsonb de aranceles y retenciones bancarias. Sujeto a DP-CPC-03. |
| 26 | `arancel_cobro` | `arancel_pct` | Fuera de alcance por DP-03 | Parámetro de procesador de pago. Sujeto a DP-CPC-03. |
| 27 | `arancel_cobro` | `iva_arancel_pct` | Fuera de alcance por DP-03 | Tasa impositiva s/arancel. Sujeto a DP-CPC-03. |
| 28 | `cuenta_destino` | `ret_iva_pct` | Fuera de alcance por DP-03 | Retención impositiva fiscal. Sujeto a DP-CPC-03. |
| 29 | `cuenta_destino` | `ret_ganancias_pct` | Fuera de alcance por DP-03 | Retención impositiva fiscal. Sujeto a DP-CPC-03. |
| 30 | `cuenta_destino` | `ret_iibb_pct` | Fuera de alcance por DP-03 | Retención impositiva fiscal. Sujeto a DP-CPC-03. |
| 31 | `cuenta_destino` | `imp_deb_cred_pct` | Fuera de alcance por DP-03 | Impuesto a los créditos/débitos. Sujeto a DP-CPC-03. |
| 32 | `liquidacion_revendedora` | `monto_comision` | Fuera de alcance (Revendedoras) | Comisión liquidada acumulada. Deuda abierta, fuera de este cambio: sin policy por módulo. |
| 33 | `escala_comision` | `porcentaje` | Fuera de alcance (Revendedoras) | Tramos de comisión pactados. Deuda abierta, fuera de este cambio: sin policy por módulo. |
| 34 | `regla_precio` | `valor` (margen) | **Policy restrictiva por fila** | Enmascarar en DAL o RPC no frena un `select` por PostgREST. La tabla mezcla `tipo_regla` margen, descuento y recargo, y el mostrador lee descuentos (`sp_calcular_precio_venta_snapshot`, `sp_descuentos_disponibles_venta`), así que no se cierra entera: `using (tipo_regla <> 'margen' or auth_tiene_permiso('precios', 'ver_margenes'))`. |
| 35 | `producto` | `id_regla_margen_aplicada` | Sin cambio en DB | Con la fila de margen oculta por la policy de #34, el id no revela el valor. Se omite de los DTOs de 3A por prolijidad. |

### 4.2. Comparación cuantitativa: Enfoque A (Revocación) vs Enfoque B (Tablas Satélites)

| Dimensión | Enfoque A (Revocación a `authenticated`) | Enfoque B (Tablas Satélites con RLS) |
|---|---|---|
| **Selladores / Mutadores DEFINER chicos (`RETURNS void`)** | **5 funciones DEFINER masivas** (SPs enteros corren como DEFINER). | **3 selladores DEFINER chicos** (`fn_sellar_costo_venta`, `fn_sellar_costo_cambio`, `fn_sellar_costo_devolucion`), más 0 o 1 en recálculo según DP-CPC-05. |
| **Funciones `SECURITY DEFINER` de lectura requeridas** | **11 funciones DEFINER** (`preview_rendicion`, `sp_perdida_incobrable_venta`, `rf_finanzas_resultados`, `rf_finanzas_flujo`, `rf_finanzas_posicion`, `rf_finanzas_ranking_productos`, más 5 RPCs de lectura DAL para Admin). | **0 funciones DEFINER de lectura**. Toda consulta corre como INVOKER; RLS filtra filas automáticamente según `inventario.ver_costos`. |
| **Total de funciones DEFINER a autorizar en `AGENTS.md`** | **16 funciones DEFINER** | **3 a 4 funciones DEFINER** |
| **Impacto en Vistas SQL (`v_linea_venta`, etc.)** | Se rompen para `authenticated`; requieren convertirse en DEFINER. | Siguen operando como INVOKER uniendo con tablas satélites protegidas por RLS. |
| **Esfuerzo de migración DDL** | DDL acotado a revocaciones, pero reescritura masiva de SPs a DEFINER. | Creación de tablas satélites (`item_costo`, `detalle_venta_costo`, `ingreso_detalle_costo`, `devolucion_venta_costo`) con RLS limpia. |

---

## 5. Fuga hacia el navegador: Análisis y Propuesta de Slice Temprano

### 5.1. Comando de detección mecánica sobre Server Components, Layouts y Endpoints de API

Se auditó mecánicamente todo el directorio `app/` (incluyendo `page.tsx`, `layout.tsx` y `app/api/**/route.ts`) buscando llamadas a funciones de DAL que devuelven datos sensibles o columnas de costo.

Comando ejecutado:
```bash
node --experimental-strip-types -e "
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function findFiles(dir, filter) {
  let res = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) res = res.concat(findFiles(full, filter));
    else if (filter(full)) res.push(full);
  }
  return res;
}

const files = findFiles('app', f => f.endsWith('page.tsx') || f.endsWith('layout.tsx') || f.endsWith('route.ts'));
const dalCalls = [
  'listProductosConDetalle', 'listCuentasDestino', 'listArancelesCobro',
  'getItemConDetalle', 'getConsignacionConDetalle', 'listControlDePrecios',
  'listIngresos', 'findItemByQr', 'listItemsDisponibles', 'listItemsByProducto',
  'queryProductos', 'listGananciaPorProducto', 'listReglasPrecio'
];

for (const p of files.sort()) {
  const content = readFileSync(p, 'utf8');
  const found = dalCalls.filter(c => content.includes(c));
  if (found.length > 0) {
    console.log(relative('.', p).replace(/\\\\/g, '/') + ' -> ' + found.join(', '));
  }
}
"
```

### 5.2. Catálogo verificado de archivos con fuga hacia el cliente

A partir de la salida del comando (transcripta en el [Apéndice A.1](#apéndice-a1-salida-del-comando-de-detección-de-fugas-en-app)):
- **Layouts (`layout.tsx`)**: Se verificó que **ningún layout** ejecuta consultas sobre funciones sensibles de costo ni transfiere datos de costo en props.
- **Rutas de API (`app/api/**`)**:
  - `app/api/consignaciones/lookup-item/route.ts`: Invoca `findItemByQr` y **retorna explícitamente `costo_ingreso: Number(item.costo_ingreso)`** en el JSON retornado al frontend (línea 116).
  - `app/api/ventas/lookup-item/route.ts`: Invoca `listItemsDisponibles` pero su respuesta `LineaCarrito` ya proyecta solo campos de venta públicos.
- **Server Components (`page.tsx`)**:
  - `app/(app)/ventas/nueva/page.tsx`: Transfiere `productos` (con `costo_vigente`) a `<NuevaVentaView />`, y `cuentas`/`aranceles` a `<CobranzaPanel />`.
  - `app/(app)/ventas/reservas/nueva/page.tsx`: Transfiere `productos` (con `costo_vigente`) a `<NuevaReservaView />`.
  - `app/(app)/inventario/page.tsx`: Transfiere `productosPagina` y `catalogoBuscador` (ambos con `costo_vigente`) a `<ProductosTableClient />`.
  - `app/(app)/inventario/ficha/[qr]/page.tsx`: Renderiza directamente en el HTML `Number(detalle.costo_ingreso)`.
  - `app/(app)/consignaciones/[id]/page.tsx`: Transfiere `item.costo_ingreso` a `<ConsignacionDetalleView />`.
  - `app/(app)/precios/control/page.tsx`: Transfiere `costo_vigente` y márgenes a `<ControlDePreciosView />`.
  - `app/(app)/inventario/ingresos/nuevo/page.tsx`: Pasa `productos` con `costo_vigente` y `ultimoContexto` con `costoUnitario` a `<NuevoIngresoView />`.

### 5.3. Propuesta de Slice Temprano (Fase 3A — Saneamiento en Next.js sin tocar la BD)

Se propone implementar un primer slice puramente en TypeScript/Next.js antes de aplicar migraciones de base de datos:

1. **Creación de DTOs mínimos de proyección**:
   - `ProductoVentaDto`: `{ id_producto, nombre, codigo, precio_venta, stock_disponible, talle, color }` (omitiendo deliberadamente `costo_vigente` e `id_regla_margen_aplicada`).
   - `CuentaDestinoPublicaDto`: `{ id_cuenta_destino, nombre, tipo_cuenta, activo }` (omitiendo retenciones impositivas).
2. **Mapeo en Server Components**:
   - En `app/(app)/ventas/nueva/page.tsx`, mapear `productos` y `cuentas` a sus versiones DTO antes de inyectarlos en `<NuevaVentaView />`.
   - En `app/(app)/ventas/reservas/nueva/page.tsx`, aplicar el mismo mapeo para `<NuevaReservaView />`.
   - En `app/(app)/inventario/page.tsx`, purgar `costo_vigente` de `productosPagina` y `catalogoBuscador` al pasarlos a `ProductosTableClient`.
3. **Saneamiento de Endpoints API**:
   - En `app/api/consignaciones/lookup-item/route.ts`, condicionar el campo `costo_ingreso` a que la sesión posea `inventario.ver_costos`; si no lo posee, retornar `costo_ingreso: null` o suprimirlo.
4. **Compuerta en Vistas Sensibles**:
   - En `app/(app)/inventario/ficha/[qr]/page.tsx`, condicionar la visualización del bloque de costo a `hasModuleAccess(session, 'inventario', 'ver_costos')`. Si es falso, no renderizar la cifra en el HTML.
   - En `app/(app)/consignaciones/[id]/page.tsx`, ocultar columna de costo si el usuario no tiene permiso.

*Resultado del slice temprano*: Elimina las fugas verificadas en props RSC y respuestas JSON de API para los componentes listados, sin alterar la base de datos de producción.

---

## 6. Funciones DEFINER nuevas (Lista Cerrada propuesta y Test de Guard)

Bajo el modelo arquitectónico de **Enfoque B (Tablas Satélites con RLS)**, las funciones principales de negocio (`sp_registrar_venta`, `sp_registrar_cambio`, `sp_registrar_devolucion_cliente`) **permanecen `SECURITY INVOKER`**. La lista cerrada de excepciones `SECURITY DEFINER` se compone exclusivamente de **selladores chicos que retornan `void`** (más la resolución opcional de recálculo según DP-CPC-05):

### 6.1. Contratos y firmas de los Selladores DEFINER chicos (Enfoque B)

1. **`fn_sellar_costo_venta(p_id_venta uuid) RETURNS void`**:
   - **Modo**: `SECURITY DEFINER set search_path = public, extensions, pg_temp`
   - **Permiso**: Exige `(auth_tiene_permiso('ventas', 'crear') OR auth_tiene_permiso('revendedoras', 'crear'))`. Valida `auth_tenant_id()` y rechaza `auth_revendedora_id() is not null`.
   - **Contrato / Idempotencia**:
     - Filtra estrictamente por `auth_tenant_id()`.
     - Selecciona las líneas de `detalle_venta` de `p_id_venta` que aún no tienen registro en `detalle_venta_costo`.
     - Para cada línea pendiente, lee `item_costo.costo_ingreso`, calcula margen (`dv.precio_venta - costo_snapshot`) e inserta en `detalle_venta_costo`.
     - Si todas las líneas ya están selladas, la ejecución es no-op (idempotente). Retorna `void` (cero fuga por RPC).

2. **`fn_sellar_costo_cambio(p_id_detalle_venta uuid) RETURNS void`**:
   - **Modo**: `SECURITY DEFINER set search_path = public, extensions, pg_temp`
   - **Permiso**: Exige `(auth_tiene_permiso('ventas', 'crear') OR auth_tiene_permiso('revendedoras', 'crear'))`.
   - **Contrato / Idempotencia**:
     - Verifica tenant y existencia de `p_id_detalle_venta`.
     - Si `detalle_venta_costo` ya existe para ese detalle, no hace nada (idempotente).
     - Lee el costo del nuevo ítem en `item_costo`, calcula margen y persiste la fila en `detalle_venta_costo`. Retorna `void`.

3. **`fn_sellar_costo_devolucion(p_id_devolucion uuid) RETURNS void`**:
   - **Modo**: `SECURITY DEFINER set search_path = public, extensions, pg_temp`
   - **Permiso**: Exige `auth_tiene_permiso('ventas', 'editar')`.
   - **Contrato / Idempotencia**:
     - Verifica tenant y existencia de `p_id_devolucion`.
     - Si `devolucion_venta_costo` ya fue registrado para esa devolución, no hace nada.
     - Lee `costo_snapshot` de `detalle_venta_costo` correspondiente a la prenda devuelta e inserta `costo_recuperado` en `devolucion_venta_costo`. Retorna `void`.

4. **`sp_recalcular_precio_venta(p_id_producto uuid, p_ip inet default null) RETURNS numeric`** *(Condicional a DP-CPC-05)*:
   - Si se adopta la Opción 5.B: corre como DEFINER, exige `auth_tiene_permiso('precios', 'editar')`, lee `costo_producto.costo`, actualiza `producto.precio_venta` y devuelve únicamente el valor numérico del precio público resultante. (Si se adopta la Opción 5.A, permanece INVOKER puro y no integra esta lista).

**Recuento total de DEFINER en Enfoque B**: **3 selladores chicos** (más 0 o 1 en recálculo). **CERO (0) funciones DEFINER de lectura**.

### 6.2. Reglas de blindaje obligatorio para las funciones DEFINER

Toda función autorizada como DEFINER DEBE:
1. Declarar `set search_path = public, extensions, pg_temp`.
2. Iniciar con validación estricta de permiso operativo (`auth_tiene_permiso(...)`).
3. Revalidar aislamiento de tenant con `auth_tenant_id()`.
4. Rechazar ejecuciones de roles de revendedora con `auth_revendedora_id() is not null`.

### 6.3. Test de Guardia anti-propagación de DEFINER (Actualización de `tests/db/rvp-lecturas.test.ts`)

Se actualizará la prueba unitaria de arquitectura en `tests/db/rvp-lecturas.test.ts` incorporando en su whitelist únicamente los selladores chicos expresamente aprobados.

---

## 7. Cifras financieras

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
|---|---|---|---|
| `item_costo.costo_ingreso` | Confirmación del ingreso de stock | Adquisición unitaria devengada | `sp_confirmar_ingreso` / `sp_aplicar_ultimo_costo` |
| `detalle_venta_costo.costo_snapshot` | Confirmación de la venta | Costo histórico congelado al momento del hecho generador | `fn_sellar_costo_venta` |
| `detalle_venta_costo.monto_ganancia` | Confirmación de la venta | Margen bruto unitario (`precio_venta - costo_snapshot`) | `fn_sellar_costo_venta` |
| `devolucion_venta_costo.costo_recuperado` | Aceptación de devolución de mercadería | Restitución del costo histórico al inventario activo | `fn_sellar_costo_devolucion` |
| `pago_venta.costo_cobro` | Cobro en mostrador / acreditación | Retención arancelaria e impositiva bancaria percibida | `sp_calcular_costo_cobro` |

---

## 8. INVOKER contra RLS restrictiva

- `sp_listar_productos`: Permanece `INVOKER`. Al consultar `costo_producto` (o tabla satélite), la RLS devolverá 0 filas si el usuario no tiene `inventario.ver_costos`, resolviendo `costo_vigente = null` mediante un `LEFT JOIN`.
- `sp_control_de_precios`: Permanece `INVOKER`. Chequea `auth_tiene_permiso('precios', 'ver_margenes')` antes de proyectar la columna de margen.
- `preview_rendicion`: Permanece `INVOKER` en Enfoque B. Se corrige la fuga actual agregando validación de `auth_tiene_permiso('rendiciones', 'ver')`.
- `rf_finanzas_resultados` y `rf_finanzas_ranking_productos`: Permanecen `INVOKER` en Enfoque B. Se corrige la fuga agregando validación de `auth_tiene_permiso('reportes', 'ver')`.

---

## 9. Migración de roles al desplegar

Se ejecutará una migración idempotente de actualización de roles en la tabla `rol`:

1. **Rol `Administrador`**:
   - En todos los tenants existentes (`SELECT id_tenant FROM tenant`), se actualiza el jsonb `permisos` del rol `Administrador` incorporando:
     - `inventario`: agrega `'ver_costos'` y `'cargar_costos'`.
     - `precios`: agrega `'ver_margenes'`.
2. **Roles Limitados existentes (`Vendedora-Local`, `Cajero`, etc.)**:
   - **No reciben** los nuevos permisos por defecto (principio de menor privilegio).
   - El rol "Vendedora-Local" preserva intacta su configuración real verificada:
     - `gastos`: `['ver', 'crear']`
     - `ventas`: `['crear', 'editar']` (sin `ver`)
     - `precios`: `['ver']` (sin `ver_margenes`)
     - `inventario`: `['ver', 'crear', 'editar']` (sin `ver_costos` ni `cargar_costos`)
     - `revendedoras`: `['ver']`
   - Los dueños de tienda podrán asignar explícitamente `ver_costos` o `cargar_costos` desde `/administracion/roles` a los perfiles que lo requieran.

---

## 10. Ubicación del código

| Archivo | Quién lo consume | Por qué va ahí |
|---|---|---|
| `lib/types/administracion.ts` | Editor de roles, guards, DAL | Catálogo central `CATALOGO_PERMISOS` tipado en TypeScript. |
| `lib/dal/inventario/producto.ts` | Server Components de ventas, inventario y reservas | Proyección y filtrado de `costo_vigente` según sesión. |
| `lib/dal/ventas/cuenta-destino.ts` | Checkout de ventas | Proyección limpia de cuentas bancarias sin retenciones impositivas. |
| `lib/dal/ventas/arancel.ts` | Checkout de ventas | Proyección limpia de aranceles. |
| `app/(app)/ventas/nueva/page.tsx` | Pantalla de nueva venta | Saneamiento de DTOs enviados a `NuevaVentaView`. |
| `app/api/consignaciones/lookup-item/route.ts` | Carrito de consignación | Supresión de `costo_ingreso` en JSON para roles no autorizados. |
| `app/(app)/inventario/ficha/[qr]/page.tsx` | Escaneo en depósito | Compuerta de renderizado para ocultar costo de ingreso. |

---

## 11. Partición en fases de implementación (Cada fase con sus tests en `tests/db`)

### Fase 3A — Saneamiento temprano de Props en Server Components, API routes y Layouts (Next.js)
*Objetivo*: Eliminar las fugas verificadas en props RSC y respuestas API sin tocar base de datos.
- Archivos:
  - `app/(app)/ventas/nueva/page.tsx`
  - `app/(app)/ventas/reservas/nueva/page.tsx`
  - `app/(app)/inventario/page.tsx`
  - `app/(app)/inventario/ficha/[qr]/page.tsx`
  - `app/(app)/consignaciones/[id]/page.tsx`
  - `app/api/consignaciones/lookup-item/route.ts`
- Tests: `tests/unit/props-sanitization.test.ts` (test unitario que verifica que las props serializadas hacia los Client Components no contengan campos sensibles).

### Fase 3B — Catálogo de permisos y migración de roles
*Objetivo*: Extender `CATALOGO_PERMISOS` y aprovisionar a los roles Administrador existentes sin alterar roles limitados.
- Archivos:
  - `lib/types/administracion.ts`
  - `supabase/migrations/<next>_cpc_roles_seed.sql`
- Tests: `tests/unit/catalogo-permisos.test.ts` y `tests/db/cpc-roles.test.ts` (verifica la presencia de permisos en el catálogo TS y la migración de JSON en la tabla `rol`).

### Fase 3C — Costo pendiente en ingresos y prevención de duplicación de vigencias
*Objetivo*: Adaptar constraints `NOT NULL`, lógica de `sp_confirmar_ingreso`, estado de valorización de ítems y blindaje de `sp_aplicar_ultimo_costo` según DP-CPC-01 y DP-CPC-04.
- Archivos:
  - `supabase/migrations/<next>_cpc_costo_pendiente.sql`
  - `lib/dal/inventario/ingreso.ts`
  - `app/(app)/inventario/ingresos/nuevo/NuevoIngresoView.tsx`
- Tests: `tests/db/cpc-costo-pendiente.test.ts` (test de base de datos que confirma remitos con y sin costo, verifica la herencia de costo o estado pendiente, y valida que `costo_producto` no duplique vigencias).

### Fase 3D — Refactorización de DAL: Eliminación de `select('*')` en tablas sensibles
*Objetivo*: Reemplazar las 13 llamadas a `select('*')` en DAL identificadas en el inventario por proyecciones explícitas de columnas públicas, previniendo roturas en Postgres.
- Archivos:
  - `lib/dal/inventario/item.ts` (`findItemByQr`, `getItemConDetalle`, `listItemsByProducto`, `listItemsDisponibles`)
  - `lib/dal/ventas/cuenta-destino.ts` (`listCuentasDestino`, `listCuentasDestinoPaginado`)
  - `lib/dal/ventas/arancel.ts` (`listArancelesCobro`)
  - `lib/dal/precios/regla.ts` (`listReglasPrecio`, `getReglaPrecio`)
- Tests: `tests/unit/dal-select-whitelist.test.ts` (escaneo estático contra `select('*')` en tablas sensibles).

### Fase 3E — Segregación técnica en Postgres, Selladores DEFINER chicos y Cierre de Fugas RPC
*Objetivo*: Crear tablas satélites con RLS (`item_costo`, `detalle_venta_costo`, `ingreso_detalle_costo`, `devolucion_venta_costo`), implementar los selladores chicos `fn_sellar_*`, cerrar las fugas de permisos en `preview_rendicion`, `sp_perdida_incobrable_venta` y funciones `rf_*`, resolver `sp_recalcular_precio_venta` según DP-CPC-05 y actualizar las guardias de seguridad.
- Archivos:
  - `supabase/migrations/<next>_cpc_segregacion_costos.sql`
  - `tests/db/cpc-segregacion.test.ts` (prueba integral con rol Administrador y rol Vendedora-Local ejecutando ventas, recálculos y consultas directas)
  - Actualización de `tests/db/rvp-lecturas.test.ts` (guardia anti-propagación de DEFINER).

---

## Apéndice A: Evidencia mecánica de comandos

### A.1. Salida del comando de detección de fugas en `app` (Pages, Layouts y API Routes)

```text
$ node --experimental-strip-types -e "..."
app/(app)/clientes/[id]/page.tsx -> listCuentasDestino
app/(app)/consignaciones/[id]/page.tsx -> getConsignacionConDetalle
app/(app)/inventario/buscar/[codigo]/page.tsx -> listItemsByProducto
app/(app)/inventario/ficha/[qr]/page.tsx -> getItemConDetalle, findItemByQr
app/(app)/inventario/ficha/page.tsx -> listProductosConDetalle
app/(app)/inventario/ingresos/[id]/page.tsx -> listProductosConDetalle
app/(app)/inventario/ingresos/nuevo/page.tsx -> listProductosConDetalle
app/(app)/inventario/ingresos/page.tsx -> listIngresos
app/(app)/inventario/page.tsx -> listProductosConDetalle
app/(app)/inventario/productos/[id]/ficha/page.tsx -> listItemsByProducto
app/(app)/inventario/productos/nuevo/page.tsx -> listProductosConDetalle
app/(app)/precios/control/page.tsx -> listControlDePrecios
app/(app)/precios/cuentas/page.tsx -> listCuentasDestino, listArancelesCobro
app/(app)/precios/page.tsx -> listGananciaPorProducto, listReglasPrecio
app/(app)/precios/reglas/nueva/page.tsx -> listProductosConDetalle
app/(app)/precios/reglas/page.tsx -> listProductosConDetalle, listReglasPrecio
app/(app)/proveedores/[id]/page.tsx -> listIngresos
app/(app)/revendedoras/[id]/consignaciones/nueva/page.tsx -> listProductosConDetalle
app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx -> listCuentasDestino
app/(app)/ventas/[id]/page.tsx -> listCuentasDestino
app/(app)/ventas/nueva/page.tsx -> listProductosConDetalle, listCuentasDestino, listArancelesCobro
app/(app)/ventas/reservas/nueva/page.tsx -> listProductosConDetalle
app/api/consignaciones/lookup-item/route.ts -> findItemByQr
app/api/ventas/lookup-item/route.ts -> listItemsDisponibles
```

### A.2. Auditoría completa de funciones vivas que NO son `sp_*` ni `rvp_*` y leen columnas de `inventario.md §1`

Comando ejecutado con exclusión estricta de funciones eliminadas posteriormente en migraciones UP (`def.borradaDespues.length === 0`):
```bash
node --experimental-strip-types -e "
import { buscarDefinicionFuncion, leerMigraciones } from './scripts/sp-parser.mts';
import { readdirSync, readFileSync } from 'node:fs';

const archivos = leerMigraciones('supabase/migrations');
const migFiles = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();

const allFuncNames = new Set();
for (const mf of migFiles) {
  const content = readFileSync('supabase/migrations/' + mf, 'utf8');
  const matches = content.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/gi);
  for (const m of matches) allFuncNames.add(m[1].toLowerCase());
}

const sensitiveTerms = [
  'costo_ingreso', 'costo_snapshot', 'monto_ganancia', 'porcentaje_comision_preview',
  'monto_comision', 'costo_unitario', 'costo_original_usd', 'cotizacion_aplicada',
  'cotizacion_fecha_valor', 'costo_recuperado', 'costo_cobro', 'desglose_costo',
  'arancel_pct', 'iva_arancel_pct', 'ret_iva_pct', 'ret_ganancias_pct', 'ret_iibb_pct',
  'imp_deb_cred_pct', 'id_regla_margen_aplicada', 'costo_producto',
  'v_linea_venta', 'v_ganancia_por_producto'
];

for (const fn of allFuncNames) {
  if (fn.startsWith('sp_') || fn.startsWith('rvp_') || fn.startsWith('tg_')) continue;
  const def = buscarDefinicionFuncion(archivos, fn);
  if (!def || def.borradaDespues.length > 0) continue;
  const matched = sensitiveTerms.filter(t => def.cuerpo.includes(t));
  if (matched.length > 0) {
    const hasPermiso = def.cuerpo.includes('auth_tiene_permiso');
    console.log(fn + ' | ' + def.vigente.archivo + ':' + def.vigente.linea + ' | auth_tiene_permiso: ' + hasPermiso + ' | terms: ' + matched.join(', '));
  }
}
"
```

Salida textual dividida por ámbito de datos:

#### A.2.1. Funciones vivas que leen costos o márgenes de producto (ENTRAN en este cambio)
```text
preview_rendicion | supabase/migrations/00126_rendicion_modulo.sql:231 | auth_tiene_permiso: false | terms: costo_snapshot
rf_finanzas_resultados | supabase/migrations/00110_finanzas_cambio_diferencia.sql:69 | auth_tiene_permiso: false | terms: costo_ingreso, costo_recuperado, costo_cobro, v_linea_venta
rf_finanzas_flujo | supabase/migrations/00095_liquidacion_functions.sql:956 | auth_tiene_permiso: false | terms: costo_unitario, costo_cobro
rf_finanzas_posicion | supabase/migrations/00111_seguridad_revendedoras.sql:344 | auth_tiene_permiso: false | terms: costo_ingreso, monto_comision, costo_unitario
rf_finanzas_ranking_productos | supabase/migrations/00073_finanzas_lectura_2.sql:213 | auth_tiene_permiso: false | terms: v_linea_venta
* Nota: sp_perdida_incobrable_venta (00059:788) es función de lectura INVOKER que lee costo_snapshot sin auth_tiene_permiso.
```
*(Funciones como `rf_rotacion_por_producto`, `rf_reporte_caja` y `rf_reporte_financiero` fueron dropeadas en el UP de `00074:4-8` y no están vivas en el schema).*

#### A.2.2. Funciones vivas que leen comisiones de revendedora / retenciones financieras (DEUDA APARTE)
```text
preview_liquidacion | supabase/migrations/00095_liquidacion_functions.sql:168 | auth_tiene_permiso: false | terms: porcentaje_comision_preview, monto_comision
rf_cuenta_corriente_revendedora | supabase/migrations/00100_finanzas_cambio.sql:62 | auth_tiene_permiso: false | terms: monto_comision
rf_totales_panel_revendedoras | supabase/migrations/00101_panel_revendedoras_cambio.sql:8 | auth_tiene_permiso: false | terms: monto_comision
rf_panel_revendedoras | supabase/migrations/00107_panel_declaraciones_pendientes.sql:281 | auth_tiene_permiso: false | terms: porcentaje_comision_preview, monto_comision
rf_perfil_revendedora | supabase/migrations/00102_reportes_revendedoras.sql:12 | auth_tiene_permiso: false | terms: porcentaje_comision_preview, monto_comision
rf_resumen_canal | supabase/migrations/00102_reportes_revendedoras.sql:311 | auth_tiene_permiso: false | terms: porcentaje_comision_preview, monto_comision
```

### A.3. Definición de `preview_rendicion` (`supabase/migrations/00126_rendicion_modulo.sql:231`)

```sql
create or replace function preview_rendicion(
  p_id_proveedor uuid
) returns table (
  id_detalle_venta uuid,
  id_venta         uuid,
  fecha            timestamptz,
  producto_nombre  text,
  producto_sku     text,
  qr_code          text,
  precio_venta     numeric,
  costo_snapshot   numeric,
  monto_proveedor  numeric,
  cliente_nombre   text
) language plpgsql stable as $$
begin
  if not fn_modulo_habilitado(auth_tenant_id(), 'rendiciones') then
    raise exception 'module-disabled' using errcode = 'P0001';
  end if;

  return query
  select
    dv.id_detalle_venta, v.id_venta, v.fecha,
    p.nombre as producto_nombre, p.sku as producto_sku, ip.qr_code,
    dv.precio_venta, dv.costo_snapshot, dv.monto_proveedor, c.nombre as cliente_nombre
  from detalle_venta dv
  ...
```

### A.4. Definición de `sp_recalcular_precio_venta` (`supabase/migrations/00146_rlsp_sp_precios.sql:159`)

```sql
create or replace function sp_recalcular_precio_venta(...) ...
  select costo into v_costo
    from costo_producto
   where id_producto = p_id_producto and vigente_hasta is null;

  if v_costo is null then
    -- Sin costo vigente no hay precio calculable — marcar desactualizado y salir.
    update producto
       set precio_venta = null,
           id_regla_margen_aplicada = null,
           precio_venta_resuelto_at = now(),
           precio_venta_desactualizado = true
     where id_producto = p_id_producto and id_tenant = v_tenant;
    return null;
  end if;
  ...
```
