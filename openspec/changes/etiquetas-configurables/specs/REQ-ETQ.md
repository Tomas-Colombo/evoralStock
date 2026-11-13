# Spec — etiquetas-configurables / identificación, plantillas e impresión

**Change**: `etiquetas-configurables` · **Requisitos**: `REQ-ETQ-01…08` · **Decisiones**: `D-ETQ-01…05` (en `proposal.md`)

## 1. Requisitos

### REQ-ETQ-01 — Método de identificación del tenant

El tenant MUST tener exactamente un método de identificación activo, elegido del
catálogo `SIMBOLOGIAS` (`lib/etiquetas/simbologias.ts`): `qr`, `datamatrix`,
`code128`, `ean13`. Sin fila en `etiqueta_config`, el método es `qr`, que es el
comportamiento de hoy. Agregar una simbología MUST ser una entrada en el catálogo
más el `check` de la columna, y un test MUST verificar que los dos coinciden.

- **Feliz**: admin con `administracion.editar` elige `ean13` → la ficha del ítem y
  las etiquetas nuevas muestran el EAN-13 de `codigo_ean`.
- **N1**: sin `administracion.editar` → `no-permission`.
- **N2**: simbología fuera del catálogo → `etiqueta-config-invalida` (zod en la
  Action y `check` en la tabla).
- **N3**: otro tenant → `sp_set_etiqueta_config` solo escribe la fila de
  `auth_tenant_id()`; el SELECT ajeno devuelve 0 filas.
- **N4**: dos guardados seguidos → upsert idempotente; queda una sola fila por tenant.

### REQ-ETQ-02 — Código EAN interno por unidad

Toda fila de `item_producto` MUST tener `codigo_ean`: 13 dígitos, prefijo `20`,
contador de 10 dígitos por tenant y dígito verificador GS1 válido. Es único por
`(id_tenant, codigo_ean)`. Lo asigna el trigger `before insert` cuando viene null.
Es inmutable: un `update` que lo cambie MUST fallar.

- **Feliz**: `sp_confirmar_ingreso` crea 3 ítems → reciben 3 EAN correlativos válidos.
- **N1**: dos inserts concurrentes del mismo tenant → EAN distintos (el contador
  se bloquea con `insert … on conflict do update … returning`).
- **N2**: dos tenants → contadores independientes; el mismo EAN puede existir en
  ambos sin chocar.
- **N3**: `update item_producto set codigo_ean = …` → `codigo-ean-inmutable`.
- **N4**: ítems anteriores a la migración → todos tienen EAN después del backfill,
  y el contador del tenant queda en el máximo asignado.
- **N5**: insert de un rol sin permiso de alta de stock → lo rechaza la policy de
  `item_producto`, antes de tocar el contador.

### REQ-ETQ-03 — Plantillas de etiqueta

El tenant MUST poder tener de 1 a `PLANTILLAS_MAX` (20) plantillas. Cada una
tiene: nombre (1–40 caracteres, sin espacios al borde, único por tenant sin
distinguir mayúsculas), `ancho_mm` (15–300), `alto_mm` (10–300) y campos visibles
(`mostrar_nombre`, `mostrar_talle`, `mostrar_sku`, `mostrar_texto_codigo`). Hay
exactamente una predeterminada por tenant, asegurada con un índice único parcial.
La primera plantilla creada es la predeterminada.

- **Feliz**: crear "Bijou 25×15" (`administracion.crear`), editarla
  (`administracion.editar`), marcarla predeterminada (`administracion.editar`) y
  borrar otra (`administracion.eliminar`).
- **N1**: actor sin el permiso de cada operación → `no-permission`.
- **N2**: nombre repetido, ignorando mayúsculas → `plantilla-nombre-duplicado`.
- **N3**: medidas fuera de rango → `plantilla-medidas-invalidas`.
- **N4**: borrar la predeterminada → `plantilla-predeterminada-no-se-borra`.
- **N5**: id de otro tenant o inexistente → `plantilla-no-encontrada`, sin
  distinguir entre los dos casos.
- **N6**: crear la número 21 → `plantillas-limite`.

### REQ-ETQ-04 — Perfil de impresora

`etiqueta_config` MUST guardar: `impresora_tipo` (`hoja` | `rollo`), `margen_mm`
(0–20), `separacion_mm` (0–20), `columnas` (null = automático, o 1–10),
`offset_x_mm` y `offset_y_mm` (−10…10). Sin fila, los valores son: hoja,
margen 10, separación 2, columnas null, offsets 0.

- **Feliz hoja**: A4 (210×297) → grilla con tantas columnas como entren, o las
  pedidas si entran.
- **Feliz rollo**: `@page` del tamaño exacto de la plantilla, una etiqueta por
  página, desplazada por los offsets.
