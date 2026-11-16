# Spec — chat-ayuda-v2 / ayuda

**Change**: `chat-ayuda-v2` · **Requisitos**: `REQ-AYUDA-V2-01…14` · **Decisiones**: `DR-AYUDA-V2-1…6`

Esta especificación evoluciona el módulo de ayuda implementado en `chat-ayuda`. **Reemplaza formalmente** las siguientes secciones de `openspec/changes/chat-ayuda/specs/REQ-AYUDA.md`:
- **REQ-AYUDA-05 (Salida estructurada y re-validación)** → reemplazado por REQ-AYUDA-V2-06.
- **REQ-AYUDA-06 (El modelo nunca devuelve rutas / descarte de texto)** → reemplazado por REQ-AYUDA-V2-08.
- **REQ-AYUDA-07 (Máximo dos llamadas por turno)** → reemplazado por REQ-AYUDA-V2-07 (llamada única).
- **REQ-AYUDA-10 (Valores de resultado y entrada_id)** → reemplazado por `entradas_citadas text[]` y resultados ampliados en REQ-AYUDA-V2-12.

---

## 1. Requisitos

### REQ-AYUDA-V2-01 — Extensión tipada de EntradaGuia con alias
`EntradaGuia` MUST aceptar el campo opcional `alias?: readonly string[]`. Si está definido, cada alias debe ser un string kebab-case o frase corta de hasta 64 caracteres. La presencia de alias no altera la compatibilidad hacia atrás con las entradas existentes.

- **Feliz**: entrada con `alias: ['ticket', 'comprobante']` compila y se indexa.
- **N1**: entrada sin `alias` compila correctamente (campo opcional).
- **N2**: alias con string vacío o de más de 64 caracteres → error de tipado o validación.

### REQ-AYUDA-V2-02 — Normalización de texto y whitelist funcional
El normalizador de texto MUST convertir a minúsculas, remover tildes y signos de puntuación no semánticos, aplicar stemming liviano en español y filtrar stopwords tradicionales, **con excepción expresa de la siguiente whitelist inmutable de palabras funcionales que jamás deben ser descartadas (normalizadas sin tilde), tanto en la clave de indexación como en el query del usuario**:
`no`, `sin`, `con`, `ya`, `ni`, `nunca`, `todavia`, `solo`, `antes`, `despues`.

- **Feliz**: "Cómo cobrar sin recargo" preserva "sin" y busca la entrada correspondiente a cobros sin recargo.
- **N1**: "no puedo anular una venta" conserva "no" y "anular", diferenciándose de "cómo anular una venta".
- **N2**: stopwords tradicionales (ej. "el", "la", "de", "un") son eliminadas correctamente.

### REQ-AYUDA-V2-03 — Retrieval BM25 local fail-closed
El motor BM25 en memoria MUST operar puramente en TypeScript (sin dependencias nativas ni llamadas de red). Antes de rankear las entradas sobre el query normalizado, MUST filtrar las entradas mediante `filtrarGuia(GUIA, permisosEfectivos)`. Las entradas no autorizadas jamás deben ingresar al cálculo ni ser recuperadas. Se recuperan entre 5 y 6 entradas con sus bloques de `detalles` completos.

- **Feliz**: operador con permiso `ventas` consulta por facturación; se recuperan las 5 entradas más relevantes de ventas con sus detalles.
- **N1**: operador sin permiso `gastos` consulta por "cómo cargar un gasto"; ninguna entrada de gastos aparece en el top recuperado (fail-closed).
- **N2**: conjunto de permisos vacío → lista recuperada vacía.

### REQ-AYUDA-V2-04 — Umbral de corte BM25 y fallback sin LLM (sin reserva de cuota)
Si el score BM25 de la mejor entrada recuperada no alcanza `UMBRAL_MINIMO_BM25`, el sistema MUST retornar una respuesta predefinida de orientación con sugerencias de las 3 entradas con mayor score relativo **sin invocar a Gemini y SIN reservar cuota en base de datos**.

