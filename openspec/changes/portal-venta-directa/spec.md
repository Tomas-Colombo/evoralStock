# Spec — portal-venta-directa / Portal Revendedora (`/mi-cuenta`)

**Change**: `portal-venta-directa` · **Requisitos**: `REQ-RVP-VTA-01…10` · **Decisiones**: `DR-13` (whitelist de columnas en `rvp_*`), excepciones `DEFINER` de escritura acotada (`sp_registrar_venta_revendedora`, `sp_anular_venta_revendedora`), extracción de núcleos en schema `interno` (sp compartido: **aprobado por el dueño del producto el 2026-11-24**)

> **Alcance**: Este documento define el contrato funcional, de seguridad, base de datos, UI y pruebas para reemplazar el flujo de *declaración + confirmación del local* por **venta directa en lote** desde el portal de revendedora.

---

## 1. Requisitos

### REQ-RVP-VTA-01 — Venta directa atómica por lote desde el portal

La revendedora MUST poder armar un carrito de `1..N` artículos de **su propio stock en poder** y confirmarlo en una única llamada atómica (`sp_registrar_venta_revendedora`), sin bucle de `await` por ítem en TypeScript.

- La venta se registra con `canal = 'revendedora'`, `estado_venta = 'registrada'`, `id_revendedora = auth_revendedora_id()`, sin selección de forma de pago (genera automáticamente el registro en `pago_venta` con `medio = 'cuenta_revendedora'` por el total, igual que `sp_registrar_venta`).
- Cada ítem del lote transiciona en `item_producto` de `'en_revendedora'` a `'vendido'` y su fila abierta en `consignacion_revendedora_detalle` pasa de `'en_poder'` a `'vendido'`.
- El payload MUST deduplicar `id_item` (tanto en validación Zod como en SQL) y aplicar un tope máximo de `N = 50` ítems por operación.
- La escritura NO se reimplementa: `sp_registrar_venta_revendedora` valida identidad y pertenencia y delega en el núcleo compartido con `sp_registrar_venta` (ver REQ-RVP-VTA-02).
- **Feliz**: Dado un usuario revendedora autenticado con 3 artículos en estado `'en_poder'`, cuando confirma un carrito con esos 3 `id_item`, entonces se crea una única `venta` con 3 `detalle_venta`, 1 `pago_venta` con `medio = 'cuenta_revendedora'` por la suma de los precios calculados en DB (REQ-RVP-VTA-04), los costos quedan sellados (`detalle_venta_costo` / `detalle_venta_rendicion`), los 3 ítems pasan a `'vendido'`, desaparecen de `Mi stock` y aparecen de inmediato en `Mis ventas`.
- **N6 (artículo sin costo)**: Si algún ítem del lote no tiene fila en `item_costo`, el sellado lanza `item-costo-pendiente` y se hace rollback total (nada se escribe). La UI muestra `mensajeDeError('item-costo-pendiente')`, que ya existe en `lib/errores/mensajes.ts` y le pide a la revendedora que avise al local.
- **N1 (entrada inválida / sin permiso)**: Lista vacía, `N` excedido, UUID malformado o usuario sin permiso de venta de revendedora → rechazo con slug `lineas-vacias` / `payload-invalido` / `no-permission`.
- **N2 (otro tenant / otra revendedora)**: Si la lista incluye un `id_item` de otro tenant o en poder de otra revendedora del mismo tenant → rollback completo con slug `item-no-en-poder` (no filtra si el ítem existe).
- **N3 (módulo apagado)**: Módulo `revendedoras` deshabilitado en `tenant_modulo` → rechazo con slug `modulo-revendedoras-deshabilitado`.
- **N4 (lote parcialmente inválido / ítem ya vendido o devuelto / doble envío)**: Si 2 ítems son válidos y 1 ya fue vendido, devuelto al local o repetido con estado incompatible → rollback total de la transacción (`venta`, `detalle_venta`, `pago_venta`, `consignacion_revendedora_detalle`, `item_producto` quedan intactos: **nada se escribe**).
- **N5 (operador del local)**: Un operador del local (`auth_revendedora_id() is null`) que invoque `sp_registrar_venta_revendedora` → rechazo con slug `no-revendedora`.

---

### REQ-RVP-VTA-02 — Seguridad y modelo de permisos (Opciones y recomendación)

Hoy la revendedora tiene RLS restrictivo sobre las tablas operativas (`venta`, `detalle_venta`, `pago_venta`, `item_producto`, `consignacion_revendedora_detalle`, `auditoria`) y `sp_registrar_venta` rechaza explícitamente `auth_revendedora_id() is not null`. Se evalúan dos alternativas para habilitar la escritura:

