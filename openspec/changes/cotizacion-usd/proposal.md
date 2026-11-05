# Propuesta y Especificación — cotizacion-usd

**Change**: `cotizacion-usd` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

## 1. Problema y Objetivos de Negocio

### Problema
En `00013_producto.sql:62`, la tabla `costo_producto` tiene un constraint `check (moneda in ('ARS', 'USD'))` y en `NuevoProductoForm.tsx:178` la interfaz permite seleccionar moneda `USD`. Sin embargo, el sistema no realiza ninguna conversión cambiaria: un costo cargado como USD 100 se almacena numéricamente como 100 en `costo_producto.costo` y se propaga a los ítems físicos como 100. En consecuencia, el cálculo de reglas de margen, precios de venta, ganancias proyectadas y reportes financieros asume erróneamente que dicho costo es de $100 ARS. El fallo es completamente silencioso y distorsiona la rentabilidad del comercio.

### Objetivos de negocio
1. **Cotización oficial del dólar por tenant**: obtención diaria y automática a partir de la API oficial del Banco Central de la República Argentina (BCRA, Estadísticas Cambiarias v1.0, divisa `USD`). No se utilizan fuentes secundarias ni scrapeos.
2. **Modo dual (Automático / Manual)**: el modo por defecto es automático (consulta diaria al BCRA). El comercio puede cambiar a modo manual para fijar su propia cotización comercial.
3. **Control de acceso granular**: solo el rol administrador o usuarios con el permiso dedicado `precios.editar_cotizacion` pueden alternar el modo o modificar la cotización. La acción general `precios.editar` no confiere este privilegio.
4. **Trazabilidad de la conversión**: al registrar un costo en moneda extranjera, se persisten el monto original en USD, la cotización aplicada, la fecha oficial del valor tomado y el equivalente resultante en pesos (ARS).
5. **INVARIANTE ABSOLUTO**: todo lector actual de costos (formación de precios, congelamiento de costos en venta, márgenes de ganancia, valuación de inventario y estados financieros) debe continuar leyendo montos expresados en pesos (ARS) sin alterar su lógica matemática ni su contrato.

---

## 2. Inventario de Circuitos de Costo y Lectores/Escritores

Existen dos circuitos independientes de costo en el sistema. La conversión de USD a ARS debe realizarse **en el momento de la carga (compuerta de entrada)** para alimentar ambos circuitos ya convertidos en pesos.

```
                              [Carga / Remito / Producto]
                                         │
                         (Si moneda == 'USD' → Convierte a ARS)
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         [Circuito A: Catálogo]                         [Circuito B: Físico]
      costo_producto.costo (ARS)            ingreso_mercaderia_detalle.costo_unitario (ARS)
                 │                                               │
                 ▼                                               ▼
     sp_recalcular_precio_venta                     item_producto.costo_ingreso (ARS)
     sp_control_de_precios                                       │
     v_ganancia_por_producto                                     ▼
     sp_listar_productos                            detalle_venta.costo_snapshot (ARS)
                                                                 │
                                                                 ▼
                                                    rf_finanzas_* / rendiciones
```

### Circuito (A): Catálogo y Precios Vigentes (`costo_producto.costo`)
Almacena el costo de reposición o referencia del producto en el catálogo general.

#### Escritores:
1. `sp_set_costo_producto` (`supabase/migrations/00019_precios_functions.sql:273`, vigente): invocado por `app/(app)/inventario/actions.ts:299` (`createProductoAction`) y `:399` (`setCostoProductoAction`). Inserta en `costo_producto` y marca precios desactualizados.
2. `sp_importar_remito` (`supabase/migrations/00036_sku_autogen.sql:214`, vigente): cuando una línea del remito crea un producto nuevo (`v_es_nuevo = true`), inserta directamente en `costo_producto` con `costo = v_costo`.