- **Feliz**: pregunta incomprensible o fuera de dominio ("cómo cocinar una pizza") → score < umbral; se emite de inmediato respuesta de sugerencias locales; cero llamadas a Gemini y cero impacto en la cuota diaria.
- **N1**: consulta con palabras clave operativas reconocidas → score ≥ umbral; el flujo continúa hacia la reserva de cuota y llamada al modelo.

### REQ-AYUDA-V2-05 — Contexto multi-turno, ponderación y revalidación de citas previas
Si la petición incluye historial conversacional (últimos 4 turnos), el query BM25 MUST incorporar los títulos y alias de las entradas citadas en el turno anterior con un factor de peso atenuado (0.4, calibrado en `evaluacion.test.ts`), manteniendo la entrada activa en el contexto. Los `ids` de citas previas enviados por el cliente MUST ser validados con Zod (kebab-case ≤ 64) y descartados si no están en las entradas permitidas para el usuario en ese turno. Respuestas enlatadas y sugerencias previas se excluyen del historial enviado al modelo.

- **Feliz**: turno 1 cita `venta-nueva`; turno 2 consulta "¿y el descuento?"; BM25 pondera `venta-nueva` con peso 0.4 y recupera pantallas de descuento de ventas.
- **N1**: cliente envía en el historial un `id` de entrada ajena a sus permisos actuales → el servidor lo descarta antes de computar BM25 o armar el prompt.
- **N2**: cliente envía un `id` con más de 64 caracteres o caracteres inválidos → Zod rechaza el payload con `payload-invalido`.
- **N3**: historial con más de 4 turnos → se truncan conservando estrictamente los 4 más recientes.

### REQ-AYUDA-V2-06 — Prompting con prefijo estable y texto plano sin Markdown (reemplaza REQ-AYUDA-05)
El prompt MUST estructurarse con: (1) instrucciones de sistema invariantes byte a byte, (2) las 5–6 entradas recuperadas con pasos y detalles, (3) historial reciente, (4) pregunta actual. El modelo MUST ser instruido explícitamente a responder en **texto plano puro, sin formato Markdown** (sin negritas `**`, sin itálicas ni listas formateadas), citando pantallas únicamente mediante la sintaxis sintáctica `[[entrada-id]]`. No se utiliza `responseSchema` JSON.

- **Feliz**: el modelo emite texto plano directo: "Podés registrar la operación desde [[venta-nueva]] y seleccionar el cliente en el paso inicial.".
- **N1**: dos consultas distintas con las mismas entradas recuperadas comparten idéntico prefijo de instrucciones.
- **N2**: el prompt no contiene rutas URL (strings que empiecen con `/`).

### REQ-AYUDA-V2-07 — Resiliencia en llamada streaming sin 2ª llamada (reemplaza REQ-AYUDA-07)
Se realiza una única llamada al modelo de lenguaje configurado vía `GEMINI_MODEL`. No se admite una segunda llamada por detalles, ya que estos viajan en el top recuperado. Ante errores 429 o 5xx del proveedor, MUST realizarse a lo sumo 1 reintento con backoff exponencial. Si persiste el fallo y existe `GEMINI_MODEL_FALLBACK`, se conmuta a dicho modelo secundario. **El reintento y el fallback son válidos ÚNICAMENTE antes de emitir el primer byte al cliente**.

- **Feliz**: llamada exitosa genera stream directo; una sola llamada al proveedor.
- **N1**: error 503 inmediato antes del primer byte → reintento tras backoff; si falla, conmuta a `GEMINI_MODEL_FALLBACK`.
- **N2**: fallo a mitad del streaming (después del primer byte) → no se reintenta ni conmuta; se emite evento SSE de error de stream.