| Opción | Mecanismo | Tradeoffs |
| --- | --- | --- |
| **(a) Nueva excepción `SECURITY DEFINER` acotada** *(Elegida)* | Crear `sp_registrar_venta_revendedora(p_items uuid[], ...)` como `SECURITY DEFINER` (`set search_path = public, pg_temp`). Valida en SQL `v_tenant := auth_tenant_id()`, `v_revendedora_id := auth_revendedora_id()`, módulo habilitado, lectura directa del rol de la revendedora (`usuario` + `rol`, `r.permisos -> 'revendedoras' ? 'vender'`) y con `FOR UPDATE` que **cada** `id_item` esté `en_revendedora` y en `consignacion_revendedora_detalle` abierta/confirmada/`en_poder` de `v_revendedora_id`. *(Nota: `auth_tiene_permiso()` exige `auth_revendedora_id() is null` y devuelve `false` siempre para una sesión de revendedora, por lo que el permiso se lee del rol dentro del `DEFINER`.)* | **Pros**: Mantiene RLS cerrado por defecto en todas las tablas de ventas y stock; evita abrir `INSERT`/`UPDATE` a revendedoras sobre tablas del núcleo; evita colisiones con satélites de costo (`fn_sellar_costo_venta` hoy exige `auth_revendedora_id() is null`, por lo que el sellado de costo queda desacoplado o manejado explícitamente en SQL sin exponer costos).<br>**Contras**: Suma una excepción `DEFINER` fuera del prefijo `rvp_*`, por lo que exige actualizar explícitamente `AGENTS.md` y la whitelist `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`. |
| **(b) Políticas de `INSERT`/`UPDATE` para revendedora + `INVOKER`** | Mantener `INVOKER` y agregar políticas RLS de `INSERT`/`UPDATE` para `auth_revendedora_id() is not null` en `venta`, `detalle_venta`, `pago_venta`, `item_producto`, `movimiento_stock`, `consignacion_revendedora_detalle` y `auditoria`. | **Pros**: No agrega excepción `DEFINER`.<br>**Contras**: Abre superficie de escritura directa en 7+ tablas críticas del núcleo comercial; `RETURNING` y `FOR UPDATE` chocan con policies restrictivas existentes (satélites de costo, reglas de precio); duplica lógica de pertenencia en `WITH CHECK` de múltiples tablas, aumentando el riesgo de bypass. |

**Decisión**: **opción (a)**, aprobada. El cambio MUST:
1. Documentar `sp_registrar_venta_revendedora` en la lista de excepciones `DEFINER` permitidas de `AGENTS.md` (y `supabase/README.md`).
2. Agregar `'sp_registrar_venta_revendedora'` a `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`.
3. Usar el permiso `revendedoras.vender` (renombre de `'declarar'`, ver §8).

#### Núcleo compartido de la venta (no se copia `sp_registrar_venta`)

`sp_registrar_venta` (465 líneas, 13 versiones) MUST NOT duplicarse. No alcanza con que el DEFINER lo invoque: `sp_registrar_venta` y `fn_sellar_costo_venta` rechazan `auth_revendedora_id() is not null` y chequean `auth_tiene_permiso`, que leen el JWT y no el rol, así que siguen viendo a la revendedora aunque el llamador sea DEFINER.

- Se extrae de `sp_registrar_venta` un núcleo interno `fn_registrar_venta_nucleo(...)` con toda la escritura: validación de ítems por canal, precio (`sp_calcular_precio_venta_snapshot`), `venta`, `detalle_venta`, `movimiento_stock`, transición de `consignacion_revendedora_detalle`, sellado de costos y `pago_venta` (`cuenta_revendedora` en canal revendedora). El núcleo **no** tiene compuertas de auth propias: recibe `v_tenant`, `v_actor` y la identidad ya validados por quien lo llama.
- `sp_registrar_venta` (operador, `INVOKER`) conserva sus compuertas actuales y delega en el núcleo. Su comportamiento MUST quedar idéntico: los `tests/db` de ventas existentes siguen en verde sin tocar sus aserciones.
- `sp_registrar_venta_revendedora` (revendedora, `DEFINER`) valida tenant, `auth_revendedora_id()`, módulo, permiso `'vender'` leído directamente del rol (`usuario` + `rol`, ya que `auth_tiene_permiso` excluye sesiones de revendedora) y pertenencia de cada ítem con `FOR UPDATE`, y luego delega en el núcleo con `p_canal = 'revendedora'` y `p_id_revendedora = auth_revendedora_id()` (nunca un id que venga del cliente).
- El sellado de costos corre dentro del núcleo. `fn_sellar_costo_venta` (DEFINER) conserva su compuerta y delega en `interno.fn_sellar_costo_venta_nucleo` (DEFINER, sin compuerta, misma lógica), que es el que llama el núcleo. Ninguna `rvp_*` ni el retorno de `sp_registrar_venta_revendedora` (solo `id_venta`) exponen costos.
- **Modelo de privilegios**: el núcleo y el sellador interno viven en un schema nuevo `interno`, que **no** figura en `[api] schemas` de `supabase/config.toml` (hoy `["public", "graphql_public"]`): PostgREST no los expone y ningún cliente puede llamarlos por RPC. Se otorga `usage` sobre el schema y `execute` a `authenticated` (con `revoke ... from public, anon`), porque el `EXECUTE` se chequea contra el rol que llama:
  - `fn_registrar_venta_nucleo` es **INVOKER**. Llamado desde `sp_registrar_venta` (INVOKER) corre con el rol y la RLS del operador, exactamente igual que hoy. Llamado desde `sp_registrar_venta_revendedora` (DEFINER) corre como owner, que es lo que permite escribir sin abrir RLS a la revendedora.
  - `interno.fn_sellar_costo_venta_nucleo` es **DEFINER**, como el sellador actual.
  - Todas las funciones de `interno` usan `set search_path = public, pg_temp` y referencian `interno.` de forma calificada.
  - Test obligatorio en `tests/db`: el schema `interno` no es alcanzable por RPC (`supabase.rpc` y `/rest/v1/rpc/fn_registrar_venta_nucleo` = función no encontrada) como revendedora, operador y anon.
  - Cambiar `[api] schemas` queda prohibido: está fuera de la lista de config editable y rompería esta garantía.

