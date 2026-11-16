# Spec — chat-ayuda-v2 / ayuda

**Change**: `chat-ayuda-v2` · **Requisitos**: `REQ-AYUDA-V2-01…14` · **Decisiones**: `DR-AYUDA-V2-1…6`

Esta especificación evoluciona el módulo de ayuda implementado en `chat-ayuda`. **Reemplaza formalmente** las siguientes secciones de `openspec/changes/chat-ayuda/specs/REQ-AYUDA.md`:
- **REQ-AYUDA-05 (Salida estructurada y re-validación)** → reemplazado por REQ-AYUDA-V2-06.
- **REQ-AYUDA-06 (El modelo nunca devuelve rutas / descarte de texto)** → reemplazado por REQ-AYUDA-V2-08.
- **REQ-AYUDA-07 (Máximo dos llamadas por turno)** → reemplazado por REQ-AYUDA-V2-07 (llamada única).
- **REQ-AYUDA-10 (Valores de resultado)** → valores ampliados y check de `entrada_id` flexibilizado en REQ-AYUDA-V2-12.

---

## 1. Requisitos

### REQ-AYUDA-V2-01 — Extensión tipada de EntradaGuia con alias
`EntradaGuia` MUST aceptar el campo opcional `alias?: readonly string[]`. Si está definido, cada alias debe ser un string de hasta 64 caracteres. La presencia de alias no altera la compatibilidad hacia atrás con las entradas existentes.

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

### REQ-AYUDA-V2-04 — Umbral de corte BM25 y fallback sin LLM
Si el score BM25 de la mejor entrada recuperada no alcanza `UMBRAL_MINIMO_BM25`, el sistema MUST retornar una respuesta predefinida de orientación con sugerencias de las 3 entradas con mayor score relativo **sin invocar a la API de Gemini**.

- **Feliz**: pregunta incomprensible o fuera de dominio ("cómo cocinar una pizza") → score < umbral; se emite de inmediato evento SSE de sugerencias locales; cero llamadas a Gemini.
- **N1**: consulta con palabras clave operativas reconocidas → score ≥ umbral; se invoca al LLM.

### REQ-AYUDA-V2-05 — Contexto multi-turno y ponderación de turnos previos
Si la petición incluye historial conversacional (últimos 4 turnos), el query BM25 MUST incorporar los títulos y alias de las entradas citadas en el turno anterior con un factor de peso atenuado (0.4), manteniendo la entrada activa en el contexto. Las respuestas enlatadas del sistema y tarjetas de sugerencias previas MUST ser excluidas del historial enviado al modelo.

- **Feliz**: turno 1 pregunta por ventas; turno 2 pregunta "¿y cómo le aplico descuento?"; el BM25 pondera el contexto de ventas previo y recupera descuentos de ventas.
- **N1**: historial con más de 4 turnos → se truncan conservando estrictamente los 4 más recientes.
- **N2**: mensajes del historial con tarjetas del sistema o sugerencias → se descartan antes de armar el prompt.

### REQ-AYUDA-V2-06 — Prompting con prefijo estable y salida con citas sintácticas (reemplaza REQ-AYUDA-05)
El prompt MUST estructurarse con: (1) instrucciones de sistema invariantes byte a byte, (2) las 5–6 entradas recuperadas con pasos y detalles, (3) historial reciente, (4) pregunta actual. El modelo MUST instruirse a responder en texto plano natural y citar pantallas únicamente mediante la sintaxis `[[entrada-id]]`. No se utiliza `responseSchema` JSON.

- **Feliz**: el modelo emite texto fluido intercalando citas como "Podés iniciar la operación desde [[venta-nueva]] y luego cobrar.".
- **N1**: dos consultas distintas con las mismas entradas recuperadas comparten el mismo prefijo de instrucciones.
- **N2**: el prompt no contiene rutas URL (strings que empiecen con `/`).

### REQ-AYUDA-V2-07 — Resiliencia en llamada streaming sin 2ª llamada (reemplaza REQ-AYUDA-07)
Se realiza una única llamada al modelo de lenguaje configurado vía `GEMINI_MODEL` (sin prefijar en código; evaluado en Fase 0). No se admite una segunda llamada por detalles, ya que estos viajan en el top recuperado. Ante errores 429 o 5xx del proveedor, MUST realizarse a lo sumo 1 reintento con backoff exponencial. Si persiste el fallo y existe `GEMINI_MODEL_FALLBACK`, se conmuta a dicho modelo secundario. **El reintento y el fallback son válidos ÚNICAMENTE antes de emitir el primer byte al cliente**.

