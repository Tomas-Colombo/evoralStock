# Spec — portal-revendedor-filtros / Portal Revendedora (`/mi-cuenta`)

**Change**: `portal-revendedor-filtros` · **Requisitos**: `REQ-RVP-FIL-01…09` · **Decisiones**: `DR-13` (whitelist de columnas en `rvp_*`)

---

## 1. Requisitos

### REQ-RVP-FIL-01 — Filtros en URL por pestaña del portal

Todas las pestañas del portal (`/mi-cuenta`) MUST leer y persistir sus filtros en query params de la URL, validados en el Server Component antes de invocar al DAL. Al cambiar cualquier filtro (período, estado o búsqueda), la paginación MUST volver a `pagina=1` (omitiendo `pagina` o reseteándola).

| Pestaña | Ruta | Período (`?desde&hasta`) | Campo fecha SQL | Estado (`?estado=`) | Búsqueda (`?q=` o `?busqueda=`) | Paginación |
| --- | --- | --- | --- | --- | --- | --- |
| Resumen | `/mi-cuenta` | Sí | `v.fecha` / `lr.fecha_liquidacion` | No | No | No |
| Mi stock | `/mi-cuenta/stock` | No (ver evaluación §1.1) | — | `todos` \| `con_pendiente` \| `sin_declaracion` | Nombre (`p.nombre`) / SKU (`p.sku`) | `?pagina=` |
| Mis ventas | `/mi-cuenta/ventas` | Sí | `v.fecha` | `todos` \| `liquidada` \| `pendiente` | Descripción (`p.nombre`) | `?pagina=` |
| Liquidaciones | `/mi-cuenta/liquidaciones` | Sí | `lr.fecha_liquidacion` | `todos` \| `pendiente` \| `pagada` | No | `?pagina=` |
| Declaraciones | `/mi-cuenta/declaraciones` | Sí | `dvr.fecha` | `todos` \| `pendiente` \| `confirmada` \| `rechazada` \| `retirada` | Nombre (`p.nombre`) / SKU (`p.sku`) | `?pagina=` |

- **Feliz**: Dado un usuario revendedora autenticado en `/mi-cuenta/ventas?desde=2026-10-01&hasta=2026-10-31&estado=pendiente&q=remera&pagina=2`, cuando carga la página, ve solo sus ventas pendientes de liquidar en octubre cuya descripción contiene `"remera"`, paginadas en la página 2.
- **N1**: Parámetros de URL inválidos (`desde=abc`, `estado=cualquiera`, `pagina=-5`) → el Server Component los sanea a sus valores por defecto (sin error ni crash); si `hasta < desde`, se corrige `hasta = desde`.
- **N2**: Otro tenant o revendedora B → ve 0 filas ajenas; los filtros siempre se aplican con `AND` sobre `auth_tenant_id()` y `auth_revendedora_id()`.
- **N3**: Módulo `revendedoras` apagado → `modulo-revendedoras-deshabilitado`.
- **N4**: `?pagina=` mayor que la última página real cuando `total > 0` → `redirect()` server-side a la última página válida preservando los filtros activos.

#### 1.1 Evaluación de período en Mi stock (`fecha_entrega`)

Se evalúa **no incluir** filtro de período sobre `fecha_entrega` (`cr.periodo_desde`) en `/mi-cuenta/stock`:
- **Justificación**: `Mi stock` muestra la mercadería *viva actualmente en poder* de la revendedora (`estado_detalle = 'en_poder'`). En el uso diario, la revendedora busca una prenda por nombre o SKU para declararla vendida, sin recordar cuándo la recibió; ocultar prendas entregadas en meses anteriores puede inducirla a creer que no las tiene en stock.
- Queda listado como **pregunta abierta** (§7) por si se prefiere habilitarlo para auditar consignaciones antiguas.

---

### REQ-RVP-FIL-02 — Resumen (`/mi-cuenta`): período solo sobre métricas devengadas/del período

En `/mi-cuenta`, el filtro `?desde&hasta` MUST afectar **únicamente** a:
- `total_vendido`
- `comision_liquidada`
- `comision_estimada`

Las siguientes métricas son **fotos del momento** y MUST NOT verse afectadas por `?desde&hasta`:
- `piezas_en_poder` y `valor_en_poder` (`monto_en_poder`)
- `total_adeudado` (Saldo a rendir al local)
- `total_pagado`
- `porcentaje_comision_actual` y `proximo_tramo_comision` (Comisión vigente: `fn_resolver_comision` sigue recibiendo el vendido vigente/histórico, nunca el filtrado)
- `declaraciones_pendientes`