- **N1**: sin `administracion.editar` → `no-permission`.
- **N2**: valor fuera de rango → `etiqueta-config-invalida`.
- **N3**: hoja con columnas pedidas que no entran en 210 mm → `layout` devuelve
  `etiqueta-no-entra-en-hoja` y la UI lo muestra (no es error de base).

### REQ-ETQ-05 — Imprimir con selector de plantilla

`/inventario/imprimir-etiquetas` MUST mostrar un `Select` de `components/ui`
con las plantillas del tenant, con la predeterminada elegida. Elegir una cambia
`?plantilla=<uuid>` con `router.replace` y la vista previa se rehace en el
cliente. Cada etiqueta dibuja el código del método del tenant (D-ETQ-01) y los
campos visibles de la plantilla.

- **Feliz**: 40 ítems de un ingreso, plantilla "Remera 40×30" → 40 etiquetas con
  el código del método y la medida exacta.
- **N1**: `?plantilla` no es uuid, o es de otro tenant, o no existe → se usa la
  predeterminada sin mostrar error (no se filtra existencia).
- **N2**: simbología 1D en una plantilla más angosta que el mínimo del catálogo
  (`minAnchoMm`) → aviso `etiqueta-chica-para-codigo` y el botón Imprimir queda
  deshabilitado.
- **N3**: más de `ETIQUETAS_MAX` (200) ítems → se mantiene el paginado actual.
- **N4**: usuario sin `inventario.ver` → no llega (lo frena el `layout`). Las
  plantillas no se leen sin `inventario.ver` ni `administracion.ver` (RLS).

### REQ-ETQ-06 — Cualquier código impreso resuelve

`resolverCodigo` MUST probar en este orden: `qr_code` exacto, después EAN (si es
`^\d{13}$` con dígito verificador válido busca `codigo_ean` del tenant), después
SKU y por último nombre. Los formatos no se pisan: 24 hex, 13 dígitos con
verificador y `^[A-Z]+-\d+`. Las rutas que hoy usan `findItemByQr` directo MUST
pasar por el resolver.

- **Feliz**: tenant que pasó de QR a EAN-13 escanea una etiqueta QR vieja y una
  EAN nueva → los dos resuelven al mismo tipo de ítem.
- **N1**: 13 dígitos con verificador inválido → no se busca como EAN; sigue a SKU
  y nombre, y termina en "no encontrado".
- **N2**: EAN de otro tenant → no encontrado (RLS + filtro por tenant).
- **N3**: lookup de consignaciones y ficha con EAN → resuelven, o redirigen a la
  ficha canónica `/inventario/ficha/<qr_code>`.

### REQ-ETQ-07 — Migración sin pérdida

La migración MUST crear, por cada tenant, una plantilla "Predeterminada" que
reproduzca la impresión actual. Medidas: si había `impresora_ancho_mm`/`alto_mm`,
esos valores con `impresora_tipo = 'rollo'`; si no, las que surgen de
`qr_lado_mm` (o 35) más el texto, según `ImprimirEtiquetasClient.tsx:37-89`, con
`impresora_tipo = 'hoja'`. Después borra las 3 claves `etiquetas` de
`configuracion` y retira `sp_set_configuracion_qr_lado_mm` y
`sp_set_configuracion_impresora`. El DOWN MUST restaurar claves y SP (desde
`pnpm sp:last`).

- **Feliz**: tenant con impresora 50×30 → plantilla 50×30, rollo, predeterminada.
- **N1**: tenant sin configuración → plantilla derivada de 35 mm, hoja.
- **N2**: tenant nuevo provisionado después → `provision-tenant` (o el primer
  acceso a `/administracion`) tiene plantilla predeterminada; la página de
  impresión nunca queda sin plantillas.

### REQ-ETQ-08 — Tablas nuevas cerradas por defecto (alineado con RCD)

`etiqueta_config`, `etiqueta_plantilla` e `item_ean_seq` MUST cumplir:
`id_tenant`, RLS habilitada, permissive tenant, restrictiva de revendedora
(`auth_revendedora_id() is null`), restrictiva por comando con
`auth_tiene_permiso` según §2.2, sin grants ni policies para `anon`/`public`.
Conservan el grant de escritura de `authenticated` porque los SP son INVOKER.

- **N1**: rol solo `gastos` → 0 filas en las tres tablas.
- **N2**: revendedora → 0 filas.
- **N3**: `insert`/`update` directo por PostgREST sin el permiso → `42501` o 0 filas.
- **N4**: `anon` → `42501`.

## 2. Matriz de permisos

### 2.1 Funciones

