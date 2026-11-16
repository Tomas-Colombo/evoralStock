# Design — chat-ayuda-v2

**Change**: `chat-ayuda-v2` · **Spec**: `specs/REQ-AYUDA-V2.md` · **Tareas**: `tasks.md`

## 1. Overview y contexto medido

En la versión inicial (`chat-ayuda`), el asistente fue diseñado con un enfoque determinista mono-pantalla:
- El archivo `lib/ayuda/guia/index.ts` agrupa 132 entradas (~76.000 caracteres de texto estructurado).
- Por cada turno, `consultarAyuda` inyecta la totalidad de los títulos y pasos de las entradas permitidas en el prompt, forzando a Gemini a emitir un esquema JSON estructurado (`responseSchema`) con un enum cerrado de 132 variantes para `entradaId`.
- Si el modelo retorna `entradaId: null`, todo el texto explicativo generado se descarta (REQ-AYUDA-06) y la UI cae en una tarjeta genérica fija.
- Si la respuesta requiere detalles, el sistema ejecuta una segunda llamada obligatoria consecutiva con `focoId` (REQ-AYUDA-07).
- En el Lote 0 de v1 se midieron ~2 s de latencia con `gemini-3-flash-preview` para una respuesta completa; no obstante, al carecer de streaming, el usuario queda bloqueado frente a un spinner sin feedback visual hasta que la respuesta entera (o la segunda llamada) finaliza.
- No hay contención transaccional de cuota por tenant en base de datos.

`chat-ayuda-v2` reemplaza esta arquitectura mediante:
1. Retrieval local BM25 en memoria (TypeScript puro) que reduce el contexto inyectado de 132 entradas a las 5–6 más relevantes con sus detalles completos.
2. Salida en texto plano puro, sin formato Markdown, con citas sintácticas `[[entrada-id]]`.
3. Streaming en tiempo real vía Server-Sent Events (SSE) con parser de citas interactivo en `TransformStream`.
4. Endpoint `POST /api/ayuda/chat` con compuertas locales en `app/api/ayuda/chat/` y manejo estricto de errores HTTP JSON previos al stream.
5. BM25 previo a la reserva de cuota: respuestas `sin_llm` no consumen cupo del tenant.
6. Reserva atómica previa de cuota diaria bajo `SECURITY INVOKER`, con separación de tablas (`limite_ayuda_tenant` vs `cuota_ayuda_diaria`) y triggers anti-adulteración.
7. Telemetría completa ejecutada de forma no bloqueante mediante `after()` de `next/server`.

---

## 2. Estimación de tokens y latencia: v1 vs v2

> [!IMPORTANT]
> Las cifras de v2 presentadas a continuación son **estimadas** con base en mediciones de longitud de la guía actual (132 entradas, ~76k caracteres a ~4 caracteres por token) y contratos de salida. En v1 se midió un tiempo base de ~2.000 ms con `gemini-3-flash-preview` en el Lote 0 (extendible a ~4.000 ms si ocurría la 2ª llamada). El impacto real de v2 se medirá empíricamente en producción mediante la telemetría transaccional detallada en §7.

