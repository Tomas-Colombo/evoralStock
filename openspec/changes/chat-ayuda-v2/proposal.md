# Propuesta — chat-ayuda-v2

**Change**: `chat-ayuda-v2` · **Spec**: `specs/REQ-AYUDA-V2.md` · **Diseño**: `design.md` · **Tareas**: `tasks.md`

## Problema

La guía del asistente de ayuda creció a 132 entradas (~76.000 caracteres de texto estructurado). En la versión 1 (implementada en `chat-ayuda`), cada consulta del operador envía el índice completo de las 132 entradas dentro del prompt (~19.000 tokens de entrada por turno). Sobre ese volumen, se fuerza a Gemini a responder bajo un esquema JSON rígido (`responseSchema` con enum de 132 variantes) seleccionando una única entrada o `null`.

Este diseño presenta limitaciones críticas:
1. **Consumo masivo e ineficiente de tokens**: cada turno consume ~19.000 tokens de entrada, y si la respuesta requiere detalles se ejecuta una segunda llamada obligatoria consecutiva con `focoId` (REQ-AYUDA-07), duplicando el costo y la latencia.
2. **Latencia elevada sin feedback interactivo**: la generación sin streaming bloquea la UI con un spinner estático durante 4 a 10 segundos antes de mostrar cualquier carácter.
3. **Pérdida de respuestas útiles**: si el modelo evalúa que ninguna entrada individual resuelve de forma exacta la consulta y retorna `null`, el texto explicativo generado se descarta por completo (REQ-AYUDA-06) y se muestra una tarjeta estática fija.
4. **Falta de control de cuota por tenant**: no existe un techo transaccional por tenant en la base de datos; la única contención es la cuota global del proyecto en Google Cloud.
5. **Rigidez mono-entrada**: no permite articular respuestas fluidas que combinen referencias o pasos de más de un flujo ni enriquecer el diálogo en turnos sucesivos.

## Decisión

Reemplazar la arquitectura de envío total de índice y respuesta JSON estática por un pipeline de componentes orientados a alta velocidad, bajo costo, streaming interactivo y aislamiento multi-tenant estricto:

1. **Retrieval 100% local en memoria (BM25 en TypeScript)**:
   - Se rankea la guía curada en memoria sin dependencias externas, sin modelos de embeddings ni llamadas de red.
   - Normalización de texto: minúsculas, remoción de tildes, stemming liviano en español y filtrado de stopwords, **preservando en clave y en query una whitelist estricta de palabras funcionales que alteran el significado (normalizadas sin tilde)**:
     `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`.
   - Se agrega un campo opcional `alias: readonly string[]` en `EntradaGuia` para incorporar sinónimos operativos con boost de relevancia en el scoring.
   - El filtrado por permisos efectivos del usuario es **fail-closed y previo al rankeo** (idéntico a v1).
   - Se recuperan las mejores 5 a 6 entradas con sus detalles completos para inyectar al prompt.
   - Si el score BM25 máximo queda por debajo de un umbral de confianza, se devuelve inmediatamente una respuesta estática con sugerencias de entradas cercanas **sin invocar al LLM**.

2. **Contexto multi-turno optimizado**:
   - En turnos de seguimiento, se incorporan al query BM25 los títulos y alias de las entradas citadas en el turno anterior con menor ponderación, reteniendo además la entrada activa en foco en el contexto.
   - Historial comprimido: ventana máxima de 4 turnos recientes, excluyendo respuestas enlatadas o tarjetas de sugerencias.

3. **Prompting directo y conciso con modelo GA (sin prefijar en código)**:
   - Estructura del prompt: prefijo de sistema/instrucciones estable + bloque de top 5-6 entradas recuperadas + historial breve + pregunta actual.
   - Salida del modelo en **texto plano con citas sintácticas `[[entrada-id]]`** (sin JSON estructurado).
   - Modelo GA configurable vía `GEMINI_MODEL` (la spec no fija modelo; se selecciona en Fase 0 midiendo TTFT), `thinkingLevel: 'MINIMAL'` (o `thinkingBudget: 0`), `maxOutputTokens` acotado (~800 tokens).
   - 1 reintento con backoff exponencial ante errores 429/5xx y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte**.

