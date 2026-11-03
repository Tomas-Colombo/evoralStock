# Spec — chat-ayuda / ayuda

**Change**: `chat-ayuda` · **Requisitos**: `REQ-AYUDA-01…12` · **Decisiones**: `DR-AYUDA-1…8`

Los contratos de §6 son lo que permite trabajar en paralelo: cada lote
programa contra ellos, no contra el código de otro lote. Cambiar un contrato
es un cambio de spec: se avisa al revisor antes de tocarlo.

## 1. Requisitos

### REQ-AYUDA-01 — Permisos tipados

`CATALOGO_PERMISOS` MUST ser `as const` y exportar `Permiso` como unión
literal `'<modulo>.<accion>'`. Renombrar una acción del catálogo MUST romper
el typecheck de toda entrada de la guía que la use. Se agrega `ayuda: ['consultar']`.

- **Feliz**: `'ventas.crear'` compila; `'ventas.borrar'` no compila.
- **N1**: entrada de guía con `permisos: []` → error de tipos (tupla no vacía).
- **N2**: los consumidores que indexan con `string` (`provision-tenant`,
  `e2e/support/tenant.ts`) siguen compilando sin `any`.

### REQ-AYUDA-02 — Permisos efectivos

`permisosEfectivos(session)` MUST devolver solo `Permiso` de módulos en
`modulosHabilitados` y presentes en el catálogo. Sin `rolId` → vacío.

- **Feliz**: rol con `ventas: ['ver','crear']`, módulo habilitado → `{ventas.ver, ventas.crear}`.
- **N1**: módulo con permiso en el rol pero apagado en el tenant → no aparece.
- **N2**: acción inexistente en el catálogo (`ventas: ['volar']`) → se ignora.
- **N3**: `rolId: null` → conjunto vacío.

### REQ-AYUDA-03 — Filtro fail-closed

`filtrarGuia(guia, permisos)` MUST devolver solo entradas cuyos permisos
estén TODOS en el conjunto, en el orden de la guía.

- **Feliz**: entrada `[ventas.ver, ventas.crear]` con ambos → visible.
- **N1**: falta uno de los permisos → no visible.
- **N2**: entrada con `permisos` vacío en runtime (cast) → no visible.
- **N3**: conjunto vacío → lista vacía.

### REQ-AYUDA-04 — Contexto con prefijo estable

`armarPrompt` MUST producir `instrucciones` idénticas byte a byte para el
mismo conjunto de entradas permitidas, sin importar pregunta, historial ni
foco (cache implícito de Gemini). El turno final MUST tener las etiquetas
`Entrada en foco:`, `Detalles:`, `Pregunta del usuario:`. Los detalles MUST
ser solo los de la entrada en foco. Ni `ruta` ni `permisos` aparecen en el prompt.

- **Feliz**: dos preguntas distintas → mismas `instrucciones`.
- **N1**: el índice no contiene ninguna `ruta` (string que empiece con `/`).
- **N2**: sin foco → `Entrada en foco: ninguna` y sin bloque de detalles de otras entradas.
- **N3**: historial de 6 → se respeta el orden y los roles.

### REQ-AYUDA-05 — Salida estructurada y re-validación

El esquema enviado al modelo MUST tener `entradaId` como `STRING`,
`format: "enum"`, `enum` = ids permitidos de este request, `nullable: true`.
La respuesta MUST re-validarse con zod en el servidor.

- **Feliz**: `{respuesta, entradaId: 'venta-nueva'}` con id permitido → ok.
- **N1**: `entradaId` fuera del enum del request → `formato`.
- **N2**: JSON inválido o sin `respuesta` → `formato`.
- **N3**: `respuesta` > 2000 caracteres → `formato`.

### REQ-AYUDA-06 — El modelo nunca devuelve rutas

`resolverRespuesta` MUST tomar la ruta de la guía por `entradaId`. Con
`entradaId: null` el resultado es `fuera_de_opciones` y la UI muestra la
tarjeta fija; el texto del modelo se descarta.