| Métrica por turno | v1 (`chat-ayuda`) | v2 (`chat-ayuda-v2`) | Impacto proyectado |
| --- | --- | --- | --- |
| **Tokens de entrada (primer turno)** | ~19.000 tokens *(índice completo de 132 entradas + instrucciones)* | ~850 – 1.100 tokens *(instrucciones + top 5-6 entradas con detalles + pregunta)* | **Reducción de ~94% a 95%** |
| **Llamadas al proveedor por turno** | 1 o 2 llamadas *(si pide detalle, ejecuta 2da llamada completa de ~19k tokens)* | 1 llamada única *(detalles ya incluidos en las entradas recuperadas)* | **Eliminación de la 2ª llamada** |
| **Tokens de salida** | ~150 – 300 tokens *(JSON con clave `respuesta` y `entradaId`)* | ~200 – 400 tokens *(texto plano con sintaxis `[[id]]`)* | Similar volumen de texto útil |
| **Time-to-First-Token (TTFT)** | No aplica *(sin streaming: espera completa de ~2.000 a 4.000 ms)* | ~600 – 1.000 ms *(primer chunk emitido vía SSE al cliente)* | **Feedback interactivo inmediato** |
| **Latencia total percibida** | ~2.000 ms (hasta ~4.000 ms si hay 2ª llamada) | ~1.500 – 2.500 ms (con lectura progresiva en streaming) | **Lectura fluida token a token** |
| **Costo por turno (Gemini Flash GA)** | ~USD 0,0095 – 0,0190 por turno | ~USD 0,0005 – 0,0012 por turno | **Reducción de costo >90%** |
| **Turnos sin LLM (fallback BM25)** | 0% *(siempre consulta al LLM)* | ~10% – 20% de turnos a costo USD 0,00 | **Ahorro adicional y cuota intacta** |

### Plan de medición con telemetría de producción (§7)
La nueva migración incorpora a `consulta_ayuda` las columnas `tokens_input`, `tokens_output`, `tokens_cached`, `tokens_thinking`, `latencia_ms` y `modelo`. Se auditará mediante la consulta analítica periódica:
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

---

## 3. Arquitectura y layout de archivos

### Reglas de diseño y ubicación de código
- **Colocalización de compuertas (AGENTS.md: *"Used by one module → it lives in that module's folder"*):**
  Las compuertas del chat streaming se utilizan exclusivamente en el Route Handler de chat. Por consiguiente, viven en **`app/api/ayuda/chat/compuertas.ts`**. No se crea ninguna función compartida en `lib/` para este fin.
- **Aislamiento de `lib/ayuda/` (REQ-AYUDA-09):**
  `lib/ayuda/imports.test.ts` prohíbe que cualquier archivo en `lib/ayuda/**` importe `lib/dal`, `@supabase/*` o `next/headers`. El motor de búsqueda BM25, la tokenización, el TransformStream y los generadores de prompt son lógica pura en TypeScript que reside en `lib/ayuda/`.
- **Contratos tipados centralizados:**
  `lib/ayuda/tipos.ts` es modificado y cerrado exclusivamente en la fase de contratos (Fase 1); ninguna fase paralela posterior lo lista como propio.
- **Acceso a base de datos:**
  Las operaciones de cuota y telemetría de base de datos se implementan en `lib/dal/ayuda/cuota.ts` e `index.ts`.

```
app/
  api/ayuda/chat/
    route.ts                             ← Route Handler SSE (adaptador HTTP / stream)
    compuertas.ts                        ← Validación de Origin, sesión, rol, Zod y reserva de cuota
  (app)/ayuda/
    actions.ts                           ← calificarConsultaAyudaAction (Server Action preservada)
    PanelAyuda.tsx                       ← UI adaptada a consumo de stream SSE y tokens interactivos

lib/
  ayuda/
    tipos.ts                             ← EntradaGuia extendida con alias, tipos de streaming (cerrado en Fase 1)
    bm25.ts                              ← Motor puro de tokenización, normalización y BM25
    bm25.test.ts                         ← Tests unitarios con fixtures
    evaluacion.test.ts                   ← Suite de ~40 preguntas reales para calibrar umbral y peso 0.4
    stopwords.ts                         ← Stopwords en español con whitelist funcional estricta
    normalizar.ts                        ← Normalizador de texto y stemming liviano
    prompt.ts                            ← Generador de prompt con top 5-6 entradas y citas [[id]]
    stream.ts                            ← TransformStream parser de citas [[id]] y tokens de link
    stream.test.ts                       ← Tests de buffering, delimitadores partidos y límites
    gemini.ts                            ← Adaptador Gemini streaming con backoff y fallback
    guia/                                ← Entradas de la guía (se añade alias en entradas clave)
  dal/
    ayuda/
      index.ts                           ← Funciones DAL base (registro y calificación)
      cuota.ts                           ← Reserva atómica y liquidación de cuota diaria
  validation/
    ayuda.ts                             ← Esquemas zod strictObject para consulta streaming

scripts/
  ayuda-latencia.mts                     ← Extendido en Fase 0 para listar modelos de la API y medir TTFT en streaming

supabase/
  migrations/
    <siguiente>_ayuda_v2.sql             ← limite_ayuda_tenant, cuota_ayuda_diaria, consulta_ayuda extendida
```

