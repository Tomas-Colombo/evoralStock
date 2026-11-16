# Tareas — chat-ayuda-v2

Tareas organizadas por fases secuenciales y lotes de trabajo para agentes. Cada lote es dueño exclusivo de sus archivos. Las especificaciones y contratos se encuentran en `specs/REQ-AYUDA-V2.md` y `design.md`.

## Gate humano

- [x] Spec aprobada (`proposal.md`, `design.md`, `specs/REQ-AYUDA-V2.md`, `tasks.md`) por la persona (2026-11-16).
- [x] DR-AYUDA-V2-1 aprobada: resultado `'sin_cita'` y tarjeta fija al final del stream en UI.
- [x] DR-AYUDA-V2-2 resuelta: 100 consultas diarias por tenant por defecto.
- [x] DR-AYUDA-V2-3 ratificada: caché de respuestas fuera de v2.
- [ ] Fase 0 ejecutada: modelos GA seleccionados (`GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK`) mediante medición empírica de TTFT con script.

---

## Olas de ejecución

```
Ola A   Fase 0 (TTFT y modelos)   Fase 1 (tipos, BM25, evaluación)   Fase 3 (DB)
                                     │                                 │
Ola B                             Fase 2 (stream, prompt, Gemini)      │
                                     │                                 │
Ola C   Fase 4 (Route Handler + compuertas) ◄────────────────────────┘
        Fase 5 (UI en streaming)
           │
Ola D   Fase 6 (limpieza, docs, gates)
```

Máximo 3 agentes por ola; ninguna fase de la misma ola comparte archivos.

- **Ola A**: las tres fases son independientes. La Fase 3 no depende del BM25,
  y la Fase 0 solo fija el valor de `GEMINI_MODEL`, que la Fase 2 lee de env.
- **Ola B**: la Fase 2 necesita los tipos cerrados en la Fase 1
  (`EventoStreamAyuda`, `TokenLinkAyuda`, `alias`).
- **Ola C**: la Fase 4 integra la 2 y la 3. La Fase 5 programa contra el
  contrato de eventos de `lib/ayuda/tipos.ts` y contra las respuestas HTTP de
  la §REQ-AYUDA-V2-10, no contra el código de la Fase 4.
- **Ola D**: la limpieza va al final porque la Fase 5 todavía usa
  `calificarConsultaAyudaAction` del mismo archivo que se recorta.

Entre olas, el chat v1 tiene que seguir funcionando: lo garantiza la Fase 3
(ver su primera tarea).

---

## Fase 0 — Medición de TTFT en streaming y selección de modelos GA (agente + persona)

Archivos: `scripts/ayuda-latencia.mts`.

- [ ] Extender `scripts/ayuda-latencia.mts` para:
  - Listar los modelos habilitados en la cuenta con `ai.models.list()`.
  - Consumir `generateContentStream` y medir el tiempo al primer token (TTFT en ms) y tiempo total de stream de los modelos GA candidatos.
  - Documentar la lección de v1: el listado no garantiza que `generateContent` funcione con nuestra clave.
- [ ] **Persona** ejecuta el script con los modelos GA candidatos sin asumir nombres de memoria:
  ```bash
  node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <candidatos-ga>
  ```
- [ ] Definir en entorno `GEMINI_MODEL` (principal) y `GEMINI_MODEL_FALLBACK` (secundario) a partir de los números medidos.

---

## Fase 1 — Contratos y Dominio BM25 con Suite de Evaluación

Archivos: `lib/ayuda/tipos.ts`, `lib/ayuda/stopwords.ts`, `lib/ayuda/normalizar.ts`, `lib/ayuda/bm25.ts`, `lib/ayuda/bm25.test.ts`, `lib/ayuda/evaluacion.test.ts`, `lib/ayuda/guia/*.ts`.

- [ ] **Única modificación de contratos tipados**: extender `EntradaGuia` y definir eventos de streaming en `lib/ayuda/tipos.ts` (REQ-AYUDA-V2-01). *Ninguna otra fase modificará este archivo*.
- [ ] Crear `lib/ayuda/stopwords.ts` con la lista de stopwords en español y la **whitelist inmutable de palabras funcionales en clave y query (normalizadas sin tilde)**:
  `no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues` (REQ-AYUDA-V2-02).