#### Lectores vigentes:
- `sp_recalcular_precio_venta` (`supabase/migrations/00019_precios_functions.sql:149`, vigente):
  - *Columna leída*: `costo_producto.costo` donde `vigente_hasta is null`.
  - *Por qué no se rompe*: lee `costo`, que bajo este diseño siempre almacena el valor equivalente en ARS. Las reglas de margen (porcentuales o fijas) se calculan en pesos.
- `sp_control_de_precios` (`supabase/migrations/00040_precios_batch.sql:89`, vigente):
  - *Columna leída*: `cp.costo as costo_vigente` (LEFT JOIN con `costo_producto`).
  - *Por qué no se rompe*: evalúa desvíos de precios y rentabilidad sobre pesos argentinos. Al estar `costo` en ARS, las alertas y márgenes son correctos.
- `v_ganancia_por_producto` (`supabase/migrations/00028_reportes.sql:39`, vigente):
  - *Columna leída*: `coalesce(cp.costo, 0) as costo_vigente`.
  - *Por qué no se rompe*: calcula el margen bruto proyectado contra `precio_venta` (en ARS). Al recibir pesos, la proyección no se altera.
- `sp_listar_productos` (`supabase/migrations/00042_inventario_batch.sql:87`, vigente):
  - *Columna leída*: `cp.costo as costo_vigente`, `cp.moneda as costo_moneda`.
  - *Por qué no se rompe*: la columna `costo_vigente` entrega el monto numérico en ARS listo para visualización y precarga.

---

### Circuito (B): Trazabilidad de Stock Físico y Valuación Contable
Este circuito **no posee columna `moneda`** en ninguna de sus tablas. Todo número ingresado se asume moneda de curso legal (ARS).

#### Cadena de propagación y lectores vigentes:
1. `ingreso_mercaderia_detalle.costo_unitario` (`00014_ingreso_mercaderia.sql:57`):
   - *Escrito por*: `sp_importar_remito` (`00036:247`), `addIngresoDetalle` (`lib/dal/inventario/ingresos.ts:98`).
   - *Lectores*:
     - `rf_finanzas_flujo` (`00095_liquidacion_functions.sql:1021`): acumula `sum(cantidad * costo_unitario)` para compras confirmadas en el período. No se rompe porque recibe pesos reales.
     - `rf_finanzas_posicion` (`00111_seguridad_revendedoras.sql:483`): lee `sum(d.costo_unitario)` para deuda exigible a proveedores consignatarios. No se rompe porque la liquidación se calcula en ARS.
2. `item_producto.costo_ingreso` (`00015_item_producto.sql:23`):
   - *Escrito por*: `sp_confirmar_ingreso` (`00032_talles.sql:80`) copiando `d.costo_unitario`, y `sp_crear_stock_directo` (`00033_sp_crear_stock_directo.sql:51`).
   - *Lectores*:
     - `rf_finanzas_posicion` (`00111:377`): suma `costo_ingreso` para determinar valuación de capital propio en stock (`estado_item in ('disponible', 'reservado', 'en_revendedora')`).
     - `rf_finanzas_resultados` (`00110_finanzas_cambio_diferencia.sql:192`): acumula `costo_ingreso` de ítems dados de baja por merma o descarte.
     - `sp_registrar_cambio` (`00099_sp_registrar_cambio.sql:139`): recupera `costo_ingreso` del ítem que entra y sale.
3. `detalle_venta.costo_snapshot` y `monto_proveedor` (`00021_venta.sql`, `00093_venta_revendedora_pago.sql:288`):
   - *Escrito por*: `sp_registrar_venta` congelando `v_item.costo_ingreso`.
   - *Restricciones*: CHECKs de consistencia financiera en `00067_ganancia_y_costo_consistentes.sql` y triggers de inmutabilidad estricta en `00068_inmutabilidad_ventas.sql` y `00075_trigger_inmutabilidad_detalle_venta.sql`.
   - *Lectores*: `00126_rendicion_modulo.sql:261` (rendiciones de mercadería vendida a consignadores).