---

## 4. Detalle de los componentes aprobados

### 4.1. Retrieval 100% local en memoria (BM25 en TypeScript)
- **Cero dependencias externas**: algoritmo BM25 clásico ($k_1 = 1.2$, $b = 0.75$) en TypeScript puro dentro de `lib/ayuda/bm25.ts`.
- **Campos indexados y ponderación**: `titulo` (peso 3.0), `alias` (peso 2.5), `pasos` (peso 1.0), `detalles` (peso 1.2).
- **Estructura en `EntradaGuia`**:
  ```ts
  export interface EntradaGuia {
    id: string
    titulo: string
    pasos: readonly string[]
    ruta?: `/${string}`
    permisos: readonly [Permiso, ...Permiso[]]
    detalles?: readonly DetalleGuia[]
    alias?: readonly string[] // Sinónimos operativos (ej: ['ticket', 'factura', 'cobro'])
  }
  ```
- **Normalización y Whitelist inmutable de palabras funcionales**:
  - Conversión a minúsculas, remoción de tildes y signos ortográficos no semánticos.
  - Stemming liviano en español para plurales y sufijos frecuentes (`-es`, `-s`, `-ción` → `-cion`).
  - Filtrado de stopwords tradicionales, **preservando terminantemente en clave y en query la siguiente whitelist de palabras funcionales (normalizadas sin tilde)**:
    `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`.
  - *Razón crítica*: descartar términos como "sin", "no" o "antes" invierte diametralmente la semántica de consultas como "cómo cobrar sin recargo", "anular venta no cobrada" o "devolución antes del cierre".
- **Filtrado previo por permisos (fail-closed)**:
  - Previo al cálculo del ranking, se ejecuta `filtrarGuia(GUIA, permisosEfectivos)`. Las entradas no autorizadas quedan totalmente excluidas del índice en ese turno.
- **Top 5–6 entradas**:
  - Se inyectan completas las mejores 5 a 6 entradas que superen el umbral de corte, con sus bloques de `detalles`.
- **Calibración con `lib/ayuda/evaluacion.test.ts`**:
  - Se crea una suite de evaluación con ~40 preguntas reales representativas de los módulos del sistema.
  - Aserciones estrictas: (1) la entrada esperada debe ubicarse en el top 5 recuperado; (2) consultas fuera de dominio ("cómo hacer café", "receta de empanadas") deben quedar bajo el umbral.
  - El umbral `UMBRAL_MINIMO_BM25` y el peso de turnos anteriores (0.4) se ajustan con base en estos tests.
- **Fallback sin LLM**:
  - Si el score de la mejor entrada queda por debajo de `UMBRAL_MINIMO_BM25`, el servidor emite inmediatamente respuesta `sin_llm` con sugerencias de las 3 entradas con mayor score relativo **SIN invocar a Gemini y SIN reservar cuota** (costo cero y cuota intacta).

### 4.2. Contexto multi-turno optimizado
- **Turnos anteriores en el query BM25**: si la petición incluye historial previo, los títulos y alias de las entradas citadas en el turno anterior se agregan al query BM25 con factor atenuado (peso 0.4, calibrado en `evaluacion.test.ts`).
- **Revalidación de citas previas del cliente**:
  - Los `ids` de citas del turno anterior enviados por el cliente se validan con Zod (kebab-case, longitud ≤ 64).
  - El servidor los contrasta contra las entradas permitidas para los permisos del operador: si un id no pertenece a las permitidas, se descarta para evitar inyecciones de contexto no autorizado.