La UI MUST rotular claramente qué tarjetas responden al período activo y cuáles muestran el estado actual (por ejemplo, badge o subtítulo `"Del período"` vs `"Estado actual"`).

- **Feliz**: Al filtrar `?desde=2026-10-01&hasta=2026-10-31`, cambian `total_vendido`, `comision_liquidada` y `comision_estimada`; `piezas_en_poder`, `valor_en_poder`, `total_adeudado`, `total_pagado`, `porcentaje_comision_actual` y `declaraciones_pendientes` permanecen idénticos al estado sin filtro.
- **N1**: Rango sin ventas ni liquidaciones → los 3 KPIs filtrados devuelven `0`; las fotos del momento conservan sus valores reales.
- **N2**: Otra revendedora / otro tenant → 0 impacto cruzado.
- **N3**: Módulo apagado → `modulo-revendedoras-deshabilitado`.

---

### REQ-RVP-FIL-03 — Whitelist de `p_estado` en SQL

Cada función de listado (`rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`) MUST validar `p_estado` contra su lista blanca propia antes de ejecutar la consulta:

- `rvp_mi_stock`: `null` | `'con_pendiente'` | `'sin_declaracion'`
- `rvp_mis_ventas`: `null` | `'liquidada'` | `'pendiente'`
- `rvp_mis_liquidaciones`: `null` | `'pendiente'` | `'pagada'`
- `rvp_mis_declaraciones`: `null` | `'pendiente'` | `'confirmada'` | `'rechazada'` | `'retirada'`

- **Feliz**: `p_estado` nulo o dentro de la whitelist de esa función → filtra correctamente.
- **N1**: `p_estado` desconocido (ej. `'hack'`, `'pagada'` en `rvp_mis_ventas`) → lanza excepción `'estado-filtro-invalido'` (`errcode = '22023'`).
- **N2**: El error `'estado-filtro-invalido'` MUST estar registrado en `lib/errores/mensajes.ts`, en `lib/errores/mensajes.test.ts` y en `REGLAS_SLUG` de `lib/dal/revendedoras/portal.ts`.

---

### REQ-RVP-FIL-04 — Búsqueda segura sin SQL dinámico

`rvp_mi_stock`, `rvp_mis_ventas` y `rvp_mis_declaraciones` MUST filtrar `p_busqueda` usando `ILIKE ... ESCAPE '\'` sin `EXECUTE` ni `format(...)`:
- `rvp_mi_stock`: `(p.nombre ilike v_patron escape '\' or p.sku ilike v_patron escape '\')`
- `rvp_mis_ventas`: `p.nombre ilike v_patron escape '\'`
- `rvp_mis_declaraciones`: `(p.nombre ilike v_patron escape '\' or p.sku ilike v_patron escape '\')`
- Además, `rvp_mi_stock` y `rvp_mis_declaraciones` MUST proyectar `p.sku` en su `RETURNS TABLE` (hoy `portal.ts` mapea `r.sku ?? ''`, pero la columna no existe en la firma SQL vigente).