### REQ-AYUDA-V2-08 — Parser TransformStream y resolución de citas (reemplaza REQ-AYUDA-06)
Los chunks de texto emitidos por el modelo MUST pasar por un `TransformStream` que retenga en buffer delimitadores abiertos `[` o `[[` hasta encontrar `]]`, con un límite de seguridad de 80 caracteres. Si el buffer supera 80 caracteres sin cerrar, se vacía como texto literal. Al cerrarse una cita `[[id]]`, se valida contra las entradas autorizadas del turno: si es válida, se emite un token de link con `{ id, titulo, ruta }` resuelto desde la guía; si es inválida, se descarta. La ruta URL jamás proviene del modelo.

- **Feliz**: modelo emite chunk con `[[venta-nueva]]` → el stream emite evento de link con ruta `/ventas/nueva`.
- **N1**: delimitador partido entre dos chunks (`[` al final de chunk 1 y `[id]]` al inicio de chunk 2) → el buffer une el identificador y resuelve el link sin corromper el texto.
- **N2**: corchete abierto sin cerrar que supera 80 caracteres → se emite como texto literal ordinario.
- **N3**: cita con id inexistente `[[pantalla-fantasma]]` → se descarta la cita y no se emite ningún enlace inválido.

### REQ-AYUDA-V2-09 — Renderizado cliente en texto plano y tratamiento de respuestas sin citas
El componente `PanelAyuda` MUST renderizar el flujo SSE combinando texto plano y componentes de enlace seguros (`<Link href={ruta}>`). MUST NOT utilizar `dangerouslySetInnerHTML` ni evaluadores de HTML crudo. Si la respuesta finaliza sin haber emitido ninguna cita válida a la guía, la UI MUST conservar el texto explicativo y renderizar al pie la tarjeta fija de advertencia de v1: *"No tengo esa respuesta. Preguntale al administrador de tu negocio."* (DR-AYUDA-V2-1).

- **Feliz**: respuesta con texto plano y botones de link a las pantallas oficiales.
- **N1**: respuesta conceptual válida pero sin citas a pantallas → texto visible + tarjeta fija de advertencia al pie; telemetría registra `resultado: 'sin_cita'`.
- **N2**: modelo intenta emitir etiquetas HTML `<script>` en el texto → se renderizan como texto literal plano en el DOM; ataque XSS neutralizado.

### REQ-AYUDA-V2-10 — Route Handler POST /api/ayuda/chat y orden estricto de compuertas
El endpoint `POST /api/ayuda/chat` MUST implementar estrictamente el siguiente orden de compuertas colocalizadas en `app/api/ayuda/chat/`:
1. Validación `Origin`: si `Origin` está ausente o no coincide con `Host` (o `x-forwarded-host`) → **HTTP 403 Forbidden** JSON `{ ok: false, reason: 'origin-invalido' }` inmediato, sin tocar sesión ni DB.
2. `verifySession()`: si `session.idRevendedora` está presente → **HTTP 401 Unauthorized** JSON `{ ok: false, reason: 'no-permission' }`.
3. `requireModuleRole(session, 'ayuda', 'consultar')`: si falla → **HTTP 403 Forbidden** JSON con slug de autorización o `module-disabled`.
4. Validación Zod `strictObject` (`consultarAyudaChatSchema`): si falla → **HTTP 400 Bad Request** JSON `{ ok: false, reason: 'payload-invalido' }`.
5. `permisosEfectivos(session)`: cálculo en memoria de permisos válidos.
6. Retrieval BM25 local sobre entradas autorizadas:
   - Si score < `UMBRAL_MINIMO_BM25` → emite respuesta `sin_llm` **SIN reservar cuota**.
7. Si supera el umbral y va a invocar a Gemini: llamada a `sp_reservar_cuota_ayuda`. Si el límite diario fue alcanzado → **HTTP 429 Too Many Requests** JSON `{ ok: false, reason: 'ayuda-cuota-excedida' }`.
8. Inicio del streaming SSE (`ReadableStream`, `Content-Type: text/event-stream; charset=utf-8`). Errores durante el stream viajan como eventos SSE `{ tipo: 'error', reason: string }`.