- **Feliz**: `entradaId` con `ruta` → `{ tipo: 'respondida', entrada: { id, titulo, ruta } }`.
- **N1**: `entradaId: null` → `fuera_de_opciones`, sin texto del modelo.
- **N2**: el texto del modelo contiene `/administracion` → se devuelve tal cual como texto, nunca como link.

### REQ-AYUDA-07 — Máximo dos llamadas por turno

Si `necesitaDetalle` y `entradaId` ≠ foco, MUST hacerse UNA segunda llamada
con esa entrada en foco. Nunca más de dos. Si la segunda falla, vale la primera.

- **Feliz**: foco `null`, respuesta pide detalle de `gasto-nuevo` → 2 llamadas, la 2ª con foco `gasto-nuevo`.
- **N1**: la 2ª también pide detalle de otra entrada → no hay 3ª.
- **N2**: `necesitaDetalle` con `entradaId` = foco → 1 llamada.
- **N3**: 2ª llamada con timeout → se usa la 1ª respuesta.

### REQ-AYUDA-08 — Errores tipados y log mínimo

El adaptador MUST clasificar fallos en `sin-clave | timeout | proveedor | formato`.
El log MUST contener solo tipo, modelo, status HTTP, `error.name` y
`error.message` recortado a 200. NUNCA el objeto error, `cause`, prompt,
respuesta ni la clave.

- **Feliz**: 503 del proveedor → `proveedor`, log con `status: 503`.
- **N1**: abort a los 10 s → `timeout`.
- **N2**: sin `GEMINI_API_KEY` → `sin-clave` sin llamar a la red.
- **N3**: spy de `console.error` no recibe ningún argumento `instanceof Error` ni el texto del prompt.

### REQ-AYUDA-09 — Ningún dato del tenant al modelo

`lib/ayuda/**` (salvo tests) MUST NOT importar `@/lib/dal`, `@supabase/*` ni
`next/headers`, con excepción de `lib/ayuda/config.ts` (`server-only`).

- **N1**: test que recorre los imports de `lib/ayuda/**` y falla si aparece uno prohibido.

### REQ-AYUDA-10 — Registro de cada turno

Cada turno (respondido, fuera de opciones o fallido) MUST registrarse en
`consulta_ayuda` con `sp_registrar_consulta_ayuda`. Si el registro falla, la
respuesta igual llega al usuario (se loguea el slug).

- **Feliz**: turno respondido → fila con `entrada_id` y `resultado = 'respondida'`.
- **N1**: turno con `timeout` → fila `resultado = 'error'`, `respuesta` null.
- **N2**: otro tenant → 0 filas visibles (RLS).
- **N3**: módulo `ayuda` apagado → `module-disabled`.
- **N4**: `pregunta` de 301 caracteres directo al SP → rechazo por CHECK.

### REQ-AYUDA-11 — Calificar solo la fila propia

`sp_calificar_consulta_ayuda(id, util)` MUST actualizar solo si la fila es del
tenant y de `auth.uid()`. Se puede re-calificar.

- **Feliz**: fila propia → `util` actualizado.
- **N1**: fila de otro usuario del mismo tenant → `consulta-no-encontrada`.
- **N2**: fila de otro tenant → `consulta-no-encontrada`.
- **N3**: fila con `resultado = 'error'` → `consulta-no-encontrada`.

### REQ-AYUDA-12 — Panel

Se monta solo si `hasModuleAccess(session, 'ayuda', 'consultar')` Y
`ayudaDisponible()`. Escape cierra solo el panel. Un turno fallido quita la
burbuja del usuario, devuelve el texto al input y muestra el error de
`mensajeDeError`. Cada respuesta `respondida` tiene "¿Te sirvió?" (sí/no).

- **N1**: sin clave → el layout no renderiza el panel (ni el botón).
- **N2**: sin permiso → idem.
- **N3**: con un `Modal` abierto, Escape cierra el modal y no el panel (el handler va en el panel, no en `document`).
- **N4**: doble envío mientras hay un turno en vuelo → ignorado.

## 2. Matriz de permisos

