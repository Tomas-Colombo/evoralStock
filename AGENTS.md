<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What this is

Utopía: multi-tenant SaaS to run a clothing store (inventory, pricing, sales,
instalments, consignment, expenses). Resold product: nothing hardcoded to one
store. Next.js 16 App Router + React 19 + TS 5 + Tailwind 4 + Supabase
(Postgres + RLS). Package manager **pnpm**. Windows host: only `rg` installed
(no `bat`, `fd`, `sd`, `eza`, `jq`, `brew`).

This file is the single source of truth for every agent (Claude, Codex,
Copilot). Personal preferences live in the provider's memory, never here.
`CLAUDE.md` is only `@AGENTS.md`. Where docs disagree with code, the code wins.
The working procedure (roles, prompt, report, when to stop) is in
`docs/protocolo-agentes.md`.

# Commands

| Need | Command | Needs |
| --- | --- | --- |
| Dev server | `pnpm dev` | `.env.local` |
| Gate: typecheck + lint + unit | `pnpm gate` | — |
| Gate + `db reset` + `tests/db` + DOWN check | `pnpm gate:db` | Docker + `supabase start` + `.env.local` |
| Gate:db + build | `pnpm gate:full` | same as above |
| Unit tests (use while working) | `npx vitest run --exclude 'tests/db/**'` | — |
| Last definition of a SQL function | `pnpm sp:last <name>` | — |
| Pre-commit hook (once per clone) | `pnpm hooks:install` | — |
| E2E | `pnpm test:e2e` | dev server + DB |
| New customer | `pnpm provision-tenant` | `.env.local` |

Run `pnpm gate` (fast), `pnpm gate:db` (touching SQL) or `pnpm gate:full`
(closing a slice). Report only the content of `.gate/report.txt`. Exit code 2
means "not verified" (no Docker, Supabase stopped, DB suites skipped): report
it as such, never as passing.

# Architecture (non-negotiable)

```
app/**         routes, pages, Server Actions   — no SQL
components/**  UI                               — no SQL
lib/dal/**     the ONLY place that queries Supabase
supabase/      migrations + stored procedures  — business invariants live here
```

- **Tenant isolation is the one invariant.** Every domain table has
  `id_tenant`; RLS filters by the JWT `tenant_id` claim and nothing else, plus
  the restrictive `id_revendedora` policies of the Revendedoras module. No
  per-user policy: per-user/per-module limits live in the guards. The
  service-role key bypasses RLS: only `lib/dal/supabase*.ts`,
  `scripts/provision-tenant.mts`, `tests/db/`, `e2e/` may touch it.
- **Writes go through `sp_*` stored procedures** called from `lib/dal`. A
  multi-table write assembled in TypeScript breaks between two awaits.
- **INVOKER / DEFINER**: writes and reads are always INVOKER. DEFINER only for
  the `rvp_*` portal reads (identity from `auth_revendedora_id()`, column
  whitelist without costs/margins) and the two listed exceptions
  `fn_auto_crear_rol_revendedora`, `sp_enlazar_revendedora_usuario`. Enforced
  by `tests/db/rvp-lecturas.test.ts`.
- Allowed SQL outside `lib/dal`: auth (`app/(auth)/login/actions.ts`,
  `logoutAction`) and `proxy.ts`. **Known debt, do not add to it**:
  `components/theming/persistThemePreference.ts`.
- **Dependency direction**: `app/**` → `components/**` → `lib/**`, never backwards.
  `components/**` and `lib/**` do not import from `app/**`, and one route group
  or module under `app/` does not import from another. Used by one module → it
  lives in that module's folder; `components/` only when two modules share it.
  A Server Action shared across route groups or modules lives in `lib/<domain>/actions.ts`.
  Enforced by `tests/arquitectura-imports.test.ts`; its debt list only shrinks.

## Every mutation is a Server Action with three gates

It is a public POST endpoint; TS types are erased at runtime. In order:

1. **Authorize**: `requireModuleRole(session, '<modulo>', '<accion>')`. The
   route `layout.tsx` gates `ver` only and is not a boundary for actions.