- **Feliz**: petición POST con origen válido y operador autorizado → supera compuertas, reserva cuota e inicia stream SSE.
- **N1**: petición con `Origin` ausente → HTTP 403 JSON antes de llamar a `verifySession`.
- **N2**: revendedora (`session.idRevendedora` no nulo) → HTTP 401 JSON (`no-permission`).
- **N3**: operador sin permiso `ayuda.consultar` → HTTP 403 JSON (`no-permission`).
- **N4**: paquete `ayuda` apagado en el tenant → HTTP 403 JSON (`module-disabled`).
- **N5**: payload inválido (pregunta vacía) → HTTP 400 JSON (`payload-invalido`).
- **N6**: consulta fuera de dominio bajo el umbral BM25 → respuesta `sin_llm`; cuota diaria NO es decrementada.
- **N7**: cuota diaria alcanzada antes de la llamada al modelo → HTTP 429 JSON (`ayuda-cuota-excedida`).

### REQ-AYUDA-V2-11 — Control de cuota con SECURITY INVOKER y separación de tablas
El límite de cuota vive en `limite_ayuda_tenant(id_tenant, limite_diario)` y solo puede ser modificado por el operador con service-role (patrón 00117); `authenticated` solo tiene permiso `SELECT`. El contador diario vive en `cuota_ayuda_diaria(id_tenant, fecha, consultas_realizadas)` y utiliza obligatoriamente `fn_hoy_tenant()` (prohibido `current_date`). Todas las funciones son `SECURITY INVOKER`. Grants a `authenticated`: `SELECT, INSERT (id_tenant, fecha, consultas_realizadas), UPDATE (consultas_realizadas)`, sin `DELETE`.

- **Feliz**: `sp_reservar_cuota_ayuda` incrementa atómicamente el contador en 1 si es menor al límite de `limite_ayuda_tenant`.
- **N1**: consulta lanzada cuando `consultas_realizadas = limite_diario` → excepción `cuota-excedida` (HTTP 429).
- **N2**: intento directo de `INSERT` en `cuota_ayuda_diaria` con `consultas_realizadas = 99` → trigger `BEFORE INSERT` lanza `cuota-insert-invalido`.
- **N3**: intento directo de `INSERT` en `cuota_ayuda_diaria` con fecha futura → trigger `BEFORE INSERT` sobrescribe con `fn_hoy_tenant()`.
- **N4**: intento vía PostgREST de ejecutar `UPDATE cuota_ayuda_diaria SET consultas_realizadas = 0` → trigger `BEFORE UPDATE` lanza `cuota-decremento-prohibido`.
- **N5**: intento vía PostgREST de modificar `id_tenant` o `fecha` en `cuota_ayuda_diaria` → trigger `BEFORE UPDATE` lanza `cuota-modificacion-invalida`.
- **N6**: intento de `DELETE FROM cuota_ayuda_diaria` → denegado por permisos de PostgreSQL.
- **N7**: intento de `UPDATE` o `INSERT` en `limite_ayuda_tenant` por `authenticated` → denegado por permisos de PostgreSQL.

### REQ-AYUDA-V2-12 — Telemetría diferida vía after() y entradas_citadas (reemplaza REQ-AYUDA-10)
Al cerrarse el stream o producirse un error, el registro en `consulta_ayuda` se ejecuta mediante `after()` de `next/server`. Se reemplaza la columna `entrada_id text` por `entradas_citadas text[]`. Se registran: `resultado` (`'respondida'`, `'sin_cita'`, `'sin_llm'`, `'fuera_de_opciones'`, `'error'`), `entradas_citadas`, `tipo_error`, `latencia_ms`, `modelo`, y desglose de tokens (`input`, `output`, `cached`, `thinking`). Si la función serverless es interrumpida abruptamente por Vercel, la cuota previamente reservada asegura la contención financiera.

