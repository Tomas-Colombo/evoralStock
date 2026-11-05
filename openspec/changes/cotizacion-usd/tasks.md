# Tareas — cotizacion-usd

**Change**: `cotizacion-usd` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

Slices organizados en orden secuencial estricto para ejecución encadenable con TDD. Cada slice es dueño exclusivo de sus archivos. Los puntos de parada humana están explícitamente delimitados.

---

## Gate Humano (Previo a Implementación)

- [ ] Spec aprobada (`proposal.md` y `tasks.md`) por la persona.
- [ ] Definición de Decisiones Abiertas:
  - [ ] ¿Precio de venta sigue al dólar del día o queda fijo con el valor al registrar el costo? (Opción recomendada: fijo).
  - [ ] ¿Conversión en remitos usa fecha de carga o fecha del remito? (Opción recomendada: fecha de carga).
  - [ ] ¿UI de edición individual de costos entra en el alcance? (Opción recomendada: fuera de alcance en v1).

---

## Slice 1 — Catálogo de Permisos, Tipos y Mensajes de Error

Cierra contratos base para frontend y backend.
Archivos:
- `lib/types/administracion.ts`
- `docs/modulos.md`
- `lib/validation/cotizacion.ts` (+ `lib/validation/cotizacion.test.ts`)
- `lib/errores/mensajes.ts` (+ `lib/errores/mensajes.test.ts`)

Tareas:
- [ ] Agregar `'editar_cotizacion'` al catálogo de acciones de `precios` en `lib/types/administracion.ts` (REQ-USD-02).
- [ ] Documentar el nuevo permiso `precios.editar_cotizacion` en la tabla de `docs/modulos.md`.
- [ ] Crear schemas Zod con `strictObject` en `lib/validation/cotizacion.ts`:
  - `actualizarCotizacionSchema` (`valor: z.number().positive().max(10_000_000)`).
  - `cambiarModoCotizacionSchema` (`modo: z.enum(['automatica', 'manual'])`).
- [ ] Agregar tests unitarios para los schemas Zod.
- [ ] Incorporar los 5 nuevos slugs en español con voseo y punto final en `lib/errores/mensajes.ts`:
  - `sin-cotizacion-dolar`, `cotizacion-manual-invalida`, `modo-cotizacion-invalido`, `bcra-no-disponible`, `cotizacion-desactualizada`.
- [ ] Agregar los casos correspondientes en `lib/errores/mensajes.test.ts`.
- [ ] Verificar con `pnpm gate`.

---

## Slice 2 — Modelo de Datos, Migración SQL y Stored Procedures

Cierra estructura relacional, aislamiento tenant y persistencia INVOKER.
Archivos:
- `supabase/migrations/NNNNN_cotizacion_usd.sql` (siguiente número libre)
- `tests/db/cotizacion-usd.test.ts`

Tareas:
- [ ] Crear migración con bloque reversible `-- DOWN:` completo (validado por `pnpm gate:db`).
- [ ] Crear tabla `cotizacion_config` con RLS por `id_tenant` (modo 'automatica' | 'manual', cotizacion_manual, updated_at).
- [ ] Crear tabla `cotizacion_dolar` con RLS por `id_tenant` (fecha, valor, origen 'bcra' | 'manual', fecha_valor, desactualizada, UNIQUE `(id_tenant, fecha)`).
- [ ] Alterar `costo_producto` agregando `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`.
- [ ] Crear funciones PL/pgSQL INVOKER:
  - `sp_get_cotizacion_vigente() returns jsonb`
  - `sp_set_cotizacion_manual(p_valor numeric, p_ip inet) returns void`
  - `sp_set_modo_cotizacion(p_modo text, p_ip inet) returns void`
  - `sp_registrar_cotizacion_bcra(p_fecha date, p_valor numeric, p_fecha_valor date, p_desactualizada boolean) returns void`
- [ ] Tests en `tests/db/cotizacion-usd.test.ts`:
  - Flujo feliz de guardado y lectura de cotización manual.
  - N1: intento de modificación por usuario sin tenant o valor <= 0.
  - N2: aislamiento entre tenants (Tenant A no ve ni altera cotizaciones de Tenant B).
  - N3: verificar que funciones son INVOKER.
- [ ] **PUNTO DE PARADA**: chequear regresión manual de seguridad quitando temporalmente la policy RLS para confirmar que el test falla.
- [ ] Verificar con `pnpm gate:db`.

---

## Slice 3 — Integración BCRA, Resiliencia y Server Actions

Cierra cliente HTTP server-side y endpoints de mutación con tres compuertas.
Archivos:
- `lib/cotizacion/bcra.ts` (+ `lib/cotizacion/bcra.test.ts`)
- `lib/dal/precios/cotizacion.ts`
- `app/(app)/precios/cotizacion/actions.ts` (+ `app/(app)/precios/cotizacion/actions.test.ts`)

