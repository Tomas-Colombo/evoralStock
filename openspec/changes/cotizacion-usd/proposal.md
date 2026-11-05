# Propuesta y Especificación — cotizacion-usd

**Change**: `cotizacion-usd` · **Spec**: `proposal.md` · **Tareas**: `tasks.md`

## 1. Problema y Objetivos de Negocio

### Problema
En `00013_producto.sql:62`, la tabla `costo_producto` tiene un constraint `check (moneda in ('ARS', 'USD'))` y en `NuevoProductoForm.tsx:178` la interfaz permite seleccionar moneda `USD`. Sin embargo, el sistema no realiza ninguna conversión cambiaria: un costo cargado como USD 100 se almacena numéricamente como 100 en `costo_producto.costo` y se propaga a los ítems físicos como 100. En consecuencia, el cálculo de reglas de margen, precios de venta, ganancias proyectadas y reportes financieros asume erróneamente que dicho costo es de $100 ARS. El fallo es completamente silencioso y distorsiona la rentabilidad del comercio.

### Objetivos de negocio
1. **Cotización oficial del dólar por tenant**: obtención diaria y automática a partir de la API oficial del Banco Central de la República Argentina (BCRA, Estadísticas Cambiarias v1.0, divisa `USD`). No se utilizan fuentes secundarias ni scrapeos.
2. **Modo dual (Automático / Manual)**: el modo por defecto es automático (consulta diaria al BCRA). El comercio puede conmutar a modo manual para fijar su propia cotización comercial.
3. **Control de acceso granular**: solo el rol administrador o usuarios con el permiso dedicado `precios.editar_cotizacion` pueden alternar el modo, modificar la cotización o revaluar costos en masa. La acción general `precios.editar` no confiere este privilegio.
4. **Trazabilidad de la conversión en ambos circuitos**: al registrar un costo en moneda extranjera (tanto en el catálogo como en el ingreso físico de mercadería), se persisten el monto original en USD, la cotización aplicada, la fecha oficial del valor tomado y el equivalente resultante en pesos (ARS).
5. **INVARIANTE ABSOLUTO**: todo lector actual de costos (formación de precios, congelamiento de costos en venta, márgenes de ganancia, valuación de inventario y estados financieros) debe continuar leyendo montos expresados en pesos (ARS) sin alterar su lógica matemática ni su contrato.

---

## 2. Inventario de Circuitos de Costo y Lectores/Escritores

Existen dos circuitos independientes de costo en el sistema. La conversión de USD a ARS debe realizarse **en el momento de la carga (compuerta de entrada)** para alimentar ambos circuitos ya convertidos en pesos.

