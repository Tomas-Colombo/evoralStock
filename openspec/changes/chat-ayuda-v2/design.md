# Design — chat-ayuda-v2

**Change**: `chat-ayuda-v2` · **Spec**: `specs/REQ-AYUDA-V2.md` · **Tareas**: `tasks.md`

## 1. Overview y contexto medido

En la versión inicial (`chat-ayuda`), el asistente fue diseñado con un enfoque determinista mono-pantalla:
- El archivo `lib/ayuda/guia/index.ts` agrupa 132 entradas (~76.000 caracteres de texto estructurado).
- Por cada turno, `consultarAyuda` inyecta la totalidad de los títulos y pasos de las entradas permitidas en el prompt, forzando a Gemini a emitir un esquema JSON estructurado (`responseSchema`) con un enum cerrado de 132 variantes para `entradaId`.
- Si el modelo retorna `entradaId: null`, todo el texto explicativo generado se descarta (REQ-AYUDA-06) y la UI cae en una tarjeta genérica "fuera de opciones".
- Si la respuesta requiere detalles, el sistema ejecuta una segunda llamada obligatoria consecutiva con `focoId` (REQ-AYUDA-07).
- No hay streaming: el operador experimenta una espera de 4 a 10 segundos antes de leer el primer token.
- No hay contención transaccional de cuota por tenant en base de datos.

`chat-ayuda-v2` reemplaza esta arquitectura mediante:
1. Retrieval local BM25 en memoria (TypeScript puro) que reduce el contexto inyectado de 132 entradas a las 5–6 más relevantes con sus detalles completos.
2. Salida en texto plano con citas sintácticas `[[entrada-id]]`.
3. Streaming en tiempo real vía Server-Sent Events (SSE) con parser de citas interactivo en `TransformStream`.
4. Endpoint `POST /api/ayuda/chat` con validación CSRF temprana y compuertas estrictas colocalizadas en `app/api/ayuda/chat/`.
5. Reserva atómica previa de cuota diaria bajo `SECURITY INVOKER` con trigger anti-decrementos.
6. Telemetría completa ejecutada de forma no bloqueante mediante `after()` de `next/server`.

---

## 2. Estimación de tokens y latencia: v1 vs v2

> [!IMPORTANT]
> Las cifras presentadas a continuación son **estimadas** con base en mediciones de longitud de la guía actual (132 entradas, ~76k caracteres a ~4 caracteres por token) y contratos de salida. El impacto real se medirá de forma empírica en producción mediante la telemetría transaccional detallada en §7.

| Métrica por turno | v1 (`chat-ayuda`) | v2 (`chat-ayuda-v2`) | Impacto proyectado |
| --- | --- | --- | --- |
| **Tokens de entrada (primer turno)** | ~19.000 tokens *(índice completo de 132 entradas + instrucciones)* | ~850 – 1.100 tokens *(instrucciones + top 5-6 entradas con detalles + pregunta)* | **Reducción de ~94% a 95%** |
| **Llamadas al proveedor por turno** | 1 o 2 llamadas *(si pide detalle, ejecuta 2da llamada completa de ~19k tokens)* | 1 llamada única *(detalles ya incluidos en las entradas recuperadas)* | **Eliminación de la 2ª llamada** |
| **Tokens de salida** | ~150 – 300 tokens *(JSON con clave `respuesta` y `entradaId`)* | ~200 – 400 tokens *(texto fluido con sintaxis `[[id]]`)* | Similar volumen de texto útil |
| **Latencia Time-to-First-Token (TTFT)** | No aplica *(sin streaming: espera total de 4.000 a 8.500 ms)* | ~700 – 1.200 ms *(primer chunk emitido vía SSE al cliente)* | **Feedback interactivo inmediato** |
| **Latencia total percibida** | 4.000 a 8.500 ms (hasta 15.000 ms si hay 2ª llamada) | 2.000 a 3.500 ms (con lectura progresiva en streaming) | **Mejora de hasta 4x** |
| **Costo por turno (Gemini Flash GA)** | ~USD 0,0095 – 0,0190 por turno | ~USD 0,0005 – 0,0012 por turno | **Reducción de costo >90%** |
| **Turnos sin LLM (fallback BM25)** | 0% *(siempre consulta al LLM)* | ~10% – 20% de turnos a costo USD 0,00 | **Ahorro adicional directo** |

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
  Las compuertas del chat streaming se utilizan exclusivamente en el Route Handler de chat. Por consiguiente, viven en **`app/api/ayuda/chat/compuertas.ts`** (o integradas en `route.ts`). No se crea ninguna función compartida en `lib/` para este fin.
