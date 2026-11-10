# Supabase — Migrations

Migrations are plain SQL files in `supabase/migrations/`. They are applied by
the Supabase CLI:

- **Local**: `supabase start` / `supabase db reset` (needs Docker) applies them
  to the local stack for development and `tests/db/*`.
- **Production** (`utopia-dev`): link the project (`supabase link`) and apply
  via `supabase db push` (or `supabase db reset --linked` when re-initializing
  from scratch).

Do not paste migrations into a dashboard SQL Editor when using the CLI flow: it
bypasses the migration history that `db push` relies on.

## Migration naming convention

```
supabase/migrations/NNNNN_verb_scope.sql
```

- `NNNNN` — zero-padded 5-digit sequence number, applied in ascending order.
- `verb_scope` — snake_case description of what the migration does, e.g.
  `00002_tenant.sql`, `00008_auth_hook_tenant_id.sql`.

Each migration file MUST include a reversible **down-step** documented as a SQL
comment header at the top of the file (see "Rollback" below).

## Legacy manual apply order

1. Run `pnpm gate:db` locally against the local Supabase stack (`supabase start`).
2. Once green, apply the pending migration file (in ascending `NNNNN` order) to
   **`utopia-dev`** via `supabase db push` (preferred) or the SQL Editor.

`supabase/seed.sql` is applied automatically on local resets only. `db push`
does not run it: apply it to `utopia-dev` with `supabase db push --include-seed`
after all migrations have landed.

Vercel deploys `main` on every push (there is no CI and no `vercel.json` gate).
Apply pending migrations to `utopia-dev` BEFORE pushing code that depends on
them, or production runs new code against the old schema.

`supabase/seeds/seed_dev.sql` is a different thing: it is the **reseed**
script, run after emptying a development database so nobody has to retype
categories, suppliers, customers, payment accounts and pricing rules by hand.
It is not a migration, never runs against production, and is idempotent —
re-running it completes whatever is missing instead of duplicating rows. The
target tenants are the `v_subs` array on the first lines of the file.

It is gitignored on purpose: it seeds one developer's local database, not a
shared fixture. `config.toml` no longer loads `./seeds/*.sql` (24c6deb): with
the glob, `supabase db reset --linked` would push demo tenants and the dev
admin into a cloud database. Load them locally with `pnpm db:seed:local`
(both seed files, against the `supabase_db_utopia` container), or reset and
seed in one step with `pnpm db:reset:local`. `pnpm gate:db` resets without
seeding, so run `pnpm db:seed:local` again after it.

Products are deliberately out of scope (they come from the PDF importer), but
the **development admin user is not**: §12 writes it straight into
`auth.users`, so a `db reset` leaves the app loggable-into with no manual step.
Onboarding a real customer is still `npm run provision-tenant`, which also
creates the tenant and generates a random temporary password.

## Rollback

Every migration file's down-step is documented as a comment header at the top
of the file (e.g. `-- DOWN: drop table tenant;`). To roll back, copy the
down-step SQL from the affected migration(s) — in descending order — into the
dashboard SQL Editor of the project being rolled back, and run it.

## Auth Hook dashboard registration checklist

The Auth Hook function itself (`public.custom_access_token_hook`) is created by
a migration (see `design.md` §5/§14). Registering it as the active hook is a
**MANDATORY manual dashboard step** in Supabase (`utopia-dev` / production):

1. Open the Supabase dashboard for the project.
2. Go to **Auth → Hooks**.
3. Under **Custom Access Token**, click **Function**.
4. Select `public.custom_access_token_hook` from the dropdown.
5. Click **Save**.
6. Repeat steps 1–5 for every Supabase project created.

> **CRITICAL**: If this manual dashboard step is skipped on a newly provisioned Supabase project,
> issued JWT access tokens will NOT contain the `tenant_id` claim (nor `id_revendedora`), causing
> PostgreSQL RLS and application guards to immediately reject all authenticated user operations.

**Important (Módulo Revendedoras)**: the hook logic is extended by `00077_revendedora_id_usuario.sql`
and `00080_hook_seguridad_revendedora.sql` to inject the `id_revendedora` claim when a user has the
`Revendedora` role linked to a revendedora entity. After applying these migrations or provisioning a new
environment, verify that `public.custom_access_token_hook` is active in **Auth → Hooks**.

## Permission checks in sp_*

At the top of each `sp_*` body, check permissions via:
`if not (select auth_tiene_permiso('m', 'a')) then raise exception 'no-permission' using errcode = '42501'; end if;`
- **OR rule**: check the OR of all entry points (RPC Actions and calling SPs transitively). Always inspect real action guards, never a spec table.
- **New Actions**: any new Action hitting an existing `sp_*` must widen that OR via a new migration starting from `pnpm sp:last <name>`.
- **Identity comparisons**: use `is distinct from auth.uid()`, because `<>` fails silently on `null`.
- **DAL errors**: parse RPC errors with `errorDeRpc` (`lib/dal/errors.ts`), never with `extraerSlugRpc` which drops details.
- **Restrictive policies (00142)**: cross-module reads return 0 rows without error.
- **Unchecked SPs**: every live `sp_*` without a check must be listed with an explicit reason in `SP_SIN_CHEQUEO` (`tests/arquitectura-sp-permisos.test.ts`).