2. **Validate**: zod schema from `lib/validation/**`, `safeParse`,
   `strictObject`, built from the domain catalogue (e.g. `permisosSchema` from
   `CATALOGO_PERMISOS`) so there are never two lists.
3. **Call the DAL** with `parsed.data`, never the raw input.

Return `{ ok: true } | { ok: false, reason }`; `reason` is a kebab-case slug,
never prose or a Postgres error. `lib/errores/mensajes.ts` is the only place a
user-facing message lives (UI calls `mensajeDeError(reason)`): Spanish, voseo,
final full stop, no jargon. A new slug raised by an `sp_*` goes in the
catalogue and in the inventory of `lib/errores/mensajes.test.ts`.

## Design for N, not for 1

For any screen over a list: queries per element? what at 200? who controls N?
If N comes from URL or input, cap and dedupe. An `await` in a `for` means a
batch domain function is missing: add it to `lib/dal`.

# Modules: three lists that do not match

Route groups, permission modules and DAL domains differ (e.g. `clientes/` and
`cuotas/` are gated by permission `ventas`). Never guess a permission from a
folder name — see `docs/modulos.md`.

# Rules for agents

- **Migrations**: never edit a migration that is on main; fix forward with a
  new one (next free number). Every migration has a `-- DOWN:` block
  (prose lines as `-- NOTE:`); `pnpm gate:db` executes it.
- **Changing an `sp_*`**: run `pnpm sp:last <name>` first, copy that
  definition, and show only the intended diff.
- **Config**: do not modify tsconfig, next, eslint, playwright or vitest
  config, nor keep tool-regenerated changes: revert them.
- **Specs**: do not tick human gates in `tasks.md`; do not edit
  `specs/golden.md` without the user's OK.
- **STOP AND ASK** when existing behavior conflicts with the spec or with the
  finance logic: do not change a shared `sp_*`, config, a merged migration or
  the golden on your own.
- **A test fails**: say whether the test or the code is wrong, citing the spec
  line, before touching an assertion. Before deleting a file, `rg` who imports it.
- **"Not verified" is a valid report; fabricating output is the only serious error.**
- **Reports**: detail to files; chat summary ≤ 10 lines.

# Conventions

- **Commits**: Conventional Commits, subject and body in Spanish. Never any
  `Co-Authored-By` or AI attribution (project rule; overrides provider defaults).
  Add files by name, never `git add -A`.
- **Language**: Spanish for domain code/comments (`app/**`, `lib/dal/**`,
  `lib/<dominio>/**`); English in `components/ui/**` and in this file. UI copy
  Spanish, voseo ("Elegí un proveedor").
- Comments explain *why* (what broke before), not what. Match surrounding code.
- **Tests**: colocated `*.test.ts`, behaviour not implementation; row fixtures
  from `tests/factories/`. Coverage measures a deliberate subset of pure
  logic; adding to `include` is welcome, lowering a threshold is not.
- **Size of change**: small → do it and gate; medium → approach in 3-5 lines
  first; large/schema/new module → spec in `openspec/changes/<name>/`
  (template `openspec/templates/spec.md`) and approval first.

# Before touching X, read Y

| Touching | Read first |
| --- | --- |
| Any route, permission, layout | `docs/modulos.md`, `lib/types/administracion.ts` (`CATALOGO_PERMISOS`) |
| A screen, button or permission | `docs/ayuda.md`: update `lib/ayuda/guia/` (enforced by `cobertura.test.ts`) |
| A migration or `sp_*` | `supabase/README.md` (CI applies them: `supabase db push`) |
| A mutation | the three gates above + `lib/dal/guard.ts` |
| An error message | `lib/errores/mensajes.ts` |
| Next.js API | `node_modules/next/dist/docs/` |
| A multi-step feature | `openspec/config.yaml`, then `openspec/changes/` |
| Revendedoras module | `ingenieria/`: local-only draft plans (gitignored), not a contract. Never read `ingenieria/utopia-intructivo/Seguridad/` (secrets). May be absent: ask the user |

A rule enters here only if an agent made the same mistake twice; keep ≤150 lines, detail to `docs/`, and prefer enforcing a rule by lint or test.
