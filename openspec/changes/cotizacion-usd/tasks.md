# Tareas — cotizacion-usd

**Change**: `cotizacion-usd` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

Slices organizados en orden secuencial estricto para ejecución encadenable con TDD. Cada slice es dueño exclusivo de sus archivos. Los puntos de parada humana están explícitamente delimitados.

---

## Gate Humano (Previo a Implementación)

- [ ] Spec aprobada (`proposal.md` y `tasks.md`) por la persona.
- [ ] Decisiones de Negocio Cerradas:
  - [x] Precio de venta: Opción B (acción masiva en Control de Precios para revaluar costos USD vigentes y marcar precios desactualizados; no toca stock físico).
  - [x] Remitos: cotización vigente a la fecha de carga en el sistema.
  - [x] Pantalla para editar costos individuales: fuera de alcance en v1.

---

## Slice 1 — Catálogo de Permisos, Tipos y Mensajes de Error

Cierra contratos base para frontend y backend.
Archivos:
- `lib/types/administracion.ts`
- `docs/modulos.md`
- `lib/validation/cotizacion.ts` (+ `lib/validation/cotizacion.test.ts`)
- `lib/errores/mensajes.ts` (+ `lib/errores/mensajes.test.ts`)

Tareas:
- [ ] Agregar `'editar_cotizacion'` al catálogo de acciones de `precios` en `lib/types/administracion.ts` (REQ-USD-02, REQ-USD-05).
- [ ] Documentar el nuevo permiso `precios.editar_cotizacion` en la tabla de `docs/modulos.md` explicitando que es una compuerta a nivel de Server Action (guard de aplicación).
- [ ] Crear schemas Zod con `strictObject` en `lib/validation/cotizacion.ts`:
  - `actualizarCotizacionSchema` (`valor: z.number().positive().max(10_000_000)`).
  - `cambiarModoCotizacionSchema` (`modo: z.enum(['automatica', 'manual'])`).
- [ ] Agregar tests unitarios para los schemas Zod.
- [ ] Incorporar los 5 nuevos slugs en español con voseo y punto final en `lib/errores/mensajes.ts`:
  - `sin-cotizacion-dolar`, `cotizacion-manual-invalida`, `modo-cotizacion-invalido`, `bcra-no-disponible`, `cotizacion-desactualizada`.
- [ ] Agregar los casos correspondientes en `lib/errores/mensajes.test.ts`.
- [ ] Verificar con `pnpm gate`.

---

## Slice 2 — Modelo de Datos, RLS Restrictiva y Stored Procedures

Cierra estructura relacional, aislamiento tenant + revendedora y persistencia INVOKER.
Archivos:
- `supabase/migrations/NNNNN_cotizacion_usd.sql` (siguiente número libre)
- `tests/db/cotizacion-usd.test.ts`

Tareas:
- [ ] Crear migración con bloque reversible `-- DOWN:` completo (validado por `pnpm gate:db`).
- [ ] Crear tabla `cotizacion_config` con RLS por `id_tenant` y policy restrictiva de revendedora `restrict_revendedora_cotizacion_config` (`auth_revendedora_id() is null`).
- [ ] Crear tabla `cotizacion_dolar` con RLS por `id_tenant` y policy restrictiva de revendedora `restrict_revendedora_cotizacion_dolar` (`auth_revendedora_id() is null`). Única fuente de verdad para el valor manual.
- [ ] Alterar `costo_producto` agregando `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`.
- [ ] Alterar `ingreso_mercaderia_detalle` agregando `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`.
- [ ] Crear funciones PL/pgSQL INVOKER resolviendo "hoy" en `tenant.zona_horaria`:
  - `sp_get_cotizacion_vigente() returns jsonb`
  - `sp_set_cotizacion_manual(p_valor numeric, p_ip inet) returns void`
  - `sp_set_modo_cotizacion(p_modo text, p_ip inet) returns void`
  - `sp_registrar_cotizacion_bcra(p_fecha date, p_valor numeric, p_fecha_valor date, p_desactualizada boolean) returns void`
  - `sp_revaluar_costos_usd_vigentes(p_ip inet) returns jsonb`