- **Compresión de historial**:
  - Se conservan estrictamente los últimos 4 turnos (`usuario` / `asistente`).
  - Se eliminan del historial respuestas enlatadas del sistema, tarjetas de sugerencias y tokens de link, conservando el texto conversacional puro.

### 4.3. Prompting directo y conciso con modelo GA (Fase 0)
- **Estructura del prompt**:
  1. *System Instruction / Prefijo estable*: directivas estrictas de rol (asistente de navegación de Utopía, responder únicamente con base en las entradas provistas, citar con `[[id]]` exacto, prohibición de inventar rutas).
  2. *Entradas recuperadas*: texto completo de las 5–6 entradas seleccionadas por BM25, incluyendo sus pasos y bloques de detalles.
  3. *Historial reciente*: últimos 4 turnos comprimidos.
  4. *Pregunta actual*: pregunta del operador.
- **Formato de salida (sin Markdown)**:
  - El prompt exige explícitamente: **salida en texto plano puro, sin Markdown** (sin negritas `**`, sin itálicas, sin listas complejas con viñetas o numeración especial), intercalando únicamente las citas sintácticas con corchetes dobles: `[[venta-nueva]]`.
- **Selección de modelo y configuración (Fase 0)**:
  - La spec **no fija un modelo en código ni asume nombres de memoria**: en la Fase 0, `scripts/ayuda-latencia.mts` lista los modelos disponibles en la cuenta con `ai.models.list()` y mide empíricamente el TTFT en streaming de los modelos GA candidatos.
  - La persona elige el modelo principal (`GEMINI_MODEL`) y secundario (`GEMINI_MODEL_FALLBACK`) con base en las mediciones reales. Lección de v1: el listado de Google no garantiza que el endpoint `generateContent` funcione con nuestra clave.
  - Nivel de pensamiento: `thinkingBudget: 0` o `thinkingLevel: 'MINIMAL'` para acelerar el inicio del streaming.
  - `maxOutputTokens`: acotado a 800 tokens.
  - Resiliencia: 1 reintento con backoff exponencial (500 ms – 1500 ms con jitter) ante códigos HTTP 429 o 5xx, y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte** hacia el cliente. Una vez iniciado el streaming, si la conexión falla se emite un evento SSE de error.

### 4.4. Parser de citas en streaming (`TransformStream`)
- **Pipeline de streaming**:
  El flujo emitido por el SDK de Gemini pasa a través de un `TransformStream<string, EventoAyudaStream>`.
- **Buffer de delimitador y protección contra desborde**:
  - Cuando el parser detecta un corchete `[` o `[[`, suspende la emisión y retiene los caracteres siguientes en un buffer interno.
  - Si el buffer supera **80 caracteres** sin encontrar el cierre `]]`, el contenido acumulado se vacía de inmediato como texto literal ordinario (evitando retenciones indefinidas por texto malformado).
- **Resolución de citas**:
  - Al detectar `[[<id-candidato>]]`:
    - Se verifica si `<id-candidato>` pertenece a la lista blanca de entradas permitidas del turno.
    - *Si es válido*: emite un token estructurado SSE `tipo: 'link'` con `{ id, titulo, ruta }` resueltos desde la guía en TypeScript.
    - *Si es inválido*: se descarta la cita.
  - **Invariante crítica**: el modelo nunca emite rutas URL; las rutas provienen exclusivamente de la guía oficial en memoria del servidor.
- **Renderizado seguro en UI**:
  - El componente React `PanelAyuda` recibe eventos SSE de tipo `texto` y `link`.
  - Renderiza texto plano y botones/links tipados (`<Link href={evento.ruta}>`).
  - **Tratamiento de `sin_cita` (DR-AYUDA-V2-1)**: si el stream termina sin ninguna cita válida, la UI mantiene el texto en pantalla y agrega al pie la tarjeta fija de advertencia de v1.
  - **Uso de HTML prohibido**: cero llamadas a `dangerouslySetInnerHTML` ni librerías que inyecten HTML en el DOM, blindando al sistema contra ataques XSS.

