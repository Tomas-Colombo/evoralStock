# Propuesta — chat-ayuda-v2

**Change**: `chat-ayuda-v2` · **Spec**: `specs/REQ-AYUDA-V2.md` · **Diseño**: `design.md` · **Tareas**: `tasks.md`

## Problema

La guía del asistente de ayuda creció a 132 entradas (~76.000 caracteres de texto estructurado). En la versión 1 (implementada en `chat-ayuda`), cada consulta del operador envía el índice completo de las 132 entradas dentro del prompt (~19.000 tokens de entrada por turno). Sobre ese volumen, se fuerza a Gemini a responder bajo un esquema JSON rígido (`responseSchema` con enum de 132 variantes) seleccionando una única entrada o `null`.

Este diseño presenta limitaciones críticas:
1. **Consumo masivo e ineficiente de tokens**: cada turno consume ~19.000 tokens de entrada, y si la respuesta requiere detalles se ejecuta una segunda llamada obligatoria consecutiva con `focoId` (REQ-AYUDA-07), duplicando el costo y la latencia.
2. **Latencia y falta de streaming**: aunque en el Lote 0 de v1 se midieron ~2 s con `gemini-3-flash-preview`, la ausencia de streaming bloquea la UI con un spinner estático hasta completar la respuesta entera (o el doble si hay 2ª llamada).
3. **Pérdida de respuestas útiles**: si el modelo evalúa que ninguna entrada individual resuelve de forma exacta la consulta y retorna `null`, el texto explicativo generado se descarta por completo (REQ-AYUDA-06) y se muestra una tarjeta estática fija.
4. **Falta de control de cuota por tenant**: no existe un techo transaccional por tenant en la base de datos; la única contención es la cuota global del proyecto en Google Cloud.
5. **Rigidez mono-entrada**: no permite articular respuestas fluidas que combinen referencias o pasos de más de un flujo ni enriquecer el diálogo en turnos sucesivos.

## Decisión

Reemplazar la arquitectura de envío total de índice y respuesta JSON estática por un pipeline optimizado:

1. **Retrieval 100% local en memoria (BM25 en TypeScript)**:
   - Se rankea la guía curada en memoria sin dependencias externas, sin modelos de embeddings ni llamadas de red.
   - Normalización de texto: minúsculas, remoción de tildes, stemming liviano en español y filtrado de stopwords, **preservando en clave y en query una whitelist estricta de palabras funcionales que alteran el significado (normalizadas sin tilde)**:
     `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`.
   - Se agrega un campo opcional `alias: readonly string[]` en `EntradaGuia` para incorporar sinónimos operativos con boost de relevancia en el scoring.
   - El filtrado por permisos efectivos del usuario es **fail-closed y previo al rankeo** (idéntico a v1).
   - Calibración empírica en `lib/ayuda/evaluacion.test.ts` con ~40 preguntas reales: valida que la entrada esperada figure en el top 5 y que preguntas fuera de dominio queden bajo el umbral.
   - Top 5 a 6 entradas completas con sus detalles se inyectan al prompt.
   - Si el score BM25 máximo queda por debajo del umbral, se devuelve de inmediato respuesta `sin_llm` con sugerencias de entradas cercanas **SIN reservar cuota ni invocar a Gemini**.

2. **Contexto multi-turno optimizado**:
   - En turnos de seguimiento, se incorporan al query BM25 los títulos y alias de las entradas citadas en el turno anterior con factor de peso atenuado (0.4, calibrado con la suite de evaluación).
   - Los ids de citas previos enviados por el cliente se revalidan contra las entradas permitidas del usuario (Zod ≤ 64; se descartan si no están permitidos).
   - Historial comprimido: ventana máxima de 4 turnos recientes, excluyendo respuestas enlatadas o tarjetas de sugerencias.

3. **Prompting directo y conciso con modelo GA (Fase 0)**:
   - Estructura del prompt: prefijo de sistema/instrucciones estable + bloque de top 5-6 entradas recuperadas + historial breve + pregunta actual.
   - Salida del modelo en **texto plano puro, sin Markdown** (sin negritas ni listas formateadas) con citas sintácticas `[[entrada-id]]`. El prompt lo exige explícitamente.
   - La spec **no fija modelo de memoria ni umbrales inventados**: la Fase 0 lista los modelos disponibles para la clave (`ai.models.list()`) y mide TTFT en streaming de los modelos GA candidatos; la persona elige con los números reales en mano (lección de v1: el listado de Google no garantiza disponibilidad real).
   - 1 reintento con backoff exponencial ante errores 429/5xx y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte**.