---

### REQ-RVP-VTA-03 — Resolución de código escaneado o buscado (`rvp_resolver_item_stock`)

La resolución de códigos en el portal MUST realizarse mediante una nueva lectura `rvp_resolver_item_stock(p_codigo text)` (`SECURITY DEFINER`, `set search_path = public, pg_temp`, whitelist estricta de columnas sin costos ni márgenes). **MUST NOT** usarse `/api/ventas` (`/api/ventas/lookup-item` rechaza `session.idRevendedora` y exige `ventas.ver`).

- Acepta:
  1. **QR y Data Matrix** contra `item_producto.qr_code`: las simbologías 2D codifican `qrCode` (D-ETQ-01, `components/etiquetas/CodigoEtiqueta.tsx`). Identifican la unidad exacta.
  2. **EAN-13 y Code128** contra `item_producto.codigo_ean` (simbologías 1D).
  3. **SKU** de producto como alternativa de texto (con talle opcional, p. ej. `REM-0007-M` mediante `parsearSku`). Con talle: devuelve la primera unidad en su poder que no esté en el carrito (la UI pasa los `id_item` ya agregados). Sin talle y con varios talles en su poder: devuelve una fila por talle y la UI muestra un selector de talle.
- El `precio_venta` que devuelve es el mismo que se va a cobrar (REQ-RVP-VTA-04).
- Filtra estrictamente por `v_tenant = auth_tenant_id()`, `v_revendedora_id = auth_revendedora_id()`, `ip.estado_item = 'en_revendedora'`, `cr.confirmada = true`, `cr.estado = 'abierta'` y `crd.estado_detalle = 'en_poder'`.
- **Cero filtración de información**: si el código corresponde a un artículo existente en el local (`disponible`), vendido, devuelto, en poder de *otra* revendedora o de *otro* tenant, la función MUST devolver exactamente `0 filas` (y la UI/Action mostrar `"Artículo no encontrado en tu stock"`), indistinguible de un código inexistente.
- **Feliz**: Dada una revendedora con el ítem X en su poder, cuando escanea su QR, su `codigo_ean` (Data Matrix) o busca por su SKU, entonces `rvp_resolver_item_stock` devuelve `{ id_item, id_producto, descripcion, sku, talle, precio_venta }` para agregarlo al carrito.
- **N1 (código vacío o inválido)**: Texto vacío o sin coincidencias → `0 filas` (o `codigo-invalido` si es vacío).
- **N2 (ítem de otra revendedora o de otro tenant)**: Código válido que pertenece a otra revendedora o a otro tenant → `0 filas` (sin error que revele existencia).
- **N3 (ítem del local o ya vendido)**: Código válido de ítem `disponible` o `vendido` → `0 filas`.
- **N4 (módulo apagado / operador)**: Módulo apagado → `modulo-revendedoras-deshabilitado`; operador sin claim → `no-revendedora`.

---

### REQ-RVP-VTA-04 — Precio desde DB y punto de extensión para descuentos futuros

- El precio **no** sale de `producto.precio_venta`. `sp_registrar_venta` lo calcula con `sp_calcular_precio_venta_snapshot(id_producto, p_forma_pago, v_ids_desc, ...)`, y la confirmación de declaraciones de hoy lo invoca con los defaults (`p_forma_pago = 'efectivo'`, sin descuentos). La venta directa MUST usar exactamente ese cálculo, a través del núcleo, con los mismos parámetros: el precio de una venta de revendedora no cambia respecto del flujo actual.
- `rvp_resolver_item_stock` y `rvp_mi_stock` MUST mostrar el `precio_final` de ese mismo snapshot (hoy `rvp_mi_stock` proyecta `p.precio_venta`, que puede diferir si hay una regla para efectivo). Si `ok = false`, el ítem se muestra sin precio y no se puede agregar al carrito (slug `precio-no-resoluble`).
- El carrito muestra ese precio, nunca editable. Al confirmar, el núcleo lo vuelve a calcular en el servidor e ignora cualquier monto del cliente.
- **Punto de extensión (fuera de alcance)**: los futuros descuentos del administrador sobre productos en poder de revendedoras entran por el parámetro de descuentos del snapshot (`v_ids_desc`) o por una regla dentro de `sp_calcular_precio_venta_snapshot`, **sin cambios en la UI del carrito ni en el flujo de confirmación**.
- **Feliz**: Si el precio cambió en DB entre que la revendedora abrió el modal y confirmó, `detalle_venta.precio_venta` y `venta.total` reflejan el precio calculado al confirmar; `Mis ventas` muestra ese precio.

---

### REQ-RVP-VTA-05 — Estado en `Mis ventas`, agrupación por venta y visibilidad inmediata de comisión estimada

