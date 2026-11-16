# Tareas — chat-ayuda-v2

Tareas organizadas por fases secuenciales y lotes de trabajo para agentes. Cada lote es dueño exclusivo de sus archivos. Las especificaciones y contratos se encuentran en `specs/REQ-AYUDA-V2.md` y `design.md`.

## Gate humano

- [ ] Spec aprobada (`proposal.md`, `design.md`, `specs/REQ-AYUDA-V2.md`, `tasks.md`) por la persona.
- [ ] DR-AYUDA-V2-1 resuelta: comportamiento ante respuestas sin citas válidas transmitidas en streaming.
- [ ] DR-AYUDA-V2-2 resuelta: límite por defecto de consultas diarias por tenant (propuesto: 100).
- [ ] DR-AYUDA-V2-3 ratificada: postergación del caché de respuestas fuera de v2 por seguridad INVOKER.
- [ ] Fase 0 ejecutada: modelos GA seleccionados (`GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK`) mediante medición empírica de TTFT.

---

## Olas de ejecución

```
Ola 1   Fase 0 (Latencia TTFT y modelos GA) ──► Fase 1 (Dominio BM25 y Whitelist)
                                            ├──► Fase 2 (Streaming y TransformStream)
                                            └──► Fase 3 (DB: cuota atómica y telemetría)
                                                       │
Ola 2   Fase 4 (Route Handler SSE + compuertas locales) ◄┘
           │
Ola 3   Fase 5 (UI streaming en PanelAyuda)
           │
Ola 4   Fase 6 (Cierre: docs/ayuda.md, cobertura y gates de arquitectura)
```

---

## Fase 0 — Medición de TTFT en streaming y selección de modelos GA (agente + persona)

Archivos: `scripts/ayuda-latencia.mts`.

- [ ] Extender `scripts/ayuda-latencia.mts` para consumir `generateContentStream` y medir:
  - Tiempo al primer token (TTFT en milisegundos).
  - Tiempo total de stream.
  - Disponibilidad real bajo nuestra clave de API.
- [ ] **Persona** ejecuta el script con los modelos GA candidatos:
  ```bash
  node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts gemini-2.5-flash gemini-1.5-flash <otros-ga>
  ```
- [ ] Definir en entorno `GEMINI_MODEL` (principal) y `GEMINI_MODEL_FALLBACK` (secundario) con base en menor TTFT (< 1.200 ms).

---

## Fase 1 — Dominio puro: BM25 y Normalización con Whitelist Funcional

Archivos: `lib/ayuda/stopwords.ts`, `lib/ayuda/normalizar.ts`, `lib/ayuda/bm25.ts`, `lib/ayuda/tipos.ts`, `lib/ayuda/guia/*.ts`, `lib/ayuda/bm25.test.ts`.

- [ ] Extender `EntradaGuia` en `lib/ayuda/tipos.ts` con el campo opcional `alias?: readonly string[]` (REQ-AYUDA-V2-01).
- [ ] Crear `lib/ayuda/stopwords.ts` con la lista de stopwords en español y la **whitelist inmutable de palabras funcionales en clave y query (normalizadas sin tilde)**:
  `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues` (REQ-AYUDA-V2-02).
- [ ] Crear `lib/ayuda/normalizar.ts` con normalización minúscula, desacentuación y stemming liviano en español.
- [ ] Crear `lib/ayuda/bm25.ts`: cálculo BM25 en TypeScript puro sobre `titulo`, `alias`, `pasos` y `detalles`, con filtrado previo fail-closed mediante `filtrarGuia` (REQ-AYUDA-V2-03) y umbral de corte para fallback sin LLM (REQ-AYUDA-V2-04).
- [ ] Añadir alias operativos a entradas clave de `lib/ayuda/guia/*.ts` (ej. 'ticket', 'cobro', 'factura', 'seña').
- [ ] Incorporar contexto multi-turno al query BM25 con peso atenuado (0.4) para títulos y alias del turno previo (REQ-AYUDA-V2-05).
- [ ] Crear `lib/ayuda/bm25.test.ts` con escenarios felices y negativos numerados N1–N3.
- [ ] Validar que `lib/ayuda/imports.test.ts` siga pasando al 100% (REQ-AYUDA-V2-14).