- **Feliz**: llamada exitosa genera stream directo; una sola llamada al proveedor.
- **N1**: error 503 inmediato antes del primer byte → se reintenta tras backoff; si falla, se invoca `GEMINI_MODEL_FALLBACK`.
- **N2**: fallo a mitad del streaming (después del primer byte) → no se reintenta ni conmuta; se emite evento de error de stream.

### REQ-AYUDA-V2-08 — Parser TransformStream y resolución de citas (reemplaza REQ-AYUDA-06)
Los chunks de texto emitidos por el modelo MUST pasar por un `TransformStream` que retenga en buffer delimitadores abiertos `[` o `[[` hasta encontrar `]]`, con un límite de seguridad de 80 caracteres. Si el buffer supera 80 caracteres sin cerrar, se vacía como texto literal. Al cerrarse una cita `[[id]]`, se valida contra las entradas autorizadas del turno: si es válida, se emite un token de link con `{ id, titulo, ruta }` resuelto desde la guía; si es inválida, se descarta. La ruta URL jamás proviene del modelo.

- **Feliz**: modelo emite chunk con `[[venta-nueva]]` → el stream emite evento de link con ruta `/ventas/nueva`.
- **N1**: delimitador partido entre dos chunks (`[` al final de chunk 1 y `[id]]` al inicio de chunk 2) → el buffer une el identificador y resuelve el link sin corromper el texto.
- **N2**: corchete abierto sin cerrar que supera 80 caracteres → se emite como texto literal ordinario.
- **N3**: cita con id inexistente `[[pantalla-fantasma]]` → se descarta la cita y no se emite ningún enlace inválido.

### REQ-AYUDA-V2-09 — Renderizado cliente seguro en texto plano
El componente `PanelAyuda` MUST renderizar el flujo SSE combinando texto plano y componentes de enlace seguros (`<Link href={ruta}>`). MUST NOT utilizar `dangerouslySetInnerHTML` ni evaluadores de HTML crudo.

- **Feliz**: respuesta con texto y botones de link a las pantallas oficiales.
- **N1**: modelo intenta emitir etiquetas HTML `<script>` o `<a href="...">` en el texto → se renderizan como texto literal plano en el DOM; ataque XSS neutralizado.

### REQ-AYUDA-V2-10 — Route Handler POST /api/ayuda/chat y orden estricto de compuertas
El endpoint `POST /api/ayuda/chat` MUST implementar estrictamente el siguiente orden de compuertas colocalizadas en `app/api/ayuda/chat/`:
1. Validación de cabecera `Origin` contra `Host` (o `x-forwarded-host`) → si no coinciden, rechazo 403 sin tocar sesión ni base de datos.
2. `verifySession()`: validación de sesión activa; si `session.idRevendedora` está presente, rechazo inmediato con `401 Unauthorized` / `no-permission`.
3. `requireModuleRole(session, 'ayuda', 'consultar')`.
4. Validación Zod `strictObject` (`consultarAyudaChatSchema`).
5. `permisosEfectivos(session)`.
6. Reserva de cuota atómica (`sp_reservar_cuota_ayuda`).

- **Feliz**: petición POST legítima de operador autenticado con origen válido → supera compuertas e inicia streaming SSE.
- **N1**: petición con `Origin: https://sitio-malicioso.com` → 403 Forbidden antes de llamar a `verifySession`.
- **N2**: usuario del portal de revendedoras (`session.idRevendedora` no nulo) → 401 Unauthorized (`no-permission`).
- **N3**: usuario sin permiso `ayuda.consultar` → 403 / `no-permission`.
- **N4**: paquete `ayuda` deshabilitado en el tenant → `module-disabled`.
- **N5**: payload inválido (pregunta vacía o > 300 caracteres) → 400 `payload-invalido`.
- **N6**: cuota diaria alcanzada → evento SSE o status 429 con slug `ayuda-cuota-excedida`.