- En `app/(revendedora)/mi-cuenta/ventas/VentasRevendedoraView.tsx`, la etiqueta del badge cuando `liquidada === false` MUST cambiar de `"Pendiente de liquidar"` a **`"No liquidada"`** (y en el `<Select>` de filtro de `app/(revendedora)/mi-cuenta/ventas/page.tsx`, la opción `'pendiente'` pasa a rotularse `"No liquidada"`).
- **Agrupación y paginación por venta**: `rvp_mis_ventas` devuelve `id_venta` por línea; la vista `Mis ventas` MUST renderizar **una tarjeta por venta** (reutilizando componentes existentes de `components/`) con sus artículos, total de la venta, fecha, comisión estimada total, estado (`"No liquidada"` / `"Liquidada"` / `"Anulada"`), datos de contacto opcionales (`REQ-RVP-VTA-08`) y acción de anulación (`REQ-RVP-VTA-09`). La paginación MUST operar **por venta**, no por línea.
- Como la venta queda `registrada` con `canal = 'revendedora'` e `id_liquidacion IS NULL` desde el instante en que la revendedora la confirma, tanto `rvp_mis_ventas` (fila nueva con `comision_estimada`) como `rvp_mi_cuenta` (KPI `comision_estimada` y `total_vendido`) MUST reflejarla inmediatamente sin esperar confirmación del local.
- Cuando una venta está `'anulada'`, su tarjeta muestra la etiqueta **`"Anulada"`** y **sin comisión** (`$0` / omitida).
- **Feliz**: Inmediatamente después de confirmar una venta en el portal, la revendedora navega a `Mis ventas`, ve una única tarjeta para esa venta con todos sus artículos, badge `"No liquidada"` y su `comision_estimada` calculada; en `Resumen`, `comision_estimada` y `total_vendido` ya incluyen la venta.

---

### REQ-RVP-VTA-06 — Control del local y anulación de ventas de revendedora

- El local consulta las ventas registradas por cada revendedora en:
  - La pestaña **Ventas** de la ficha de la revendedora (`app/(app)/revendedoras/[id]/ventas/page.tsx` → `RevendedoraVentasTable.tsx`, que enlaza a `/ventas/[id]`).
  - El listado general de `/ventas`.
- Si el local necesita anular una venta cargada por una revendedora, MUST reutilizar el flujo existente `anularVentaAction` → `sp_anular_venta` (`00144_rlsp_sp_ventas.sql`), sin crear un mecanismo paralelo de anulación.
  - `sp_anular_venta` ya contempla `v_canal = 'revendedora'`: devuelve los ítems a `estado_item = 'en_revendedora'`, restaura `consignacion_revendedora_detalle.estado_detalle = 'en_poder'`, rechaza la anulación si la venta ya fue liquidada (`venta-liquidada`) y excluye `cuenta_revendedora` de los reintegros de caja.
- **Feliz**: Dado un operador con `ventas.editar` en `/ventas/[id]` de una venta de revendedora no liquidada, cuando ejecuta la anulación existente, la venta pasa a `'anulada'`, los ítems vuelven a `'en_poder'` de la revendedora y desaparecen de `Mis ventas` y `comision_estimada`.
- **N1 (venta ya liquidada)**: Intentar anular una venta de revendedora ya incluida en una liquidación → rechazo con `venta-liquidada`.

---

### REQ-RVP-VTA-07 — Destino de las declaraciones y UI Mobile-First del portal

#### 7.1 Destino de las Declaraciones (decidido, ver §8)

| Artefacto actual | Destino |
| --- | --- |
| Tabla `declaracion_venta_revendedora` | Se conserva solo como historial, sin nuevas escrituras. La migración **aborta** con un mensaje claro si existe alguna fila `'pendiente'`: el local las confirma o rechaza antes del deploy. No se convierten dentro de la migración (no hay sesión y las compuertas de auth fallan). |
| SPs `sp_declarar_venta_revendedora`, `sp_confirmar_declaracion_venta`, `sp_rechazar_declaracion_venta`, `sp_retirar_declaracion` y `rvp_mis_declaraciones` | Se retiran en este cambio (`DROP FUNCTION IF EXISTS`), con su definición completa recreada en el `-- DOWN:`. Antes de borrar, verificar los nombres exactos con `pnpm sp:last`. |
| `lib/dal/revendedoras/declaraciones.ts`, sus actions, tipos y tests | Se retiran en este cambio (verificando antes con `rg` que no queden importadores). |
| Bandeja del local (`app/(app)/revendedoras/declaraciones/**`, `app/(app)/revendedoras/[id]/declaraciones/**`, tab `'declaraciones'` en `RevendedoraTabs.tsx`, `BandAction` en `app/(app)/revendedoras/page.tsx`, filtro `declaraciones_pendientes` en `RevendedorasPanelView.tsx` / `RevendedorasFiltrosBar.tsx`) | Se retira en este cambio (y se quita `declaraciones_pendientes` del panel y de su `rvp_*`/`rf_*` si lo proyecta). |
| Sección Declaraciones del portal (`app/(revendedora)/mi-cuenta/declaraciones/**`, ítem en `app/(revendedora)/mi-cuenta/layout.tsx`, KPI `declaraciones_pendientes` y `BandAction` `"Ver declaraciones"` en `app/(revendedora)/mi-cuenta/page.tsx`, filtros `con_pendiente`/`sin_declaracion` y columna `declaracion_pendiente` en `Mi stock`) | Retirar de la navegación, del `PageBand` de Resumen, de los KPIs y de los filtros/columnas de `Mi stock`. |
| `e2e/tests/declaraciones-portal-revendedora.spec.ts` | Reemplazar por `e2e/tests/portal-venta-directa.spec.ts` (viewport móvil `375x812`, conservando los casos de aislamiento entre revendedoras, redirección de URLs del local y módulo deshabilitado). |
| `lib/ayuda/guia/revendedoras.ts`, `docs/modulos.md`, `supabase/README.md` | Retirar las 3 entradas de declaraciones (`revendedoras-declaraciones-bandeja`, `revendedoras-declaraciones-confirmar`, `revendedoras-declaraciones-rechazar`) y actualizar la guía/docs para reflejar la venta directa, anulación en portal y excepciones DEFINER / schema `interno`. |