### Dónde se realiza la conversión
La conversión se realiza **estrictamente en la compuerta de ingreso**, antes de invocar a las funciones de persistencia:
- Si el usuario ingresa un costo en `USD`, el sistema obtiene la cotización vigente del tenant, calcula `costo_ars = round(costo_usd * cotizacion, 2)`, y envía `costo_ars` tanto a `costo_unitario` de ingresos como al campo `costo` de `costo_producto`.
- `costo_producto` registra adicionalmente `costo_original_usd`, `cotizacion_aplicada` y `cotizacion_fecha_valor`.
- Gracias a esto, **ningún lector ni `sp_*` existente de precios, ventas, finanzas, inventario o rendiciones requiere ser modificado**. Las tablas y triggers de inmutabilidad permanecen intactos.

### Estado de `setCostoProductoAction`
`setCostoProductoAction` (`app/(app)/inventario/actions.ts:390`) existe en el código pero carece de interfaz gráfica (no hay pantalla que lo invoque). Para este cambio:
- La función se adapta a nivel DAL para requerir conversión si recibe `moneda = 'USD'`, pero **no se construirá una pantalla nueva ad-hoc** a fin de mantener el alcance delimitado (ver punto 8 de decisiones abiertas).

---

## 3. Verificación de la API Oficial del BCRA

Se verificó el comportamiento real de la API pública del BCRA contra los servidores de producción mediante `curl.exe`:

### Consulta ejecutada
```bash
curl.exe -s "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD"
```

### Respuesta obtenida (JSON)
```json
{
  "status": 200,
  "metadata": {
    "resultset": {
      "count": 1,
      "offset": 0,
      "limit": 1000
    }
  },
  "results": [
    {
      "fecha": "2026-11-04",
      "detalle": [
        {
          "codigoMoneda": "USD",
          "descripcion": "DOLAR E.E.U.U.",
          "tipoPase": 0.00000000,
          "tipoCotizacion": 1546.00000000
        }
      ]
    }
  ]
}
```

### Parámetros y reglas de la API verificadas
1. **Moneda seleccionada**: se utiliza el código `USD` ("DOLAR E.E.U.U."), cuyo valor reside en el campo `tipoCotizacion` (1546.00). Se descarta el registro `REF` (Comunicación "A" 3500 mayorista).
2. **Sin puntas de compra/venta**: la API del BCRA no publica spread cambiario ni valores discriminados de `comprador` / `vendedor`. Publica un único tipo de cotización oficial de cierre.
3. **Calendario y desfase**:
   - El BCRA publica la cotización al cierre de cada jornada bancaria hábil.
   - No existe cotización para el día en curso en horario matutino/comercial, ni durante fines de semana o feriados.
   - Definición de negocio: **"Cotización vigente"** es la última cotización oficial publicada por el BCRA disponible en la tabla.
   - Se debe almacenar tanto la `fecha_valor` (el atributo `fecha` devuelto en `results[0].fecha`, ej: `2026-11-04`) como la fecha/hora en que nuestro sistema realizó la consulta.
4. **Consulta histórica**: el endpoint soporta `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD`.
5. **Claridad en UI**: la interfaz debe informar explícitamente al operador que la cotización automática corresponde al **tipo de cambio oficial del BCRA** (mayorista/minorista de referencia institucional), y no al dólar billete de ventanilla comercial. Si el comerciante opera con dólar billete o cotizaciones financieras (MEP/Blue), debe utilizar el **Modo Manual**.

---

## 4. Modelo de Datos y Seguridad (RLS + SPs INVOKER)

Se incorporan dos tablas nuevas y se extienden las columnas de `costo_producto`.

### 4.1. Configuración de Cotización por Tenant: `cotizacion_config`
```sql
create table if not exists cotizacion_config (
  id_tenant                uuid primary key references tenant(id_tenant) on delete cascade,
  modo                     text not null default 'automatica' check (modo in ('automatica', 'manual')),
  cotizacion_manual        numeric(14, 4) check (cotizacion_manual is null or cotizacion_manual > 0),
  updated_at               timestamptz not null default now(),
  id_usuario_modificacion  uuid references auth.users(id)
);

alter table cotizacion_config enable row level security;
create policy cotizacion_config_tenant on cotizacion_config for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());
```