### 4.5. Endpoint `POST /api/ayuda/chat` (SSE) y compuertas locales
- **Ubicación**: `app/api/ayuda/chat/route.ts` con compuertas colocalizadas en `app/api/ayuda/chat/compuertas.ts`.
- **Manejo de errores HTTP vs SSE**:
  - Toda falla de validación o compuerta previa al inicio del stream responde con código HTTP semántico y payload JSON `{ ok: false, reason: string }`.
  - Solo los errores ocurridos con el stream ya abierto viajan como evento SSE `{ tipo: 'error', reason: string }`.
- **Orden único de compuertas (estricto e innegociable)**:
  1. **Validación de `Origin`**: si `Origin` está ausente o no coincide con `Host` (o `x-forwarded-host`) → **HTTP 403 Forbidden** JSON `{ ok: false, reason: 'origin-invalido' }` de inmediato, sin tocar sesión ni base de datos.
  2. **`verifySession()`**: valida la cookie de sesión; **rechazo inmediato si `session.idRevendedora` está presente** retornando **HTTP 401 Unauthorized** JSON `{ ok: false, reason: 'no-permission' }` (alineado con los handlers de `app/api/`).
  3. **`requireModuleRole(session, 'ayuda', 'consultar')`**: si falla → **HTTP 403 Forbidden** JSON con slug de autorización o `module-disabled`.
  4. **Validación Zod `strictObject`**: parseo de `consultarAyudaChatSchema`; si falla → **HTTP 400 Bad Request** JSON `{ ok: false, reason: 'payload-invalido' }`.
  5. **`permisosEfectivos(session)`**: cálculo en memoria de los permisos válidos del operador.
  6. **Retrieval BM25 local**:
     - Si el score BM25 máximo queda bajo `UMBRAL_MINIMO_BM25`, se retorna inmediatamente respuesta de sugerencias `sin_llm` **SIN llamar a `sp_reservar_cuota_ayuda`** (la cuota no se reserva si no se consume el LLM).
  7. **Reserva atómica de cuota**: llamada a `sp_reservar_cuota_ayuda`. Si el límite diario fue alcanzado (o el límite configurado es < 1), la función lanza excepción y se retorna **HTTP 429 Too Many Requests** JSON `{ ok: false, reason: 'ayuda-cuota-excedida' }`.
  8. **Inicio del streaming SSE**: invocación al modelo y apertura de `ReadableStream` con `Content-Type: text/event-stream; charset=utf-8`.
- **Excepción justificada a "toda mutación es Server Action"**:
  Las Server Actions de React 19 no soportan respuestas chunked en tiempo real mediante `ReadableStream` y Server-Sent Events. El Route Handler es imprescindible para la entrega fluida token a token. `calificarConsultaAyudaAction` se mantiene como Server Action estándar.

### 4.6. Control de cuota atómica con `SECURITY INVOKER` y separación de tablas
- **Garantía anti-propagación de DEFINER**:
  `tests/db/rvp-lecturas.test.ts` (test 8) valida la lista blanca cerrada de DEFINER. Todas las funciones de cuota son **`SECURITY INVOKER`**.
- **Separación de tablas: límite vs contador**:
  1. **Tabla de límite configurado por tenant (`limite_ayuda_tenant`)**:
     - Clave primaria `id_tenant references tenant(id_tenant)`.
     - Campo `limite_diario integer not null default 100 check (limite_diario >= 0)`.
     - RLS activada con doble policy restrictiva: revendedora bloqueada (`auth_revendedora_id() is null`, guardia ACC-11) y permiso requerido (`(select auth_tiene_permiso('ayuda', 'consultar'))`).
     - Grant `SELECT` a `authenticated`; revocado `INSERT, UPDATE, DELETE` a `authenticated` (solo service-role, patrón 00117).
     - **Procedimiento de aprovisionamiento**: hasta que plataforma tenga UI en `PaquetesCard`, el operador inserta o actualiza filas vía SQL con clave `service_role`. Sin fila registrada, el sistema toma el valor por defecto de 100 consultas/día (`coalesce(limite_diario, 100)`).
  2. **Tabla de contador diario (`cuota_ayuda_diaria`)**:
     - Clave primaria compuesta `(id_tenant, fecha)`.
     - RLS activada con policy tenant (`id_tenant = auth_tenant_id()`), policy restrictiva de revendedora (ACC-11) y policy restrictiva por permiso (`auth_tiene_permiso('ayuda', 'consultar')`).
     - Grants estrictos por columna: `SELECT, INSERT (id_tenant, fecha, consultas_realizadas), UPDATE (consultas_realizadas) on cuota_ayuda_diaria to authenticated`. Revocado `DELETE`.