#### 7.2 UI Mobile-First y reutilización de componentes

- **Botón `"Vender"` en `PageBand`**:
  - En **Resumen** (`/mi-cuenta`), el `PageBand` MUST incluir **únicamente** el `BandAction` primario `"Vender"` (se retiran `"Ver mi stock"`, `"Ver mis ventas"`, `"Ver liquidaciones"` y `"Ver declaraciones"`, ya que la navegación se realiza por la nav).
  - **Mi stock** (`/mi-cuenta/stock`) y **Mis ventas** (`/mi-cuenta/ventas`) MUST incluir `<BandAction tone="primary" title="Vender" ... />` (mismo patrón visual que `"Nueva venta"` en `app/(app)/ventas/page.tsx`).
  - El resto de los `BandAction` en esas pantallas (excepto Resumen, que solo lleva `"Vender"`) quedan como secundarios (`tone="secondary"`).
- **Modal de venta compartido**:
  - Se comparte el mismo modal entre Resumen, Mi stock y Mis ventas.
  - Diseño mobile-first:
    - Entrada por cámara reutilizando **`components/inventario/QrScanner.tsx`** (el mismo componente, sin duplicar).
    - Campo de búsqueda por texto/código como alternativa a la cámara.
    - Lista de artículos agregados al carrito con precio unitario, botón para quitar cada ítem y total acumulado.
    - Botón principal de confirmación mostrando el total (`Confirmar venta · $...`), deshabilitado con carrito vacío o envío en curso.
  - **Reutilización obligatoria**: extraer la lógica pura del carrito desde `app/(app)/ventas/nueva/NuevaVentaView.tsx` (manejo de líneas sin duplicados por `id_item`/`qr_code`, agregado/quitado, cálculo de total) hacia `components/` (ver §6) en lugar de copiarla.

---

### REQ-RVP-VTA-08 — Contacto opcional en la venta del portal

- La tabla `venta` incorpora las columnas opcionales `contacto_nombre text null` (`CHECK (char_length(contacto_nombre) <= 120)`) y `contacto_telefono text null` (`CHECK (char_length(contacto_telefono) <= 30)`).
- `sp_registrar_venta_revendedora` suma los parámetros opcionales `p_contacto_nombre text default null` y `p_contacto_telefono text default null`. Realiza `nullif(btrim(p_contacto), '')` sobre ambos y ejecuta el `UPDATE` sobre la venta recién creada dentro de la misma transacción, **sin modificar `interno.fn_registrar_venta_nucleo`**.
- El schema Zod en `lib/validation/revendedoras.ts` (`strictObject`) acepta ambos campos opcionales, aplicando `trim` y normalizando `''` a `null`/`undefined`.
- `VenderModal` incluye una sección colapsable `"Datos del cliente (opcional)"` con nombre y teléfono (`inputMode="tel"`).
- El contacto (cuando existe) se muestra en la tarjeta de `Mis ventas` y en el detalle de venta del administrador (`/ventas/[id]`).

---

### REQ-RVP-VTA-09 — Anulación de venta desde el portal (`sp_anular_venta_revendedora`)

En el portal no se editan ventas: si hubo un error, la revendedora la **anula** y vuelve a vender.

- **Núcleo compartido**: se extrae `interno.fn_anular_venta_nucleo` (cuerpo de `sp_anular_venta` sin la compuerta de auth, `INVOKER` en schema `interno`). `sp_anular_venta` público conserva su compuerta (`ventas.editar`) y delega en el núcleo.
- **RPC del portal**: `sp_anular_venta_revendedora(p_id_venta uuid, p_motivo text default null)` (`SECURITY DEFINER`, `set search_path = public, pg_temp`) sigue el mismo patrón que `sp_registrar_venta_revendedora`:
  - Valida `auth_tenant_id()`, `auth_revendedora_id()`, módulo `revendedoras` habilitado y permiso `'vender'` leído directamente del rol (`usuario` + `rol`, ya que `auth_tiene_permiso` devuelve `false` a revendedoras).
  - Bloquea la venta con `FOR UPDATE` verificando `id_tenant`, `canal = 'revendedora'`, `id_revendedora = v_revendedora_id`, `estado_venta = 'registrada'` y `id_liquidacion IS NULL` (si está liquidada → `venta-liquidada`; si no pertenece o no existe → rechazo; si ya está anulada → rechazo).
  - Delega la anulación en `interno.fn_anular_venta_nucleo`, devolviendo los artículos a `en_revendedora` / `en_poder`.
  - Se agrega a `SP_SIN_CHEQUEO` y a `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts` y se documenta en `AGENTS.md` (junto con `sp_registrar_venta_revendedora`, `tg_venta_cuadre_pagos` y el schema `interno`).