### 4.2. Historial de Cotizaciones del Tenant: `cotizacion_dolar`
```sql
create table if not exists cotizacion_dolar (
  id_cotizacion            uuid primary key default gen_random_uuid(),
  id_tenant                uuid not null references tenant(id_tenant) on delete cascade,
  fecha                    date not null, -- Fecha del calendario del comercio (YYYY-MM-DD)
  valor                    numeric(14, 4) not null check (valor > 0),
  origen                   text not null check (origen in ('bcra', 'manual')),
  fecha_valor              date not null, -- Fecha oficial reportada por el BCRA o fecha fijada
  desactualizada           boolean not null default false, -- True si se utilizó fallback por fallo de API
  id_usuario               uuid references auth.users(id), -- Null en sync automático, actor en carga manual
  created_at               timestamptz not null default now(),
  constraint cotizacion_dolar_tenant_fecha_uk unique (id_tenant, fecha)
);

alter table cotizacion_dolar enable row level security;
create policy cotizacion_dolar_tenant on cotizacion_dolar for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());
```

### 4.3. Extensiones en `costo_producto`
```sql
alter table costo_producto
  add column if not exists costo_original_usd numeric(14, 2) check (costo_original_usd is null or costo_original_usd >= 0),
  add column if not exists cotizacion_aplicada numeric(14, 4) check (cotizacion_aplicada is null or cotizacion_aplicada > 0),
  add column if not exists cotizacion_fecha_valor date;
```
*Invariante*: La columna existente `costo` (numeric(14,2)) almacena SIEMPRE el importe equivalente en pesos (ARS). Si `moneda = 'USD'`, `costo_original_usd` guarda el importe original ingresado por el usuario.

### 4.4. Stored Procedures (INVOKER)
1. `sp_get_cotizacion_vigente()`:
   - Tipo: `returns jsonb language plpgsql security invoker`.
   - Lee el modo del tenant en `cotizacion_config`.
   - Si es manual: devuelve el valor de `cotizacion_manual`.
   - Si es automática: busca en `cotizacion_dolar` para la fecha actual. Si no existe registro de hoy, devuelve null o el último registro existente marcándolo como pendiente de sincronización.
2. `sp_set_cotizacion_manual(p_valor numeric, p_ip inet)`:
   - Valida `p_valor > 0`.
   - Actualiza `cotizacion_config.cotizacion_manual = p_valor`, `modo = 'manual'`.
   - Inserta o actualiza en `cotizacion_dolar` para la fecha actual con `origen = 'manual'`, `fecha_valor = current_date`, `desactualizada = false`.
   - Registra auditoría.
3. `sp_set_modo_cotizacion(p_modo text, p_ip inet)`:
   - Valida `p_modo in ('automatica', 'manual')`.
   - Actualiza `cotizacion_config.modo = p_modo`.
   - Registra auditoría.
4. `sp_registrar_cotizacion_bcra(p_fecha date, p_valor numeric, p_fecha_valor date, p_desactualizada boolean)`:
   - Inserta o actualiza en `cotizacion_dolar` para la fecha `p_fecha` del tenant con `origen = 'bcra'`.

---

## 5. Estrategia de Obtención (Sin Cron), Timeout y Resiliencia

### Verificación de Cron en el Repositorio
Se verificó el árbol completo del repositorio: **no existen tareas programadas, cron jobs (`pg_cron`) ni endpoints de background cron en Vercel**.