- **Feliz**: stream completado con citas válidas → `after()` persiste fila con `resultado: 'respondida'`, `entradas_citadas: ['venta-nueva']`, tokens y latencia.
- **N1**: stream completado sin citas válidas → `after()` persiste fila con `resultado: 'sin_cita'`, `entradas_citadas: []`.
- **N2**: cliente cancela stream a mitad de generación → `after()` registra telemetría con tokens acumulados hasta la cancelación.
- **N3**: timeout de Vercel corta la ejecución antes de `after()` → la cuota ya fue reservada; no hay sobreconsumo financiero.

### REQ-AYUDA-V2-13 — Preservación de calificación de consultas (REQ-AYUDA-11)
`calificarConsultaAyudaAction` se preserva como Server Action estándar con sus tres compuertas: `verifySession` → `requireModuleRole('ayuda', 'consultar')` → zod → `sp_calificar_consulta_ayuda`.

- **Feliz**: operador califica una consulta propia como útil → fila actualizada en `consulta_ayuda`.
- **N1**: intento de calificar consulta de otro tenant o usuario → `consulta-no-encontrada`.

### REQ-AYUDA-V2-14 — Invariante de aislamiento de datos del tenant (REQ-AYUDA-09)
Bajo ninguna circunstancia se importan módulos de base de datos ni datos de negocio en `lib/ayuda/**`. Verificado mediante el test de regresión inmutable `lib/ayuda/imports.test.ts`.

- **N1**: inclusión de un import a `@/lib/dal` en `lib/ayuda/bm25.ts` → `imports.test.ts` falla la suite de tests.

---

## 2. Matriz de permisos

| Función / Endpoint | Operador con `ayuda.consultar` | Sin permiso | Revendedora (`idRevendedora`) | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `POST /api/ayuda/chat` (Compuertas) | Continúa a BM25 | 403 JSON (`no-permission`) | 401 JSON (`no-permission`) | 403 JSON (`module-disabled`) | Aislado por JWT |
| `POST /api/ayuda/chat` (Cuota) | 200 (SSE stream) | — | — | — | Consume de su propio tenant |
| `calificarConsultaAyudaAction` | ok | `no-permission` | `no-permission` | `module-disabled` | `consulta-no-encontrada` |
| `sp_reservar_cuota_ayuda` | ok | `no-permission` | rechazo (RLS/permiso) | `module-disabled` | Incrementa en su tenant |
| `sp_registrar_consulta_ayuda` | ok | `no-permission` | rechazo (RLS/permiso) | `module-disabled` | Escribe en su tenant |
| `sp_calificar_consulta_ayuda` | fila propia | `no-permission` | `no-permission` | `module-disabled` | `consulta-no-encontrada` |

---

## 3. Cifras financieras

No aplica: este cambio no crea ni modifica cifras financieras ni saldos contables.

---

## 4. INVOKER contra RLS restrictiva

- Todas las funciones creadas o modificadas (`sp_reservar_cuota_ayuda`, `sp_registrar_consulta_ayuda`, `sp_calificar_consulta_ayuda`) son terminantemente **`SECURITY INVOKER`**.
- Ninguna función es `SECURITY DEFINER`, respetando la lista blanca estricta del test 8 de `tests/db/rvp-lecturas.test.ts`.
- La tabla `cuota_ayuda_diaria` cuenta con:
  - Policy restrictiva de revendedora: `auth_revendedora_id() is null`.
  - Policy de tenant: `id_tenant = auth_tenant_id()`.
- La tabla `limite_ayuda_tenant` cuenta con policy de select por tenant (`id_tenant = auth_tenant_id()`) y revendedora bloqueada.
- La tabla `consulta_ayuda` preserva su policy restrictiva `restrict_revendedora_consulta_ayuda`.

---

## 5. Migraciones

