# Asistente de ayuda (Chat IA)

Guía operativa para despliegue, configuración y mantenimiento del módulo `ayuda` (v2).

## Variables de entorno y modelos

- `GEMINI_API_KEY` (opcional, solo servidor): Clave de API de Google AI Studio. Sin esta variable el panel de ayuda no se renderiza en ninguna pantalla, el Route Handler responde `503 ayuda-no-disponible` y las acciones retornan error de disponibilidad. Nunca se expone al cliente ni se registra en logs ni telemetría.
- `GEMINI_MODEL` (opcional, solo servidor, valor por defecto: `gemini-3.5-flash-lite`): Identificador del modelo de lenguaje principal. Debe ser un modelo General Availability (GA) estable para producción.
- `GEMINI_MODEL_FALLBACK` (opcional, solo servidor, valor por defecto: `gemini-3-flash-preview`): Modelo secundario de contingencia. Se utiliza si la llamada inicial falla con error 429 o 5xx tras un reintento con backoff exponencial, **únicamente antes de emitir el primer byte** hacia el cliente.
  > [!WARNING]
  > El modelo de fallback actual (`gemini-3-flash-preview`) es una versión **preview**: Google puede modificar su comportamiento, cuota o discontinuarlo sin previo aviso. Debe ser monitoreado y reemplazado cuando surja una alternativa GA liviana.

> **Importante:** No incluir claves reales ni placeholders sensibles en archivos versionados.

### Medición de TTFT y cómo cambiar de modelo

Antes de actualizar `GEMINI_MODEL` o `GEMINI_MODEL_FALLBACK`:
1. Listar y medir empíricamente el tiempo al primer token (TTFT) y tiempo total de streaming ejecutando:
   ```bash
   # Listar modelos disponibles en la cuenta:
   node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts --listar

   # Medir TTFT y duración (3 corridas con prompt realista):
   node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts gemini-3.5-flash-lite gemini-3-flash-preview
   ```
   **Lección aprendida:** El listado devuelto por `ai.models.list()` de Google Cloud no garantiza que `generateContentStream` funcione con nuestra clave ni plan. Solo deben seleccionarse modelos que hayan respondido exitosamente a la medición empírica.
2. Verificar que el TTFT promedio esté por debajo de 1.000 ms y la latencia total por debajo de 3.000 ms.
3. Definir las variables `GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK` en el entorno de ejecución (ej. Vercel).

## Cuota diaria por tenant

A diferencia de v1, el consumo del asistente está estrictamente delimitado a nivel tenant para evitar facturación descontrolada o abusos:

- **Tabla `limite_ayuda_tenant`**:
  - Almacena el cupo máximo diario asignado a cada comercio (`limite_diario integer default 100`).
  - RLS activada: grant `SELECT` para usuarios autenticados; permisos `INSERT, UPDATE, DELETE` revocados para `authenticated`.
  - **Gestión por el operador**: Es administrado exclusivamente por el operador de plataforma utilizando la clave `service-role`. Si un tenant no tiene fila explícita en esta tabla, el sistema asume el valor por defecto de **100 consultas diarias**.
- **Tabla `cuota_ayuda_diaria`**:
  - Clave primaria compuesta `(id_tenant, fecha)`.
  - Registra las consultas consumidas en el día.
  - **Integridad temporal**: Se utiliza estrictamente la fecha local del negocio provista por `fn_hoy_tenant()`. Está terminantemente prohibido usar `current_date` o fechas del servidor.
  - **Triggers de seguridad**:
    - `trg_guardia_insert_cuota_ayuda`: Fuerza `fecha = fn_hoy_tenant()` y restringe el valor inicial a 0 o 1 (`consultas_realizadas in (0, 1)`).
    - `trg_guardia_update_cuota_ayuda`: Bloquea modificaciones sobre `id_tenant` y `fecha`, y rechaza cualquier decremento del contador (`new.consultas_realizadas > old.consultas_realizadas`).