### Mecanismo de Sincronización Bajo Demanda (Lazy Cache)
La obtención de la cotización se realiza **bajo demanda en el servidor (Server Action / Server Component)** la primera vez en el día que una operación lo requiera (o al ingresar a la pantalla de Precios / Cotización):
1. El servidor consulta `sp_get_cotizacion_vigente()`.
2. Si para el día de hoy ya existe un valor cacheado en `cotizacion_dolar` del tenant, se utiliza de inmediato (latencia 0 ms externa).
3. Si no existe registro para la fecha de hoy y el modo es `automatica`:
   - El backend realiza una llamada `fetch` a `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`.
   - **Timeout estricto**: `AbortSignal.timeout(5000)` (5 segundos).
   - Si responde 200 OK: guarda el registro en `cotizacion_dolar` con `valor = tipoCotizacion`, `fecha_valor = results.fecha`, `desactualizada = false`.
   - Si la API falla (timeout, 5xx, error de red) o devuelve vacío:
     - **Estrategia de degradación 1 (Fallback histórico)**: busca la cotización más reciente en `cotizacion_dolar` del tenant. Si existe, la toma pero la marca como `desactualizada = true`. La UI muestra un banner de advertencia ("Cotización del BCRA no actualizada; usando valor del DD/MM/AAAA").
     - **Estrategia de degradación 2 (Bloqueo preventivo)**: si el tenant no tiene absolutamente ninguna cotización previa en la base, la operación de conversión **se bloquea** retornando el slug `sin-cotizacion-dolar`. Se instruye al operador a cambiar a modo manual y definir una cotización.
   - **Regla dura**: NUNCA se asume una cotización de 1 ARS = 1 USD ni se inventa un valor por defecto en silencio.

---

## 6. Datos Existentes en Base de Datos y Tratamiento

### Conteo en fixtures y seeds
- En `supabase/seed.sql` y `supabase/seeds/seed_dev.sql`: existen **0 registros** en `costo_producto` (los productos no forman parte del seed base, provienen de importación real).
- En tests: los factories generan productos en ARS.

### Detección en Entornos Productivos
Para detectar filas preexistentes que hayan sido cargadas erróneamente con moneda USD antes de este cambio, se utilizará la siguiente consulta:
```sql
select
  cp.id_costo,
  cp.id_tenant,
  cp.id_producto,
  p.nombre as producto_nombre,
  cp.costo as costo_actual_erroneo,
  cp.moneda,
  cp.vigente_desde,
  cp.vigente_hasta
from costo_producto cp
join producto p on p.id_producto = cp.id_producto
where cp.moneda = 'USD';
```

### Tratamiento propuesto (PUNTO DE PARADA HUMANO)
- **NO convertir automáticamente en la migración**: una conversión masiva con una cotización arbitraria podría alterar retroactivamente márgenes de productos ya vendidos o precios ya fijados.
- Se mantendrán intactas las filas históricas cerradas (`vigente_hasta is not null`).
- Para las filas con `moneda = 'USD'` que sigan vigentes (`vigente_hasta is null`), la migración creará una tabla temporal o reporte de auditoría `auditoria_costos_usd_pendientes`.
- **Punto de parada obligatorio**: El administrador del comercio deberá revisar y validar dichos productos desde la pantalla de Precios / Control de Precios antes de forzar su recálculo.

---

## 7. Compuertas de Server Actions, Mensajes y Ayuda

### 7.1. Tres compuertas en cada Server Action

#### Action 1: `actualizarCotizacionManualAction(input: { valor: number })`
1. **Compuerta 1 (Autorización)**:
   ```ts
   await requireModuleRole(session, 'precios', 'editar_cotizacion')
   ```
2. **Compuerta 2 (Validación Zod)**:
   ```ts
   const schema = z.strictObject({
     valor: z.number().positive().max(10_000_000),
   })
   const parsed = schema.safeParse(input)
   if (!parsed.success) return { ok: false, reason: 'cotizacion-manual-invalida' }
   ```
3. **Compuerta 3 (Llamada al DAL)**:
   ```ts
   await spSetCotizacionManual({ valor: parsed.data.valor, ip })
   ```

#### Action 2: `cambiarModoCotizacionAction(input: { modo: 'automatica' | 'manual' })`
1. **Compuerta 1 (Autorización)**:
   ```ts
   await requireModuleRole(session, 'precios', 'editar_cotizacion')
   ```