### REQ-AYUDA-V2-11 — Control de cuota con SECURITY INVOKER y trigger anti-decrementos
`cuota_ayuda_diaria` almacena las consultas diarias por `(id_tenant, fecha)`. Todas las funciones asociadas son `SECURITY INVOKER`. El rol `authenticated` recibe grants restringidos (`SELECT, INSERT, UPDATE (consultas_realizadas)`) sin `DELETE`. Un trigger `BEFORE UPDATE` en la tabla MUST rechazar cualquier intento de decrementar `consultas_realizadas` o de modificar `id_tenant`, `fecha` o `limite_diario`. El campo `limite_diario` solo puede ser editado mediante procedimientos del operador de plataforma (patrón 00117).

- **Feliz**: `sp_reservar_cuota_ayuda` incrementa atómicamente el contador en 1 si es menor a `limite_diario`.
- **N1**: consulta lanzada cuando `consultas_realizadas = limite_diario` → excepción `cuota-excedida`.
- **N2**: intento vía PostgREST de ejecutar `UPDATE cuota_ayuda_diaria SET consultas_realizadas = 0` → trigger lanza `cuota-decremento-prohibido`.
- **N3**: intento vía PostgREST de modificar `limite_diario = 99999` → trigger lanza `cuota-modificacion-invalida`.
- **N4**: intento de `DELETE FROM cuota_ayuda_diaria` → denegado por permisos de PostgreSQL (sin grant de delete).

### REQ-AYUDA-V2-12 — Telemetría diferida vía after() (actualiza REQ-AYUDA-10)
Al cerrarse el stream o producirse un error, el registro en `consulta_ayuda` se ejecuta mediante `after()` de `next/server`. Se registran: `resultado` (`'respondida'`, `'sin_llm'`, `'fuera_de_opciones'`, `'error'`), `tipo_error`, `latencia_ms`, `modelo`, y desglose de tokens (`input`, `output`, `cached`, `thinking`). Se elimina la restricción CHECK de que `resultado = 'respondida'` requiera obligatoriamente un `entrada_id` no nulo. Si la función serverless es interrumpida abruptamente por Vercel, la cuota previamente reservada asegura la contención financiera.

- **Feliz**: stream completado con éxito → `after()` persiste fila con tokens y latencia; stream al cliente no se demora.
- **N1**: cliente cancela el stream a mitad de generación → `after()` registra `resultado: 'respondida'` o `'error'` con los tokens acumulados hasta la cancelación.
- **N2**: timeout de Vercel corta la ejecución antes de `after()` → la cuota ya fue reservada; no hay sobreconsumo financiero.

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
| `POST /api/ayuda/chat` | 200 (SSE stream) | 403 (`no-permission`) | 401 (`no-permission`) | 403 (`module-disabled`) | Aislado por JWT |
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
  - Policy restrictiva de revendedora: `auth_revendedora_id() is null` (impide que el portal de revendedoras acceda al contador del comercio).
  - Policy de tenant: `id_tenant = auth_tenant_id()`.
- La tabla `consulta_ayuda` preserva su policy restrictiva `restrict_revendedora_consulta_ayuda`.

---

## 5. Migraciones

Número: el siguiente número libre al momento de aplicar. Contenido de la migración:

1. **Tabla `cuota_ayuda_diaria`**:
   ```sql
   create table if not exists cuota_ayuda_diaria (
     id_tenant             uuid not null references tenant(id_tenant) on delete cascade,
     fecha                 date not null,
     consultas_realizadas  integer not null default 0,
     limite_diario         integer not null default 100,
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
   grant select, insert, update (consultas_realizadas) on cuota_ayuda_diaria to authenticated;
   ```
