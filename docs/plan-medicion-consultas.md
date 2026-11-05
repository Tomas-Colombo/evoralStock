# Plan: medir consultas a la base y evaluar caché

Objetivo: saber cuántas veces va cada pantalla a la base, detectar consultas
repetidas o que crecen con N, y decidir —con datos— qué se arregla con
`cache()` de React, con funciones batch o con `use cache`.

**Esta fase solo mide.** No se cambia lógica, no se activa `cacheComponents`,
no se toca ningún `sp_*`. El único cambio de código es la instrumentación de
la fase 1, apagada por defecto.

## Fase 0 — Entorno

- `supabase start` + `pnpm db:seed:local`.
- Dos volúmenes del mismo tenant: **chico (~20)** y **grande (~200)**
  productos, ventas, clientes, cuotas y revendedoras. Si los seeds no llegan a
  200, un script local de volumen (no se commitea o va en `supabase/seeds/`
  marcado como solo-dev).
- Medir siempre con `pnpm build && pnpm start` además de `pnpm dev`: en dev
  React renderiza dos veces y los números se inflan.

## Fase 1 — Instrumentación lado app (round trips por request)

En `lib/dal/supabase.ts`, solo si `process.env.DAL_TRACE === '1'`, pasar
`global: { fetch: tracedFetch }` a `createServerClient` y `createServiceClient`.

`tracedFetch` registra por llamada: id de request, método, ruta
(`/rest/v1/<tabla>`, `/rest/v1/rpc/<sp>`, `/auth/v1/user`), status y ms. Sin
query string (lleva filtros con ids). El id de request sale de un objeto
creado con `cache()` de React (vive un request). Salida: una línea JSON por
llamada a stdout → un script en `scratchpad`/`scripts/` agrupa por request y
por ruta.

Esto cubre lo que la app pide, incluido `auth.getUser()`, que es un viaje a
GoTrue y no a Postgres.

## Fase 2 — Recorrido

Con `DAL_TRACE=1`, en ambos volúmenes:

1. `pnpm test:e2e` completo (cubre los flujos de escritura).
2. Visita de cada pantalla de listado y detalle: inicio, inventario,
   productos, precios, ventas (lista y detalle), reservas, clientes, cuotas,
   consignaciones, rendiciones, revendedoras (lista y detalle), gastos,
   reportes, administración, plataforma y el portal `mi-cuenta`.

## Fase 3 — Lado base (lo que pasa dentro de los `sp_*`)

La fase 1 ve un `rpc/sp_x` como una llamada; adentro puede haber 50 queries.

- Antes del recorrido: `select pg_stat_statements_reset();` (verificar que la
  extensión esté activa en el Supabase local; si no, `create extension`
  solo en local, nunca como migración).
- Después: top 20 por `calls` y por `total_exec_time`, con `mean_exec_time`
  y `rows`. Alternativa: `supabase inspect db calls|outliers|seq-scans`
  (confirmar flags con `--help`).

## Fase 4 — Barrido estático de N+1

`rg` en `app/**` y `lib/dal/**`: `await` dentro de `for`/`for...of`,
`.map(async`, `Promise.all(xs.map(` sobre funciones del DAL. Cada hallazgo se
cruza con los números de la fase 2.

## Fase 5 — Clasificación

| Síntoma | Remedio | Riesgo |
| --- | --- | --- |
| Misma consulta 2+ veces en un request | `cache()` de React en la función del DAL | Ninguno: vive un request |
| Cantidad de llamadas crece de vol. chico a grande | Función batch en `lib/dal` o un `sp_*` que devuelva el set | Bajo |
| `await`s independientes en serie | `Promise.all` | Ninguno (baja latencia, no cantidad) |
| Query lenta (`outliers`, `seq-scans`) | Índice o reescritura SQL, migración nueva | Medio |
| Mismo resultado entre requests, cambia poco | **Candidato** a `use cache` → checklist abajo | Alto |

Checklist para un candidato a `use cache` (si falla uno, no se cachea):

1. ¿Se puede leer sin `cookies()`? Si exige `createServiceClient`, **STOP**:
   pierde RLS y es decisión del usuario.
2. ¿`tenantId` es argumento de la función (y por lo tanto de la clave)?
3. ¿Qué actions lo modifican? Cada una debe llamar `updateTag`.
4. ¿Qué pasa si se muestra viejo 1 minuto? Si la respuesta toca stock,
   plata o permisos, no se cachea.

Tentación conocida: `sp_session_context` corre en cada request. Cachearlo
entre requests deja permisos viejos tras un cambio de rol: no pasa el punto 4
salvo invalidación explícita por usuario.

## Entregable

`docs/medicion-consultas-resultados.md`:

1. Tabla por pantalla: round trips, llamadas a auth, duplicadas,
   ¿crece con N? (chico vs grande), p50 ms.
2. Top 20 de `pg_stat_statements`.
3. Lista priorizada de arreglos con su fila de la tabla de la fase 5.

Resumen en chat ≤ 10 líneas. Lo que no se pudo medir se reporta como
"no verificado".

## Prompt para el agente

> Ejecutá `docs/plan-medicion-consultas.md` fases 0 a 5. Único cambio de
> código permitido: `tracedFetch` detrás de `DAL_TRACE` en
> `lib/dal/supabase.ts` (apagado por defecto, sin query string en el log).
> No cambies lógica, config, `sp_*` ni migraciones; no actives
> `cacheComponents`. Escribí los resultados en
> `docs/medicion-consultas-resultados.md` y reportame ≤ 10 líneas. Si algo
> no se pudo medir, decilo como "no verificado".