**Decisión de escape**: Se propone escapar caracteres especiales (`\`, `%`, `_`) en el **DAL** usando `escaparPatronLike` (`lib/inventario/codigo.ts`) antes de enviar `p_busqueda` al RPC, manteniendo el código único en el proyecto. (Alternativa en §7: escapar también/en su lugar dentro de SQL para cubrir llamadas RPC directas).

- **Feliz**: Buscar `"50%_off"` encuentra solo productos cuyo nombre o SKU contiene literalmente `"50%_off"`.
- **N1**: `p_busqueda` con `'%'`, `'_'`, `'\'` no actúa como wildcard ni rompe la sintaxis SQL.
- **N2**: Búsqueda coincidente con productos de otro tenant o en poder de otra revendedora → 0 filas ajenas.

---

### REQ-RVP-FIL-05 — Rangos semiabiertos y límite de paginación

- Todos los filtros de fecha MUST usar rango semiabierto: `campo >= p_desde AND campo < p_hasta_exclusivo` (evaluando cada extremo solo si el parámetro no es `NULL`).
- Se mantiene el tope `v_limit := greatest(1, least(coalesce(p_limit, 50), 200))` y `v_offset := greatest(0, coalesce(p_offset, 0))` en las 4 funciones de lista.

---

### REQ-RVP-FIL-06 — Total de filas (`total_filas`) para paginar y encabezado

Las 4 funciones de lista (`rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`) MUST devolver `count(*) over()::bigint as total_filas` en cada fila.

- **Justificación**: Es el patrón ya usado en `PanelRevendedoraRow.total_filas` (`lib/types/revendedoras.ts`), evita una segunda llamada RPC por página y garantiza consistencia en un solo snapshot transaccional. El encabezado de cada pestaña pasa de mostrar `items.length` (filas de la página actual) a mostrar `total` (`total_filas`).
- **Trade-off**: Si `offset >= total` (página fuera de rango), el RPC retorna 0 filas y `total` resulta `0` en el DAL. Para que el redirect a la última página funcione si alguien pide `?pagina=999`, se asume flujo normal desde UI (donde los filtros resetean a `pagina=1`) o se evalúa si hace falta consulta auxiliar (ver §7).

---

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `rvp_mi_cuenta` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist de columnas | `modulo-revendedoras-deshabilitado` | 0 filas / `no-revendedora` |
| `rvp_mi_stock` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist + `sku` + `total_filas` | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mis_ventas` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist + `total_filas` | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mis_liquidaciones` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist + `total_filas` | `modulo-revendedoras-deshabilitado` | 0 filas |
| `rvp_mis_declaraciones` | `no-revendedora` | `no-revendedora` | solo lo suyo, whitelist + `sku` + `total_filas` | `modulo-revendedoras-deshabilitado` | 0 filas |

---

## 3. Cifras financieras

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
| --- | --- | --- | --- |
| `total_vendido` (en `rvp_mi_cuenta`) | `v.fecha` (`timestamptz`) | Suma de `dv.precio_venta` de ventas `registrada` no cambiadas + diferencias de `cambio_venta` (ver §7 sobre fecha de imputación de cambios) | `rvp_mi_cuenta` |
| `comision_estimada` (en `rvp_mi_cuenta`) | `v.fecha` (`timestamptz`) | Suma de `round(dv.porcentaje_comision_preview * dv.precio_venta / 100.0, 2)` cuando `dv.id_liquidacion is null` | `rvp_mi_cuenta` |
| `comision_liquidada` (en `rvp_mi_cuenta`) | `lr.fecha_liquidacion` (`date`) | Suma de `lr.monto_comision` de liquidaciones cuyo `fecha_liquidacion` cae en el rango | `rvp_mi_cuenta` |
| `total_adeudado`, `total_pagado`, `monto_en_poder`, `piezas_en_poder` | Sin filtro (foto actual) | Invariantes respecto a `p_desde` / `p_hasta_exclusivo` | `rvp_mi_cuenta` |

*Nota sobre `specs/golden.md`*: No cambia ninguna fórmula ni definición de cifra histórica; únicamente se acotan `total_vendido`, `comision_liquidada` y `comision_estimada` por rango de fechas cuando `p_desde` / `p_hasta_exclusivo` no son `NULL`.

---

## 4. INVOKER contra RLS restrictiva

Las 5 funciones `rvp_*` permanecen **`SECURITY DEFINER`** con `set search_path = public, pg_temp` (DR-13):
- Identidad obtenida exclusivamente de `auth_tenant_id()` y `auth_revendedora_id()`, nunca por parámetro.
- Whitelist estricta de columnas sin exponer costos, márgenes ni proveedores.
- Cubiertas por `tests/db/rvp-lecturas.test.ts`.

### Cambios requeridos en `tests/db/rvp-lecturas.test.ts`

1. **Test existente modificado — `1. Snapshot por función`**:
   - Actualizar los arrays esperados de `stockKeys`, `ventasKeys`, `liqKeys` y `decKeys` para incluir `'total_filas'` (y `'sku'` en `stockKeys` y `decKeys`).
2. **Tests nuevos a agregar**:
   - **Filtros de período en `rvp_mi_cuenta`**: verificar rango semiabierto `[p_desde, p_hasta_exclusivo)` sobre `total_vendido`, `comision_liquidada` y `comision_estimada`, y confirmar que `piezas_en_poder`, `monto_en_poder`, `total_adeudado`, `total_pagado`, `declaraciones_pendientes` y `porcentaje_comision_actual` NO varían.
   - **Filtros combinados en listas (`rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`)**: período semiabierto, `p_estado` válido, `p_busqueda` con caracteres especiales (`%`, `_`, `\`), y `total_filas` independiente de `p_limit`/`p_offset`.
   - **Whitelist de `p_estado`**: pasar un valor inválido a cada una de las 4 funciones de lista y verificar error `estado-filtro-invalido`.
   - **Aislamiento con filtros**: búsqueda/estado/período nunca devuelven filas de otra revendedora del mismo tenant ni de otro tenant.

---

## 5. Migraciones

- **Número**: siguiente número libre al momento de aplicar (`ls supabase/migrations | tail -1`; al escribir esta spec, la última es `00167_costo_por_peso.sql`, por lo que corresponde **`00168_rvp_filtros.sql`**).
- **Partir de `pnpm sp:last`** de cada una de las 5 funciones (`rvp_mi_cuenta`, `rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`).
- **Firmas nuevas (todos los nuevos parámetros con `DEFAULT NULL` al final)**:
  - `rvp_mi_cuenta(p_desde timestamptz default null, p_hasta_exclusivo timestamptz default null)`
  - `rvp_mi_stock(p_limit integer default 50, p_offset integer default 0, p_estado text default null, p_busqueda text default null)`
  - `rvp_mis_ventas(p_limit integer default 50, p_offset integer default 0, p_desde timestamptz default null, p_hasta_exclusivo timestamptz default null, p_estado text default null, p_busqueda text default null)`
  - `rvp_mis_liquidaciones(p_limit integer default 50, p_offset integer default 0, p_desde date default null, p_hasta_exclusivo date default null, p_estado text default null)`
  - `rvp_mis_declaraciones(p_limit integer default 50, p_offset integer default 0, p_desde date default null, p_hasta_exclusivo date default null, p_estado text default null, p_busqueda text default null)`
- **`DROP FUNCTION IF EXISTS`** de las firmas anteriores (`rvp_mi_cuenta()`, `rvp_mi_stock(integer, integer)`, `rvp_mis_ventas(integer, integer)`, `rvp_mis_liquidaciones(integer, integer)`, `rvp_mis_declaraciones(integer, integer)`) antes de recrear cada una, para evitar sobrecargas ambiguas (patrón `00047`).
- **`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO authenticated;`** con la firma nueva en cada una (patrón `00106:177`).
- **Bloque `-- DOWN:`** ejecutable al inicio del archivo restaurando las 5 firmas y definiciones previas (con `DROP FUNCTION IF EXISTS` de las firmas nuevas + `REVOKE/GRANT` de las anteriores), verificado con `pnpm gate:db`.

---

## 6. Capas TypeScript, ubicación del código y Ayuda

### 6.1 Capas TS

- **Pages (`app/(revendedora)/mi-cuenta/**/page.tsx`)**:
  - Siguen el patrón de `app/(app)/ventas/page.tsx`: leen `await props.searchParams`, validan fechas con `esFechaValida` (`lib/fechas.ts`), corrigen `hasta < desde` (`hasta = desde`), validan `estado` contra el catálogo permitido de cada pestaña (basura → default), parsean `pagina` (`>= 1`), acotan `q` (`trim().slice(0, 100)`), y convierten el período a `{ desde: inicioDelDia(desde), hastaExclusivo: inicioDelDiaSiguiente(hasta) }` (o `date` para liquidaciones/declaraciones).
  - Redireccionan si `pagina > ultimaPagina && total > 0`.
- **DAL (`lib/dal/revendedoras/portal.ts`)**:
  - Solo reenvía parámetros tipados a `supabase.rpc(...)`.
  - Las 4 funciones de lista devuelven `{ ok: true; data: { rows: ...[]; total: number } }` (o equivalente) leyendo `total_filas` de la primera fila (`0` si vacío).
  - Agrega `'estado-filtro-invalido'` a `REGLAS_SLUG`.
- **UI**:
  - `FiltroPeriodo` (con `extras` para el `<Select>` de estado en Ventas, Liquidaciones y Declaraciones; sin `extras` en Resumen).
  - `FilterBar` para búsqueda de texto en Stock, Ventas y Declaraciones, con debounce y `router.push` que resetea `pagina` a `1`.
  - Componente de paginación del portal que preserva los query params activos al cambiar de página.

### 6.2 Ubicación del código (`tests/arquitectura-imports.test.ts`)

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `app/(revendedora)/mi-cuenta/PortalPaginacion.tsx` | `stock`, `ventas`, `liquidaciones`, `declaraciones` | Compartido solo dentro del portal `/mi-cuenta`; no sale a `components/`. |
| `app/(revendedora)/mi-cuenta/PortalBusqueda.tsx` | `stock`, `ventas`, `declaraciones` | Wrapper cliente de `FilterBar` + `router.push` exclusivo del portal. |
| `app/(revendedora)/mi-cuenta/ventas/VentasRevendedoraView.tsx` | `app/(revendedora)/mi-cuenta/ventas/page.tsx` | Solo lo consume la pestaña Ventas del portal. |
| `app/(revendedora)/mi-cuenta/liquidaciones/LiquidacionesRevendedoraView.tsx` | `app/(revendedora)/mi-cuenta/liquidaciones/page.tsx` | Solo lo consume la pestaña Liquidaciones del portal. |
| `lib/dal/revendedoras/portal.ts` (modificado) | Pages de `app/(revendedora)/mi-cuenta/` | DAL existente del portal. |
| `lib/types/revendedoras.ts` (modificado) | DAL y vistas del portal | Tipos compartidos del dominio revendedoras. |
| `lib/errores/mensajes.ts` + `mensajes.test.ts` (modificado) | Portal y tests | Catálogo único de slugs de error (`estado-filtro-invalido`). |

### 6.3 Ayuda (`lib/ayuda/guia/` y `cobertura.test.ts`)

- **Sin cambios**: `lib/ayuda/guia/cobertura.test.ts` solo inspecciona rutas estáticas bajo `app/(app)/` (no `app/(revendedora)/`). Además, el asistente de ayuda (`ayuda.consultar`) rechaza sesiones de revendedora en `app/api/ayuda/chat/compuertas.ts`. No corresponde agregar entradas de `/mi-cuenta` en `lib/ayuda/guia/revendedoras.ts`.

---

## 7. Riesgos y preguntas abiertas

### Riesgos
1. **Desfase de huso horario en `rvp_mi_cuenta` al comparar `date` vs `timestamptz`**: `venta.fecha` es `timestamptz` mientras `liquidacion_revendedora.fecha_liquidacion` es `date`. Si `rvp_mi_cuenta` recibe `p_desde`/`p_hasta_exclusivo` como `timestamptz` con offset local (ej. `-03:00`), un cast directo `p_desde::date` en Postgres (UTC) podría correr el día. Conviene pasar además o derivar la fecha en la zona del tenant (`fn_zona_horaria_tenant()` / `p_desde_fecha date`), o validar explícitamente la conversión.
2. **`count(*) over()` en página fuera de rango (`offset >= total`)**: devuelve 0 filas, por lo que `total_filas` no está disponible para calcular `ultimaPagina` y hacer `redirect()`.
3. **Contrato de `rvp_mi_stock` y `rvp_mis_declaraciones` sin `sku`**: actualmente `portal.ts` intenta leer `r.sku`, que no viene del RPC. Debe agregarse `sku` al `RETURNS TABLE` en la migración.

### Preguntas abiertas (para decisión)
1. **Período por defecto al entrar sin query params**: ¿En Resumen y en las listas (Ventas, Liquidaciones, Declaraciones) sin `?desde&hasta` se muestra todo el histórico (`null` en SQL) o `mesActual()` como en `/ventas`?
2. **Período en `Mi stock`**: ¿Confirmamos dejarlo **sin** filtro de período sobre `fecha_entrega` (`cr.periodo_desde`), o preferís incluirlo?
3. **Imputación temporal de `cambio_venta` en `rvp_mi_cuenta`**: Al filtrar `total_vendido` por período, ¿las diferencias de `cambio_venta` se imputan por `cv.created_at` (fecha del cambio) o por `v.fecha` (fecha de la venta original)?
4. **Lugar del escape `ILIKE`**: ¿Escapamos en el DAL con `escaparPatronLike` (como `lib/dal/plataforma/index.ts`), o dentro de la función SQL para proteger también llamadas RPC directas?
5. **Tamaño de página (`PAGE_SIZE`)**: ¿Estandarizamos en `50` (como `/ventas` y el default SQL) o mantenemos `100` (como pasan hoy las 4 pages del portal)?
6. **Nombre del query param de búsqueda**: ¿Usamos `?q=` (convención de `lib/dal/plataforma`) o `?busqueda=`?