- **Aislamiento de `lib/ayuda/` (REQ-AYUDA-09):**
  `lib/ayuda/imports.test.ts` prohíbe que cualquier archivo en `lib/ayuda/**` importe `lib/dal`, `@supabase/*` o `next/headers`. El motor de búsqueda BM25, la tokenización, el TransformStream y los generadores de prompt son lógica pura en TypeScript que se ubica en `lib/ayuda/`.
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
    bm25.ts                              ← Motor puro de tokenización, normalización y BM25
    bm25.test.ts                         ← Tests unitarios con fixtures
    stopwords.ts                         ← Stopwords en español con whitelist funcional estricta
    normalizar.ts                        ← Normalizador de texto y stemming liviano
    prompt.ts                            ← Generador de prompt con top 5-6 entradas y citas [[id]]
    stream.ts                            ← TransformStream parser de citas [[id]] y tokens de link
    stream.test.ts                       ← Tests de buffering, delimitadores partidos y límites
    tipos.ts                             ← EntradaGuia extendida con alias, tipos de streaming
    gemini.ts                            ← Adaptador Gemini streaming con backoff y fallback
    guia/                                ← Entradas de la guía (se añade alias en entradas clave)
  dal/
    ayuda/
      index.ts                           ← Funciones DAL base (registro y calificación)
      cuota.ts                           ← Reserva atómica y liquidación de cuota diaria
  validation/
    ayuda.ts                             ← Esquemas zod strictObject para consulta streaming

scripts/
  ayuda-latencia.mts                     ← Extendido en Fase 0 para medir TTFT en streaming de modelos GA

supabase/
  migrations/
    <siguiente>_ayuda_v2.sql             ← Extensión de consulta_ayuda, cuota_ayuda_diaria y trigger
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
- **Fallback sin LLM**:
  - Si el score de la mejor entrada queda por debajo de `UMBRAL_MINIMO_BM25`, el servidor emite inmediatamente un evento SSE con sugerencias de las 3 entradas con mayor score relativo, sin consultar a Gemini (costo cero y latencia < 20 ms).

### 4.2. Contexto multi-turno optimizado
- **Turnos anteriores en el query BM25**: si la petición incluye historial previo, los títulos y alias de las entradas citadas en el turno anterior se agregan al query BM25 con un factor de atenuación (peso 0.4). La entrada activa en foco se conserva en el contexto.
- **Compresión de historial**:
  - Se conservan estrictamente los últimos 4 turnos (`usuario` / `asistente`).
  - Se eliminan del historial respuestas enlatadas del sistema, tarjetas de sugerencias y tokens de link, conservando el texto conversacional puro.

### 4.3. Prompting directo y conciso con modelo GA (Fase 0)
- **Estructura del prompt**:
  1. *System Instruction / Prefijo estable*: directivas estrictas de rol (asistente de navegación de Utopía, responder únicamente con base en las entradas provistas, citar con `[[id]]` exacto, prohibición de inventar rutas).
  2. *Entradas recuperadas*: texto completo de las 5–6 entradas seleccionadas por BM25, incluyendo sus pasos y bloques de detalles.
  3. *Historial reciente*: últimos 4 turnos comprimidos.
  4. *Pregunta actual*: pregunta del operador.