| Función | Operador con `ayuda.consultar` | Sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `consultarAyudaAction` | ok | `no-permission` | redirigida por el layout; action → `no-permission` | `module-disabled` | — (no lee DB) |
| `calificarConsultaAyudaAction` | ok | `no-permission` | `no-permission` | `module-disabled` | `consulta-no-encontrada` |
| `sp_registrar_consulta_ayuda` | ok | — (lo filtra la guarda) | — | `module-disabled` | escribe en su propio tenant (JWT) |
| `sp_calificar_consulta_ayuda` | fila propia | — | — | `module-disabled` | `consulta-no-encontrada` |

## 3. Cifras financieras

No aplica: el cambio no crea ni modifica cifras.

## 4. INVOKER contra RLS restrictiva

Ambos `sp_*` son INVOKER y la tabla no tiene policy restrictiva de
revendedora: **filtra por diseño** (RLS por tenant). La fila propia se
garantiza en el SP (`id_usuario = auth.uid()`), no en una policy, porque el
proyecto no tiene policies por usuario (ver DR-AYUDA-4). Ninguna DEFINER.

## 5. Migraciones

Una sola migración, número = siguiente libre al aplicar. Contenido:

1. `insert into modulo (codigo, nombre) values ('ayuda', 'Ayuda')`.
2. Nueva versión de `fn_codigos_paquete` (desde `pnpm sp:last
   fn_codigos_paquete`) con `when 'ayuda' then array['ayuda']`. Mostrar solo el diff.
3. `tenant_modulo`: nada; ningún tenant lo tiene hasta que el operador lo prenda.
   Verificar que `fn_modulo_tiene_estado_vivo('ayuda')` da falso (apagable siempre).
4. Roles `Administrador` de todos los tenants: `permisos || '{"ayuda":["consultar"]}'`
   (sin filtrar por módulo habilitado, a diferencia de `00108`: el permiso
   sin módulo no habilita nada y así el admin ya lo tiene el día que el
   operador prende el paquete).
5. Tabla `consulta_ayuda`:

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id_consulta_ayuda` | uuid pk | `default gen_random_uuid()` |
| `id_tenant` | uuid not null | FK `tenant` on delete cascade |
| `id_usuario` | uuid not null | FK `usuario` on delete cascade |
| `id_conversacion` | uuid not null | generado por el cliente |
| `pregunta` | text not null | `char_length between 1 and 300` |
| `respuesta` | text null | `char_length <= 2000` |
| `entrada_id` | text null | `char_length <= 64` |
| `resultado` | text not null | `in ('respondida','fuera_de_opciones','error')` |
| `util` | boolean null | |
| `created_at` | timestamptz not null | `default now()` |

   CHECK: `(resultado = 'respondida') = (entrada_id is not null)`.
   Índice `(id_tenant, created_at desc)`.
   RLS: policy `consulta_ayuda_tenant` `for all to authenticated using/with check (id_tenant = auth_tenant_id())`.
   Grants: `select, insert` y `update (util)` a `authenticated`; sin `delete`.

6. `sp_registrar_consulta_ayuda(p_id_conversacion uuid, p_pregunta text,
   p_respuesta text, p_entrada_id text, p_resultado text) returns uuid` —
   INVOKER, `search_path = public, pg_temp`, `id_tenant := auth_tenant_id()`,
   `id_usuario := auth.uid()`, `module-disabled` si `fn_modulo_habilitado` da falso.
7. `sp_calificar_consulta_ayuda(p_id uuid, p_util boolean) returns void` —
   INVOKER; `update … where id = p_id and id_tenant = auth_tenant_id() and
   id_usuario = auth.uid() and resultado = 'respondida'`; 0 filas →
   `raise exception 'consulta-no-encontrada' using errcode = '42704'`.

`-- DOWN:` ejecutable en orden inverso: borra `tenant_modulo` de `ayuda`,
saca la clave `ayuda` de `rol.permisos`, restaura la versión anterior de
`fn_codigos_paquete` y borra el módulo.

## 6. Contratos (lo que cada lote respeta)

### Tipos — `lib/ayuda/tipos.ts`

```ts
import type { Permiso } from '@/lib/types/administracion'