4. **Parser de citas al vuelo en streaming (`TransformStream`)**:
   - Endpoint HTTP con Server-Sent Events (SSE).
   - Un `TransformStream` intercepta los chunks del modelo, acumulando texto únicamente cuando detecta un delimitador de apertura `[` o `[[` hasta el cierre `]]`, con un límite de seguridad (80 caracteres) que emite texto literal si se supera el buffer sin cerrar la etiqueta.
   - Toda cita `[[entrada-id]]` cerrada se valida contra la whitelist de entradas permitidas del turno. Si es válida, se emite un evento/token de link tipado con título y ruta resueltos en el servidor desde la guía; si es inválida, se descarta. La ruta nunca sale del modelo.
   - El cliente renderiza texto y componentes React de navegación, **nunca HTML crudo** (`dangerouslySetInnerHTML` prohibido).

5. **Endpoint `POST /api/ayuda/chat` (SSE), compuertas y errores tipados**:
   - Route Handler en Next.js App Router.
   - **Compuertas colocalizadas en `app/api/ayuda/chat/`**: no se crea función compartida en `lib/` (AGENTS: *"Used by one module → its folder"*).
   - **Manejo de errores estricto**:
     - Errores de compuertas (previos al stream): retornan respuesta HTTP con JSON `{ ok: false, reason: string }` y status HTTP semántico (401, 403, 400, 429).
     - Errores posteriores al inicio del stream: viajan como eventos SSE `{ tipo: 'error', reason: string }`.
   - **Orden único de ejecución**:
     1. Validación `Origin`: ausente o no coincidente con `Host` (o `x-forwarded-host`) → 403 Forbidden HTTP JSON inmediato, sin tocar sesión ni DB.
     2. `verifySession()`: rechazo inmediato de `session.idRevendedora` con 401 (`no-permission`) HTTP JSON.
     3. `requireModuleRole(session, 'ayuda', 'consultar')`: 403 HTTP JSON si no tiene rol o módulo apagado.
     4. Validación Zod `strictObject`: 400 `payload-invalido` HTTP JSON.
     5. `permisosEfectivos(session)`.
     6. Retrieval BM25 local sobre entradas autorizadas:
        - Si el score queda bajo el umbral de corte → respuesta `sin_llm` (sugerencias) **SIN reservar cuota**.
     7. Si supera el umbral y se va a llamar a Gemini: **reserva atómica de cuota diaria**. Si la cuota fue alcanzada → 429 `cuota-excedida` HTTP JSON.
     8. Inicio del streaming SSE.

6. **Control de cuota atómica con `SECURITY INVOKER`**:
   - Separación estricta de tablas:
     - `limite_ayuda_tenant(id_tenant pk, limite_diario)`: solo modificable por el operador con clave service-role (patrón 00117); el rol `authenticated` solo tiene permiso `SELECT`.
     - `cuota_ayuda_diaria(id_tenant, fecha, consultas_realizadas)`: el rol `authenticated` recibe grants por columna para `INSERT (id_tenant, fecha, consultas_realizadas)` y `UPDATE (consultas_realizadas)`, sin grant de `DELETE`.
   - Reglas de integridad mediante triggers y fechas de tenant:
     - Se reemplaza `current_date` por `fn_hoy_tenant()` en todo el diseño.
     - Trigger `BEFORE INSERT`: fuerza `fecha = fn_hoy_tenant()` y valida `consultas_realizadas in (0, 1)`.
     - Trigger `BEFORE UPDATE`: garantiza que el contador solo se incremente (`new.consultas_realizadas > old.consultas_realizadas`) e impide modificar `id_tenant` o `fecha`.
   - **Riesgo residual documentado**: un empleado del tenant con permiso legítimo de ayuda puede agotar intencionalmente el cupo diario de su comercio ejecutando consultas en bucle.
   - Reserva de cuota atómica mediante `sp_reservar_cuota_ayuda` (SECURITY INVOKER).