- **Formato de salida**: texto Markdown plano, natural, conciso y profesional. Toda referencia a una pantalla o acción debe citar su id entre corchetes dobles: `[[venta-nueva]]`. Cero esquemas JSON obligatorios.
- **Selección de modelo y configuración**:
  - La spec **no fija un modelo en código**: se configura vía variable de entorno `GEMINI_MODEL`, eligiendo una versión GA estable a partir de las mediciones de streaming de la Fase 0 (extendiendo `scripts/ayuda-latencia.mts` para medir Time-to-First-Token).
  - Nivel de pensamiento: `thinkingBudget: 0` o `thinkingLevel: 'MINIMAL'` para acelerar el inicio del streaming.
  - `maxOutputTokens`: acotado a 800 tokens.
  - Resiliencia: 1 reintento con backoff exponencial (500 ms – 1500 ms con jitter) ante códigos HTTP 429 o 5xx, y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte** hacia el cliente. Una vez iniciado el streaming, si la conexión falla se emite un evento de error de stream.

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
  - **Uso de HTML prohibido**: cero llamadas a `dangerouslySetInnerHTML` ni librerías que inyecten HTML en el DOM, blindando al sistema contra ataques XSS.

### 4.5. Endpoint `POST /api/ayuda/chat` (SSE) y compuertas locales
- **Ubicación**: `app/api/ayuda/chat/route.ts` con sus compuertas en `app/api/ayuda/chat/compuertas.ts`.
- **Orden único de compuertas (estricto e innegociable)**:
  1. **Validación de `Origin` contra `Host` (o `x-forwarded-host`)**: rechazo inmediato con `403 Forbidden` si difieren, **sin tocar la sesión ni la base de datos**. Mitiga ataques CSRF directos sobre el Route Handler.
  2. **`verifySession()`**: valida la cookie de sesión; **rechazo inmediato si `session.idRevendedora` está presente** lanzando `AuthorizationError('no-permission')` / `401 Unauthorized` (alineado con todos los handlers de `app/api/`).
  3. **`requireModuleRole(session, 'ayuda', 'consultar')`**: valida que el rol tenga el permiso y el paquete esté activo.
  4. **Validación Zod `strictObject`**: parseo de `consultarAyudaChatSchema` desde `lib/validation/ayuda.ts`.
  5. **`permisosEfectivos(session)`**: cálculo en memoria de los permisos válidos del operador.
  6. **Reserva atómica de cuota**: llamada a `sp_reservar_cuota_ayuda`.
- **Excepción justificada a "toda mutación es Server Action"**:
  Las Server Actions de React 19 no soportan respuestas chunked en tiempo real mediante `ReadableStream` y Server-Sent Events. El Route Handler es imprescindible para la entrega fluida token a token. `calificarConsultaAyudaAction` se mantiene como Server Action estándar.

### 4.6. Control de cuota atómica con `SECURITY INVOKER`
- **Garantía anti-propagación de DEFINER**:
  `tests/db/rvp-lecturas.test.ts` (test 8) valida la lista blanca cerrada de DEFINER. Todas las funciones de cuota son **`SECURITY INVOKER`**.
- **Tabla `cuota_ayuda_diaria`**:
  ```sql
  create table if not exists cuota_ayuda_diaria (
    id_tenant             uuid not null references tenant(id_tenant) on delete cascade,
    fecha                 date not null,
    consultas_realizadas  integer not null default 0,
    limite_diario         integer not null default 100,
    primary key (id_tenant, fecha)
  );
  ```
- **Protección contra manipulación por PostgREST**:
  - `grant select, insert, update (consultas_realizadas) on cuota_ayuda_diaria to authenticated;`
  - `revoke delete on cuota_ayuda_diaria from authenticated;`
  - **Trigger `BEFORE UPDATE`**: impide que un usuario decremente el contador o altere `id_tenant`, `fecha` o `limite_diario`:
    ```sql
    create or replace function fn_guardia_cuota_ayuda() returns trigger
    language plpgsql security invoker set search_path = public, pg_temp as $$
    begin
      if new.consultas_realizadas < old.consultas_realizadas then
        raise exception 'cuota-decremento-prohibido' using errcode = '42501';
      end if;
      if new.id_tenant is distinct from old.id_tenant or new.fecha is distinct from old.fecha or new.limite_diario is distinct from old.limite_diario then
        raise exception 'cuota-modificacion-invalida' using errcode = '42501';
      end if;
      return new;
    end;
    $$;
    ```
  - **Límite diario protegido**: el campo `limite_diario` solo puede ser configurado mediante procedimientos del operador/super-admin (patrón de migración `00117`).
