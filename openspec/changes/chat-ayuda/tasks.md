# Tareas — chat-ayuda

Lotes pensados para agentes en paralelo. Cada lote **es dueño exclusivo** de
sus archivos: si necesita tocar uno ajeno, para y avisa. Los contratos están
en `specs/REQ-AYUDA.md` §6; se programa contra ellos, no contra el código de
otro lote. Cada caso negativo de la spec es un test con su número en el nombre.

## Gate humano

- [x] Spec aprobada (`proposal.md` + `specs/REQ-AYUDA.md`) — la persona, 2026-11-03
- [x] DR-AYUDA-1 decidida: paquete opcional, lo prende/apaga el super admin (2026-11-03)
- [x] DR-AYUDA-7 decidida: sin tope por usuario en v1 (2026-11-03)
- [ ] Lote 0: modelo elegido con latencia medida (< 3 s)

## Olas

```
Ola 1   L0 (SDK + latencia)   L1 (contratos)   A (DB)
           │                     │               │
Ola 2      └──► D (Gemini)       ├──► B (dominio) │
                                 ├──► C1 C2 C3 C4 (guía)
                                 ├──► E (DAL + actions) ◄──┘
                                 └──► F (UI)
Ola 3   G (cierre: tests de cobertura de la guía + docs)
```

L1 y A se integran juntos: `tests/db` compara el catálogo TS con
`fn_codigos_paquete`, así que `pnpm gate:db` solo pasa con los dos.

Rama: `feat/chat-ayuda`. Los prompts de cada lote los da el revisor por
chat; no viven en el repo. Un commit por lote, solo con sus archivos.

---

## L0 — SDK y latencia (agente + persona)

Archivos: `package.json`, `pnpm-lock.yaml`, `scripts/ayuda-latencia.mts`.

- [ ] `pnpm add -E @google/genai@<última estable>` (hoy 2.32.0; fijada, sin `^`)
- [ ] Leer los `.d.ts` del SDK fijado y anotar en el reporte, con archivo:línea:
      nombre exacto de `responseSchema`/`responseJsonSchema`, `thinkingConfig.thinkingLevel`,
      `httpOptions.timeout`, `httpOptions.retryOptions`, `abortSignal`, clase de error con `status`,
      y si `generateContent` figura como legacy
- [ ] `scripts/ayuda-latencia.mts`: lee la clave con `--env-file=.env.local` (nunca la imprime),
      llama `generateContent` con "hola" a cada modelo de `argv`, 3 veces, e imprime solo
      `modelo | status | ms p50 | ms máx`
- [ ] **Persona** corre: `node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts gemini-3-flash-preview <otros>`
      y elige el modelo (< 3 s). Re-verificar precio en <https://ai.google.dev/gemini-api/docs/pricing>

## L1 — Contratos (primero; bloquea la Ola 2)

Archivos: `lib/types/administracion.ts`, `lib/modulos/catalogo.ts`,
`app/(plataforma)/plataforma/{TenantsView,NuevoTenantModal}.tsx`, `app/(plataforma)/plataforma/[id]/PaquetesCard.tsx`
y sus tests que arman `Record<PaqueteOpcional, …>`,
`scripts/provision-tenant.mts` y `e2e/support/tenant.ts` (solo el indexado por string),
`lib/ayuda/tipos.ts`, `lib/ayuda/guia/index.ts`, `lib/ayuda/guia/{ayuda,ventas,inventario,precios,gastos,reportes,administracion,consignaciones,revendedoras}.ts`,
`lib/validation/ayuda.ts` (+ test), `lib/errores/mensajes.ts` (+ test).

- [ ] `CATALOGO_PERMISOS` `as const satisfies Record<string, readonly string[]>` + `ayuda: ['consultar']`; tipo `Permiso` (REQ-AYUDA-01)
- [ ] `MODULO_NOMBRE.ayuda = 'Ayuda'`; `PAQUETES_OPCIONALES.ayuda = ['ayuda']`
- [ ] Hoy los nombres de paquete están copiados en 3 archivos de plataforma
      (`TenantsView`, `NuevoTenantModal`, `PaquetesCard`). Moverlos a un
      `PAQUETES_INFO: Record<PaqueteOpcional, { nombre; descripcion }>` en
      `lib/modulos/catalogo.ts` y que los tres lo importen: el próximo paquete
      se agrega en un solo lugar
- [ ] Consumidores que indexan con `string` compilan sin `any` (REQ-AYUDA-01 N2)
- [ ] `lib/ayuda/tipos.ts` tal cual la spec §6
- [ ] `guia/index.ts` concatena los archivos de área; cada área exporta `[]`; `guia/ayuda.ts` trae `ayuda-uso`
- [ ] `lib/validation/ayuda.ts` con los límites de la spec + tests de borde (300/301, 6/7, 500/501, 64/65)
- [ ] Slugs `ayuda-no-disponible`, `ayuda-error`, `consulta-no-encontrada` en catálogo e inventario

## A — DB

Archivos: `supabase/migrations/<siguiente>_ayuda.sql`, `tests/db/ayuda.test.ts`.

- [ ] Migración según spec §5 (`fn_codigos_paquete` desde `pnpm sp:last`, mostrar solo el diff)
- [ ] `-- DOWN:` ejecutable que restaura la versión anterior de `fn_codigos_paquete`
- [ ] `tests/db`: el operador (service-role) prende y apaga `ayuda` sin `modulo-con-estado-vivo`;
      `authenticated` no puede escribir `tenant_modulo` de `ayuda` (00117 sigue cerrado)