- [ ] Tests en `tests/db/cotizacion-usd.test.ts`:
  - Flujo feliz de guardado y lectura de cotización manual y automática.
  - N1: intento de modificación por usuario sin tenant o valor <= 0.
  - N2: aislamiento entre tenants (Tenant A no ve ni altera cotizaciones de Tenant B).
  - N3: verificar que funciones son INVOKER.
  - N4: test de seguridad de revendedora (REQ-USD-01 N5 y REQ-USD-02 N4): sesión con JWT de revendedora no puede leer ni escribir en `cotizacion_config` ni `cotizacion_dolar`.
- [ ] **PUNTO DE PARADA**: chequear regresión manual de seguridad quitando temporalmente la policy RLS para confirmar que el test falla.
- [ ] Verificar con `pnpm gate:db`.

---

## Slice 3 — Integración BCRA, Resiliencia y Server Actions

Cierra cliente HTTP server-side, reintentos y endpoints de mutación con tres compuertas.
Archivos:
- `lib/cotizacion/bcra.ts` (+ `lib/cotizacion/bcra.test.ts`)
- `lib/dal/precios/cotizacion.ts`
- `app/(app)/precios/cotizacion/actions.ts` (+ `app/(app)/precios/cotizacion/actions.test.ts`)

Tareas:
- [ ] Implementar cliente BCRA en `lib/cotizacion/bcra.ts`:
  - Fetch a `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`.
  - Timeout de 5000 ms con `AbortSignal.timeout(5000)`.
  - Extracción estricta del campo `tipoCotizacion` donde `codigoMoneda === 'USD'`.
  - Reintento: si la fila de hoy tiene `desactualizada = true`, reintentar la llamada HTTP.
  - `desactualizada = true` SOLO si la API falló (timeout o error HTTP).
- [ ] Tests unitarios en `lib/cotizacion/bcra.test.ts` con mock de `fetch` (caso feliz, timeout, error 500, reintento exitoso tras fallo).
- [ ] Implementar capa DAL en `lib/dal/precios/cotizacion.ts`.
- [ ] Implementar Server Actions con las tres compuertas (`requireModuleRole('precios', 'editar_cotizacion')` -> Zod -> DAL):
  - `actualizarCotizacionManualAction`
  - `cambiarModoCotizacionAction`
  - `sincronizarCotizacionBcraAction`
  - `revaluarCostosUsdAction` (REQ-USD-05)
- [ ] Tests unitarios de Server Actions probando casos felices y rechazo por falta de permiso (`no-permission`).
- [ ] Verificar con `pnpm gate`.

---

## Slice 4 — Conversión en Carga de Productos e Ingresos (Circuitos A y B)

Cierra REQ-USD-03 y REQ-USD-04 asegurando que el equivalente en ARS alimente ambos circuitos a la fecha de carga.
Archivos:
- `lib/dal/inventario/producto.ts`
- `lib/dal/inventario/ingreso.ts`
- `app/(app)/inventario/actions.ts`
- `supabase/migrations/NNNNN_sp_importar_remito_usd.sql` (actualiza `sp_set_costo_producto` y `sp_importar_remito` a partir de `pnpm sp:last`)
- `tests/db/conversion-costo-usd.test.ts`

Tareas:
- [ ] Actualizar `sp_set_costo_producto` para recibir `p_costo_original_usd`, `p_cotizacion_aplicada` y `p_cotizacion_fecha_valor`.
- [ ] Actualizar `sp_importar_remito` para recibir y persistir metadatos de cotización en `ingreso_mercaderia_detalle` cuando `p_moneda = 'USD'`.
- [ ] En `createProductoAction` (`app/(app)/inventario/actions.ts`):
  - Si `input.moneda === 'USD'`: resolver cotización vigente a la fecha de carga.
  - Calcular `costoArs = round(input.costoInicial * cotizacion, 2)`.
  - Pasar `costoArs` y metadatos a `addIngresoDetalle` / `spCrearStockDirecto` (Circuito B físico).
  - Pasar `costoArs` y metadatos a `spSetCostoProducto` (Circuito A catálogo).