2. **Compuerta 2 (Validación Zod)**:
   ```ts
   const schema = z.strictObject({
     modo: z.enum(['automatica', 'manual']),
   })
   const parsed = schema.safeParse(input)
   if (!parsed.success) return { ok: false, reason: 'modo-cotizacion-invalido' }
   ```
3. **Compuerta 3 (Llamada al DAL)**:
   ```ts
   await spSetModoCotizacion({ modo: parsed.data.modo, ip })
   ```

#### Action 3: `sincronizarCotizacionBcraAction()`
1. **Compuerta 1 (Autorización)**:
   ```ts
   await requireModuleRole(session, 'precios', 'editar_cotizacion')
   ```
2. **Compuerta 2 (Validación Zod)**:
   ```ts
   // Sin payload, strictObject vacío
   const parsed = z.strictObject({}).safeParse({})
   ```
3. **Compuerta 3 (Llamada al DAL y fetch)**:
   ```ts
   await syncCotizacionBcraConServicio({ forzar: true })
   ```

### 7.2. Nuevos Slugs en `lib/errores/mensajes.ts`
- `'sin-cotizacion-dolar'`: `'No hay una cotización del dólar disponible para hoy. Cargá una cotización manual en Precios.'`
- `'cotizacion-manual-invalida'`: `'La cotización del dólar debe ser un número positivo.'`
- `'modo-cotizacion-invalido'`: `'El modo de cotización seleccionado no es válido.'`
- `'bcra-no-disponible'`: `'El servicio del BCRA no respondió. Verificá la conexión o cambiá a cotización manual.'`
- `'cotizacion-desactualizada'`: `'La cotización oficial del BCRA no se encuentra al día. Revisá el valor o ingresá una cotización manual.'`

### 7.3. Documentación y Permisos
- `lib/types/administracion.ts`: se añade `'editar_cotizacion'` al arreglo de `precios` en `_CATALOGO`.
- `docs/modulos.md`: se documenta el nuevo permiso `precios.editar_cotizacion` explicando que separa la facultad de modificar la política cambiaria del permiso genérico de editar precios.
- `lib/ayuda/guia/precios.ts`: se añade la sección de ayuda interactiva sobre cómo funciona la cotización automática del BCRA, el cambio a modo manual y la advertencia sobre dólar oficial vs ventanilla.

---

## 8. Requisitos de la Especificación (REQ)

### REQ-USD-01 — Consulta y Cacheo de Cotización Automática BCRA
El sistema MUST consultar la API oficial del BCRA (`https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`) bajo demanda en el servidor para obtener el `tipoCotizacion` de la moneda `USD` cuando el tenant esté en modo `automatica`.
- **Feliz**: el BCRA responde 200 con `fecha` y `tipoCotizacion`. Se almacena en `cotizacion_dolar` para la fecha actual con `desactualizada = false`.
- **N1**: API del BCRA no responde (timeout 5s o 5xx) y el tenant posee cotización anterior → se utiliza la cotización previa con bandera `desactualizada = true`.
- **N2**: API del BCRA no responde y el tenant no posee ninguna cotización previa → rechazo de la operación con slug `sin-cotizacion-dolar`.
- **N3**: Invocación desde otro tenant → RLS aísla la tabla `cotizacion_dolar`; ningún tenant puede leer ni pisar cotizaciones ajenas (0 filas).

### REQ-USD-02 — Configuración y Carga de Cotización Manual
El sistema MUST permitir a usuarios autorizados cambiar el modo a `manual` y fijar un importe de cotización comercial positivo.
- **Feliz**: operador con rol admin o permiso `precios.editar_cotizacion` envía valor $1.600,00. Se guarda en `cotizacion_config` y en `cotizacion_dolar` con `origen = 'manual'`.
- **N1**: Operador con permiso `precios.editar` pero SIN `precios.editar_cotizacion` intenta modificar la cotización → rechazo con error de autorización `no-permission`.
- **N2**: Operador envía valor 0 o negativo → rechazo con slug `cotizacion-manual-invalida`.
- **N3**: Operador intenta guardar cotización en tenant ajeno → rechazo por comprobación de tenant en sesión.