Número: el siguiente número libre al momento de aplicar. Contenido de la migración:

1. **Tabla `limite_ayuda_tenant`**:
   ```sql
   create table if not exists limite_ayuda_tenant (
     id_tenant      uuid primary key references tenant(id_tenant) on delete cascade,
     limite_diario  integer not null default 100,
     created_at     timestamptz not null default now()
   );
   alter table limite_ayuda_tenant enable row level security;
   create policy limite_ayuda_tenant_select on limite_ayuda_tenant
     for select to authenticated
     using (id_tenant = auth_tenant_id());
   revoke insert, update, delete on limite_ayuda_tenant from authenticated;
   ```
2. **Tabla `cuota_ayuda_diaria` y triggers**:
   ```sql
   create table if not exists cuota_ayuda_diaria (
     id_tenant             uuid not null references tenant(id_tenant) on delete cascade,
     fecha                 date not null,
     consultas_realizadas  integer not null default 0,
     created_at            timestamptz not null default now(),
     primary key (id_tenant, fecha)
   );
   alter table cuota_ayuda_diaria enable row level security;
   create policy cuota_ayuda_diaria_tenant on cuota_ayuda_diaria
     for all to authenticated
     using (id_tenant = auth_tenant_id())
     with check (id_tenant = auth_tenant_id());
   create policy restrict_revendedora_cuota_ayuda on cuota_ayuda_diaria
     as restrictive for all to authenticated
     using (auth_revendedora_id() is null);

   revoke all on cuota_ayuda_diaria from public, anon;
   grant select, insert (id_tenant, fecha, consultas_realizadas), update (consultas_realizadas)
     on cuota_ayuda_diaria to authenticated;
   revoke delete on cuota_ayuda_diaria from authenticated;

   create or replace function fn_guardia_insert_cuota_ayuda() returns trigger
   language plpgsql security invoker set search_path = public, pg_temp as $$
   begin
     new.fecha := fn_hoy_tenant();
     if new.consultas_realizadas not in (0, 1) then
       raise exception 'cuota-insert-invalido' using errcode = '42501';
     end if;
     return new;
   end;
   $$;

   create trigger trg_guardia_insert_cuota_ayuda
     before insert on cuota_ayuda_diaria
     for each row execute function fn_guardia_insert_cuota_ayuda();

   create or replace function fn_guardia_update_cuota_ayuda() returns trigger
   language plpgsql security invoker set search_path = public, pg_temp as $$
   begin
     if new.consultas_realizadas <= old.consultas_realizadas then
       raise exception 'cuota-decremento-prohibido' using errcode = '42501';
     end if;
     if new.id_tenant is distinct from old.id_tenant or new.fecha is distinct from old.fecha then
       raise exception 'cuota-modificacion-invalida' using errcode = '42501';
     end if;
     return new;
   end;
   $$;

   create trigger trg_guardia_update_cuota_ayuda
     before update on cuota_ayuda_diaria
     for each row execute function fn_guardia_update_cuota_ayuda();
   ```
3. **SP `sp_reservar_cuota_ayuda` (INVOKER)**:
   ```sql
   create or replace function sp_reservar_cuota_ayuda() returns void
   language plpgsql security invoker set search_path = public, pg_temp as $$
   declare
     v_tenant uuid := auth_tenant_id();
     v_limite integer;
     v_res    integer;
   begin
     if not (select auth_tiene_permiso('ayuda', 'consultar')) then
       raise exception 'no-permission' using errcode = '42501';
     end if;
     if v_tenant is null then
       raise exception 'no-tenant' using errcode = '42501';
     end if;
     if not fn_modulo_habilitado(v_tenant, 'ayuda') then
       raise exception 'module-disabled' using errcode = 'P0001';
     end if;

     select coalesce(limite_diario, 100) into v_limite
     from limite_ayuda_tenant where id_tenant = v_tenant;
     if v_limite is null then
       v_limite := 100;
     end if;

     insert into cuota_ayuda_diaria (id_tenant, fecha, consultas_realizadas)
     values (v_tenant, fn_hoy_tenant(), 1)
     on conflict (id_tenant, fecha) do update
       set consultas_realizadas = cuota_ayuda_diaria.consultas_realizadas + 1
       where cuota_ayuda_diaria.consultas_realizadas < v_limite
     returning consultas_realizadas into v_res;

     if v_res is null then
       raise exception 'cuota-excedida' using errcode = 'P0001';
     end if;
   end;
   $$;
   ```