export interface DetalleGuia { tema: string; texto: string }
export interface EntradaGuia {
  id: string                          // kebab, único, ≤64
  titulo: string
  pasos: readonly string[]
  ruta?: `/${string}`                 // solo rutas estáticas de app/(app)
  permisos: readonly [Permiso, ...Permiso[]]
  detalles?: readonly DetalleGuia[]
}
export interface MensajeHistorial { rol: 'usuario' | 'asistente'; texto: string }
export interface PromptAyuda {
  instrucciones: string               // prefijo estable
  turnos: readonly MensajeHistorial[] // historial + turno final etiquetado
}
export type ErrorModelo = 'sin-clave' | 'timeout' | 'proveedor' | 'formato'
/** Puerto: lo implementa lib/ayuda/gemini.ts; los tests usan un fake. */
export type ModeloAyuda = (
  prompt: PromptAyuda,
  idsPermitidos: readonly [string, ...string[]],
) => Promise<{ ok: true; salida: unknown } | { ok: false; error: ErrorModelo }>
export type ResultadoConsulta =
  | { resultado: 'respondida'; texto: string; entrada: { id: string; titulo: string; ruta?: string } }
  | { resultado: 'fuera_de_opciones' }
  | { resultado: 'error'; error: ErrorModelo }
```

### Funciones puras — `lib/ayuda/`

| Archivo | Firma |
| --- | --- |
| `permisos.ts` | `permisosEfectivos(s: Pick<Session,'rolId'\|'permisos'\|'modulosHabilitados'>): ReadonlySet<Permiso>` |
| `filtrar.ts` | `filtrarGuia(guia: readonly EntradaGuia[], permisos: ReadonlySet<Permiso>): EntradaGuia[]` |
| `prompt.ts` | `armarPrompt(a: { entradas; foco: EntradaGuia \| null; historial; pregunta }): PromptAyuda` |
| `salida.ts` | `esquemaSalida(ids): object` (para `responseSchema`) · `salidaSchema(ids)` (zod) · `type SalidaModelo` |
| `resolver.ts` | `resolverRespuesta(entradas, salida: SalidaModelo): ResultadoConsulta` |
| `consultar.ts` | `consultarAyuda(i: { pregunta; historial; focoId: string \| null; permisos }, modelo: ModeloAyuda): Promise<ResultadoConsulta>` |
| `guia/index.ts` | `export const GUIA: readonly EntradaGuia[]` = concatenación de `guia/<area>.ts` |

`consultarAyuda` usa siempre `GUIA` y siempre incluye la entrada
`ayuda-uso` (permiso `ayuda.consultar`), así el enum nunca está vacío.
`focoId` que no está entre las permitidas se trata como `null` (sin error:
no se filtra si existe).

### Servidor

| Archivo | Firma |
| --- | --- |
| `lib/ayuda/config.ts` (`server-only`) | `ayudaDisponible(): boolean` · `leerConfigAyuda(): { apiKey: string; modelo: string } \| null` |
| `lib/ayuda/gemini.ts` (`server-only`) | `crearModeloGemini(cfg): ModeloAyuda` · `nivelPensamiento(modelo: string)` |
| `lib/dal/ayuda/index.ts` (`server-only`) | `registrarConsultaAyuda(d): Promise<{ ok: true; id: string } \| { ok: false; reason }>` · `calificarConsultaAyuda(d): Promise<{ ok: true } \| { ok: false; reason }>` |
| `lib/validation/ayuda.ts` | `consultarAyudaSchema`, `calificarConsultaAyudaSchema` (`strictObject`) |
| `app/(app)/ayuda/actions.ts` | ver abajo (carpeta sin `page.tsx`) |

```ts
consultarAyudaAction(input: {
  idConversacion: string; pregunta: string               // uuid; 1..300 trim
  historial: MensajeHistorial[]; focoId: string | null    // ≤6 de ≤500; ≤64
}): Promise<
  | { ok: true; idConsulta: string | null; resultado: Exclude<ResultadoConsulta, { resultado: 'error' }> }
  | { ok: false; reason: string }   // 'ayuda-no-disponible' | 'ayuda-error' | 'payload-invalido' | guard