---

## Fase 2 — Streaming, Parser TransformStream y Prompt v2

Archivos: `lib/ayuda/stream.ts`, `lib/ayuda/stream.test.ts`, `lib/ayuda/prompt.ts`, `lib/ayuda/prompt.test.ts`, `lib/ayuda/gemini.ts`, `lib/ayuda/tipos.ts`.

- [ ] Definir tipos de eventos streaming (`EventoStreamAyuda`, `TokenLinkAyuda`) en `lib/ayuda/tipos.ts`.
- [ ] Crear `lib/ayuda/stream.ts` con `TransformStream` que implemente:
  - Buffer delimitador para `[` y `[[`.
  - Límite de seguridad de 80 caracteres (emisión como texto literal si desborda sin cerrar).
  - Resolución de citas cerradas `[[id]]` contra la whitelist de entradas autorizadas del turno, emitiendo `{ tipo: 'link', id, titulo, ruta }` (REQ-AYUDA-V2-08).
- [ ] Crear `lib/ayuda/stream.test.ts` cubriendo delimitadores partidos entre chunks, citas no autorizadas, desborde de 80 caracteres y texto plano intercalado.
- [ ] Actualizar `lib/ayuda/prompt.ts` para producir el prefijo estable y formatear las top 5-6 entradas completas con detalles y citas sintácticas (REQ-AYUDA-V2-06).
- [ ] Actualizar `lib/ayuda/gemini.ts` para streaming (`generateContentStream`), thinking mínimo, 1 reintento con backoff y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte** (REQ-AYUDA-V2-07).

---

## Fase 3 — Base de Datos: Cuota Atómica y Telemetría

Archivos: `supabase/migrations/<siguiente>_ayuda_v2.sql`, `tests/db/ayuda_v2.test.ts`, `lib/dal/ayuda/cuota.ts`.

- [ ] Crear migración SQL con número siguiente libre:
  - Tabla `cuota_ayuda_diaria` con clave primaria `(id_tenant, fecha)`.
  - Policies RLS: `cuota_ayuda_diaria_tenant` y restrictiva `restrict_revendedora_cuota_ayuda`.
  - Grants estrictos: `SELECT, INSERT, UPDATE (consultas_realizadas)` a `authenticated`; sin grant de `DELETE`.
  - Trigger `trg_guardia_cuota_ayuda` con función `fn_guardia_cuota_ayuda` (SECURITY INVOKER) que rechaza decrementos de contador y modificaciones de tenant, fecha o límite diario.
  - Función `sp_reservar_cuota_ayuda()` (SECURITY INVOKER) con `INSERT ON CONFLICT DO UPDATE ... WHERE ... RETURNING`.
  - Extensión de tabla `consulta_ayuda`: columnas de telemetría (`tipo_error`, `latencia_ms`, `modelo`, `tokens_input`, `tokens_output`, `tokens_cached`, `tokens_thinking`) y flexibilización de CHECK de resultados (`respondida`, `sin_llm`, `fuera_de_opciones`, `error`).
  - Actualización de `sp_registrar_consulta_ayuda` (SECURITY INVOKER) partiendo de `pnpm sp:last sp_registrar_consulta_ayuda`.
  - Bloque reversible `-- DOWN:` ejecutable verificado por `pnpm gate:db`.
- [ ] Crear `lib/dal/ayuda/cuota.ts` para invocar `sp_reservar_cuota_ayuda` y `sp_registrar_consulta_ayuda`.
- [ ] Crear suite `tests/db/ayuda_v2.test.ts`:
  - Prueba de reserva atómica exitosa y rechazo al superar el cupo diario.
  - Intento de decremento vía PostgREST rechazado por el trigger.
  - Verificación del test 8 de `tests/db/rvp-lecturas.test.ts` confirmando cero DEFINER nuevos.