2. **Trigger anti-decremento y anti-adulteración**:
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

   create trigger trg_guardia_cuota_ayuda
     before update on cuota_ayuda_diaria
     for each row execute function fn_guardia_cuota_ayuda();
   ```
3. **SP `sp_reservar_cuota_ayuda` (INVOKER)**:
   ```sql
   create or replace function sp_reservar_cuota_ayuda() returns void
   language plpgsql security invoker set search_path = public, pg_temp as $$
   declare
     v_tenant uuid := auth_tenant_id();
     v_res integer;
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

     insert into cuota_ayuda_diaria (id_tenant, fecha, consultas_realizadas, limite_diario)
     values (v_tenant, current_date, 1, 100)
     on conflict (id_tenant, fecha) do update
       set consultas_realizadas = cuota_ayuda_diaria.consultas_realizadas + 1
       where cuota_ayuda_diaria.consultas_realizadas < cuota_ayuda_diaria.limite_diario
     returning consultas_realizadas into v_res;

     if v_res is null then
       raise exception 'cuota-excedida' using errcode = 'P0001';
     end if;
   end;
   $$;
   ```
4. **Modificación de `consulta_ayuda` y `sp_registrar_consulta_ayuda`**:
   - Se agregan columnas: `tipo_error text`, `latencia_ms integer`, `modelo text`, `tokens_input integer`, `tokens_output integer`, `tokens_cached integer`, `tokens_thinking integer`.
   - Se actualiza el CHECK de resultado para admitir `in ('respondida', 'sin_llm', 'fuera_de_opciones', 'error')` y se elimina la igualdad estricta con `entrada_id is not null`.
   - Se actualiza `sp_registrar_consulta_ayuda` a partir de `pnpm sp:last sp_registrar_consulta_ayuda` para recibir los nuevos parámetros de telemetría.

Bloque `-- DOWN:` ejecutable documentado con restauración de los esquemas anteriores y eliminación de tablas y triggers.

---

## 6. Ubicación del código y contratos de tipos

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `app/api/ayuda/chat/route.ts` | Frontend (`PanelAyuda`) | Endpoint Route Handler SSE; adaptador HTTP del stream. |
| `app/api/ayuda/chat/compuertas.ts` | Solo `route.ts` | Colocalizado en su módulo (AGENTS: *"Used by one module → its folder"*). |
| `lib/ayuda/bm25.ts` | Motor de ayuda | Lógica pura en TypeScript de ranking BM25, testeable en memoria. |
| `lib/ayuda/stopwords.ts` | `bm25.ts` | Diccionario de stopwords y whitelist funcional inmutable. |
| `lib/ayuda/normalizar.ts` | `bm25.ts` | Stemming y desacentuación en español. |
| `lib/ayuda/stream.ts` | `route.ts` | `TransformStream` para parsing de delimitadores y citas. |
| `lib/dal/ayuda/cuota.ts` | `compuertas.ts` | DAL de base de datos para reserva de cuota y telemetría. |

### Contratos de tipos y firmas — `lib/ayuda/tipos.ts`

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

- **DR-AYUDA-V2-1 (Abierta) — Comportamiento ante respuesta sin citas válidas**:
  Al haber transmitido ya el texto vía streaming al usuario, no puede descartarse la respuesta. Se decide provisionalmente mantener el texto visible y en telemetría marcar `resultado = 'respondida'` con array de citas vacío, evaluando si corresponde añadir una advertencia sutil en la UI.
- **DR-AYUDA-V2-2 (Abierta) — Límite diario por tenant**:
  Se fija en 100 consultas diarias por defecto en `cuota_ayuda_diaria`. Configurable por el operador.
- **DR-AYUDA-V2-3 (Abierta / Fuera de v2) — Caché de respuestas**:
  Con `SECURITY INVOKER`, cualquier usuario con acceso al tenant podría inyectar respuestas adulteradas en la tabla de caché que luego serían leídas por sus compañeros (envenenamiento de caché interno). Por seguridad, el caché de respuestas queda postergado y fuera de las fases de implementación de v2.
- **DR-AYUDA-V2-4 (Cerrada) — Sustitución de JSON por citas sintácticas**:
  Se abandona `responseSchema` JSON en favor de Markdown plano y delimitadores `[[id]]` parseados al vuelo con `TransformStream`.
- **DR-AYUDA-V2-5 (Cerrada) — Reintento y fallback solo antes del primer byte**:
  Una vez emitido el primer token al cliente vía SSE, la conexión no admite conmutación transparente de modelo; los fallos posteriores emiten evento de error.
- **DR-AYUDA-V2-6 (Cerrada) — Telemetría diferida con `after()`**:
  La persistencia en base de datos se programa de forma asíncrona tras la respuesta sin demorar el stream al cliente.