- **Triggers de seguridad e integridad temporal**:
  - **Uso estricto de fecha del tenant**: se utiliza `fn_hoy_tenant()` en todo el código SQL; se prohíbe terminantemente `current_date`.
  - **Trigger `BEFORE INSERT` (`fn_guardia_insert_cuota_ayuda`)**:
    Sobrescribe `new.fecha := fn_hoy_tenant()` e impide que se inserte un contador arbitrario exigiendo `new.consultas_realizadas in (0, 1)`.
  - **Trigger `BEFORE UPDATE` (`fn_guardia_update_cuota_ayuda`)**:
    Exige `new.consultas_realizadas > old.consultas_realizadas` (impide decrementos) y bloquea alteraciones a `id_tenant` o `fecha`.
- **Reserva atómica (`sp_reservar_cuota_ayuda`)**:
  Lee `limite_diario` de `limite_ayuda_tenant`. Si `v_limite < 1` (ej. tenant con cuota 0), lanza inmediatamente `'cuota-excedida'` antes de intentar cualquier inserción. Si no, ejecuta `INSERT ... ON CONFLICT DO UPDATE ... WHERE consultas_realizadas < v_limite RETURNING`. Si no retorna filas, lanza `'cuota-excedida'`.
- **Riesgo residual documentado**:
  Un empleado con permiso legítimo de ayuda puede agotar intencionalmente el cupo diario de su tenant ejecutando consultas continuas. El impacto queda acotado al cupo diario de ese tenant (sin costos descontrolados en Google Cloud) y la autoría se audita mediante `id_usuario` en `consulta_ayuda`.

### 4.7. Telemetría diferida con `after()` de `next/server` y evolución de esquema
- **Uso de `after()`**:
  El registro final en `consulta_ayuda` no bloquea el cierre del stream al cliente; se programa mediante `after(async () => { ... })`.
- **Migración de `entrada_id` a `entradas_citadas text[]`**:
  - Se agrega `entradas_citadas text[] not null default array[]::text[]`.
  - Se backfillea con `case when entrada_id is not null then array[entrada_id] else array[]::text[] end`.
  - Se agrega CHECK `consulta_ayuda_entradas_citadas_check`: `coalesce(cardinality(entradas_citadas), 0) <= 6 and array_to_string(entradas_citadas, ',') !~ '[^,]{65,}'`.
  - **Límite de caracteres de respuesta en DB**: se eleva `consulta_ayuda_respuesta_check` a 5.000 caracteres (`char_length(respuesta) <= 5000`) para acomodar `maxOutputTokens: 1000` en español (~4.000 caracteres) sin recortar en el DAL, preservando datos de telemetría íntegros para auditoría de calidad.
- **Ventana entre migración (`db push`) y deploy**:
  Antes de crear la versión extendida de `sp_registrar_consulta_ayuda`, la migración dropea explícitamente `sp_registrar_consulta_ayuda(uuid, text, text, text, text)`. Durante la ventana previa al deploy del nuevo frontend, las consultas de v1 fallarán al intentar registrarse en el SP dropeado; sin embargo, gracias al manejo fail-open de REQ-AYUDA-10, `consultarAyudaAction` captura el error, lo registra en `console.error` y la respuesta llega intacta al usuario. `sp_calificar_consulta_ayuda` no sufre cambios de firma y sigue operativo.