- **Reserva atómica (`sp_reservar_cuota_ayuda`)**:
  - Función `SECURITY INVOKER` que valida el límite diario y reserva el cupo atómicamente antes de invocar a Gemini. Si la cuota fue alcanzada o el límite es menor a 1, levanta el error `cuota-excedida` (retornando HTTP 429 al cliente).

## Flujo SSE y compuertas locales (Route Handler)

El chat v2 opera mediante Server-Sent Events (SSE) a través de `POST /api/ayuda/chat`.

### Compuertas locales innegociables

Antes de iniciar la conexión en streaming, la petición atraviesa 7 compuertas estrictas y secuenciales colocalizadas en `app/api/ayuda/chat/compuertas.ts`:
1. **Validación de `Origin`**: Si el header falta o no coincide con `Host` / `x-forwarded-host`, rechaza inmediatamente con HTTP 403 JSON `{ ok: false, reason: 'origin-invalido' }`.
2. **`verifySession()`**: Rechaza de inmediato a revendedoras con HTTP 401 JSON `{ ok: false, reason: 'no-permission' }`.
3. **`requireModuleRole(session, 'ayuda', 'consultar')`**: Si el operador no tiene permiso o el paquete está deshabilitado, rechaza con HTTP 403 JSON `{ ok: false, reason: 'no-permission' | 'module-disabled' }`.
4. **Validación Zod (`strictObject`)**: Valida `consultarAyudaChatSchema` (pregunta 1..300 caracteres, historial de hasta 4 turnos con citas previas en kebab-case). Si falla, retorna HTTP 400 JSON `{ ok: false, reason: 'payload-invalido' }`.
5. **Permisos efectivos**: Calcula los permisos autorizados del operador para filtrar la guía en memoria (`filtrarGuia`).
6. **Retrieval BM25 local**: Si el score normalizado máximo queda por debajo de `UMBRAL_MINIMO_BM25`, se retorna una respuesta inmediata de sugerencias con resultado `sin_llm` **SIN reservar cuota y SIN llamar al modelo** (ahorro total de costo y cuota intacta).
7. **Reserva de cuota**: Se invoca a `sp_reservar_cuota_ayuda`. Si el tenant superó su cuota diaria, responde con HTTP 429 JSON `{ ok: false, reason: 'cuota-excedida' }`.

### Eventos del Stream SSE

Una vez superadas las compuertas, se abre el stream con header `Content-Type: text/event-stream; charset=utf-8`:
- `{ tipo: 'texto', contenido: string }`: Chunks de texto progresivo en texto plano sin Markdown.
- `{ tipo: 'link', id: string, titulo: string, ruta: string }`: Token interactivo emitido cuando el parser de citas detecta una referencia `[[id]]` autorizada. La ruta proviene exclusivamente de la guía oficial en memoria (el modelo nunca emite rutas URL).
- `{ tipo: 'error', reason: string }`: Emitido si ocurre una falla posterior al inicio del stream.
- **Evento `fin` (DR-AYUDA-V2-7)**: Último evento emitido al completar el stream:
  ```json
  { "tipo": "fin", "idConsulta": "uuid-o-null", "resultado": "respondida" | "sin_cita" | "sin_llm" }
  ```
  `idConsulta` viaja en este evento para que la UI pueda habilitar los botones de calificación mediante `calificarConsultaAyudaAction`. Si el registro de telemetría falló, `idConsulta` es `null` (fail-open: el usuario lee su respuesta de todos modos).

## Umbral BM25 y cómo recalibrarlo

El motor de retrieval local (`lib/ayuda/bm25.ts`) opera en TypeScript puro sin dependencias externas:
- **Ponderaciones**: `titulo` (3.0), `alias` (2.5), `detalles` (1.2), `pasos` (1.0).
- **Turno previo**: Los títulos y alias de las citas del turno anterior se agregan con factor atenuado `PESO_TURNO_PREVIO = 0.4`.
- **Palabras funcionales (Whitelist estricta)**: Aunque se filtran stopwords comunes, se preservan terminantemente en clave y query las palabras: `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`, para evitar invertir el sentido de consultas críticas.
- **Score normalizado y umbral**:
  El score BM25 se normaliza en el rango $[0, 1]$ mediante $\frac{\text{score}}{\text{score} + 10}$. El umbral actual es:
  ```ts
  export const UMBRAL_MINIMO_BM25 = 0.28
  ```
  Este valor asegura un margen de separación limpio entre consultas fuera de dominio (máximo medido: 0.2642) y consultas legítimas de la aplicación (mínimo de dominio en control: 0.3114).

