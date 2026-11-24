# Spec — portal-venta-directa / Portal Revendedora (`/mi-cuenta`)

**Change**: `portal-venta-directa` · **Requisitos**: `REQ-RVP-VTA-01…07` · **Decisiones**: `DR-13` (whitelist de columnas en `rvp_*`), nueva excepción `DEFINER` de escritura acotada

> **Alcance**: Este documento define el contrato funcional, de seguridad, base de datos, UI y pruebas para reemplazar el flujo de *declaración + confirmación del local* por **venta directa en lote** desde el portal de revendedora.

---

## 1. Requisitos

### REQ-RVP-VTA-01 — Venta directa atómica por lote desde el portal

La revendedora MUST poder armar un carrito de `1..N` artículos de **su propio stock en poder** y confirmarlo en una única llamada atómica (`sp_registrar_venta_revendedora`), sin bucle de `await` por ítem en TypeScript.

- La venta se registra con `canal = 'revendedora'`, `estado_venta = 'registrada'`, `id_revendedora = auth_revendedora_id()`, sin selección de forma de pago (genera automáticamente el registro en `pago_venta` con `medio = 'cuenta_revendedora'` por el total, igual que `sp_registrar_venta`).
- Cada ítem del lote transiciona en `item_producto` de `'en_revendedora'` a `'vendido'` y su fila abierta en `consignacion_revendedora_detalle` pasa de `'en_poder'` a `'vendido'`.
- El payload MUST deduplicar `id_item` (tanto en validación Zod como en SQL) y aplicar un tope máximo `N` de ítems por operación (propuesto `N = 50`; ver *Decisiones pendientes*).
- **Feliz**: Dado un usuario revendedora autenticado con 3 artículos en estado `'en_poder'`, cuando confirma un carrito con esos 3 `id_item`, entonces se crea una única `venta` con 3 `detalle_venta`, 1 `pago_venta` con `medio = 'cuenta_revendedora'` por la suma de los precios vigentes en DB, los 3 ítems pasan a `'vendido'`, desaparecen de `Mi stock` y aparecen de inmediato en `Mis ventas`.
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
| **(a) Nueva excepción `SECURITY DEFINER` acotada** *(Recomendada)* | Crear `sp_registrar_venta_revendedora(p_items uuid[], ...)` como `SECURITY DEFINER` (`set search_path = public, pg_temp`). Valida en SQL `v_tenant := auth_tenant_id()`, `v_revendedora_id := auth_revendedora_id()`, módulo habilitado, `auth_tiene_permiso('revendedoras', '<permiso>')` y con `FOR UPDATE` que **cada** `id_item` esté `en_revendedora` y en `consignacion_revendedora_detalle` abierta/confirmada/`en_poder` de `v_revendedora_id`. | **Pros**: Mantiene RLS cerrado por defecto en todas las tablas de ventas y stock; evita abrir `INSERT`/`UPDATE` a revendedoras sobre tablas del núcleo; evita colisiones con satélites de costo (`fn_sellar_costo_venta` hoy exige `auth_revendedora_id() is null`, por lo que el sellado de costo queda desacoplado o manejado explícitamente en SQL sin exponer costos).<br>**Contras**: Suma una excepción `DEFINER` fuera del prefijo `rvp_*`, por lo que exige actualizar explícitamente `AGENTS.md` y la whitelist `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`. |
| **(b) Políticas de `INSERT`/`UPDATE` para revendedora + `INVOKER`** | Mantener `INVOKER` y agregar políticas RLS de `INSERT`/`UPDATE` para `auth_revendedora_id() is not null` en `venta`, `detalle_venta`, `pago_venta`, `item_producto`, `movimiento_stock`, `consignacion_revendedora_detalle` y `auditoria`. | **Pros**: No agrega excepción `DEFINER`.<br>**Contras**: Abre superficie de escritura directa en 7+ tablas críticas del núcleo comercial; `RETURNING` y `FOR UPDATE` chocan con policies restrictivas existentes (satélites de costo, reglas de precio); duplica lógica de pertenencia en `WITH CHECK` de múltiples tablas, aumentando el riesgo de bypass. |

**Recomendación**: Elegir la **opción (a)**. Si se aprueba, el cambio MUST:
1. Documentar `sp_registrar_venta_revendedora` en la lista de excepciones `DEFINER` permitidas de `AGENTS.md` (y `supabase/README.md` si corresponde).
2. Agregar `'sp_registrar_venta_revendedora'` a `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`.
3. Verificar en `CATALOGO_PERMISOS` (`lib/types/administracion.ts`) el permiso utilizado (hoy `'declarar'`; evaluar renombrarlo a `'vender'` — ver *Decisiones pendientes*).