- **Reversibilidad y DOWN (`pnpm gate:db`)**:
  El script DOWN restaura la columna `entrada_id text`, mapea las filas existentes (`sin_cita` → `respondida` con primer citado o `fuera_de_opciones`, `sin_llm` → `fuera_de_opciones`), dropea las columnas nuevas, recrea los 4 CHECKs originales de v1 con sus nombres exactos, dropea la firma nueva y restaura la definición exacta de `sp_registrar_consulta_ayuda` proveniente de `00150`.

### 4.8. Reemplazo formal de especificaciones v1
- `REQ-AYUDA-05` (salida estructurada JSON): reemplazado por `REQ-AYUDA-V2-06` (texto plano sin markdown y citas sintácticas).
- `REQ-AYUDA-06` (descarte de texto si no hay entrada): reemplazado por `REQ-AYUDA-V2-08` (el texto explicativo se conserva y las citas se validan).
- `REQ-AYUDA-07` (dos llamadas consecutivas por turno): reemplazado por `REQ-AYUDA-V2-07` (llamada única con entradas completas).
- `REQ-AYUDA-10` (valores de resultado y `entrada_id`): reemplazado por `entradas_citadas text[]` y resultados que incorporan `sin_cita` y `sin_llm`.

### 4.9. Fase de limpieza de código deprecado
Para evitar deuda técnica y archivos muertos en el repositorio, la Fase 6 de implementación ejecuta la eliminación de:
- `consultarAyudaAction` en `app/(app)/ayuda/actions.ts`.
- `lib/ayuda/salida.ts`, `lib/ayuda/resolver.ts`, `lib/ayuda/consultar.ts`.
- Modo JSON y esquemas estructurados de `lib/ayuda/gemini.ts`.
- **Procedimiento innegociable**: antes de remover cualquier archivo o función, se ejecuta `rg "<simbolo>"` garantizando que ningún componente o test dependa de ellos.

---

## 5. Decisiones de diseño y puntos abiertos

- **DR-AYUDA-V2-1 (Cerrada / Propuesta aprobada) — Respuesta sin citas válidas:**
  Cuando el stream finaliza sin haber emitido ninguna cita válida a la guía, se registra en telemetría `resultado = 'sin_cita'` (con `entradas_citadas = []`), se conserva el texto transmitido en el chat y la UI agrega al final del mensaje la tarjeta fija de advertencia de v1: *"No tengo esa respuesta. Preguntale al administrador de tu negocio."*.
- **DR-AYUDA-V2-2 (Abierta) — Límite por defecto de cuota diaria:**
  Se establece provisionalmente en 100 consultas/día por tenant en `limite_ayuda_tenant`, editable por el operador mediante SQL con clave service-role hasta que exista UI en plataforma.
- **DR-AYUDA-V2-3 (Abierta / Fuera de v2) — Caché de respuestas por tenant:**
  Bajo `SECURITY INVOKER`, cualquier usuario con acceso al tenant podría inyectar respuestas adulteradas en la tabla de caché que luego serían leídas por sus compañeros (envenenamiento de caché interno). Por seguridad, el caché de respuestas queda postergado y fuera de las fases de implementación de v2. Se reevaluará con telemetría en producción.
- **DR-AYUDA-V2-4 (Cerrada) — Salida en texto plano sin Markdown:**
  El modelo emite texto plano directo (sin negritas ni listas con formato Markdown), conteniendo únicamente citas sintácticas `[[id]]`.
- **DR-AYUDA-V2-5 (Cerrada) — Reintento y fallback solo antes del primer byte:**
  Una vez emitido el primer token al cliente vía SSE, la conexión no admite conmutación transparente de modelo; los fallos posteriores emiten evento SSE de error.
- **DR-AYUDA-V2-6 (Cerrada) — Telemetría diferida con `after()`:**
  La persistencia en base de datos se programa de forma asíncrona tras la respuesta sin demorar el stream al cliente.