- [ ] Crear `lib/ayuda/normalizar.ts` con normalización minúscula, desacentuación y stemming liviano en español.
- [ ] Crear `lib/ayuda/bm25.ts`: cálculo BM25 en TypeScript puro sobre `titulo`, `alias`, `pasos` y `detalles`, con filtrado previo fail-closed mediante `filtrarGuia` (REQ-AYUDA-V2-03) y umbral de corte para fallback `sin_llm` (REQ-AYUDA-V2-04).
- [ ] Añadir alias operativos a entradas clave de `lib/ayuda/guia/*.ts` (ej. 'ticket', 'cobro', 'factura', 'seña').
- [ ] Incorporar contexto multi-turno al query BM25 con peso atenuado (0.4) para títulos y alias del turno previo, revalidando que los ids enviados por el cliente correspondan a entradas autorizadas del operador (REQ-AYUDA-V2-05).
- [ ] Crear `lib/ayuda/bm25.test.ts` con escenarios felices y negativos numerados N1–N3.
- [ ] **Crear `lib/ayuda/evaluacion.test.ts`**:
  - Suite de ~40 preguntas reales representativas del uso del sistema.
  - Aserciones de calibración: entrada esperada presente en el top 5 recuperado y preguntas fuera de dominio ubicadas bajo el umbral.
  - Calibrar con los resultados de esta suite el umbral `UMBRAL_MINIMO_BM25` y el peso 0.4.
- [ ] Validar que `lib/ayuda/imports.test.ts` continúe pasando al 100% (REQ-AYUDA-V2-14).

---

## Fase 2 — Streaming, Parser TransformStream y Prompt v2

Archivos: `lib/ayuda/stream.ts`, `lib/ayuda/stream.test.ts`, `lib/ayuda/prompt.ts`, `lib/ayuda/prompt.test.ts`, `lib/ayuda/gemini.ts`.

- [ ] Crear `lib/ayuda/stream.ts` con `TransformStream` que implemente:
  - Buffer delimitador para `[` y `[[`.
  - Límite de seguridad de 80 caracteres (emisión como texto literal ordinario si desborda sin cerrar).
  - Resolución de citas cerradas `[[id]]` contra la whitelist de entradas autorizadas del turno, emitiendo `{ tipo: 'link', id, titulo, ruta }` (REQ-AYUDA-V2-08).
- [ ] Crear `lib/ayuda/stream.test.ts` cubriendo delimitadores partidos entre chunks, citas no autorizadas, desborde de 80 caracteres y texto plano intercalado.
- [ ] Actualizar `lib/ayuda/prompt.ts` para producir el prefijo estable y formatear las top 5-6 entradas completas con detalles, exigiendo explícitamente **salida en texto plano sin Markdown** y citas sintácticas `[[id]]` (REQ-AYUDA-V2-06, DR-AYUDA-V2-4).
- [ ] Actualizar `lib/ayuda/gemini.ts` para streaming (`generateContentStream`), thinking mínimo, 1 reintento con backoff y fallback a `GEMINI_MODEL_FALLBACK` **únicamente antes de emitir el primer byte** (REQ-AYUDA-V2-07).

---

## Fase 3 — Base de Datos: Límite, Cuota Atómica y Telemetría

Archivos: `supabase/migrations/<siguiente>_ayuda_v2.sql`, `tests/db/ayuda_v2.test.ts`, `tests/db/ayuda.test.ts`, `lib/dal/ayuda/cuota.ts`, `lib/dal/ayuda/index.ts` (+ su test), `lib/errores/mensajes.ts` (+ su test).

- [ ] La migración dropea la firma vieja de `sp_registrar_consulta_ayuda`: en
      la misma fase, `registrarConsultaAyuda` de `lib/dal/ayuda/index.ts` pasa
      a la firma nueva sin cambiar su payload (traduce `entradaId` a
      `entradas_citadas = [entradaId]`), y `tests/db/ayuda.test.ts` se ajusta.
      Así el chat v1 sigue registrando hasta la Ola C.
- [ ] Slugs que levantan los SP y triggers nuevos (`cuota-excedida`,
      `cuota-decremento-prohibido`, `cuota-modificacion-invalida`,
      `cuota-insert-invalido`) en el catálogo y en el inventario del test.