```
                         [Carga: Producto / Ingreso / Remito]
                                         │
                         (Si moneda == 'USD' → Convierte a ARS)
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         [Circuito A: Catálogo]                         [Circuito B: Físico]
      costo_producto.costo (ARS)            ingreso_mercaderia_detalle.costo_unitario (ARS)
      + costo_original_usd                  + costo_original_usd
      + cotizacion_aplicada                 + cotizacion_aplicada
      + cotizacion_fecha_valor              + cotizacion_fecha_valor
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
1. `sp_set_costo_producto` (`supabase/migrations/00019_precios_functions.sql:273`, vigente): invocado por `app/(app)/inventario/actions.ts:299` (`createProductoAction`), `:399` (`setCostoProductoAction`) y por la nueva acción de revaluación masiva en Control de Precios. Inserta en `costo_producto` y marca precios desactualizados.
2. `sp_importar_remito` (`supabase/migrations/00036_sku_autogen.sql:214`, vigente): cuando una línea del remito crea un producto nuevo (`v_es_nuevo = true`), inserta directamente en `costo_producto`.

#### Lectores vigentes:
- `sp_recalcular_precio_venta` (`supabase/migrations/00019_precios_functions.sql:149`, vigente):
  - *Columna leída*: `costo_producto.costo` donde `vigente_hasta is null`.
  - *Por qué no se rompe*: lee `costo`, que bajo este diseño siempre almacena el valor equivalente en ARS. Las reglas de margen (porcentuales o fijas) se calculan en pesos.
- `sp_control_de_precios` (`supabase/migrations/00040_precios_batch.sql:89`, vigente):
  - *Columna leída*: `cp.costo as costo_vigente` (LEFT JOIN con `costo_producto`).
  - *Por qué no se rompe*: evalúa desvíos de precios y rentabilidad sobre pesos argentinos.
- `v_ganancia_por_producto` (`supabase/migrations/00028_reportes.sql:39`, vigente):
  - *Columna leída*: `coalesce(cp.costo, 0) as costo_vigente`.
  - *Por qué no se rompe*: calcula el margen bruto proyectado contra `precio_venta` (en ARS).
- `sp_listar_productos` (`supabase/migrations/00042_inventario_batch.sql:87`, vigente):
  - *Columna leída*: `cp.costo as costo_vigente`, `cp.moneda as costo_moneda`.
  - *Por qué no se rompe*: la columna `costo_vigente` entrega el monto numérico en ARS listo para visualización y precarga.

---

### Circuito (B): Trazabilidad de Stock Físico y Valuación Contable
Este circuito alimenta los ítems físicos con QR. Debe soportar moneda USD tanto al dar de alta productos nuevos como al ingresar stock de productos ya existentes (vía `NuevoIngresoView` / `crearIngresoCompletoAction` o vía `RemitoImportPanel` / `importarRemitoAction` / `sp_importar_remito`).

#### Cadena de propagación y lectores vigentes:
1. `ingreso_mercaderia_detalle.costo_unitario` (`00014_ingreso_mercaderia.sql:57`):
   - Se agregan las columnas `costo_original_usd`, `cotizacion_aplicada` y `cotizacion_fecha_valor` para trazabilidad de compras en dólares.
   - *Escrito por*: `sp_importar_remito` (`00036:247`), `addIngresoDetalle` (`lib/dal/inventario/ingreso.ts:198`).
   - *Invariante*: `costo_unitario` SIEMPRE se persiste en pesos (ARS), calculado como `round(costo_usd * cotizacion_vigente, 2)`.
   - *Lectores*:
     - `rf_finanzas_flujo` (`00095_liquidacion_functions.sql:1021`): acumula `sum(cantidad * costo_unitario)` para compras confirmadas en el período. No se rompe porque recibe pesos reales.
     - `rf_finanzas_posicion` (`00111_seguridad_revendedoras.sql:483`): lee `sum(d.costo_unitario)` para deuda exigible a proveedores consignatarios. No se rompe porque la liquidación se calcula en ARS.
2. `item_producto.costo_ingreso` (`00015_item_producto.sql:23`):
   - *Escrito por*: `sp_confirmar_ingreso` (`00032_talles.sql:80`) copiando `d.costo_unitario`, y `sp_crear_stock_directo` (`00033_sp_crear_stock_directo.sql:51`).
   - *Invariante*: almacena pesos ARS. Permanece inmutable tras la confirmación del ingreso.
   - *Lectores*:
     - `rf_finanzas_posicion` (`00111:377`): suma `costo_ingreso` para determinar valuación de capital propio en stock (`estado_item in ('disponible', 'reservado', 'en_revendedora')`).
     - `rf_finanzas_resultados` (`00110_finanzas_cambio_diferencia.sql:192`): acumula `costo_ingreso` de ítems dados de baja por merma o descarte.
     - `sp_registrar_cambio` (`00099_sp_registrar_cambio.sql:139`): recupera `costo_ingreso` del ítem que entra y sale.
3. `detalle_venta.costo_snapshot` y `monto_proveedor` (`00021_venta.sql`, `00093_venta_revendedora_pago.sql:288`):
   - *Escrito por*: `sp_registrar_venta` congelando `v_item.costo_ingreso`.
   - *Restricciones*: CHECKs de consistencia financiera en `00067_ganancia_y_costo_consistentes.sql` y triggers de inmutabilidad estricta en `00068_inmutabilidad_ventas.sql` y `00075_trigger_inmutabilidad_detalle_venta.sql`.
   - *Lectores*: `00126_rendicion_modulo.sql:261` (rendiciones de mercadería vendida a consignadores).

### Dónde se realiza la conversión
La conversión se realiza **estrictamente en la compuerta de ingreso a la fecha de carga**, antes de invocar a las funciones de persistencia:
- Si el usuario ingresa un costo en `USD`, el sistema obtiene la cotización vigente del tenant, calcula `costo_ars = round(costo_usd * cotizacion, 2)`, y envía `costo_ars` tanto a `costo_unitario` de ingresos como al campo `costo` de `costo_producto`.
- `ingreso_mercaderia_detalle` y `costo_producto` registran adicionalmente `costo_original_usd`, `cotizacion_aplicada` y `cotizacion_fecha_valor`.
- Gracias a esto, **ningún lector ni `sp_*` existente de precios, ventas, finanzas, inventario o rendiciones requiere ser modificado**. Las tablas y triggers de inmutabilidad permanecen intactos.

### Estado de `setCostoProductoAction` y pantalla de edición individual
- No existe ninguna pantalla para editar el costo (`setCostoProductoAction` no tiene UI).
- Queda **explícitamente fuera de alcance** construir una pantalla ad-hoc para editar costos individuales en la v1. La función DAL simplemente se adapta para requerir conversión si es invocada programáticamente con `moneda = 'USD'`.

---

## 3. Verificación de la API Oficial del BCRA y Manejo de Fecha

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
3. **Cálculo de "Hoy" según la zona horaria del tenant**:
   - "Hoy" NUNCA es `current_date` ni `now()::date` (UTC). Se calcula en base a `tenant.zona_horaria` (`00066_zona_horaria_tenant.sql`): `(now() at time zone coalesce(tenant.zona_horaria, 'America/Argentina/Buenos_Aires'))::date`.
4. **Calendario, desfase y significado de `desactualizada = true`**:
   - El BCRA publica la cotización al cierre de cada jornada bancaria hábil.
   - En fines de semana, feriados o mañanas hábiles, el valor oficial devuelto por el BCRA tiene `results[0].fecha` correspondiente al último día hábil anterior (por ejemplo, durante el fin de semana el valor del viernes es completamente normal y vigente).
   - **`desactualizada = true` SIGNIFICA EXCLUSIVAMENTE QUE FALLÓ LA LLAMADA A LA API DEL BCRA** (timeout, 5xx, error de red) y el sistema tuvo que recurrir a una cotización cacheada de días anteriores. NO significa que `fecha_valor < hoy`.
   - **Reintento**: si la fila de hoy tiene `desactualizada = true`, el sistema MUST reintentar la llamada al BCRA en la próxima consulta bajo demanda. Si la llamada tiene éxito, actualiza la cotización del día y limpia la marca (`desactualizada = false`).
5. **Claridad en UI**: la interfaz debe informar explícitamente al operador que la cotización automática corresponde al **tipo de cambio oficial del BCRA**, y no al dólar billete de ventanilla comercial ni cotizaciones financieras (MEP/Blue). Para operar con dólar billete, se debe utilizar el **Modo Manual**.

---

## 4. Modelo de Datos y Seguridad (RLS Restrictiva + SPs INVOKER)

Se incorporan dos tablas nuevas y se extienden `costo_producto` e `ingreso_mercaderia_detalle`.

### 4.1. Configuración de Cotización por Tenant: `cotizacion_config`
Almacena exclusivamente el modo de operación. **Una sola fuente de verdad para el valor manual**: el valor de la cotización manual reside únicamente en `cotizacion_dolar` con `origen = 'manual'`, eliminando campos duplicados.
```sql
create table if not exists cotizacion_config (
  id_tenant                uuid primary key references tenant(id_tenant) on delete cascade,
  modo                     text not null default 'automatica' check (modo in ('automatica', 'manual')),
  updated_at               timestamptz not null default now(),
  id_usuario_modificacion  uuid references auth.users(id)
);