### Recalibración con `evaluacion.test.ts`

Cada vez que se añadan nuevas entradas o alias a `lib/ayuda/guia/`, se debe ejecutar la suite de evaluación:
```bash
npx vitest run lib/ayuda/evaluacion.test.ts
```
La suite valida:
1. **Recall@5**: Que el 100% de los casos de dominio ubiquen la entrada esperada dentro de las 5 mejores opciones.
2. **Margen de corte**: Que ninguna pregunta fuera de dominio supere `UMBRAL_MINIMO_BM25` y que todas las preguntas legítimas superen el umbral con margen positivo.

## Telemetría en `consulta_ayuda`

Para auditar calidad, rendimiento y costos sin penalizar la latencia del usuario, el registro de cada consulta se realiza de forma asíncrona no bloqueante mediante la primitiva `after()` de `next/server`.

La tabla `consulta_ayuda` almacena:
- `entradas_citadas text[]`: Lista de IDs citados en la respuesta (máximo 6 elementos, validados contra la guía).
- `resultado`: `'respondida'` | `'sin_cita'` | `'sin_llm'` | `'fuera_de_opciones'` | `'error'`.
- `latencia_ms`: Tiempo transcurrido en milisegundos desde el inicio del request hasta el cierre del stream.
- `modelo`: Identificador del modelo que respondió efectivamente (o modelo fallback si conmutó).
- `tokens_input`, `tokens_output`, `tokens_cached`, `tokens_thinking`: Conteo extraído de los metadatos de uso de Gemini.
- `tipo_error`: Clasificación del fallo si ocurrió (`'sin-clave'`, `'timeout'`, `'proveedor'`, `'cuota-excedida'`, etc.).

### Consulta analítica de monitoreo

```sql
select
  resultado,
  count(*) as total_consultas,
  round(avg(latencia_ms)) as latencia_promedio_ms,
  round(avg(tokens_input)) as tokens_in_promedio,
  round(avg(tokens_output)) as tokens_out_promedio
from consulta_ayuda
where created_at >= now() - interval '7 days'
group by resultado;
```

## Tratamiento y privacidad de datos

- **Sin región fija de datos**: La API de Google AI Studio / Gemini no ofrece garantías de residencia regional; Google puede procesar y cachear los datos en centros de cómputo de cualquier país.
- **Aislamiento absoluto del tenant**: Bajo ninguna circunstancia se envían datos del tenant (clientes, ventas, montos ni stock) al modelo (`lib/ayuda/imports.test.ts` garantiza que `lib/ayuda` no importe el DAL ni Supabase).
- **Prompt seguro**: El modelo únicamente recibe las 5-6 entradas recuperadas por BM25, los últimos 4 turnos de la conversación y la pregunta actual del operador.
- **Advertencia en UI**: El panel de ayuda informa al usuario: *"No escribas datos de clientes."*

## Habilitación del paquete por tenant

- **Gestión por Super Admin**: `ayuda` es un paquete opcional (`PAQUETES_OPCIONALES.ayuda = ['ayuda']`). Lo activa o desactiva el super admin desde `/plataforma/[id]`. El administrador del tenant no tiene permisos para modificarlo (migración 00117).
- **Asignación de permisos**: El rol `Administrador` de cada tenant incluye el permiso `ayuda.consultar`. Para otros roles, se asigna desde el editor de roles en `/administracion`.

## Reglas de mantenimiento de la guía

- Si agregás o modificás una pantalla, un botón o un permiso en el sistema, actualizá el archivo de área correspondiente en `lib/ayuda/guia/`.
- El test automatizado `lib/ayuda/guia/cobertura.test.ts` valida que toda ruta de la guía exista en `app/(app)` y que ninguna página estática nueva quede sin cobertura explicada.