7. **Telemetría diferida con `after()` de `next/server`**:
   - Registro final en `consulta_ayuda` mediante `after()`, liberando el stream al cliente.
   - Se migra la columna `entrada_id text` a `entradas_citadas text[]` (con backfill automático desde `entrada_id` y bloque DOWN).
   - Se registra: `resultado` (`'respondida'`, `'sin_cita'`, `'sin_llm'`, `'fuera_de_opciones'`, `'error'`), latencia en ms, modelo utilizado y desglose de tokens (`input`, `output`, `cached`, `thinking`) extraídos de `usageMetadata`.

8. **Invariantes y limpieza de código deprecado**:
   - Cero datos del tenant al modelo (REQ-AYUDA-09 e `imports.test.ts`).
   - `lib/ayuda/tipos.ts` es modificado exclusivamente en la fase inicial de contratos (ninguna otra fase lo toca).
   - Fase de limpieza dedicada que retira `consultarAyudaAction`, `salida.ts`, `resolver.ts`, `consultar.ts` y el modo JSON de `gemini.ts` tras verificar con `rg` que no existan importadores.
   - Actualización de `docs/ayuda.md` en la fase final de cierre.

## Reemplazo explícito de especificaciones anteriores

`chat-ayuda-v2` **reemplaza formalmente**:
- **REQ-AYUDA-05 (Salida estructurada y re-validación)**: reemplazado por texto plano con citas sintácticas `[[entrada-id]]` (REQ-AYUDA-V2-06).
- **REQ-AYUDA-06 (El modelo nunca devuelve rutas / descarte de texto)**: reemplazado por REQ-AYUDA-V2-08. El texto siempre se emite en streaming; citas válidas se convierten en links y las inválidas se descartan.
- **REQ-AYUDA-07 (Máximo dos llamadas por turno)**: reemplazado por llamada única (REQ-AYUDA-V2-07), con top 5-6 entradas completas desde el inicio.
- **REQ-AYUDA-10 (Valores de resultado y entrada_id)**: reemplazado por `entradas_citadas text[]` y resultados `('respondida', 'sin_cita', 'sin_llm', 'fuera_de_opciones', 'error')` en REQ-AYUDA-V2-12.

## Lo que NO entra en v2

- Modelos de embeddings o bases de datos vectoriales.
- **Caché de respuestas entre turnos**: postergado fuera de las fases de v2 por riesgo de envenenamiento interno bajo `SECURITY INVOKER`.
- Historial persistente en UI para el usuario.
- Módulo de revendedoras (`app/(revendedora)`), el cual continúa excluido de ayuda.

## Decisiones abiertas / cerradas

- **Cerradas**:
  - Salida en texto plano puro, sin Markdown (DR-AYUDA-V2-4 corregida).
  - Whitelist estricta de palabras funcionales (`no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`).
  - Uso estricto de `fn_hoy_tenant()` en lugar de `current_date`.
  - Compuertas en `app/api/ayuda/chat/` con errores previos vía HTTP JSON (Origin ausente/mismatch → 403, cuota → 429).
  - BM25 previo a la reserva de cuota: respuestas `sin_llm` no consumen cupo diario.
  - Tabla separada `limite_ayuda_tenant` modificable únicamente por service-role y triggers de seguridad en `cuota_ayuda_diaria`.
  - Reemplazo de `entrada_id` por `entradas_citadas text[]` con backfill.
  - Fase de limpieza obligatoria con verificación previa vía `rg`.
- **Abiertas**:
  - **DR-AYUDA-V2-1**: Comportamiento ante stream completado sin citas válidas: se propone registrar `resultado = 'sin_cita'` y que la UI muestre al pie la tarjeta fija de v1 ("No tengo esa respuesta. Preguntale al administrador de tu negocio.").
  - **DR-AYUDA-V2-2**: Cupo diario por defecto en `limite_ayuda_tenant` (propuesto: 100 consultas/día por tenant).
  - **DR-AYUDA-V2-3**: Caché de respuestas por tenant en DB postergado; se analizará con datos empíricos de telemetría.