---

### REQ-RVP-VTA-03 — Resolución de código escaneado o buscado (`rvp_resolver_item_stock`)

La resolución de códigos en el portal MUST realizarse mediante una nueva lectura `rvp_resolver_item_stock(p_codigo text)` (`SECURITY DEFINER`, `set search_path = public, pg_temp`, whitelist estricta de columnas sin costos ni márgenes). **MUST NOT** usarse `/api/ventas` (`/api/ventas/lookup-item` rechaza `session.idRevendedora` y exige `ventas.ver`).

- Acepta:
  1. **QR** exacto de unidad física (`item_producto.qr_code`).
  2. **Data Matrix / EAN-13** interno (`item_producto.codigo_ean`).
  3. **SKU** de producto (con talle opcional, p. ej. `REM-0007-M` mediante `parsearSku`, o búsqueda por texto/nombre como alternativa manual en la UI).
- Filtra estrictamente por `v_tenant = auth_tenant_id()`, `v_revendedora_id = auth_revendedora_id()`, `ip.estado_item = 'en_revendedora'`, `cr.confirmada = true`, `cr.estado = 'abierta'` y `crd.estado_detalle = 'en_poder'`.
- **Cero filtración de información**: si el código corresponde a un artículo existente en el local (`disponible`), vendido, devuelto, en poder de *otra* revendedora o de *otro* tenant, la función MUST devolver exactamente `0 filas` (y la UI/Action mostrar `"Artículo no encontrado en tu stock"`), indistinguible de un código inexistente.
- **Feliz**: Dada una revendedora con el ítem X en su poder, cuando escanea su QR, su `codigo_ean` (Data Matrix) o busca por su SKU, entonces `rvp_resolver_item_stock` devuelve `{ id_item, id_producto, descripcion, sku, talle, precio_venta }` para agregarlo al carrito.
- **N1 (código vacío o inválido)**: Texto vacío o sin coincidencias → `0 filas` (o `codigo-invalido` si es vacío).
- **N2 (ítem de otra revendedora o de otro tenant)**: Código válido que pertenece a otra revendedora o a otro tenant → `0 filas` (sin error que revele existencia).
- **N3 (ítem del local o ya vendido)**: Código válido de ítem `disponible` o `vendido` → `0 filas`.
- **N4 (módulo apagado / operador)**: Módulo apagado → `modulo-revendedoras-deshabilitado`; operador sin claim → `no-revendedora`.

---

### REQ-RVP-VTA-04 — Precio desde DB y punto de extensión para descuentos futuros

- El carrito en el portal MUST mostrar el `precio_venta` devuelto por la base de datos (`rvp_mi_stock` / `rvp_resolver_item_stock`), nunca editable por la revendedora.
- Al confirmar, `sp_registrar_venta_revendedora` MUST volver a leer el `precio_venta` vigente desde la base de datos (`producto.precio_venta`) y calcular el total en el servidor, ignorando cualquier monto que pudiera venir del cliente.
- **Punto de extensión (fuera de alcance)**: Cuando en el futuro el administrador configure descuentos aplicables a productos en poder de revendedoras, la resolución del descuento y del precio neto final se implementará dentro de `sp_registrar_venta_revendedora` (y en la proyección de precio de `rvp_*` si corresponde), **sin requerir cambios en la UI del carrito ni en el flujo de confirmación**.
- **Feliz**: Si el precio del producto cambió en DB entre que la revendedora abrió el modal y confirmó la venta, `detalle_venta.precio_venta` y `venta.total` reflejan el precio vigente en DB al momento de confirmar.

---

### REQ-RVP-VTA-05 — Estado en `Mis ventas` y visibilidad inmediata de comisión estimada

- En `app/(revendedora)/mi-cuenta/ventas/VentasRevendedoraView.tsx`, la etiqueta del badge cuando `liquidada === false` MUST cambiar de `"Pendiente de liquidar"` a **`"No liquidada"`** (y en el `<Select>` de filtro de `app/(revendedora)/mi-cuenta/ventas/page.tsx`, la opción `'pendiente'` pasa a rotularse `"No liquidada"`).
- Como la venta queda `registrada` con `canal = 'revendedora'` e `id_liquidacion IS NULL` desde el instante en que la revendedora la confirma, tanto `rvp_mis_ventas` (fila nueva con `comision_estimada`) como `rvp_mi_cuenta` (KPI `comision_estimada` y `total_vendido`) MUST reflejarla inmediatamente sin esperar confirmación del local.
- **Feliz**: Inmediatamente después de confirmar una venta en el portal, la revendedora navega a `Mis ventas`, ve el artículo con badge `"No liquidada"` y su `comision_estimada` calculada; en `Resumen`, `comision_estimada` y `total_vendido` ya incluyen la venta.

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