alter table cotizacion_config enable row level security;

-- Aislamiento multitenant
create policy cotizacion_config_tenant on cotizacion_config for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

-- Policy restrictiva revendedora (patrón 00078 / fix 12fbc66 en consulta_ayuda)
create policy restrict_revendedora_cotizacion_config on cotizacion_config
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);
```

### 4.2. Historial de Cotizaciones del Tenant: `cotizacion_dolar`
Única fuente de verdad de valores de cotización (automáticos y manuales).
```sql
create table if not exists cotizacion_dolar (
  id_cotizacion            uuid primary key default gen_random_uuid(),
  id_tenant                uuid not null references tenant(id_tenant) on delete cascade,
  fecha                    date not null, -- Fecha del calendario local del tenant (zona_horaria)
  valor                    numeric(14, 4) not null check (valor > 0),
  origen                   text not null check (origen in ('bcra', 'manual')),
  fecha_valor              date not null, -- Fecha oficial reportada por el BCRA o fecha fijada
  desactualizada           boolean not null default false, -- TRUE SOLO SI FALLÓ EL FETCH AL BCRA
  id_usuario               uuid references auth.users(id), -- Null en sync automático, actor en manual
  created_at               timestamptz not null default now(),
  constraint cotizacion_dolar_tenant_fecha_uk unique (id_tenant, fecha)
);