- [ ] En `crearIngresoCompletoAction` e `importarRemitoAction`:
  - Si el ingreso o líneas indican moneda `USD`, resolver cotización vigente a la fecha de carga y persistir `costo_unitario` en ARS con metadatos de cotización.
- [ ] Tests DB en `tests/db/conversion-costo-usd.test.ts`:
  - Producto nuevo con USD: verifica `costo_producto.costo` en ARS e `item_producto.costo_ingreso` en ARS.
  - Ingreso de producto existente con USD: verifica `ingreso_mercaderia_detalle.costo_unitario` en ARS.
  - Revaluación masiva: verifica que `costo_producto` se actualiza al nuevo tipo de cambio pero `item_producto.costo_ingreso` no cambia.
- [ ] Verificar con `pnpm gate:db`.

---

## Slice 5 — Auditoría y Detección de Datos Preexistentes en Producción

Cierra Punto 5 y 6 de la spec sin scripts con service-role.
Archivos:
- Ninguno de código.

Tareas:
- [ ] **PUNTO DE PARADA OBLIGATORIO (HUMANO)**:
  - La persona humana corre la consulta documentada en el SQL Editor de Supabase:
    ```sql
    select
      cp.id_costo, cp.id_tenant, cp.id_producto, p.nombre as producto_nombre,
      cp.costo as costo_actual_erroneo, cp.moneda, cp.vigente_desde, cp.vigente_hasta
    from costo_producto cp
    join producto p on p.id_producto = cp.id_producto
    where cp.moneda = 'USD';
    ```
  - Si se detectan filas vigentes, el operador las revalúa mediante la nueva acción de Control de Precios o ajusta sus precios manualmente. No se realiza migración de datos automática en masa.

---

## Slice 6 — Interfaz de Usuario (Precios, Control de Precios y Formulario) y Guía

Cierra vistas de operador y documentación viva.
Archivos:
- `app/(app)/precios/cotizacion/page.tsx` (o subcomponente en `/precios`)
- `app/(app)/precios/control/ControlDePreciosView.tsx` (botón de revaluación masiva)
- `app/(app)/inventario/productos/nuevo/NuevoProductoForm.tsx`
- `app/(app)/inventario/ingresos/nuevo/NuevoIngresoView.tsx`
- `lib/ayuda/guia/precios.ts`
- `lib/ayuda/guia/cobertura.test.ts`

Tareas:
- [ ] Construir panel de Cotización en el módulo Precios:
  - Toggle de modo (Automático / Manual).
  - Input numérico para cotización manual (visible en modo manual).
  - Cartel informativo: "Cotización oficial publicada por el BCRA (cierre día hábil anterior). Para operar con dólar billete o financiero, utilizá el modo manual."
  - Banner de advertencia si la cotización figura como `desactualizada` y botón para forzar reintento de sincronización.
- [ ] En `ControlDePreciosView.tsx`:
  - Botón "Revaluar costos USD al dólar vigente" visible solo con permiso `precios.editar_cotizacion` que invoca `revaluarCostosUsdAction`.
- [ ] En `NuevoProductoForm.tsx` y `NuevoIngresoView.tsx`:
  - Al seleccionar moneda `USD`, mostrar hint con la cotización oficial aplicada y el cálculo estimado en pesos ARS.
- [ ] Actualizar `lib/ayuda/guia/precios.ts` con la explicación funcional del dólar oficial, modo manual, revaluación masiva y conversión de costos.
- [ ] Verificar cobertura de ayuda con `lib/ayuda/guia/cobertura.test.ts`.
- [ ] Verificar gate completo con `pnpm gate:full`.
