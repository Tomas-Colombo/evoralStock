# Spec — portal-revendedor-filtros / Portal Revendedora (`/mi-cuenta`)

**Change**: `portal-revendedor-filtros` · **Requisitos**: `REQ-RVP-FIL-01…09` · **Decisiones**: `DR-13` (whitelist de columnas en `rvp_*`)

---

## 1. Requisitos

### REQ-RVP-FIL-01 — Filtros en URL por pestaña del portal

Todas las pestañas del portal (`/mi-cuenta`) MUST leer y persistir sus filtros en query params de la URL, validados en el Server Component antes de invocar al DAL. Al cambiar cualquier filtro (período, estado o búsqueda), la paginación MUST volver a `pagina=1` (omitiendo `pagina` o reseteándola).

| Pestaña | Ruta | Período (`?desde&hasta`, inclusivos) | Campo fecha SQL | Estado (`?estado=`) | Búsqueda (`?q=`) | Paginación |
| --- | --- | --- | --- | --- | --- | --- |
| Resumen | `/mi-cuenta` | Sí | `(v.fecha at time zone v_zona)::date`, `(cv.created_at at time zone v_zona)::date`, `lr.fecha_liquidacion` | No | No | No |
| Mi stock | `/mi-cuenta/stock` | No (ver D2 y §1.1) | — | `todos` \| `con_pendiente` \| `sin_declaracion` | Nombre (`p.nombre`) / SKU (`p.sku`) | `?pagina=` |
| Mis ventas | `/mi-cuenta/ventas` | Sí | `(v.fecha at time zone v_zona)::date` | `todos` \| `liquidada` \| `pendiente` | Descripción (`p.nombre`) | `?pagina=` |
| Liquidaciones | `/mi-cuenta/liquidaciones` | Sí | `lr.fecha_liquidacion` | `todos` \| `pendiente` \| `pagada` | No | `?pagina=` |
| Declaraciones | `/mi-cuenta/declaraciones` | Sí | `dvr.fecha` | `todos` \| `pendiente` \| `confirmada` \| `rechazada` \| `retirada` | Nombre (`p.nombre`) / SKU (`p.sku`) | `?pagina=` |

- **Feliz**: Dado un usuario revendedora autenticado en `/mi-cuenta/ventas?desde=2026-10-01&hasta=2026-10-31&estado=pendiente&q=remera&pagina=2`, cuando carga la página, ve solo sus ventas pendientes de liquidar en octubre cuya descripción contiene `"remera"`, paginadas en la página 2.
- **N1**: Parámetros de URL inválidos (`desde=abc`, `estado=cualquiera`, `pagina=-5`) → el Server Component los sanea a sus valores por defecto (sin error ni crash); si `hasta < desde`, se corrige `hasta = desde`.
- **N2**: Otro tenant o revendedora B → ve 0 filas ajenas; los filtros siempre se aplican con `AND` sobre `auth_tenant_id()` y `auth_revendedora_id()`.
- **N3**: Módulo `revendedoras` apagado → `modulo-revendedoras-deshabilitado`.
- **N4**: Página fuera de rango (RPC devuelve 0 filas y `pagina > 1`) → `redirect()` server-side a `pagina=1` (omitiendo `pagina`) preservando los demás filtros activos, sin consulta auxiliar.

#### 1.1 Evaluación de período en Mi stock (`fecha_entrega`)

No se incluye filtro de período sobre `fecha_entrega` (`cr.periodo_desde`) en `/mi-cuenta/stock` (Decisión D2):
- **Justificación**: `Mi stock` muestra la mercadería *viva actualmente en poder* de la revendedora (`estado_detalle = 'en_poder'`). En el uso diario, la revendedora busca una prenda por nombre o SKU para declararla vendida, sin recordar cuándo la recibió; ocultar prendas entregadas en meses anteriores puede inducirla a creer que no las tiene en stock.

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