---

## Fase 4 — Route Handler HTTP SSE y Compuertas Locales

Archivos: `app/api/ayuda/chat/route.ts`, `app/api/ayuda/chat/compuertas.ts`, `app/api/ayuda/chat/route.test.ts`, `lib/validation/ayuda.ts`.

- [ ] Definir `consultarAyudaChatSchema` con Zod `strictObject` en `lib/validation/ayuda.ts`.
- [ ] Crear `app/api/ayuda/chat/compuertas.ts` colocalizado en el módulo implementando el orden único innegociable:
  1. Validación `Origin` contra `Host` (rechazo 403 CSRF sin tocar sesión ni DB).
  2. `verifySession()` y rechazo inmediato de `session.idRevendedora` con 401 (`no-permission`).
  3. `requireModuleRole(session, 'ayuda', 'consultar')`.
  4. Parseo Zod `strictObject`.
  5. `permisosEfectivos(session)`.
  6. Reserva atómica de cuota diaria.
- [ ] Implementar `app/api/ayuda/chat/route.ts` como adaptador `ReadableStream` SSE (`Content-Type: text/event-stream; charset=utf-8`):
  - Integración del pipeline BM25 + Gemini stream + `TransformStream`.
  - Ejecución de telemetría final diferida mediante `after()` de `next/server`.
  - `export const maxDuration = 30`.
- [ ] Crear `app/api/ayuda/chat/route.test.ts` testeando cada rechazo de compuerta y el flujo exitoso con fake de streaming.

---

## Fase 5 — UI Streaming en PanelAyuda

Archivos: `app/(app)/ayuda/PanelAyuda.tsx`, `app/(app)/ayuda/PanelAyuda.test.tsx`.

- [ ] Adaptar `PanelAyuda.tsx` para consumir el endpoint `/api/ayuda/chat` mediante `fetch` y lectura de `ReadableStream` con SSE.
- [ ] Renderizar texto progresivo en tiempo real y transformar tokens estructurados de link en componentes `<Link href={ruta}>` (REQ-AYUDA-V2-09).
- [ ] Garantizar que no se use `dangerouslySetInnerHTML` ni renderizado de HTML sin escapar.
- [ ] Gestionar el estado de cuota excedida (`ayuda-cuota-excedida`) mostrando aviso claro en la UI.
- [ ] Manejar la resolución de la DR-AYUDA-V2-1 para respuestas que no contengan citas válidas.
- [ ] Mantener intacta la Server Action `calificarConsultaAyudaAction` vinculada a cada respuesta respondida.
- [ ] Actualizar `PanelAyuda.test.tsx` verificando el ciclo de vida del stream, cancelación y renderizado seguro.

---

## Fase 6 — Cierre, Documentación y Verificación Integral

Archivos: `docs/ayuda.md`, `lib/errores/mensajes.ts`, `lib/errores/mensajes.test.ts`.

- [ ] Agregar nuevo slug `ayuda-cuota-excedida` a `lib/errores/mensajes.ts` y al inventario de `mensajes.test.ts`.
- [ ] **Actualizar `docs/ayuda.md`**:
  - Reemplazar referencias a modelos preview por modelos GA estables.
  - Documentar las variables de entorno `GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK`.
  - Documentar el funcionamiento de la cuota diaria por tenant en `cuota_ayuda_diaria` y la reserva atómica.
  - Documentar la arquitectura streaming y la telemetría en `consulta_ayuda`.
- [ ] Correr `lib/ayuda/guia/cobertura.test.ts` para verificar cobertura total de pantallas de la app.
- [ ] Correr `tests/arquitectura-imports.test.ts` y `lib/ayuda/imports.test.ts` para garantizar cumplimiento de fronteras de arquitectura y aislamiento.
- [ ] Ejecutar `pnpm gate` (o `pnpm gate:db` con base de datos activa) y confirmar estado limpio.