- [ ] `tests/db`: REQ-AYUDA-10 N2–N4, REQ-AYUDA-11 feliz y N1–N3, CHECK de `resultado`/`entrada_id`
- [ ] No aplicar. La persona corre `pnpm gate:db`

## B — Dominio puro

Archivos: `lib/ayuda/{permisos,filtrar,prompt,salida,resolver,consultar}.ts` + `*.test.ts`,
`lib/ayuda/imports.test.ts`.

- [ ] REQ-AYUDA-02, 03, 04, 05, 06, 07 con fake de `ModeloAyuda` (cuenta llamadas)
- [ ] `imports.test.ts`: REQ-AYUDA-09 N1
- [ ] Fixtures de guía chicas dentro del test, no la `GUIA` real (salvo `consultar`, que la usa por diseño)

## C1–C4 — Contenido de la guía

Un agente por fila; cada uno escribe solo sus archivos de `lib/ayuda/guia/`.

| Lote | Archivos | Pantallas |
| --- | --- | --- |
| C1 | `ventas.ts` | ventas, reservas, clientes, cuotas |
| C2 | `inventario.ts` | inventario, productos, ingresos, categorías, etiquetas, ficha, proveedores |
| C3 | `precios.ts`, `gastos.ts`, `reportes.ts` | precios (control, cuentas, reglas), gastos, presupuestos, reportes |
| C4 | `administracion.ts`, `consignaciones.ts`, `revendedoras.ts` | usuarios, roles, auditoría, consignaciones, rendiciones, revendedoras |

Reglas para todos:

- [ ] Una entrada por pantalla y una por acción (botón). Vista y acción con permisos distintos = dos entradas
- [ ] `permisos` EXACTOS: el `ver` del `layout.tsx` de la ruta + la acción del `requireModuleRole` de la Server Action del botón. Nunca adivinar por nombre de carpeta (`docs/modulos.md`)
- [ ] `ruta` solo estática (sin `[id]`); si la acción vive en una ficha, la ruta es la lista y los pasos dicen cómo llegar
- [ ] `id` con prefijo del área (`ventas-nueva`), kebab, ≤ 64. Pasos ≤ 6, español con voseo, sin jerga
- [ ] `detalles` solo para casos borde reales (qué pasa si…), no repetir los pasos
- [ ] En el reporte, por cada entrada: archivo:línea del guard que justifica cada permiso. Sin eso no se aprueba

## D — Adaptador Gemini

Archivos: `lib/ayuda/config.ts`, `lib/ayuda/gemini.ts` + `*.test.ts` (SDK mockeado con `vi.mock`).

- [ ] `config.ts`: `server-only`, zod, perezoso; `GEMINI_MODEL` default del L0; la clave no sale del módulo salvo hacia `gemini.ts`
- [ ] `gemini.ts`: `responseMimeType` JSON + schema de `salida.ts`, `temperature` 0.2, `nivelPensamiento` (DR-AYUDA-8),
      timeout 10 s con `AbortController` + `httpOptions.timeout`, `retryOptions.attempts: 1`
- [ ] REQ-AYUDA-08 feliz y N1–N3

## E — DAL y Server Actions

Archivos: `lib/dal/ayuda/index.ts`, `app/(app)/ayuda/actions.ts` + tests.

- [ ] DAL con `supabase.rpc` y `extractErrorSlug` de `lib/dal/revendedoras/slug-error.ts` (reutilizar, no copiar)
- [ ] Actions con el orden de la spec §6; registro fallido no rompe la respuesta (REQ-AYUDA-10)
- [ ] Tests con mocks de guard/DAL/modelo: matriz §2, turno fallido registrado como `error`

## F — UI

Archivos: `components/ayuda/*` (+ test), `app/(app)/layout.tsx` (solo el montaje).

- [ ] `PanelAyuda` según spec §6 UI y REQ-AYUDA-12, solo primitivas existentes de `components/ui/`
- [ ] `idConversacion` con `crypto.randomUUID()` al abrir; historial ≤ 6 al enviar; `focoId` = último `entrada.id`
- [ ] Test (testing-library): N3 Escape, N4 doble envío, turno fallido devuelve el texto al input
- [ ] Probar en claro y oscuro

## G — Cierre (Ola 3)

Archivos: `lib/ayuda/guia/cobertura.test.ts`, `docs/ayuda.md`, `AGENTS.md`, `README.md`,
`vitest.config.mts` (solo `include` de coverage).

- [ ] Test: toda `ruta` existe como `app/(app)/**/page.tsx`
- [ ] Test: toda página estática de `app/(app)` tiene entrada o está en `RUTAS_SIN_AYUDA` (lista explícita en el test)
- [ ] Test: toda entrada con `ruta` exige el `ver` del módulo de esa ruta (mapa de `docs/modulos.md`)
- [ ] Test: ids únicos y ≤ 64 en toda la `GUIA`
- [ ] `docs/ayuda.md`: env vars, proyecto de Google Cloud con facturación + cuota diaria + alertas (los budgets no cortan), sin región de datos, cómo cambiar de modelo
- [ ] `AGENTS.md`, tabla "Before touching X": cambiar pantalla, botón o permiso → actualizar `lib/ayuda/guia/`
- [ ] `lib/ayuda/**` en `include` de coverage
- [ ] **Persona**: agregar `GEMINI_API_KEY=` y `GEMINI_MODEL=` a `.env.example` y a Vercel