alter table cotizacion_dolar enable row level security;

-- Aislamiento multitenant
create policy cotizacion_dolar_tenant on cotizacion_dolar for all to authenticated
  using (id_tenant = auth_tenant_id())
  with check (id_tenant = auth_tenant_id());

-- Policy restrictiva revendedora (patrón 00078 / fix 12fbc66 en consulta_ayuda)
create policy restrict_revendedora_cotizacion_dolar on cotizacion_dolar
  as restrictive for all to authenticated
  using (auth_revendedora_id() is null);
```

### 4.3. Extensiones en `costo_producto` e `ingreso_mercaderia_detalle`
```sql
-- Circuito A: Catálogo
alter table costo_producto
  add column if not exists costo_original_usd numeric(14, 2) check (costo_original_usd is null or costo_original_usd >= 0),
  add column if not exists cotizacion_aplicada numeric(14, 4) check (cotizacion_aplicada is null or cotizacion_aplicada > 0),
  add column if not exists cotizacion_fecha_valor date;

-- Circuito B: Stock Físico
alter table ingreso_mercaderia_detalle
  add column if not exists costo_original_usd numeric(14, 2) check (costo_original_usd is null or costo_original_usd >= 0),
  add column if not exists cotizacion_aplicada numeric(14, 4) check (cotizacion_aplicada is null or cotizacion_aplicada > 0),
  add column if not exists cotizacion_fecha_valor date;