- **Action y DAL**: Server Action `anularVentaRevendedoraAction` en `app/(revendedora)/mi-cuenta/actions.ts` con los 3 gates (mismo `requireModuleRole` que `registrarVentaRevendedoraAction`) y DAL en `lib/dal/revendedoras/portal.ts`.
- **UI**: Botón `"Anular venta"` en la tarjeta de `Mis ventas` únicamente si la venta está `'registrada'` y no está liquidada, abriendo un `Modal` de confirmación con motivo opcional.
- **Tests DB requeridos**:
  - Anula venta propia no liquidada → OK, los artículos vuelven a su stock `'en_poder'`.
  - Venta ajena (de otra revendedora, del local o de otro tenant) → rechazo.
  - Venta liquidada → rechazo con `venta-liquidada`.
  - Doble anulación → rechazo.
  - Revendedora sin permiso `'vender'` → rechazo (`no-permission`).

---

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora (con permiso) | Revendedora (sin permiso) | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- | --- |
| `sp_registrar_venta_revendedora` | `no-revendedora` | `no-revendedora` | ok (solo sus ítems `en_poder`) | `no-permission` | `modulo-revendedoras-deshabilitado` | `item-no-en-poder` |
| `sp_anular_venta_revendedora` | `no-revendedora` | `no-revendedora` | ok (solo suya, `registrada`, no liquidada) | `no-permission` | `modulo-revendedoras-deshabilitado` | `venta-not-found` |
| `rvp_resolver_item_stock` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist de columnas | `no-permission` | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mis_ventas` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist | — | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mi_cuenta` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist | — | `modulo-revendedoras-deshabilitado` | 0 filas / `no-revendedora` |
| `sp_anular_venta` (existente) | ok (`ventas.editar`) | `no-permission` | `no-permission` | `no-permission` | ok si es venta local; venta revendedora | `venta-not-found` |

*(Nota: "con permiso" = `revendedoras.vender`, renombre de `'declarar'`; ver §8. En `sp_registrar_venta_revendedora` y `rvp_resolver_item_stock`, el permiso se valida leyendo `usuario` + `rol` dentro del `DEFINER` porque `auth_tiene_permiso` exige `auth_revendedora_id() is null`. El slug `no-revendedora` ya existe en `lib/errores/mensajes.ts`.)*
*(`fn_registrar_venta_nucleo` y `interno.fn_sellar_costo_venta_nucleo` no figuran en la matriz porque no son alcanzables por RPC para ningún rol, ver REQ-RVP-VTA-02.)*

---

## 3. Cifras financieras

No se alteran las fórmulas de `specs/golden.md` ni la imputación de cifras definida en `openspec/changes/portal-revendedor-filtros/spec.md`:

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
| --- | --- | --- | --- |
| `total_vendido` | `(v.fecha at time zone v_zona)::date` | Suma `dv.precio_venta` de ventas `registrada` con `canal = 'revendedora'` desde el instante en que la revendedora las crea. | `rvp_mi_cuenta` |
| `comision_estimada` | `(v.fecha at time zone v_zona)::date` | `round(dv.porcentaje_comision_preview * dv.precio_venta / 100.0, 2)` cuando `dv.id_liquidacion is null`. Aparece al crearse la venta. | `rvp_mi_cuenta`, `rvp_mis_ventas` |
| `total_adeudado` | Foto actual | Incluye el `pago_venta` automático (`cuenta_revendedora`) de la venta firme recién creada, neto de comisiones liquidadas y pagos. | `rvp_mi_cuenta`, `rf_cuenta_corriente_revendedora` |

---

## 4. INVOKER contra RLS restrictiva

- `rvp_resolver_item_stock(p_codigo text)` es **`SECURITY DEFINER`** (`set search_path = public, pg_temp`, DR-13), identidad exclusiva por `auth_tenant_id()` y `auth_revendedora_id()`, whitelist estricta sin columnas de costo/margen/proveedor, cubierta por `tests/db/rvp-lecturas.test.ts`.
- `sp_registrar_venta_revendedora` es **`SECURITY DEFINER`** (`set search_path = public, pg_temp`) bajo la opción (a) elegida en `REQ-RVP-VTA-02`. Para cumplir con la guardia anti-propagación de `DEFINER`:
  - Se documenta explícitamente en `AGENTS.md` (y `supabase/README.md`).
  - Se agrega a `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`.
  - El sellado de costos (`detalle_venta_costo` / `detalle_venta_rendicion`) corre dentro del núcleo vía `interno.fn_sellar_costo_venta_nucleo` (REQ-RVP-VTA-02). La revendedora nunca lee satélites ni recibe costos.