| Función | Con permiso | Sin permiso | Revendedora | Otro tenant |
| --- | --- | --- | --- | --- |
| `sp_set_etiqueta_config` (`administracion.editar`) | ok | `no-permission` | `no-permission` | solo escribe el propio |
| `sp_crear_etiqueta_plantilla` (`administracion.crear`) | uuid | `no-permission` | `no-permission` | solo el propio |
| `sp_editar_etiqueta_plantilla` (`administracion.editar`) | ok | `no-permission` | `no-permission` | `plantilla-no-encontrada` |
| `sp_marcar_etiqueta_plantilla_predeterminada` (`administracion.editar`) | ok | `no-permission` | `no-permission` | `plantilla-no-encontrada` |
| `sp_eliminar_etiqueta_plantilla` (`administracion.eliminar`) | ok | `no-permission` | `no-permission` | `plantilla-no-encontrada` |
| `fn_asignar_codigo_ean` (trigger, INVOKER) | asigna | lo frena la policy de `item_producto` | — | contador propio |
| `fn_ean13_digito(text)` (immutable, pura) | — | — | — | — |

Módulo apagado: no aplica. `administracion` e `inventario` son núcleo
(verificar en `lib/dal/guard.ts`; si alguno resulta opcional, agregar la columna
`module-disabled` y su test).

### 2.2 Tablas (formato del catálogo RCD)

| Tabla | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `etiqueta_config` | `inventario.ver` O `administracion.ver` O `administracion.editar` | `administracion.editar` | `administracion.editar` | solo DEFINER (nadie) |
| `etiqueta_plantilla` | `inventario.ver` O `administracion.ver` O `administracion.crear` O `administracion.editar` O `administracion.eliminar` | `administracion.crear` | `administracion.editar` | `administracion.eliminar` |
| `item_ean_seq` | OR de quienes insertan `item_producto` | ídem | ídem | solo DEFINER (nadie) |

El SELECT incluye a los escritores por `RETURNING` y `on conflict` (§4). Para
`item_ean_seq`, "quienes insertan `item_producto`" se toma de `pnpm sp:last` de
cada SP vivo que hace `insert into item_producto`. RCD hoy dice solo
`inventario.crear`; si aparece otro, se agrega al OR y se anota acá.

## 3. Cifras financieras

No aplica: el cambio no crea ni modifica montos, costos, márgenes ni precios. El
precio en la etiqueta queda fuera de alcance justamente para no tocar lógica de
precios. `specs/golden.md` no cambia.

## 4. INVOKER contra RLS restrictiva

- `sp_set_etiqueta_config` hace upsert (`on conflict do update`), que evalúa el
  SELECT de quien llama → `administracion.editar` está en el SELECT.
- `sp_crear_etiqueta_plantilla` usa `returning id` → `administracion.crear` está en
  el SELECT.
- `fn_asignar_codigo_ean` hace `insert … on conflict do update … returning` sobre
  `item_ean_seq` → el SELECT, INSERT y UPDATE del contador son el mismo OR de
  quienes insertan ítems.
- Revendedora: filtra por diseño (0 filas); ninguna función la necesita.
- **DEFINER**: ninguna. Si el trigger no puede funcionar como INVOKER, PARAR y
  preguntar (la whitelist DEFINER de `tests/db/rvp-lecturas.test.ts` es cerrada).

## 5. Migraciones

- Número: el siguiente libre al aplicar (`ls supabase/migrations | tail -1`); no se
  fija acá.
- Orden sugerido, una migración por paso, cada una con su `-- DOWN:` ejecutable:
  1. `fn_ean13_digito`, columna `codigo_ean` (nullable), `item_ean_seq`, trigger
     de asignación e inmutabilidad, backfill, `not null` y único por
     `(id_tenant, codigo_ean)`.
  2. `etiqueta_config` y `etiqueta_plantilla` con sus policies y SP.
  3. Migración de datos desde `configuracion` y retiro de los dos SP viejos.
- Backfill: el `update` dispara `item_producto_touch` (00015) y
  `tr_item_producto_consignacion` (00123). No debe cambiar `updated_at` ni fallar
  por `module-disabled`. Si hace falta, se deshabilitan esos dos triggers solo
  durante el backfill, dentro de la misma migración, con comentario del porqué.
- Ningún SP existente cambia salvo los dos que se retiran (D-ETQ-03).