```
*Invariante*: Las columnas `costo_producto.costo` e `ingreso_mercaderia_detalle.costo_unitario` almacenan SIEMPRE el importe equivalente en pesos (ARS).

### 4.4. Stored Procedures (INVOKER) y Modelo de Permisos
> **ALCANCE DE SEGURIDAD**: `precios.editar_cotizacion` es un **guard de nivel de aplicación** (`requireModuleRole`), al igual que el 100% de los permisos del sistema hoy. En la base de datos, los SPs son INVOKER y validan únicamente el aislamiento por `auth_tenant_id()`. Cualquier usuario autenticado del tenant con acceso a la conexión directa podría invocar los SPs; la restricción per-rol/per-acción se ejerce en las compuertas de Server Actions. No se prometen ni implementan controles per-usuario dentro de Postgres.

1. `sp_get_cotizacion_vigente()`:
   - Resuelve `v_hoy` en la zona horaria del tenant.
   - Lee `cotizacion_config.modo`.
   - Si es manual: lee la última fila de `cotizacion_dolar` donde `origen = 'manual'`.
   - Si es automática: busca la fila en `cotizacion_dolar` para `fecha = v_hoy`. Devuelve el registro (incluyendo si `desactualizada = true` para indicar si requiere reintento). Si no hay fila de hoy, busca la última disponible con `desactualizada = true`.
2. `sp_set_cotizacion_manual(p_valor numeric, p_ip inet)`:
   - Valida `p_valor > 0`.
   - Setea `cotizacion_config.modo = 'manual'`.
   - Inserta o actualiza en `cotizacion_dolar` para `fecha = v_hoy` con `origen = 'manual'`, `fecha_valor = v_hoy`, `desactualizada = false`, `id_usuario = auth.uid()`.
   - Registra auditoría.
3. `sp_set_modo_cotizacion(p_modo text, p_ip inet)`:
   - Valida `p_modo in ('automatica', 'manual')`.
   - Actualiza `cotizacion_config.modo = p_modo`.
   - Registra auditoría.
4. `sp_registrar_cotizacion_bcra(p_fecha date, p_valor numeric, p_fecha_valor date, p_desactualizada boolean)`:
   - Inserta o actualiza en `cotizacion_dolar` para `fecha = p_fecha` con `origen = 'bcra'`.

---

## 5. Estrategia de Obtención (Sin Cron), Reintentos y Resiliencia

### Verificación de Cron en el Repositorio
Se verificó el repositorio: **no existen tareas programadas, cron jobs (`pg_cron`) ni cron endpoints en Vercel**.

### Mecanismo de Sincronización Bajo Demanda (Lazy Cache)
La obtención se realiza **bajo demanda en el servidor** la primera vez en el día que una operación lo requiera (o al entrar a la pantalla de Precios / Cotización):
1. El backend consulta `sp_get_cotizacion_vigente()`.
2. Si para la fecha local de hoy (`v_hoy`) ya existe un valor en `cotizacion_dolar` con `desactualizada = false`, se utiliza de inmediato (latencia 0 ms externa).
3. Si no existe registro de hoy, O si el registro existente tiene `desactualizada = true`:
   - El servidor ejecuta un `fetch` a `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`.
   - **Timeout estricto**: `AbortSignal.timeout(5000)` (5 segundos).
   - Si responde 200 OK con datos: guarda en `cotizacion_dolar` para la fecha `v_hoy` con `valor = tipoCotizacion`, `fecha_valor = results.fecha`, `desactualizada = false`.
   - Si la API falla (timeout, 5xx, error de red):
     - Si ya había una fila de hoy (marcada desactualizada) o filas anteriores: las conserva y mantiene la marca `desactualizada = true`. La UI muestra un banner: "Cotización del BCRA no actualizada; usando valor previo".
     - Si el tenant no tiene absolutamente ninguna cotización previa registrada: la operación de conversión se bloquea con slug `sin-cotizacion-dolar`. Se exige cambiar a modo manual y cargar un valor.
   - **Regla dura**: NUNCA se asume 1 ARS = 1 USD ni se inventa un valor por defecto en silencio.

---

## 6. Datos Existentes en Base de Datos y Tratamiento

### Conteo en fixtures y seeds
- En `supabase/seed.sql` y `supabase/seeds/seed_dev.sql`: existen **0 registros** en `costo_producto`.

### Detección en Entornos Productivos (Sin scripts con Service-Role)
Siguiendo `AGENTS.md`, no se crean scripts que utilicen la clave service-role. La detección la realiza la **persona humana** ejecutando la siguiente consulta SQL documentada en el SQL Editor del proyecto:
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
- **NO convertir automáticamente en la migración**: no se alteran en masa filas históricas cerradas (`vigente_hasta is not null`) ni vigentes.
- **Punto de parada obligatorio**: El administrador del comercio audita los productos devueltos por la consulta anterior y decide si los revalúa individualmente o mediante la acción masiva en Control de Precios.

---

## 7. Compuertas de Server Actions y Mensajes de Error

### 7.1. Tres compuertas en cada Server Action

#### Action 1: `actualizarCotizacionManualAction(input: { valor: number })`
1. **Compuerta 1 (Autorización)**: `await requireModuleRole(session, 'precios', 'editar_cotizacion')`
2. **Compuerta 2 (Validación Zod)**: `z.strictObject({ valor: z.number().positive().max(10_000_000) })`
3. **Compuerta 3 (Llamada al DAL)**: `await spSetCotizacionManual({ valor: parsed.data.valor, ip })`

#### Action 2: `cambiarModoCotizacionAction(input: { modo: 'automatica' | 'manual' })`
1. **Compuerta 1 (Autorización)**: `await requireModuleRole(session, 'precios', 'editar_cotizacion')`
2. **Compuerta 2 (Validación Zod)**: `z.strictObject({ modo: z.enum(['automatica', 'manual']) })`
3. **Compuerta 3 (Llamada al DAL)**: `await spSetModoCotizacion({ modo: parsed.data.modo, ip })`

#### Action 3: `sincronizarCotizacionBcraAction()`
1. **Compuerta 1 (Autorización)**: `await requireModuleRole(session, 'precios', 'editar_cotizacion')`
2. **Compuerta 2 (Validación Zod)**: `z.strictObject({})`
3. **Compuerta 3 (Llamada al DAL y fetch)**: `await syncCotizacionBcraConServicio({ forzar: true })`

#### Action 4: `revaluarCostosUsdAction()` (Acción masiva en Control de Precios)
1. **Compuerta 1 (Autorización)**: `await requireModuleRole(session, 'precios', 'editar_cotizacion')`
2. **Compuerta 2 (Validación Zod)**: `z.strictObject({})`
3. **Compuerta 3 (Llamada al DAL)**: `await spRevaluarCostosUsdVigentes({ ip })`
   - Obtiene la cotización vigente del tenant.
   - Para cada producto con costo vigente donde `moneda = 'USD'`:
     - Invoca `sp_set_costo_producto` calculando `nuevo_costo = round(costo_original_usd * cotizacion_vigente, 2)` con motivo `'revaluacion masiva cotizacion usd'`.
     - `sp_set_costo_producto` historiza el costo anterior, guarda el nuevo y marca el `precio_venta_desactualizado = true`.
   - **NO toca `item_producto.costo_ingreso`**: el costo de las unidades físicas ya ingresadas en stock permanece inmutable.

### 7.2. Nuevos Slugs en `lib/errores/mensajes.ts`
- `'sin-cotizacion-dolar'`: `'No hay una cotización del dólar disponible para hoy. Cargá una cotización manual en Precios.'`
- `'cotizacion-manual-invalida'`: `'La cotización del dólar debe ser un número positivo.'`
- `'modo-cotizacion-invalido'`: `'El modo de cotización seleccionado no es válido.'`
- `'bcra-no-disponible'`: `'El servicio del BCRA no respondió. Verificá la conexión o cambiá a cotización manual.'`
- `'cotizacion-desactualizada'`: `'La cotización oficial del BCRA no se encuentra al día. Revisá el valor o ingresá una cotización manual.'`

---

## 8. Requisitos de la Especificación (REQ)

### REQ-USD-01 — Consulta y Cacheo de Cotización Automática BCRA
El sistema MUST consultar la API oficial del BCRA (`https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD`) bajo demanda en el servidor para obtener el `tipoCotizacion` de la moneda `USD` cuando el tenant esté en modo `automatica`.
- **Feliz**: el BCRA responde 200 con `tipoCotizacion`. Se almacena en `cotizacion_dolar` para la fecha actual del tenant con `desactualizada = false`.
- **N1**: API del BCRA no responde (timeout 5s o 5xx) y el tenant posee cotización anterior → se utiliza la cotización previa con bandera `desactualizada = true`.
- **N2**: API del BCRA no responde y el tenant no posee ninguna cotización previa → rechazo de la operación con slug `sin-cotizacion-dolar`.
- **N3**: Invocación desde otro tenant → RLS aísla la tabla `cotizacion_dolar`; ningún tenant puede leer ni pisar cotizaciones ajenas (0 filas).
- **N4**: Reintento: si la fila de hoy tiene `desactualizada = true` y una nueva operación la consulta, se reintenta el fetch al BCRA; si responde OK, actualiza la cotización y limpia la marca.
- **N5**: Sesión de revendedora del mismo tenant intenta consultar `cotizacion_dolar` vía PostgREST → 0 filas devueltas por policy restrictiva `restrict_revendedora_cotizacion_dolar`.

### REQ-USD-02 — Configuración y Carga de Cotización Manual
El sistema MUST permitir a usuarios autorizados conmutar el modo a `manual` y fijar un importe de cotización positivo.
- **Feliz**: operador con permiso `precios.editar_cotizacion` envía valor $1.600,00. Se actualiza `cotizacion_config.modo = 'manual'` y se inserta en `cotizacion_dolar` con `origen = 'manual'` para la fecha local de hoy.
- **N1**: Operador con permiso `precios.editar` pero SIN `precios.editar_cotizacion` intenta modificar la cotización → rechazo con error de autorización `no-permission`.
- **N2**: Operador envía valor 0 o negativo → rechazo con slug `cotizacion-manual-invalida`.
- **N3**: Invocación desde otro tenant → RLS aísla las tablas (0 filas / rechazo).
- **N4**: Sesión de revendedora del mismo tenant intenta leer o escribir `cotizacion_config` → rechazo por policy restrictiva `restrict_revendedora_cotizacion_config`.

### REQ-USD-03 — Conversión en Carga Inicial de Producto (Circuito A y B inicial)
Al dar de alta un producto nuevo con costo en `USD`, el sistema MUST convertir el importe a pesos a la cotización vigente a la fecha de carga antes de persistir en `costo_producto` y generar el ingreso inicial.
- **Feliz**: producto con costo inicial USD 100 y cotización vigente de $1.500 ARS. Se almacena `costo_producto.costo = 150000.00`, `costo_original_usd = 100.00`, `cotizacion_aplicada = 1500.00`, `cotizacion_fecha_valor = '2026-11-04'`. El stock físico (`item_producto.costo_ingreso`) se crea en $150.000,00 ARS.
- **N1**: No hay cotización vigente en el tenant (ni BCRA ni manual) → rechazo del alta con slug `sin-cotizacion-dolar`.
- **N2**: Monto en USD menor a 0 → rechazo por validación.

### REQ-USD-04 — Conversión en Ingresos de Mercadería y Remitos (Circuito B completo)
Al ingresar mercadería de productos existentes (mediante `NuevoIngresoView` / `crearIngresoCompletoAction`) o mediante importación de remito (`importarRemitoAction` / `sp_importar_remito`), si la línea o el ingreso especifica moneda `USD`, el sistema MUST convertir el costo unitario a pesos a la cotización vigente a la fecha de carga.
- **Feliz**: remito con línea de 10 unidades a USD 50,00 cada una; cotización vigente de $1.500 ARS. En `ingreso_mercaderia_detalle` se guarda `costo_unitario = 75000.00`, `costo_original_usd = 50.00`, `cotizacion_aplicada = 1500.00`, `cotizacion_fecha_valor = '2026-11-04'`. Al confirmar el ingreso, cada `item_producto.costo_ingreso` se registra en $75.000,00 ARS.
- **N1**: Ingreso en USD sin cotización vigente en el tenant → rechazo de la carga con slug `sin-cotizacion-dolar`.
- **N2**: Remito con fecha pasada → la conversión utiliza estrictamente la cotización vigente a la fecha de carga (decisión de negocio).
- **N3**: Línea de remito con costo unitario negativo → rechazo por validación de remito.

### REQ-USD-05 — Revaluación Masiva de Costos USD en Control de Precios
El sistema MUST permitir a usuarios con permiso `precios.editar_cotizacion` revaluar en lote todos los costos vigentes expresados en moneda `USD` al tipo de cambio vigente.
- **Feliz**: operador ejecuta "Revaluar costos USD al dólar vigente". Para cada producto con costo vigente donde `moneda = 'USD'`, se crea un nuevo registro en `costo_producto` mediante `sp_set_costo_producto` con `costo = round(costo_original_usd * cotizacion_vigente, 2)`, marcando su `precio_venta_desactualizado = true`. Las unidades físicas ya ingresadas en stock (`item_producto.costo_ingreso`) no se modifican.
- **N1**: Operador sin permiso `precios.editar_cotizacion` intenta ejecutar la revaluación → rechazo con error de autorización `no-permission`.
- **N2**: No hay cotización vigente disponible → rechazo con slug `sin-cotizacion-dolar`.
- **N3**: No existen productos vigentes con moneda `USD` → finaliza exitosamente con 0 productos revaluados.

### REQ-USD-06 — Invariante de Lectores de Costo Existentes
Los lectores de costos (`sp_recalcular_precio_venta`, `sp_control_de_precios`, `v_ganancia_por_producto`, `sp_listar_productos`, reportes de finanzas y rendiciones) MUST continuar operando sin modificaciones de código, consumiendo montos unificados en ARS.
- **Feliz**: se ejecuta `sp_recalcular_precio_venta` para un producto cuyo costo fue ingresado en USD y revaluado. La función lee `costo_producto.costo` en pesos, aplica la regla de margen y actualiza `precio_venta` en pesos correctamente.

---

## 9. Fuera de Alcance Explícito

1. **Venta o cobro en moneda extranjera**: el sistema no admite ventas, facturación ni cobranzas en USD. Todo el circuito de ventas y caja opera en pesos argentinos (ARS).
2. **Gastos, comisiones o liquidaciones en USD**: el módulo de gastos y las liquidaciones a revendedoras continúan exclusivamente en ARS.
3. **Consignación y rendiciones en USD**: los acuerdos de consignación de proveedores y sus rendiciones se liquidan en ARS.
4. **Precios de venta flotantes automáticos**: el precio de venta no se indexa en tiempo real automáticamente minuto a minuto con el dólar. Los precios se actualizan deliberadamente recalculándolos desde Control de Precios tras una revaluación de costos.
5. **Conversión retroactiva de ventas o ítems pasados**: no se modifican snapshots históricos de `detalle_venta` ni el `costo_ingreso` de ítems físicos ya creados.
6. **Pantalla ad-hoc para edición individual de costos**: `setCostoProductoAction` carece de UI y no se construirá una pantalla nueva para edición unitaria en esta versión.

---

## 10. Decisiones de Negocio Resueltas

1. **Evolución del precio de venta**: Se adopta la **Opción B**. Se implementa la acción masiva en Control de Precios "Revaluar costos USD al dólar vigente" (REQ-USD-05) que utiliza `sp_set_costo_producto` para actualizar el costo vigente en catálogo y marcar los precios de venta como desactualizados, sin tocar el `costo_ingreso` de las unidades físicas en stock. Permiso: `precios.editar_cotizacion`.
2. **Fecha de cotización en importación de remitos**: Se utiliza la **cotización vigente a la fecha de carga** del ingreso en el sistema, simplificando el circuito y evitando desfases con el stock físico.
3. **Pantalla para editar costos**: Queda **fuera de alcance**. No se construye interfaz para edición individual de `costo_producto`.