- `fn_registrar_venta_nucleo` es **INVOKER** en el schema no expuesto `interno`: hereda la RLS del operador cuando lo llama `sp_registrar_venta`, y corre como owner cuando lo llama `sp_registrar_venta_revendedora`.

---

## 5. Migraciones

- **Número**: el siguiente número libre al momento de aplicar (`ls supabase/migrations | tail -1`). Nunca fijar un número en la spec.
- **Contenido mínimo de la migración** (en este orden):
  1. Guardia: `raise exception` si existe alguna `declaracion_venta_revendedora` con `estado = 'pendiente'`.
  2. `create schema interno` con `usage` a `authenticated`; `interno.fn_sellar_costo_venta_nucleo` (DEFINER) y `interno.fn_registrar_venta_nucleo` (INVOKER), extraídos de la definición vigente de `fn_sellar_costo_venta` y `sp_registrar_venta` (`pnpm sp:last`).
  3. `fn_sellar_costo_venta` y `sp_registrar_venta` redefinidos para delegar en el núcleo, con las mismas firmas y compuertas.
  4. `rvp_resolver_item_stock(p_codigo text, p_excluir uuid[] default '{}')` (DEFINER) y `rvp_mi_stock` con el precio del snapshot.
  5. `sp_registrar_venta_revendedora(p_items uuid[])` (DEFINER; sin nota ni observaciones).
  6. Renombre del permiso `revendedoras.declarar` → `revendedoras.vender` en los roles existentes y en `fn_auto_crear_rol_revendedora`.
  7. `DROP` de los SPs y la `rvp_*` de declaraciones.
  8. `REVOKE ... from public, anon` y `GRANT ... to authenticated` en todo lo nuevo.
- **Bloque `-- DOWN:`**: obligatorio y ejecutable al final del archivo, revirtiendo funciones, permisos y cambios de esquema, verificado con `pnpm gate:db`.

---

## 6. Ubicación del código

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `components/ventas/carrito.ts` (o helper/hook de carrito extraído de `NuevaVentaView.tsx`) | `app/(app)/ventas/nueva/NuevaVentaView.tsx` y modal de venta del portal `app/(revendedora)/mi-cuenta/` | Compartido entre dos grupos de rutas (`(app)` y `(revendedora)`), sin importar nada de `app/`. |
| `app/(revendedora)/mi-cuenta/VenderModal.tsx` (y botón wrapper `VenderBandAction.tsx`) | `app/(revendedora)/mi-cuenta/page.tsx`, `stock/page.tsx`, `ventas/page.tsx` | Compartido exclusivamente dentro del portal `/mi-cuenta`; usa `QrScanner` de `components/inventario/QrScanner.tsx`. |
| `app/(revendedora)/mi-cuenta/actions.ts` | `VenderModal.tsx` | Server Action del portal (`registrarVentaRevendedoraAction`, `buscarItemStockRevendedoraAction`). |
| `lib/dal/revendedoras/portal.ts` | `app/(revendedora)/mi-cuenta/actions.ts` | DAL existente del portal (`registrarVentaRevendedora`, `resolverItemStockRevendedora`). |
| `lib/validation/revendedoras.ts` | `app/(revendedora)/mi-cuenta/actions.ts` | Esquema Zod `strictObject` con tope `N` y deduplicación de `id_item`. |
| `lib/errores/mensajes.ts` + `lib/errores/mensajes.test.ts` | Portal y tests | Nuevos slugs de error que levanten el SP o la validación (`no-revendedora`, `item-no-en-poder` e `item-costo-pendiente` ya existen). |
| `lib/types/administracion.ts` (`CATALOGO_PERMISOS`), `docs/modulos.md`, `lib/ayuda/guia/revendedoras.ts` | Permisos, docs y ayuda | Renombre `declarar` → `vender` y retiro de las entradas de declaraciones. |
| `supabase/migrations/<siguiente>_portal_venta_directa.sql` | DB | Schema `interno`, núcleo, SPs y rvp nuevos, renombre de permiso, DROP de declaraciones, con `-- DOWN:`. |
| `app/(revendedora)/mi-cuenta/ventas/VentasRevendedoraView.tsx` + `page.tsx` | `/mi-cuenta/ventas` | Cambio de etiqueta `"Pendiente de liquidar"` → `"No liquidada"`. |
| `tests/db/rvp-lecturas.test.ts` + nuevo `tests/db/rvp-venta-directa.test.ts` | Suite DB | Guardia `PERMITTED_NON_RVP_DEFINER` y cobertura de `sp_registrar_venta_revendedora` + `rvp_resolver_item_stock`. |
| `app/(revendedora)/mi-cuenta/actions.test.ts` | Suite unit | Tests unitarios de la nueva Server Action. |
| `e2e/tests/portal-venta-directa.spec.ts` (reemplazo de `declaraciones-portal-revendedora.spec.ts`) | Suite E2E | Flujo mobile end-to-end. |

---

## 7. Criterios de aceptación y pruebas requeridas