- [ ] Crear migración SQL con número siguiente libre:
  - Tabla `limite_ayuda_tenant (id_tenant uuid primary key references tenant, limite_diario integer default 100)`. RLS activada con policy tenant, policy restrictiva revendedora (ACC-11) y policy restrictiva por permiso (`auth_tiene_permiso('ayuda', 'consultar')`). Grant `SELECT` a `authenticated`; revocado `INSERT, UPDATE, DELETE` a `authenticated` (solo service-role, patrón 00117).
  - Tabla `cuota_ayuda_diaria (id_tenant uuid, fecha date, consultas_realizadas integer, primary key (id_tenant, fecha))`. RLS activada con policy tenant, policy restrictiva revendedora (ACC-11) y policy restrictiva por permiso (`auth_tiene_permiso('ayuda', 'consultar')`).
  - Grants estrictos: `SELECT, INSERT (id_tenant, fecha, consultas_realizadas), UPDATE (consultas_realizadas)` a `authenticated`; revocar `DELETE`.
  - Triggers de seguridad e integridad temporal usando estrictamente `fn_hoy_tenant()`:
    - Trigger `trg_guardia_insert_cuota_ayuda`: fuerza `fecha = fn_hoy_tenant()` y valida `consultas_realizadas in (0, 1)`.
    - Trigger `trg_guardia_update_cuota_ayuda`: garantiza solo incrementos e inmutabilidad de tenant y fecha.
  - Función `sp_reservar_cuota_ayuda()` (SECURITY INVOKER):
    - Chequeo temprano `if v_limite < 1 then raise exception 'cuota-excedida'; end if;`.
    - `INSERT ON CONFLICT DO UPDATE ... WHERE consultas_realizadas < v_limite RETURNING`.
  - Extensión de `consulta_ayuda`:
    - Reemplazar `entrada_id text` por `entradas_citadas text[]` con backfill automático desde `entrada_id`.
    - CHECK `consulta_ayuda_entradas_citadas_check`: cardinalidad ≤ 6 y longitud individual ≤ 64.
    - Elevar CHECK de `respuesta` a 5.000 caracteres (`char_length(respuesta) <= 5000`).
    - Ampliar CHECK de resultado para admitir `in ('respondida', 'sin_cita', 'sin_llm', 'fuera_de_opciones', 'error')`.
    - Columnas de telemetría: `tipo_error`, `latencia_ms`, `modelo`, `tokens_input`, `tokens_output`, `tokens_cached`, `tokens_thinking`.
  - Drop explícito de `sp_registrar_consulta_ayuda(uuid, text, text, text, text)` y creación de nueva firma (SECURITY INVOKER) con `revoke/grant` explícitos.
  - Bloque reversible `-- DOWN:` ejecutable completo verificado por `pnpm gate:db`:
    - Mapeo de `sin_cita` → `respondida` / `fuera_de_opciones` y `sin_llm` → `fuera_de_opciones`.
    - Backfill inverso hacia `entrada_id text` y restauración de los 4 checks originales de v1 con sus nombres exactos.
    - Restauración de la firma original de `sp_registrar_consulta_ayuda` proveniente de `00150`.
- [ ] Crear `lib/dal/ayuda/cuota.ts` para invocar `sp_reservar_cuota_ayuda` y `sp_registrar_consulta_ayuda`.
- [ ] Crear suite `tests/db/ayuda_v2.test.ts`:
  - Prueba N de `INSERT` directo en `cuota_ayuda_diaria` con contador alto (ej. 99) rechazado por trigger.
  - Prueba N de `INSERT` directo con fecha futura sobrescrita por `fn_hoy_tenant()`.
  - Prueba N de reserva atómica con `limite_diario = 0` rechazada con `cuota-excedida` antes del insert.
  - Prueba de reserva atómica exitosa y rechazo al alcanzar el límite.
  - Pruebas de las policies restrictivas: revendedora y operador sin permiso `ayuda.consultar` reciben 0 filas en ambas tablas.
  - Verificación del test 8 de `tests/db/rvp-lecturas.test.ts` confirmando cero DEFINER nuevos.

---

## Fase 4 — Route Handler HTTP SSE y Compuertas Locales

Archivos: `app/api/ayuda/chat/route.ts`, `app/api/ayuda/chat/compuertas.ts`, `app/api/ayuda/chat/route.test.ts`, `lib/validation/ayuda.ts`, `lib/errores/mensajes.ts` (+ su test).

- [ ] Slug `origin-invalido` en el catálogo y en el inventario del test (`cuota-excedida` ya lo agregó la Fase 3: se reutiliza, no se duplica).
- [ ] Deduplicar `entradas_citadas` (orden de primera aparición) antes de
      registrar: el modelo puede citar la misma entrada varias veces y el
      CHECK de cardinalidad ≤ 6 haría fallar el registro.