#### 7.1 Destino propuesto para Declaraciones (pendiente de validación en §7)

| Artefacto actual | Destino propuesto |
| --- | --- |
| Tabla `declaracion_venta_revendedora` | Conservar tabla solo para historial de registros pasados (sin nuevas escrituras). Las filas `'pendiente'` existentes al momento del deploy se convierten en ventas firmes en la migración (o se exige bandeja en 0 antes del deploy — ver *Decisiones pendientes*). |
| SPs `sp_declarar_venta_revendedora`, `sp_confirmar_declaracion_venta`, `sp_rechazar_declaracion_venta`, `sp_retirar_declaracion_venta` y `rvp_mis_declaraciones` | Deprecar / retirar una vez migradas las pendientes (con `DROP FUNCTION IF EXISTS` en la migración y su reversión en `-- DOWN:`). |
| Bandeja del local (`app/(app)/revendedoras/declaraciones/**`, `app/(app)/revendedoras/[id]/declaraciones/**`, tab `'declaraciones'` en `RevendedoraTabs.tsx`, `BandAction` en `app/(app)/revendedoras/page.tsx`, filtro `declaraciones_pendientes` en `RevendedorasPanelView.tsx` / `RevendedorasFiltrosBar.tsx`) | Retirar la bandeja y la pestaña una vez que no queden declaraciones pendientes (y quitar `declaraciones_pendientes` del panel). |
| Sección Declaraciones del portal (`app/(revendedora)/mi-cuenta/declaraciones/**`, ítem en `app/(revendedora)/mi-cuenta/layout.tsx`, KPI `declaraciones_pendientes` y `BandAction` `"Ver declaraciones"` en `app/(revendedora)/mi-cuenta/page.tsx`, filtro `con_pendiente`/`sin_declaracion` en `Mi stock`) | Retirar de la navegación, del `PageBand` de Resumen y de los filtros de `Mi stock`. |
| `e2e/tests/declaraciones-portal-revendedora.spec.ts` | Reemplazar por el nuevo E2E mobile del flujo de venta directa (conservando los casos de aislamiento entre revendedoras, redirección de URLs del local y módulo deshabilitado). |
| `lib/ayuda/guia/revendedoras.ts` | Retirar las 3 entradas de declaraciones (`revendedoras-declaraciones-bandeja`, `revendedoras-declaraciones-confirmar`, `revendedoras-declaraciones-rechazar`) y actualizar la guía del panel de revendedoras para reflejar la consulta/anulación de ventas desde la pestaña Ventas. |

#### 7.2 UI Mobile-First y reutilización de componentes

- **Botón `"Vender"` en `PageBand`**:
  - Las pantallas **Resumen** (`/mi-cuenta`), **Mi stock** (`/mi-cuenta/stock`) y **Mis ventas** (`/mi-cuenta/ventas`) MUST incluir `<BandAction tone="primary" title="Vender" ... />` (mismo patrón visual que `"Nueva venta"` en `app/(app)/ventas/page.tsx`).
  - El resto de los `BandAction` en esas tres pantallas quedan como secundarios (`tone="secondary"`).
- **Modal de venta compartido**:
  - Se comparte el mismo modal entre Resumen, Mi stock y Mis ventas.
  - Diseño mobile-first:
    - Entrada por cámara reutilizando **`components/inventario/QrScanner.tsx`** (el mismo componente, sin duplicar).
    - Campo de búsqueda por texto/código como alternativa a la cámara.
    - Lista de artículos agregados al carrito con precio unitario, botón para quitar cada ítem y total acumulado.
    - Botón principal de confirmación mostrando el total (`Confirmar venta · $...`), deshabilitado con carrito vacío o envío en curso.
  - **Reutilización obligatoria**: extraer la lógica pura del carrito desde `app/(app)/ventas/nueva/NuevaVentaView.tsx` (manejo de líneas sin duplicados por `id_item`/`qr_code`, agregado/quitado, cálculo de total) hacia `components/` (ver §6) en lugar de copiarla.