1. **Tests DB (`tests/db/`)**:
   - `sp_registrar_venta_revendedora`:
     - Caso feliz de lote (`1..N` ítems): crea 1 `venta`, `N` `detalle_venta`, 1 `pago_venta` (`cuenta_revendedora`), transiciona ítems y detalles de consignación a `'vendido'`, registra precio leído desde DB.
     - **N1**: lista vacía, superando tope `N`, sin permiso → rechazo.
     - **N2**: otro tenant → rechazo (`item-no-en-poder`), sin revelar existencia.
     - **N2b**: otra revendedora del mismo tenant → rechazo (`item-no-en-poder`).
     - **N2c**: ítem ajeno del local (`disponible`) → rechazo (`item-no-en-poder`).
     - **N3**: módulo `revendedoras` apagado → `modulo-revendedoras-deshabilitado`.
     - **N4a**: ítem ya vendido o devuelto → rechazo (`item-no-en-poder`).
     - **N4b (atomicidad de lote)**: lote con 2 ítems válidos + 1 inválido → rollback completo: **0 filas** escritas en `venta`, `detalle_venta`, `pago_venta` y los 2 ítems válidos siguen `'en_poder'`.
     - **N5**: sesión de operador del local → `no-revendedora`.
     - **N6**: lote con un ítem sin `item_costo` → `item-costo-pendiente` y 0 filas escritas.
     - Precio: el `detalle_venta.precio_venta` coincide con el `precio_final` de `sp_calcular_precio_venta_snapshot` (efectivo, sin descuentos) y con el que mostró `rvp_resolver_item_stock`.
     - Costos sellados: cada `detalle_venta` nuevo tiene fila en `detalle_venta_costo` y `detalle_venta_rendicion`.
   - Núcleo y no regresión:
     - Todas las suites existentes de `tests/db` sobre `sp_registrar_venta` y `fn_sellar_costo_venta` pasan sin modificar sus aserciones.
     - `fn_registrar_venta_nucleo` y `interno.fn_sellar_costo_venta_nucleo` no son alcanzables por RPC (anon, operador, revendedora).
   - `rvp_resolver_item_stock`:
     - Resuelve por `qr_code`, `codigo_ean` (Data Matrix) y SKU en poder de la revendedora autenticada.
     - Ítem de otra revendedora, de otro tenant, del local (`disponible`) o ya vendido → `0 filas` (idéntico a código inexistente).
     - Módulo apagado → `modulo-revendedoras-deshabilitado`; operador → `no-revendedora`.
   - Guardia `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts` en verde.
2. **Tests unitarios (`app/(revendedora)/mi-cuenta/actions.test.ts`)**:
   - Rechazo si falta `session.idRevendedora` o el permiso requerido.
   - Validación Zod: carrito vacío, más de `N` ítems, UUID inválido, deduplicación de `id_item`.
   - Delegación al DAL y `revalidatePath` sobre `/mi-cuenta`, `/mi-cuenta/stock` y `/mi-cuenta/ventas`.
3. **Tests E2E (`e2e/tests/`, viewport celular)**:
   - Revendedora en móvil abre `"Vender"` desde Resumen/Mi stock/Mis ventas, agrega artículos al carrito (por búsqueda de texto/código), quita uno, confirma la venta viendo el total.
   - Verifica que los artículos vendidos salen de `Mi stock`, aparecen inmediatamente en `Mis ventas` con estado `"No liquidada"` y `comision_estimada > 0`, y actualizan `Resumen`.
   - Verifica que el operador ve la venta en `/revendedoras/[id]/ventas` y puede anularla usando la anulación existente de `/ventas/[id]`, devolviendo el ítem al stock de la revendedora.

---

## 8. Decisiones tomadas (dueño del producto, 2026-11-24)

1. **Permiso**: se renombra `revendedoras.declarar` a `revendedoras.vender` en `CATALOGO_PERMISOS` (`lib/types/administracion.ts`), `fn_auto_crear_rol_revendedora`, seed, roles existentes (en la migración, con DOWN), `docs/modulos.md` y la guía de ayuda.
2. **Declaraciones pendientes**: la migración aborta si existe alguna `'pendiente'`; el local las resuelve antes del deploy.
3. **UI de declaraciones**: la bandeja del local, la pestaña, `/mi-cuenta/declaraciones` y sus entradas de la guía se retiran en este mismo cambio. La tabla queda como historial.
4. **Tope**: `N = 50` artículos por venta.
5. **Resolución por código**: QR y Data Matrix = la unidad exacta. SKU con talle = la primera unidad en su poder que no esté en el carrito. SKU sin talle con varios talles = selector de talle.
6. **Nota**: el modal no tiene campo de nota.
7. **Comisión**: el núcleo usa `fn_resolver_comision(v_revendedora_id, fn_hoy_tenant(), 0, 'revendedora')`, igual que hoy; `specs/golden.md` sin cambios.
8. **sp compartido**: se aprueba extraer el núcleo de `sp_registrar_venta`, de `sp_anular_venta` y de `fn_sellar_costo_venta` al schema `interno`, con comportamiento idéntico para el operador.
9. **Contacto opcional y anulación en portal**: aprobados en Fase 4 (`REQ-RVP-VTA-08`, `REQ-RVP-VTA-09`). `AGENTS.md` (≤150 líneas) documenta `sp_registrar_venta_revendedora`, `sp_anular_venta_revendedora`, `tg_venta_cuadre_pagos` y el schema `interno`.
