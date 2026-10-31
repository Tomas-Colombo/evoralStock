import { fileURLToPath } from 'node:url'
import { config as loadEnvFile } from 'dotenv'
import { defineConfig } from 'vitest/config'

/**
 * The `tests/db/*` suites talk to a real Postgres and gate themselves on the
 * `_TEST` env vars (`tests/db/_helpers.ts`). Vitest does NOT read `.env` files
 * into `process.env` on its own — Vite only surfaces `VITE_`-prefixed values,
 * and only on `import.meta.env` — so without this the DB suites see
 * `undefined` and silently skip, which reads exactly like passing.
 *
 * Loaded here in the config module (not `tests/setup.ts`) because that file
 * runs inside the jsdom environment, while workers inherit `process.env` from
 * this process. `.env.local` wins over `.env`, matching how Next.js and
 * `e2e/config/env.ts` resolve them.
 */
loadEnvFile({ path: fileURLToPath(new URL('./.env.local', import.meta.url)) })
loadEnvFile({ path: fileURLToPath(new URL('./.env', import.meta.url)) })

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Vitest's default `include` also matches `*.spec.ts`, which would pull in
    // the Playwright suite (it needs a browser and a live server, and would
    // fail instantly under jsdom).
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**', '**/.claude/**'],
    coverage: {
      /**
       * `istanbul`, not `v8`. The v8 provider re-parses every file it has to
       * report at 0% through rolldown's standalone AST parser, which receives
       * no filename and therefore reads `.ts` as JavaScript — so
       * `import type { X }` blew up with "Expected `from` but found `{`" and
       * the file was dropped from the report. Twenty-five files disappeared
       * that way, twenty-one of them under `lib/dal`, which is how this config
       * used to claim 74% for a directory actually sitting at 4%. A number
       * that wrong is worse than no number. istanbul instruments during Vite's
       * transform, so it sees the same TypeScript the tests see.
       */
      provider: 'istanbul',
      /**
       * Scoped to what unit tests are actually responsible for: logic that
       * runs without a browser, a database, or Next's request lifecycle.
       *
       * Deliberately NOT measured here:
       *  - `app/**` — routes, pages and layouts that Next renders per request.
       *    Vitest never imports them, so they report 0% forever and drag the
       *    global number to noise. The 14 Playwright specs drive them for real.
       *  - `lib/dal/**` — every function is a Supabase round-trip. It is
       *    covered by `tests/db/*` against a real database and end to end by
       *    Playwright. A unit-coverage percentage here would measure how much
       *    of the client got mocked, not how much of the layer is safe.
       *  - domain components under `components/<area>/` — thin wiring between
       *    a form and a Server Action; e2e territory for the same reason.
       */
      include: [
        'lib/cobros/**',
        'lib/cuotas/**',
        'lib/design-tokens/**',
        // El catalogo de mensajes al operador: logica pura, y es lo que garantiza
        // que ningun slug crudo llegue a la UI. Va medido.
        'lib/errores/**',
        'lib/inventario/**',
        'lib/modulos/**',
        'lib/precios/**',
        'lib/reportes/**',
        'lib/tenant/**',
        // Validación de payloads de Server Actions: lógica pura, sin DB ni
        // request de Next, y es la puerta de entrada de datos no confiables.
        // Va medida para que el piso la proteja.
        'lib/validation/**',
        'lib/utils/**',
        'lib/fechas.ts',
        'components/ui/**',
        'components/theming/**',
        'proxy.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        // Next server-only modules: they import `server-only` and pull in
        // runtime-bound dependencies, so they belong with the DAL above.
        '**/*.server.ts',
      ],
      /**
       * Set from measured reality with a little headroom, not from a number
       * picked off a blog. The point of a floor is to catch a real drop, so it
       * has to sit just under where the suite actually stands — high enough to
       * bite, low enough that a normal refactor does not trip it.
       */
      thresholds: {
        lines: 61,
        functions: 63,
        branches: 46,
        statements: 58,
      },
    },
  },
  resolve: {
    /**
     * Mirrors `tsconfig.json`'s `"@/*": ["./*"]`. It used to list only `@/lib`
     * and `@/components`, which was enough while every tested module happened
     * to import from those two trees — an import of `@/app/...` simply failed
     * to resolve, and nothing noticed because no test reached one.
     */
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Not an installed package — Next resolves it during its own build. See
      // the stub's header for why coverage needs it.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