>
calificarConsultaAyudaAction(input: { idConsulta: string; util: boolean }):
  Promise<{ ok: true } | { ok: false; reason: string }>
```

Orden en `consultarAyudaAction`: `verifySession` → `requireModuleRole(session,
'ayuda','consultar')` → `leerConfigAyuda()` (null → `ayuda-no-disponible`) →
zod → `consultarAyuda(…, crearModeloGemini(cfg))` → `registrarConsultaAyuda`
→ respuesta. La llamada de red termina antes de tocar la DB.

### Slugs nuevos (`lib/errores/mensajes.ts` + inventario del test)

`ayuda-no-disponible`, `ayuda-error`, `consulta-no-encontrada`.

### UI — `components/ayuda/`

`PanelAyuda` (client): botón flotante abajo a la derecha, panel `z-40` (los
toasts `z-50` quedan encima), reutiliza `Button`, `IconButton`, `Textarea`,
`Card`, `Portal` y tokens de theming; no crea primitivas nuevas. Lo monta
`app/(app)/layout.tsx` como hermano de `<Sidebar>` dentro de `ToastProvider`,
con la condición de REQ-AYUDA-12 calculada en el server. Tarjeta fija:
"No tengo esa respuesta. Preguntale al administrador de tu negocio." Aviso
bajo el input: "No escribas datos de clientes."

## 7. Decisiones

- **DR-AYUDA-1 (decidida 2026-11-03)** — `ayuda` es **paquete opcional**
  (`PAQUETES_OPCIONALES.ayuda = ['ayuda']`). Lo prende y apaga el super admin
  desde `/plataforma/[id]` (`PaquetesCard`) y se elige en el alta
  (`NuevoTenantModal`), igual que los otros paquetes. El admin del tenant NO
  lo toca: `tenant_modulo` es de solo lectura para `authenticated` (00117).
  Cada consulta cuesta plata: el operador decide qué cliente lo paga. Apagarlo
  no deja estado vivo (`fn_modulo_tiene_estado_vivo('ayuda')` debe dar falso).
- **DR-AYUDA-2** — Sin módulo central de env: no existe y no se crea.
  `lib/ayuda/config.ts` sigue el patrón perezoso de `lib/dal/supabase.ts`
  (`requireEnv`), con zod y `server-only`. `GEMINI_MODEL` default = el
  ganador del Lote 0.
- **DR-AYUDA-3** — "Casos de uso" = funciones de `lib/ayuda/` + Server
  Actions; no se introduce una capa `use-cases/` que el proyecto no tiene.
- **DR-AYUDA-4** — Fila propia en el SP, no en policy (AGENTS.md: sin policy
  por usuario). Riesgo residual aceptado: un usuario con sesión podría
  cambiar por PostgREST el `util` de un compañero del mismo tenant. Impacto:
  una métrica. Si no se acepta, hace falta una policy restrictiva de UPDATE
  (excepción a la regla, la decide la persona).
- **DR-AYUDA-5** — El puerto `ModeloAyuda` desacopla dominio y proveedor:
  cambiar Gemini por otro es un archivo.
- **DR-AYUDA-6** — Error de la 2ª llamada → vale la 1ª (REQ-AYUDA-07 N3).
- **DR-AYUDA-7 (decidida 2026-11-03)** — Sin tope diario por usuario en v1.
  El techo de costo es la cuota diaria del proyecto de Google Cloud (los
  budgets solo alertan). `consulta_ayuda` ya registra cada turno: si hace
  falta un tope en v2, se cuenta de ahí en la action, sin tocar `consultarAyuda`.
- **DR-AYUDA-8** — `thinkingLevel`: `MINIMAL` para Gemini 3+. Para `gemini-2.5-*`
  el Lote D verifica en la doc del SDK fijado si usa `thinkingLevel: LOW` o
  `thinkingBudget`; no se asume.