Tareas:
- [ ] Implementar cliente BCRA en `lib/cotizacion/bcra.ts`:
  - Fetch a `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`.
  - Timeout de 5000 ms con `AbortSignal.timeout(5000)`.
  - Extracción estricta del campo `tipoCotizacion` donde `codigoMoneda === 'USD'`.
  - Manejo de fallback a última cotización conocida con flag `desactualizada = true`.
- [ ] Tests unitarios en `lib/cotizacion/bcra.test.ts` con mock de `fetch` (caso feliz, timeout, error 500, ausencia de cotización previa).
- [ ] Implementar capa DAL en `lib/dal/precios/cotizacion.ts`.
- [ ] Implementar Server Actions con las tres compuertas requeridas (guard `requireModuleRole('precios', 'editar_cotizacion')` -> Zod -> DAL):
  - `actualizarCotizacionManualAction`
  - `cambiarModoCotizacionAction`
  - `sincronizarCotizacionBcraAction`
- [ ] Tests unitarios de Server Actions probando casos felices y rechazo por falta de permiso (`no-permission`).
- [ ] Verificar con `pnpm gate`.

---

## Slice 4 — Conversión en la Carga de Productos e Ingresos Físicos

Cierra REQ-USD-03 asegurando que el equivalente en ARS alimente ambos circuitos.
Archivos:
- `lib/dal/inventario/producto.ts`
- `app/(app)/inventario/actions.ts`
- `supabase/migrations/NNNNN_sp_set_costo_producto_usd.sql` (actualiza `sp_set_costo_producto` a partir de `pnpm sp:last`)
- `tests/db/conversion-costo-usd.test.ts`

Tareas:
- [ ] Actualizar `sp_set_costo_producto` para recibir `p_costo_original_usd`, `p_cotizacion_aplicada` y `p_cotizacion_fecha_valor`.
- [ ] En `createProductoAction` (`app/(app)/inventario/actions.ts`):
  - Si `input.moneda === 'USD'`: resolver cotización vigente mediante el servicio.
  - Calcular `costoArs = round(input.costoInicial * cotizacion, 2)`.
  - Pasar `costoArs` a `addIngresoDetalle` / `spCrearStockDirecto` (Circuito B físico).
  - Pasar `costoArs` junto con metadatos de cotización a `spSetCostoProducto` (Circuito A catálogo).
- [ ] Adaptar `setCostoProductoAction` con la misma lógica de conversión server-side.
- [ ] Tests DB en `tests/db/conversion-costo-usd.test.ts`:
  - Verificar que al crear un producto con costo en USD, `costo_producto.costo` tiene pesos ARS.
  - Verificar que `item_producto.costo_ingreso` tiene pesos ARS.
  - Verificar que `sp_recalcular_precio_venta` calcula margen sobre los pesos ARS.
- [ ] **PUNTO DE PARADA**: verificar con la persona si `sp_importar_remito` debe convertir por fecha del remito o fecha de carga.
- [ ] Verificar con `pnpm gate:db`.

---

## Slice 5 — Detección y Auditoría de Datos Preexistentes en Producción

Cierra Punto 5 de la spec (auditoría segura de datos existentes).
Archivos:
- `scripts/auditar-costos-usd.mts`

Tareas:
- [ ] Crear script independiente `scripts/auditar-costos-usd.mts` para consultar filas con `moneda = 'USD'` en `costo_producto`.
- [ ] El script debe listar ID de producto, nombre, costo actual, si tiene ventas asociadas y fecha de carga.
- [ ] **PUNTO DE PARADA OBLIGATORIO**: la persona ejecuta el script contra la base de datos de producción/staging. No se ejecuta ninguna actualización automática en masa. Los costos vigentes detectados se revisan manualmente en el panel de control.

---

## Slice 6 — Interfaz de Usuario (Precios y Alta de Producto) y Guía

Cierra vistas de operador y documentación viva.
Archivos:
- `app/(app)/precios/cotizacion/page.tsx` (o subcomponente en `/precios`)
- `app/(app)/inventario/productos/nuevo/NuevoProductoForm.tsx`
- `lib/ayuda/guia/precios.ts`
- `lib/ayuda/guia/cobertura.test.ts`

Tareas:
- [ ] Construir panel de configuración de Cotización en el módulo Precios:
  - Toggle de modo (Automático / Manual).
  - Input numérico para cotización manual (visible/habilitado en modo manual).
  - Cartel informativo: "Cotización oficial publicada por el BCRA (cierre día hábil anterior). Para cotización billete o financiera, utilizá el modo manual."
  - Banner de advertencia si la cotización figura como `desactualizada`.
- [ ] En `NuevoProductoForm.tsx`: al seleccionar moneda `USD`, mostrar un hint con la cotización que se aplicará y el estimado resultante en ARS.
- [ ] Actualizar `lib/ayuda/guia/precios.ts` con la explicación funcional del dólar oficial, modo manual y conversión de costos.
- [ ] Verificar cobertura de ayuda con `lib/ayuda/guia/cobertura.test.ts`.
- [ ] Verificar gate completo con `pnpm gate:full`.
