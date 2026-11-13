# Propuesta — etiquetas-configurables

**Estado**: aprobada en lo conceptual (2026-11-13), pendiente Gate H1 sobre esta spec.

## Problema

Hoy la única forma de identificar una unidad es un QR con `item_producto.qr_code`
(24 hex). Un comercio que ya trabaja con código de barras o DataMatrix no puede
usarlo, y la etiqueta tiene un solo tamaño por tenant (`qr_lado_mm` + tamaño de
impresora en `configuracion`). Si un comercio vende productos distintos (remeras
y bijouterie), necesita etiquetas de distinto tamaño.

## Hechos verificados en el código (13/11/2026)

- Generación: `components/inventario/QrDisplay.tsx:15` `generarQrDataUrl` (lib
  `qrcode`), usado por la ficha del ítem y por `ImprimirEtiquetasClient.tsx:104`.
  Ya no hay llamadas a `api.qrserver.com`.
- `qr_code` = `encode(gen_random_bytes(12),'hex')` en `sp_confirmar_ingreso`
  (vivo en 00157) y `sp_crear_stock_directo` (vivo en 00156). Índice único
  `item_producto_qr_uk` **global** (00015).
- Lectura: `@zxing/browser` `BrowserMultiFormatReader` (`QrScanner.tsx`) ya
  decodifica 1D y 2D; solo el texto dice "QR". Los lectores USB tipean + Enter.
- Resolución: `lib/dal/inventario/codigo.ts:23` `resolverCodigo()` = `qr_code` →
  SKU (`^([A-Z]+-\d+)`) → nombre. **Lo saltean** con `findItemByQr` directo:
  `app/api/consignaciones/lookup-item/route.ts:43` y `inventario/ficha/[qr]/page.tsx:23`.
- Asumen "24 hex": `ventas/nueva/NuevaVentaView.tsx:241-243`,
  `inventario/buscar/[codigo]/page.tsx:27`, `inventario/actions.ts:398-404`,
  `inventario/ProductosTableClient.tsx:243` (manda texto libre a `/ficha/{code}`).
- Impresión: `window.print()` + `@page` inyectado; A4, padding, columnas y corte
  de nombre hardcodeados en `ImprimirEtiquetasClient.tsx:37-89`.
- Config actual: `configuracion` sección `etiquetas` (`qr_lado_mm`,
  `impresora_ancho_mm`, `impresora_alto_mm`), escrita por
  `sp_set_configuracion_qr_lado_mm` y `sp_set_configuracion_impresora` (vivos en
  00149). La segunda **borra** filas de `configuracion`.

## Relación con `rls-cerrado-por-defecto` (RCD)

Pertinente en cuatro puntos, todos resueltos en la spec:

1. **Tablas nuevas nacen cerradas** (REQ-ETQ-08): RLS on, sin grants a `anon`,
   policy restrictiva por comando con `auth_tiene_permiso`. Si cuando se
   implementa ya existe `lib/seguridad/permisos-tablas.ts`, se registran ahí; si
   no, la matriz de §2.2 de la spec es la que toma RCD Fase 1.
2. **`configuracion`**: RCD Fase 6 deja su DELETE como "solo DEFINER", pero
   `sp_set_configuracion_impresora` (INVOKER) borra. Este cambio saca las claves de
   etiquetas de `configuracion` y retira esos dos SP (D-ETQ-03), así que el
   conflicto desaparece en lugar de resolverse con una excepción.
3. **`item_producto`** (D-RCD-02): la columna nueva `codigo_ean` queda cubierta
   por el SELECT restrictivo de RCD; no se agrega policy.
4. **Grants de escritura**: los `sp_*` son INVOKER, así que corren con los
   privilegios de tabla de quien llama. Las tablas nuevas **conservan**
   `insert/update/delete` para `authenticated` y las cierran las policies
   restrictivas. Revocar el grant rompería sus propios SP.

## Propuesta (resumen)

- El admin elige el **método de identificación** del tenant: QR, DataMatrix,
  Code128 o EAN-13 (catálogo extensible).
- Cada unidad tiene, además de `qr_code`, un **`codigo_ean` interno** que genera el
  sistema (rango GS1 de uso interno `20`). Lo usan las simbologías 1D.
- **Varias plantillas de etiqueta** por tenant (medidas y campos visibles), una
  predeterminada. Al imprimir se elige con el `Select` de `components/ui`.
- **Perfil de impresora**: hoja A4 en grilla o rollo (una etiqueta por página),
  márgenes, separación, columnas y calibración.
- Cambiar de método **nunca** invalida etiquetas pegadas: el lector acepta
  `qr_code`, `codigo_ean` y SKU siempre.

## Fuera de alcance

- Impresión directa ZPL / ESC-POS (necesita WebUSB o un agente local).
- Precio en la etiqueta: depende de la lógica de precios vigente; va en un cambio aparte.
- Plantilla por defecto por producto o categoría, y perfil de impresora por dispositivo.
- Importar EAN de fabricante (identifican producto+talle, no unidad).

## Decisiones

- **D-ETQ-01 — Valor ≠ simbología.** Las 2D (QR, DataMatrix) codifican `qr_code`.
  Las 1D (Code128, EAN-13) codifican `codigo_ean`. Por qué: 24 hex en Code128B son
  ~320 módulos, ~80 mm a 0,25 mm de módulo; los 13 dígitos en Code128C entran en
  ~30 mm.
- **D-ETQ-02 — EAN interno siempre generado.** `'20'` + contador de 10 dígitos por
  tenant + dígito verificador GS1. Se asigna a toda unidad nueva sin importar el
  método, y se completa para las existentes. Cambiar de método es instantáneo. Lo
  asigna un trigger INVOKER `before insert` en `item_producto`, así que no se
  tocan `sp_confirmar_ingreso` ni `sp_crear_stock_directo`. Único por
  `(id_tenant, codigo_ean)`.
- **D-ETQ-03 — La configuración de etiquetas sale de `configuracion`.** Pasa a
  `etiqueta_config` (1 fila por tenant) y `etiqueta_plantilla` (N por tenant). Se
  migran los valores actuales y se retiran las 3 claves y los 2 SP
  `sp_set_configuracion_*` de etiquetas.
- **D-ETQ-04 — Render único con bwip-js** (SVG, sin red, todas las simbologías).
  Reemplaza a `qrcode`, `QrDisplay` y `generarQrDataUrl`.
- **D-ETQ-05 — Se sigue imprimiendo con `window.print()`** y `@page` en mm. La
  plantilla elegida no se persiste en ningún ítem: borrar una plantilla es borrado
  físico, salvo la predeterminada.