4. **Parser de citas al vuelo en streaming (`TransformStream`)**:
   - Endpoint HTTP con Server-Sent Events (SSE).
   - Un `TransformStream` intercepta los chunks del modelo, acumulando texto únicamente cuando detecta un delimitador de apertura `[` o `[[` hasta el cierre `]]`, con un límite de seguridad (80 caracteres) que emite texto literal si se supera el buffer sin cerrar la etiqueta.
   - Toda cita `[[entrada-id]]` cerrada se valida contra la whitelist de entradas permitidas del turno. Si es válida, se emite un evento/token de link tipado con título y ruta resueltos en el servidor desde la guía; si es inválida, se descarta. La ruta nunca sale del modelo.
   - El cliente renderiza texto y componentes React de navegación, **nunca HTML crudo** (`dangerouslySetInnerHTML` prohibido).

5. **Endpoint `POST /api/ayuda/chat` (SSE) y compuertas locales**:
   - Route Handler en Next.js App Router actuando como adaptador de `ReadableStream`.
   - **Compuertas en `app/api/ayuda/chat/`**: las compuertas viven en la misma carpeta del módulo que las consume (cumpliendo con la regla de AGENTS.md: *"Used by one module → it lives in that module's folder"*; no se crea función compartida en `lib/`).
   - **Orden único de ejecución innegociable**:
     1. Validación de `Origin` contra `Host` (rechazo 403 CSRF sin tocar sesión ni DB).
     2. `verifySession()`: validación de sesión activa y rechazo inmediato de `session.idRevendedora` con 401/`no-permission` (alineado con los demás handlers de `app/api`).
     3. `requireModuleRole(session, 'ayuda', 'consultar')`.
     4. Validación zod `strictObject` (`consultarAyudaChatSchema`).
     5. `permisosEfectivos(session)`.
     6. Reserva atómica de cuota diaria en base de datos.
   - Excepción técnica justificada a la regla "toda mutación es Server Action": las Server Actions no soportan streaming SSE chunked en tiempo real. `calificarConsultaAyudaAction` se mantiene como Server Action estándar.

6. **Control de cuota atómica con `SECURITY INVOKER`**:
   - Todas las funciones son `SECURITY INVOKER` para respetar la lista blanca estricta de `tests/db/rvp-lecturas.test.ts` (test 8).
   - Tabla `cuota_ayuda_diaria` particionada por tenant y fecha.
   - **Defensa contra manipulación por PostgREST**: el rol `authenticated` solo recibe `GRANT UPDATE (consultas_realizadas)`. Un trigger `BEFORE UPDATE` impide decrementos y bloquea la edición de `id_tenant`, `fecha` o `limite_diario`.
   - El límite diario vive protegido: solo el operador/super-admin puede modificarlo (patrón de migración 00117).
   - Reserva de cuota atómica antes de llamar al modelo (`INSERT ... ON CONFLICT DO UPDATE ... WHERE consultas_realizadas < limite_diario RETURNING`).

7. **Telemetría diferida con `after()` de `next/server`**:
   - El registro de la consulta en `consulta_ayuda` se difiere al cierre de la respuesta mediante `after()`, liberando el stream hacia el usuario.
   - Se registra: resultado (`respondida`, `sin_llm`, `fuera_de_opciones`, `error`), latencia en milisegundos, modelo utilizado y desglose de tokens (`input`, `output`, `cached`, `thinking`) extraídos de `usageMetadata`.
   - Si la plataforma (Vercel) llegara a cortar la función por timeout extremo, la cuota ya quedó reservada previamente de forma segura (fail-safe financiero).