El escape de comodines (`\`, `%`, `_`) se realiza en el DAL con `escaparPatronLike` (`lib/inventario/codigo.ts`), cuyo carácter de escape es `\` (Decisión D4).

- **Feliz**: Buscar `"50%_off"` encuentra solo productos cuyo nombre o SKU contiene literalmente `"50%_off"`.
- **N1**: `p_busqueda` con `'%'`, `'_'`, `'\'` no actúa como wildcard ni rompe la sintaxis SQL.
- **N2**: Búsqueda coincidente con productos de otro tenant o en poder de otra revendedora → 0 filas ajenas.

---

### REQ-RVP-FIL-05 — Rangos inclusivos `date` con zona horaria del tenant y límite de paginación

- Siguiendo el patrón de `rf_finanzas_resultados` (`00156_cpc_item_venta_devolucion_costo.sql:4730`), las funciones con filtro de período reciben `p_desde date default null, p_hasta date default null` (ambos **inclusivos**).
- En `rvp_mi_cuenta` y `rvp_mis_ventas`, se resuelve `select zona_horaria into v_zona from tenant where id_tenant = v_tenant;` y las columnas `timestamptz` (`v.fecha`, `cv.created_at`) se comparan como `(col at time zone v_zona)::date >= p_desde` y `(col at time zone v_zona)::date <= p_hasta` (evaluando cada extremo solo si el parámetro no es `NULL`).
- En `rvp_mi_cuenta`, `rvp_mis_liquidaciones` y `rvp_mis_declaraciones`, las columnas que ya son `date` (`lr.fecha_liquidacion`, `dvr.fecha`) se comparan directo (`campo >= p_desde`, `campo <= p_hasta`), sin conversión de zona.
- `inicioDelDia` de `lib/fechas.ts` no se usa acá porque devuelve un string sin offset (`YYYY-MM-DDT00:00:00`) que la función SQL interpreta en UTC.
- Se mantiene el tope `v_limit := greatest(1, least(coalesce(p_limit, 50), 200))` y `v_offset := greatest(0, coalesce(p_offset, 0))` en las 4 funciones de lista, con `PAGE_SIZE = 50` en la UI (Decisión D5).

---

### REQ-RVP-FIL-06 — Total de filas (`total_filas`) para paginar y encabezado

Las 4 funciones de lista (`rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`) MUST devolver `count(*) over()::bigint as total_filas` en cada fila.

- **Justificación**: Es el patrón ya usado en `PanelRevendedoraRow.total_filas` (`lib/types/revendedoras.ts`), evita una segunda llamada RPC por página y garantiza consistencia en un solo snapshot transaccional. El encabezado de cada pestaña pasa de mostrar `items.length` (filas de la página actual) a mostrar `total` (`total_filas`).
- **Página fuera de rango**: Si el RPC devuelve 0 filas y `pagina > 1`, la page hace `redirect()` a `pagina=1` conservando los demás filtros activos, sin consulta auxiliar.

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
| `total_vendido` (en `rvp_mi_cuenta`) | `(v.fecha at time zone v_zona)::date` para ventas; `(cv.created_at at time zone v_zona)::date` para diferencias de `cambio_venta` (igual que `rf_finanzas_resultados`, `00156:4744`) | Suma de `dv.precio_venta` de ventas `registrada` no cambiadas + diferencias de `cambio_venta` con `origen = 'revendedora'` | `rvp_mi_cuenta` |
| `comision_estimada` (en `rvp_mi_cuenta`) | `(v.fecha at time zone v_zona)::date` | Suma de `round(dv.porcentaje_comision_preview * dv.precio_venta / 100.0, 2)` cuando `dv.id_liquidacion is null` | `rvp_mi_cuenta` |
| `comision_liquidada` (en `rvp_mi_cuenta`) | `lr.fecha_liquidacion` (`date`, comparación directa) | Suma de `lr.monto_comision` de liquidaciones cuyo `fecha_liquidacion` cae en el rango | `rvp_mi_cuenta` |
| `total_adeudado`, `total_pagado`, `monto_en_poder`, `piezas_en_poder` | Sin filtro (foto actual) | Invariantes respecto a `p_desde` / `p_hasta` | `rvp_mi_cuenta` |

*Nota sobre `specs/golden.md`*: No cambia ninguna fórmula ni definición de cifra histórica; únicamente se acotan `total_vendido`, `comision_liquidada` y `comision_estimada` por rango de fechas cuando `p_desde` / `p_hasta` no son `NULL`.

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
   - **Filtros de período en `rvp_mi_cuenta`**: verificar rango inclusivo `[p_desde, p_hasta]` con zona horaria del tenant sobre `total_vendido`, `comision_liquidada` y `comision_estimada`, y confirmar que `piezas_en_poder`, `monto_en_poder`, `total_adeudado`, `total_pagado`, `declaraciones_pendientes` y `porcentaje_comision_actual` NO varían.
   - **Filtros combinados en listas (`rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`)**: período inclusivo, `p_estado` válido, `p_busqueda` con caracteres especiales (`%`, `_`, `\`), y `total_filas` independiente de `p_limit`/`p_offset`.
   - **Whitelist de `p_estado`**: pasar un valor inválido a cada una de las 4 funciones de lista y verificar error `estado-filtro-invalido`.
   - **Aislamiento con filtros**: búsqueda/estado/período nunca devuelven filas de otra revendedora del mismo tenant ni de otro tenant.

---

## 5. Migraciones

- **Número**: siguiente número libre al momento de aplicar (`ls supabase/migrations | tail -1`; al escribir esta spec, la última es `00167_costo_por_peso.sql`, por lo que corresponde **`00168_rvp_filtros.sql`**).
- **Partir de `pnpm sp:last`** de cada una de las 5 funciones (`rvp_mi_cuenta`, `rvp_mi_stock`, `rvp_mis_ventas`, `rvp_mis_liquidaciones`, `rvp_mis_declaraciones`).
- **Firmas nuevas (todos los nuevos parámetros con `DEFAULT NULL` al final)**:
  - `rvp_mi_cuenta(p_desde date default null, p_hasta date default null)`
  - `rvp_mi_stock(p_limit integer default 50, p_offset integer default 0, p_estado text default null, p_busqueda text default null)`
  - `rvp_mis_ventas(p_limit integer default 50, p_offset integer default 0, p_desde date default null, p_hasta date default null, p_estado text default null, p_busqueda text default null)`
  - `rvp_mis_liquidaciones(p_limit integer default 50, p_offset integer default 0, p_desde date default null, p_hasta date default null, p_estado text default null)`
  - `rvp_mis_declaraciones(p_limit integer default 50, p_offset integer default 0, p_desde date default null, p_hasta date default null, p_estado text default null, p_busqueda text default null)`
- **`DROP FUNCTION IF EXISTS`** de las firmas anteriores (`rvp_mi_cuenta()`, `rvp_mi_stock(integer, integer)`, `rvp_mis_ventas(integer, integer)`, `rvp_mis_liquidaciones(integer, integer)`, `rvp_mis_declaraciones(integer, integer)`) antes de recrear cada una, para evitar sobrecargas ambiguas (patrón `00047`).
- **`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO authenticated;`** con la firma nueva en cada una (patrón `00106:177`).
- **Bloque `-- DOWN:`**: va **al final** del archivo de migración (como `00167_costo_por_peso.sql`), ejecutable, restaurando las 5 firmas y definiciones previas (con `DROP FUNCTION IF EXISTS` de las firmas nuevas + `REVOKE/GRANT` de las anteriores), verificado con `pnpm gate:db`.

---

## 6. Capas TypeScript, ubicación del código y Ayuda

### 6.1 Capas TS

- **Pages (`app/(revendedora)/mi-cuenta/**/page.tsx`)**:
  - Siguen el patrón de `app/(app)/ventas/page.tsx`: leen `await props.searchParams`, validan fechas con `esFechaValida` (`lib/fechas.ts`), corrigen `hasta < desde` (`hasta = desde`), validan `estado` contra el catálogo permitido de cada pestaña (basura → default), parsean `pagina` (`>= 1`), acotan `q` (`trim().slice(0, 100)`), y pasan `desde` y `hasta` directamente como strings `'YYYY-MM-DD'` (o `undefined` si no vinieron en la URL), **sin** `inicioDelDia` ni `inicioDelDiaSiguiente`.
  - Si `rows.length === 0 && pagina > 1`, hacen `redirect()` a `pagina=1` preservando los demás filtros activos.
- **DAL (`lib/dal/revendedoras/portal.ts`)**:
  - Solo reenvía parámetros tipados a `supabase.rpc(...)`, escapando `q` con `escaparPatronLike` antes de enviarlo en `p_busqueda`.
  - Las 4 funciones de lista devuelven `{ ok: true; data: { rows: ...[]; total: number } }` leyendo `total_filas` de la primera fila (`0` si vacío).
  - Agrega `'estado-filtro-invalido'` a `REGLAS_SLUG`.
- **UI**:
  - `FiltroPeriodo` (con `extras` para el `<Select>` de estado en Ventas, Liquidaciones y Declaraciones; sin `extras` en Resumen).
  - `FilterBar` para búsqueda de texto (`?q=`) en Stock, Ventas y Declaraciones, con debounce y `router.push` que resetea `pagina` a `1`.
  - Componente de paginación del portal (`PAGE_SIZE = 50`) que preserva los query params activos al cambiar de página.

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

## 7. Decisiones, riesgos y preguntas abiertas

### Decisiones
- **D1 — Período por defecto**: Sin `?desde&hasta` se muestra el histórico completo (`null` en SQL), tanto en Resumen como en las listas. Motivo: hoy el portal muestra todo; usar `mesActual()` cambiaría cifras que la revendedora ya conoce.
- **D2 — Mi stock sin período**: Queda sin filtro de período sobre `fecha_entrega` (`cr.periodo_desde`) por la justificación de §1.1.
- **D3 — Imputación de cifras en `rvp_mi_cuenta`**: Las diferencias de `cambio_venta` se imputan por `(cv.created_at at time zone v_zona)::date`, igual que `rf_finanzas_resultados` (`00156:4744`), para que el portal y los reportes del local den la misma cifra. `comision_estimada` y `total_vendido` (ventas) se imputan por `(v.fecha at time zone v_zona)::date`; `comision_liquidada` se imputa por `lr.fecha_liquidacion`.
- **D4 — Escape `ILIKE`**: Se hace solo en el DAL con `escaparPatronLike` (carácter de escape `\`), y en SQL va `ILIKE ... ESCAPE '\'`. Motivo: una llamada RPC directa sin escapar solo agrega comodines sobre las filas propias; el filtro de identidad sigue intacto.
- **D5 — Tamaño de página**: `PAGE_SIZE = 50` (default SQL y `/ventas`).
- **D6 — Query param de búsqueda**: `?q=` (consistente con `clientes` e `inventario`).

### Riesgos
1. **Contrato de `rvp_mi_stock` y `rvp_mis_declaraciones` sin `sku`**: actualmente `portal.ts` intenta leer `r.sku`, que no viene del RPC. Debe agregarse `sku` al `RETURNS TABLE` en la migración.

### Preguntas abiertas
Ninguna.