---

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora (con permiso) | Revendedora (sin permiso) | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- | --- |
| `sp_registrar_venta_revendedora` | `no-revendedora` | `no-revendedora` | ok (solo sus ítems `en_poder`) | `no-permission` | `modulo-revendedoras-deshabilitado` | `item-no-en-poder` |
| `rvp_resolver_item_stock` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist de columnas | `no-permission` | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mis_ventas` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist | — | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mi_cuenta` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist | — | `modulo-revendedoras-deshabilitado` | 0 filas / `no-revendedora` |
| `sp_anular_venta` (existente) | ok (`ventas.editar`) | `no-permission` | `no-permission` | `no-permission` | ok si es venta local; venta revendedora | `venta-not-found` |

*(Nota: el nombre exacto del permiso de revendedora —`'declarar'` o `'vender'`— queda sujeto a la decisión pendiente §7.1).*

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
- `sp_registrar_venta_revendedora` es **`SECURITY DEFINER`** (`set search_path = public, pg_temp`) bajo la opción (a) recomendada en `REQ-RVP-VTA-02`. Para cumplir con la guardia anti-propagación de `DEFINER`:
  - Se documenta explícitamente en `AGENTS.md` (y `supabase/README.md`).
  - Se agrega a `PERMITTED_NON_RVP_DEFINER` en `tests/db/rvp-lecturas.test.ts`.
  - Si dentro de la transacción se requiere sellar costos (`detalle_venta_costo` / `detalle_venta_rendicion`) o respetar la regla de satélites sin que la revendedora los lea, debe quedar resuelto en la migración manteniendo intacto que ninguna `rvp_*` ni retorno del SP exponga costos.

---

## 5. Migraciones

- **Número**: el siguiente número libre al momento de aplicar (`ls supabase/migrations | tail -1`). Nunca fijar un número en la spec.
- **Contenido mínimo de la migración**:
  1. Crear `rvp_resolver_item_stock(p_codigo text)` (`SECURITY DEFINER`, `REVOKE/GRANT` a `authenticated`).
  2. Crear `sp_registrar_venta_revendedora(p_items uuid[], p_observaciones text default null)` (`SECURITY DEFINER`, `REVOKE/GRANT` a `authenticated`).
  3. Migración de declaraciones `'pendiente'` (según definición en *Decisiones pendientes*) y limpieza/deprecación de SPs de declaración si se aprueba retirarlos.
  4. Actualización de `CATALOGO_PERMISOS` / `fn_auto_crear_rol_revendedora` si se renombra `'declarar'` → `'vender'`.
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
| `lib/errores/mensajes.ts` + `lib/errores/mensajes.test.ts` | Portal y tests | Nuevos slugs de error que levanten el SP o la validación. |
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

## 8. Decisiones pendientes

> Responder antes de pasar a diseño/migración. No se asume ninguna definición de negocio o de plata sin confirmación.

1. **Nombre del permiso en `CATALOGO_PERMISOS`**: ¿renombramos `revendedoras.declarar` a `revendedoras.vender` (actualizando `fn_auto_crear_rol_revendedora`, seed y roles existentes en migración), o preferís mantener el slug `'declarar'` / agregar `'vender'`?
2. **Declaraciones `'pendiente'` al momento del deploy**: si al momento de desplegar existen filas en `declaracion_venta_revendedora` con `estado = 'pendiente'`, ¿la migración las convierte automáticamente en ventas firmes (`canal = 'revendedora'`), o se exige que el local las resuelva antes del deploy?
3. **Retiro de UI/rutas de Declaraciones**: ¿retiramos la bandeja del local (`/revendedoras/declaraciones`, `[id]/declaraciones`, tab en `RevendedoraTabs`) y la sección `/mi-cuenta/declaraciones` en este mismo cambio, o las dejamos en solo lectura durante una transición?
4. **Tope `N` del carrito por lote**: ¿confirmamos un máximo de `50` artículos por venta (consistente con `lookup-item`) o preferís otro tope (ej. `100`)?
5. **SKU con múltiples unidades o talles en poder de la revendedora**: cuando la revendedora busca o escanea un SKU que tiene más de una unidad en su stock (distintos talles o varias unidades del mismo talle), ¿la UI muestra un selector para elegir talle/unidad o toma automáticamente la primera unidad en su poder que no esté aún en el carrito?
6. **Campo de nota/observación en el modal**: ¿el modal de venta incluye un campo opcional de nota/observación (como tenía la declaración) o se omite para mantener el flujo móvil lo más corto posible?
7. **Fórmula de `porcentaje_comision_preview` al vender**: ¿confirmás que `sp_registrar_venta_revendedora` sigue usando `fn_resolver_comision(v_revendedora_id, fn_hoy_tenant(), 0, 'revendedora')` (idéntico a `sp_registrar_venta`) sin alterar `specs/golden.md`?