## 6. Ubicación del código

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `lib/etiquetas/simbologias.ts` | validación, render, layout, administración, impresión | Catálogo de dominio puro: `{ id, dimension: '1d'|'2d', valor: 'qr_code'|'codigo_ean', bcid, minAnchoMm, minAltoMm }`. |
| `lib/etiquetas/ean13.ts` | resolver, tests | Dígito verificador y `esEan13Valido`, en espejo de `fn_ean13_digito`. |
| `lib/etiquetas/layout.ts` | impresión y vista previa de administración | Cálculo puro de hoja y rollo: columnas, `@page`, tamaño del código, aviso de "no entra". |
| `lib/etiquetas/limites.ts` | validación, layout, UI | `PLANTILLAS_MAX`, rangos en mm. Los de `lib/inventario/limites.ts` que quedan muertos se borran. |
| `lib/validation/etiquetas.ts` | Actions de administración | Schemas `strictObject` construidos desde el catálogo y los límites. |
| `lib/dal/etiquetas/etiquetas.ts` | administración, impresión, ficha | `getEtiquetaConfig` (con defaults), `listEtiquetaPlantillas` (tope `PLANTILLAS_MAX`), llamadas a `sp_*`. |
| `lib/dal/inventario/item.ts` (+ `findItemByEan`) | `resolverCodigo` | El ítem es del dominio inventario. |
| `components/etiquetas/CodigoEtiqueta.tsx` | ficha del ítem, impresión, vista previa | Render bwip-js en SVG; lo usan dos módulos (`inventario`, `administracion`). |
| `components/etiquetas/Etiqueta.tsx` | impresión, vista previa | Una etiqueta (código + campos) a la medida de la plantilla. |
| `app/(app)/administracion/ConfiguracionEtiquetasCard.tsx` | `administracion/page.tsx` | Método + perfil de impresora; reemplaza `ConfiguracionQrCard` y `ConfiguracionImpresoraCard`. |
| `app/(app)/administracion/PlantillasEtiquetaCard.tsx` | `administracion/page.tsx` | Alta, edición y baja de plantillas, con vista previa. |
| `app/(app)/inventario/imprimir-etiquetas/SelectorPlantilla.tsx` | `ImprimirEtiquetasClient` | Un solo módulo. |

Se borran, después de buscar con `rg` quién los importa: `QrDisplay.tsx`
(`generarQrDataUrl`), `ConfiguracionQrCard.tsx`, `ConfiguracionImpresoraCard.tsx`,
la dependencia `qrcode`/`@types/qrcode`, y en la DAL y validación de
administración las funciones `*QrLadoMm*` y `*Impresora*`. `QrScanner.tsx` se
queda con ese nombre y solo cambia su texto a "Escaneá el código".

## 7. Slugs nuevos (`lib/errores/mensajes.ts` + inventario de `mensajes.test.ts`)

`etiqueta-config-invalida`, `plantilla-nombre-duplicado`,
`plantilla-medidas-invalidas`, `plantilla-predeterminada-no-se-borra`,
`plantilla-no-encontrada`, `plantillas-limite`, `codigo-ean-inmutable`,
`etiqueta-chica-para-codigo`, `etiqueta-no-entra-en-hoja`. Los dos últimos son
solo de UI. Se retiran los slugs de `qr_lado_mm` e impresora (`mensajes.ts:78-79`)
si nadie más los usa.

## 8. Guía de ayuda (`lib/ayuda/guia/`)

- `administracion.ts`: reemplazar `administracion-qr-configurar` y
  `administracion-impresora-configurar` por `administracion-etiquetas-metodo`,
  `administracion-etiquetas-plantillas` y `administracion-etiquetas-impresora`.
- `inventario.ts`: actualizar `inventario-etiquetas-imprimir` (selector de
  plantilla) y las menciones a "QR" que pasan a ser "código"
  (`:56,106,201,224,246,322,346,393`).
- `ventas.ts`, `consignaciones.ts`, `revendedoras.ts`: "escaneá el QR" pasa a
  "escaneá el código".

## 9. Tests

- **Unit**: `ean13` (vector `2000000000008`, verificador inválido); `layout` (hoja
  automática y forzada, rollo con offsets, "no entra"); schemas (N de
  REQ-ETQ-01/03/04); `resolverCodigo` (orden y N1 de REQ-ETQ-06); `SelectorPlantilla`
  y `ImprimirEtiquetasClient` con plantilla (corregir también el nombre viejo
  "muestra la descripción…"); `CodigoEtiqueta` por simbología.
- **DB** (`tests/db/etiquetas.test.ts`): cada celda de §2.1 y §2.2; REQ-ETQ-02 N1–N5;
  `fn_ean13_digito` igual a `ean13.ts` en una tabla de vectores; `check` de
  simbología igual al catálogo; migración de datos (REQ-ETQ-07).
- **A actualizar** (los cambia la spec, no son regresión):
  `tests/db/rls-por-permiso.test.ts:3263-3269,3368` (SP retirados por D-ETQ-03),
  `lib/dal/administracion/administracion.test.ts:14-74`,
  `lib/validation/administracion.test.ts:128-144`.
- **E2E**: `imprimir-etiquetas` desde un ingreso: cambiar de plantilla y ver la
  cantidad de etiquetas y la medida.