4. **Migración de `consulta_ayuda`**:
   ```sql
   alter table consulta_ayuda add column if not exists entradas_citadas text[] not null default array[]::text[];
   update consulta_ayuda
   set entradas_citadas = case
     when entrada_id is not null then array[entrada_id]
     else array[]::text[]
   end;
   alter table consulta_ayuda drop constraint if exists consulta_ayuda_resultado_entrada_check;
   alter table consulta_ayuda drop constraint if exists consulta_ayuda_resultado_check;
   alter table consulta_ayuda add constraint consulta_ayuda_resultado_check
     check (resultado in ('respondida', 'sin_cita', 'sin_llm', 'fuera_de_opciones', 'error'));
   alter table consulta_ayuda drop column if exists entrada_id;

   alter table consulta_ayuda add column if not exists tipo_error text;
   alter table consulta_ayuda add column if not exists latencia_ms integer;
   alter table consulta_ayuda add column if not exists modelo text;
   alter table consulta_ayuda add column if not exists tokens_input integer;
   alter table consulta_ayuda add column if not exists tokens_output integer;
   alter table consulta_ayuda add column if not exists tokens_cached integer;
   alter table consulta_ayuda add column if not exists tokens_thinking integer;
   ```
5. **Actualización de `sp_registrar_consulta_ayuda` (INVOKER)**:
   Partiendo de su definición en `00150`, acepta `p_entradas_citadas text[]`, `p_tipo_error text`, `p_latencia_ms integer`, `p_modelo text`, `p_tokens_input integer`, `p_tokens_output integer`, `p_tokens_cached integer`, `p_tokens_thinking integer`.

**Bloque `-- DOWN:` ejecutable**:
```sql
-- DOWN:
-- alter table consulta_ayuda add column entrada_id text;
-- update consulta_ayuda set entrada_id = case when cardinality(entradas_citadas) > 0 then entradas_citadas[1] else null end;
-- alter table consulta_ayuda drop column if exists entradas_citadas cascade;
-- alter table consulta_ayuda drop column if exists tipo_error cascade;
-- alter table consulta_ayuda drop column if exists latencia_ms cascade;
-- alter table consulta_ayuda drop column if exists modelo cascade;
-- alter table consulta_ayuda drop column if exists tokens_input cascade;
-- alter table consulta_ayuda drop column if exists tokens_output cascade;
-- alter table consulta_ayuda drop column if exists tokens_cached cascade;
-- alter table consulta_ayuda drop column if exists tokens_thinking cascade;
-- drop function if exists sp_reservar_cuota_ayuda();
-- drop trigger if exists trg_guardia_update_cuota_ayuda on cuota_ayuda_diaria;
-- drop function if exists fn_guardia_update_cuota_ayuda();
-- drop trigger if exists trg_guardia_insert_cuota_ayuda on cuota_ayuda_diaria;
-- drop function if exists fn_guardia_insert_cuota_ayuda();
-- drop table if exists cuota_ayuda_diaria cascade;
-- drop table if exists limite_ayuda_tenant cascade;
-- <restaura versión previa de sp_registrar_consulta_ayuda>
```

---