8. **Invariantes de seguridad reafirmadas**:
   - Cero datos del tenant al modelo (REQ-AYUDA-09 y test de aislamiento `lib/ayuda/imports.test.ts`).
   - Rutas derivadas únicamente de la guía tipada estática.
   - Cobertura total de pantallas en la guía verificada por `cobertura.test.ts`.
   - Actualización operativa de `docs/ayuda.md` en la fase final de cierre.

## Reemplazo explícito de especificaciones anteriores

`chat-ayuda-v2` **reemplaza formalmente** las siguientes secciones de `openspec/changes/chat-ayuda/specs/REQ-AYUDA.md`:
- **REQ-AYUDA-05 (Salida estructurada y re-validación)**: reemplazado por salida en texto plano con citas sintácticas `[[entrada-id]]` procesadas en streaming (REQ-AYUDA-V2-06).
- **REQ-AYUDA-06 (El modelo nunca devuelve rutas / descarte de texto)**: reemplazado por REQ-AYUDA-V2-08. El texto siempre se transmite en streaming al usuario y nunca se descarta; las citas válidas se transforman en enlaces interactivos y las inválidas se descartan como citas.
- **REQ-AYUDA-07 (Máximo dos llamadas por turno)**: reemplazado por llamada única (REQ-AYUDA-V2-07), ya que las top 5-6 entradas inyectadas por BM25 incluyen sus detalles completos desde el inicio.
- **REQ-AYUDA-10 (Valores de resultado)**: el dominio del campo `resultado` en `consulta_ayuda` se amplía para admitir `('respondida', 'sin_llm', 'fuera_de_opciones', 'error')` y se elimina la restricción de que `respondida` exija un único `entrada_id` no nulo.

## Lo que NO entra en v2

- Reemplazo de BM25 por bases de datos vectoriales (pgvector), microservicios de búsqueda o embeddings remotos.
- **Caché de respuestas entre turnos**: queda **fuera de las fases de v2** debido al riesgo de envenenamiento interno con `SECURITY INVOKER` y se abre como DR para analizar con la telemetría recolectada.
- Historial conversacional persistente visible para el usuario (solo telemetría en `consulta_ayuda`).
- Modificación del portal de revendedoras (`app/(revendedora)`), el cual continúa excluido del módulo de ayuda.

## Decisiones abiertas / cerradas

- **Cerradas**:
  - Whitelist estricta de palabras funcionales en normalización BM25 (`no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`).
  - Ubicación de compuertas en `app/api/ayuda/chat/` (sin crear módulo compartido en `lib/`).
  - Orden estricto de compuertas en el Route Handler: (1) Origin vs Host, (2) verifySession + idRevendedora, (3) requireModuleRole, (4) zod, (5) permisosEfectivos, (6) reserva de cuota.
  - Streaming con SSE vía Route Handler `POST /api/ayuda/chat`.
  - Reintento y fallback activo únicamente antes de emitir el primer byte.
  - Telemetría al cierre ejecutada mediante `after()` de `next/server`.
  - Cuota diaria bajo `SECURITY INVOKER` con protección contra decrementos por trigger `BEFORE UPDATE`.
- **Abiertas**:
  - **DR-AYUDA-V2-1**: Comportamiento ante respuesta sin ninguna cita válida. Dado que el texto explicativo ya se emitió progresivamente al usuario vía streaming, ¿se añade una tarjeta sutil al final del stream alertando que la respuesta carece de enlaces directos, o se mantiene el texto limpio marcando la telemetría como `respondida` con lista de citas vacía?
  - **DR-AYUDA-V2-2**: Límite por defecto de la cuota diaria por tenant (se propone 100 consultas/día por tenant en `cuota_ayuda_diaria`, configurable por el super admin).
  - **DR-AYUDA-V2-3**: Caché de respuestas por tenant en DB: bajo `SECURITY INVOKER`, cualquier usuario con acceso al tenant podría insertar respuestas arbitrarias vistas por sus compañeros. Se posterga la implementación del caché hasta contar con telemetría de producción que justifique su necesidad frente al bajo costo alcanzado con BM25.