- [ ] Definir `consultarAyudaChatSchema` con Zod `strictObject` en `lib/validation/ayuda.ts`.
- [ ] Crear `app/api/ayuda/chat/compuertas.ts` colocalizado en el módulo implementando el orden único innegociable y respuestas HTTP JSON previas al stream:
  1. Validación `Origin`: ausente o mismatch → HTTP 403 JSON `{ ok: false, reason: 'origin-invalido' }`.
  2. `verifySession()`: rechazo inmediato de `session.idRevendedora` con HTTP 401 JSON `{ ok: false, reason: 'no-permission' }`.
  3. `requireModuleRole(session, 'ayuda', 'consultar')`: HTTP 403 JSON.
  4. Parseo Zod `strictObject`: HTTP 400 JSON `{ ok: false, reason: 'payload-invalido' }`.
  5. `permisosEfectivos(session)`.
  6. Retrieval BM25 local: si score < umbral → emitir respuesta `sin_llm` **SIN reservar cuota**.
  7. Si supera el umbral y va a llamar a Gemini: llamada a `sp_reservar_cuota_ayuda`. Si cuota alcanzada → HTTP 429 JSON `{ ok: false, reason: 'cuota-excedida' }`.
- [ ] Implementar `app/api/ayuda/chat/route.ts` como adaptador `ReadableStream` SSE:
  - Streaming SSE con `Content-Type: text/event-stream; charset=utf-8`.
  - Errores ocurridos una vez iniciado el stream viajan como evento SSE `{ tipo: 'error', reason: string }`.
  - Ejecución de telemetría diferida no bloqueante mediante `after()` de `next/server`.
  - `export const maxDuration = 30`.
- [ ] Crear `app/api/ayuda/chat/route.test.ts` testeando cada error HTTP previo y el flujo de stream exitoso.

---

## Fase 5 — UI Streaming en PanelAyuda y Tarjeta Fija

Archivos: `app/(app)/ayuda/PanelAyuda.tsx`, `app/(app)/ayuda/PanelAyuda.test.tsx`.

- [ ] Adaptar `PanelAyuda.tsx` para consumir `/api/ayuda/chat` mediante `fetch` y lectura de `ReadableStream` con SSE.
- [ ] Renderizar texto progresivo en tiempo real y transformar tokens estructurados de link en componentes `<Link href={ruta}>` (REQ-AYUDA-V2-09).
- [ ] Garantizar que no se use `dangerouslySetInnerHTML` ni renderizado de HTML sin escapar.
- [ ] **Manejo de `sin_cita` (DR-AYUDA-V2-1)**: si el stream finaliza sin haber emitido enlaces a la guía, mantener el texto y mostrar al pie la tarjeta fija de advertencia de v1 ("No tengo esa respuesta. Preguntale al administrador de tu negocio.").
- [ ] Gestionar error de cuota excedida (HTTP 429 `cuota-excedida`) mostrando aviso claro en la UI.
- [ ] Mantener intacta la Server Action `calificarConsultaAyudaAction` vinculada a cada respuesta respondida.
- [ ] Actualizar `PanelAyuda.test.tsx` verificando streaming, cancelación, tarjeta fija y renderizado seguro.

---

## Fase 6 — Limpieza de Código Deprecado, Documentación y Cierre

Archivos: `app/(app)/ayuda/actions.ts` (+ su test), `lib/ayuda/{salida,resolver,consultar}.ts` (+ sus tests), `lib/ayuda/gemini.ts`, `lib/dal/ayuda/index.ts` (quitar la traducción `entradaId` de la Fase 3), `docs/ayuda.md`.

- [ ] **Fase de limpieza de código deprecado**:
  - Verificar con `rg "consultarAyudaAction"` y removerla de `app/(app)/ayuda/actions.ts` (conservando únicamente `calificarConsultaAyudaAction`).
  - Verificar con `rg` y eliminar los archivos muertos: `lib/ayuda/salida.ts`, `lib/ayuda/resolver.ts`, `lib/ayuda/consultar.ts`.
  - Eliminar el modo JSON estructurado y esquemas asociados de `lib/ayuda/gemini.ts`.
- [ ] **Actualizar `docs/ayuda.md`**:
  - Reemplazar menciones a modelos preview por modelos GA estables.
  - Documentar variables `GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK`.
  - Documentar la cuota diaria por tenant (`limite_ayuda_tenant`, `cuota_ayuda_diaria`) y el trigger anti-decrementos.
  - Documentar la arquitectura streaming y la telemetría en `consulta_ayuda`.
- [ ] Correr `lib/ayuda/guia/cobertura.test.ts` para verificar cobertura total de pantallas de la app.
- [ ] Correr `tests/arquitectura-imports.test.ts` y `lib/ayuda/imports.test.ts` para garantizar cumplimiento de fronteras de arquitectura y aislamiento.
- [ ] Ejecutar `pnpm gate` (o `pnpm gate:db` con base de datos activa) y confirmar estado limpio.