- **Reserva atómica (`sp_reservar_cuota_ayuda`)**:
  ```sql
  insert into cuota_ayuda_diaria (id_tenant, fecha, consultas_realizadas, limite_diario)
  values (v_tenant, current_date, 1, 100)
  on conflict (id_tenant, fecha) do update
    set consultas_realizadas = cuota_ayuda_diaria.consultas_realizadas + 1
    where cuota_ayuda_diaria.consultas_realizadas < cuota_ayuda_diaria.limite_diario
  returning consultas_realizadas;
  ```
  Si no retorna filas, lanza `cuota-excedida`.

### 4.7. Telemetría diferida con `after()` de `next/server`
- **Uso de `after()`**:
  El registro final en `consulta_ayuda` no bloquea el cierre del stream al cliente; se programa mediante `after(async () => { ... })`.
- **Datos registrados**:
  - `resultado`: `'respondida'` | `'sin_llm'` | `'fuera_de_opciones'` | `'error'`
  - `tipo_error`: kebab-case slug si hubo fallo
  - `latencia_ms`: tiempo transcurrido desde el inicio de la petición
  - `modelo`: identificador del modelo o `'sin_llm'`
  - `tokens_input`, `tokens_output`, `tokens_cached`, `tokens_thinking` extraídos de `usageMetadata`
- **Comportamiento si la plataforma corta la función**:
  - Se define `export const maxDuration = 30` en el Route Handler.
  - En Vercel Serverless, `after()` mantiene el contenedor vivo hasta completar la promesa o alcanzar `maxDuration`.
  - **Garantía financiera ante corte abrupto**: dado que la cuota se reservó de forma atómica en el paso inicial previo a invocar a Gemini, el techo de consumo del tenant queda protegido aun si la función se interrumpe y la fila de telemetría no llega a persistirse.

### 4.8. Reemplazo formal de especificaciones v1
- `REQ-AYUDA-05` (salida estructurada JSON): reemplazado por `REQ-AYUDA-V2-06` (texto plano y citas sintácticas).
- `REQ-AYUDA-06` (descarte de texto si no hay entrada): reemplazado por `REQ-AYUDA-V2-08` (el texto explicativo se conserva y las citas se validan).
- `REQ-AYUDA-07` (dos llamadas consecutivas por turno): reemplazado por `REQ-AYUDA-V2-07` (llamada única con entradas completas).
- `REQ-AYUDA-10` (valores de resultado): se amplía el dominio de `resultado` a `('respondida', 'sin_llm', 'fuera_de_opciones', 'error')` y se elimina la exigencia de `entrada_id is not null` para respuestas fluidas.

---

## 5. Decisiones de diseño y puntos abiertos

- **DR-AYUDA-V2-1 (Abierta) — Respuesta sin citas válidas con texto emitido en streaming:**
  - *Contexto*: El modelo genera un texto correcto respondiendo una duda conceptual general (ej. "¿qué es una venta en consignación?"), pero no cita ninguna pantalla `[[id]]` específica o las citas usadas no pertenecen a la whitelist. Como el texto ya se transmitió progresivamente en streaming al usuario, no puede ocultarse.
  - *Opciones*:
    - **A (Recomendada)**: Mantener el texto tal cual en la UI, registrar `resultado = 'respondida'` con lista de citas vacía, y opcionalmente mostrar al pie una leyenda informativa: *"Esta respuesta no enlaza a una pantalla específica."*
    - **B**: Marcar la consulta en telemetría como `'fuera_de_opciones'` y agregar al final una tarjeta sugiriendo consultar al administrador.
- **DR-AYUDA-V2-2 (Abierta) — Límite de cuota diaria por defecto:**
  - Se establece provisionalmente en 100 consultas/día por tenant. El super admin podrá ajustarlo por tenant en la tabla `cuota_ayuda_diaria`.
- **DR-AYUDA-V2-3 (Abierta / Postergada) — Caché de respuestas por tenant:**
  - Bajo `SECURITY INVOKER`, cualquier usuario con acceso al tenant podría insertar respuestas adulteradas en la tabla de caché que luego serían leídas por sus compañeros (envenenamiento de caché interno).
  - Por esta razón, el caché **se deja fuera de las fases de implementación de v2**. Se evaluará en base a la telemetría real si el costo y la latencia justifican resolver la seguridad del caché o si el motor BM25 ya cumple holgadamente con los objetivos.