## 6. Ubicación del código y contratos de tipos

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `app/api/ayuda/chat/route.ts` | Frontend (`PanelAyuda`) | Endpoint Route Handler SSE; adaptador HTTP del stream. |
| `app/api/ayuda/chat/compuertas.ts` | Solo `route.ts` | Colocalizado en su módulo (AGENTS: *"Used by one module → its folder"*). |
| `lib/ayuda/tipos.ts` | Todo el módulo | Modificado exclusivamente en Fase 1 (contratos). |
| `lib/ayuda/bm25.ts` | Motor de ayuda | Lógica pura en TypeScript de ranking BM25, testeable en memoria. |
| `lib/ayuda/evaluacion.test.ts` | Suite de tests | Suite de ~40 preguntas reales para calibrar umbral y peso 0.4. |
| `lib/ayuda/stopwords.ts` | `bm25.ts` | Diccionario de stopwords y whitelist funcional inmutable. |
| `lib/ayuda/normalizar.ts` | `bm25.ts` | Stemming y desacentuación en español. |
| `lib/ayuda/stream.ts` | `route.ts` | `TransformStream` para parsing de delimitadores y citas. |
| `lib/dal/ayuda/cuota.ts` | `compuertas.ts` | DAL de base de datos para reserva de cuota y telemetría. |

### Contratos de tipos y firmas — `lib/ayuda/tipos.ts` (cerrado en Fase 1)

```ts
import type { Permiso } from '@/lib/types/administracion'

export interface DetalleGuia {
  tema: string
  texto: string
}

export interface EntradaGuia {
  id: string
  titulo: string
  pasos: readonly string[]
  ruta?: `/${string}`
  permisos: readonly [Permiso, ...Permiso[]]
  detalles?: readonly DetalleGuia[]
  alias?: readonly string[]
}

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente'
  texto: string
  citasPrevias?: readonly string[]
}

export interface TokenLinkAyuda {
  tipo: 'link'
  id: string
  titulo: string
  ruta: string
}

export type EventoStreamAyuda =
  | { tipo: 'texto'; contenido: string }
  | TokenLinkAyuda
  | { tipo: 'sugerencias'; entradas: Array<{ id: string; titulo: string; ruta?: string }> }
  | { tipo: 'error'; reason: string }
```

---

## 7. Decisiones de diseño

- **DR-AYUDA-V2-1 (Cerrada / Propuesta aprobada) — Respuesta sin citas válidas**:
  Cuando el stream finaliza sin emitir ninguna cita válida a la guía, se registra en telemetría `resultado = 'sin_cita'` (con `entradas_citadas = []`), se mantiene el texto transmitido en el chat y la UI agrega al final del mensaje la tarjeta fija de advertencia de v1: *"No tengo esa respuesta. Preguntale al administrador de tu negocio."*.
- **DR-AYUDA-V2-2 (Abierta) — Límite diario por tenant**:
  Se fija en 100 consultas diarias por defecto en `limite_ayuda_tenant`, configurable por el operador.
- **DR-AYUDA-V2-3 (Abierta / Fuera de v2) — Caché de respuestas**:
  Con `SECURITY INVOKER`, cualquier usuario con acceso al tenant podría inyectar respuestas adulteradas en la tabla de caché que luego serían leídas por sus compañeros (envenenamiento de caché interno). Por seguridad, el caché de respuestas queda postergado y fuera de las fases de implementación de v2.
- **DR-AYUDA-V2-4 (Cerrada) — Salida en texto plano sin Markdown**:
  El modelo emite texto plano directo (sin negritas ni listas con formato Markdown), conteniendo únicamente citas sintácticas `[[id]]`.
- **DR-AYUDA-V2-5 (Cerrada) — Reintento y fallback solo antes del primer byte**:
  Una vez emitido el primer token al cliente vía SSE, la conexión no admite conmutación transparente de modelo; los fallos posteriores emiten evento SSE de error.
- **DR-AYUDA-V2-6 (Cerrada) — Telemetría diferida con `after()`**:
  La persistencia en base de datos se programa de forma asíncrona tras la respuesta sin demorar el stream al cliente.