### REQ-USD-03 — Conversión en Carga de Producto e Ingreso de Stock
Al dar de alta un producto nuevo con costo en `USD`, el sistema MUST convertir el importe a pesos antes de insertarlo en `costo_producto.costo` y en el detalle del ingreso de mercadería.
- **Feliz**: producto con costo inicial USD 100 y cotización vigente de $1.500 ARS. Se almacena `costo_producto.costo = 150000.00`, `costo_original_usd = 100.00`, `cotizacion_aplicada = 1500.00`, `cotizacion_fecha_valor = '2026-11-04'`. El stock físico (`item_producto.costo_ingreso`) se crea en $150.000,00 ARS.
- **N1**: No hay cotización vigente en el tenant (ni BCRA ni manual) → rechazo del alta con slug `sin-cotizacion-dolar`.
- **N2**: Monto en USD menor a 0 → rechazo por validación de formulario.

### REQ-USD-04 — Invariante de Lectores de Costo Existentes
Los lectores de costos (`sp_recalcular_precio_venta`, `sp_control_de_precios`, `v_ganancia_por_producto`, `sp_listar_productos`, reportes de finanzas y rendiciones) MUST continuar operando sin modificaciones de código, consumiendo montos unificados en ARS.
- **Feliz**: se ejecuta `sp_recalcular_precio_venta` para un producto con costo registrado en USD. La función lee `costo_producto.costo` (que ya contiene pesos), aplica la regla de margen y actualiza `precio_venta` en pesos correctamente.

---

## 9. Fuera de Alcance Explícito

1. **Venta o cobro en moneda extranjera**: el sistema no admite ventas, facturación ni cobranzas en USD. Todo el circuito de ventas y caja opera en pesos argentinos (ARS).
2. **Gastos, comisiones o liquidaciones en USD**: el módulo de gastos y las liquidaciones a revendedoras continúan exclusivamente en ARS.
3. **Consignación y rendiciones en USD**: los acuerdos de consignación de proveedores y sus rendiciones se liquidan en ARS.
4. **Precios de venta flotantes automáticos**: el precio de venta no se indexa en tiempo real ni fluctúa automáticamente minuto a minuto con el dólar sin una revalorización de costo o recálculo explícito de precios.
5. **Conversión retroactiva de ventas pasadas**: no se modifican snapshots históricos de `detalle_venta` ni ítems ya vendidos/rendidos.

---

## 10. Decisiones Abiertas para la Persona

Las siguientes decisiones requieren definición de negocio antes de la implementación:

1. **Comportamiento del precio de venta frente a variaciones del dólar**:
   - *Opción A (Recomendada)*: El precio de venta queda fijo con el equivalente en ARS del momento en que se registró el costo. Si el dólar sube, el precio no cambia hasta que el operador actualice el costo o recalcule deliberadamente el precio.
   - *Opción B*: Se provee un botón masivo "Actualizar costos USD al tipo de cambio de hoy" en Control de Precios que recalcula los costos vigentes y marca los precios como desactualizados.
2. **Fecha de cotización en importación de remitos**:
   - *Opción A (Recomendada)*: Se utiliza la cotización vigente al momento de la carga en el sistema (fecha actual).
   - *Opción B*: Si el remito consigna una fecha de emisión pasada, se consulta el histórico del BCRA para esa fecha específica mediante el endpoint `/Cotizaciones/USD?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD`.
3. **Alcance de UI para edición individual de costos**:
   - Actualmente `setCostoProductoAction` no tiene pantalla en la UI (los costos se fijan al crear el producto o al ingresar remitos).
   - *Pregunta*: ¿Debe construirse en este cambio una interfaz dentro de la ficha de producto para editar el costo y su moneda, o se mantiene fuera de alcance?
