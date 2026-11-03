# AGENTS.md

## Repository Shape
- This is a Bun `1.4.4` workspace (`workspaces` in the root `package.json`, `bun.lock`, install settings in `bunfig.toml`); install with `bun install --frozen-lockfile` to match CI. Every dependency version is pinned exactly, including internal workspace dependencies (Bun links a workspace package when the pinned version matches); do not use ranges, `workspace:` or `catalog:`. Node must be `>=22`; CI pins runner images (`ubuntu-24.04`, `windows-2025`) and sets up exact Node, Bun, and Foundry versions inline in each workflow job where needed. Core unit tests need neither Foundry nor Postgres. Repo settings require every third-party action to be pinned to a full-length commit SHA (with the version tag in a trailing comment).
- Workspace packages are `packages/*`, `docs`, `examples/*`, `examples/*/*`, `simulation-test`, and `benchmark`.
- `packages/core` publishes the `ponder` npm package. Public exports start in `packages/core/src/index.ts`; the CLI bin starts in `packages/core/src/bin/ponder.ts`.
- `packages/core` builds with a custom `build.ts` (tsc, then rewrites `@/` aliases in `dist`). `packages/create-ponder` bundles its CLI with `Bun.build` in `build.ts` and copies `examples/` into `templates/`. `packages/client`, `packages/utils`, and `packages/react` build with `tsc --project tsconfig.build.json`; utils also emits a CommonJS bundle with `bun build`. Note: `bun build --outfile` with `--sourcemap` writes nothing (Bun 1.4.4), so use `--outdir` with `--entry-naming`.
- Core source uses `@/*` path aliases; the other packages use relative imports and have no `paths`. The core build rewrites these aliases in `dist/esm` and `dist/types`, so do not replace source aliases just to satisfy package output.

## Commands
- Build publishable packages: `bun run build`.
- Lint and format use Biome: `bun run lint`, `bun run format`, `bun run lint:fix`.
- Typecheck with `bun run typecheck`, which runs `bun check` in each `packages/*` package. `bun check` behaves like TypeScript 7 and rejects options TypeScript 7 removed (e.g. `baseUrl`), while builds use `tsc` from the pinned `typescript` 5.x; code must pass both. Examples keep `tsc` because create-ponder ships them as templates.
- Focused package checks: `bun --filter ponder typecheck`, `bun --filter @ponder/client typecheck`, `bun --filter @ponder/utils typecheck`, `bun --filter create-ponder typecheck`.
- Unit tests run with `bun test --parallel`, which gives every file a fresh global like Vitest's isolation. Focused tests: `bun --filter ponder test src/path.test.ts`, `bun --filter @ponder/client test src/index.test.ts`, `bun --filter create-ponder test`. Update inline snapshots with `-u`.
- Type-level suites (`*.test-d.ts`) use `expectTypeOf` from `bun:test` and only run as part of `bun run typecheck`; `bun test` does not pick them up. Prefer `expectTypeOf(value).toExtend<T>()` or `expectTypeOf<A>().toExtend<B>()`.
- `bun run test` runs all workspace test scripts in parallel with `--no-exit-on-error`; use `bun run test`, not `bun test`, which is Bun's own test runner; prefer `--filter` to avoid unrelated network-heavy suites.

## Tests And Environment
- Core has two kinds of tests. Unit tests (`bun test`) cover discrete, usually pure and synchronous logic (see `packages/core/src/sync-realtime/bloom.test.ts`). Behavior across modules is covered by the deterministic simulation in `simulation-test`. Do not add core tests that need Anvil, Postgres, PGlite, the network, or a running Ponder app; extend the simulation instead.
- Core unit tests have no global setup and each file runs in isolation. Shared fixtures are static: `packages/core/src/_test/abis.ts` (committed ABIs), `constants.ts`, and `utils.ts` (`createTestCommon()`, `createStubRpc()`, `EventCallback` builders, `withStubbedEnv()`). Code that needs RPC takes a stub; GraphQL tests use the `drizzle-orm/pg-proxy` harness in `packages/core/src/graphql/index.test.ts` to record SQL and serve canned rows.
- Prefer inline snapshots (`toMatchInlineSnapshot()`, `toThrowErrorMatchingInlineSnapshot()`) over hand-written expected values. Fill them with `-u`, then review every snapshot against the intended behavior before accepting it: a snapshot records current behavior, including bugs. Keep snapshots stable by leaving out version strings and other volatile values. Keep relational assertions, such as `expect(copy).toEqual(original)`, as they are.
- `bun test` quirks: `toThrowErrorMatchingInlineSnapshot()` records only the message, so also assert the class with `toThrow(ErrorClass)` when it matters. Snapshots of a Proxy (e.g. indexing-store rows from `src/utils/copy.ts`) go through `JSON.stringify` and throw on bigints; snapshot a spread copy. Use `test.failing` for known bugs. Matchers type the expected value against the received type, so type fixtures precisely (e.g. `const log: SyncLog = …`) instead of widening the assertion.
- `packages/utils/src/_test/*` contains live RPC-provider tests that require `RPC_URL_*` values from `packages/utils/.env.example`; avoid broad utils/root test runs unless those env vars and network access are intended.
- `simulation-test` uses Bun and a Postgres server, and `benchmark` uses Bun with external Postgres/RPC env from its `.env.example`. Their `DATABASE_URL` should omit a database name; scripts append their own database names.

## Memory Profiling
- Profile memory while running an example app, such as `feature-multichain`. Run it for several minutes so finalization occurs; temporarily comment out chains when necessary to keep the workload practical.
- Expose V8 garbage collection with `NODE_OPTIONS=--expose-gc`. Call `global.gc()` immediately before every reading so the measurement compares retained objects rather than differences in GC timing.
- Print `process.memoryUsage()` values for `rss`, `heapUsed`, `heapTotal`, and `external`, plus `v8.getHeapStatistics().heap_size_limit`. Report values in MiB, for example: `[memory] rss=...MiB heapUsed=...MiB heapTotal=...MiB heapLimit=...MiB external=...MiB`.
- Keep profiling code temporary and rebuild `packages/core` after removing it so ignored `dist/` artifacts do not retain stale instrumentation. Never commit RPC or database credentials from local profiling environments.

## Generated Or Copied Files
- `packages/create-ponder` build copies root `examples/` into `packages/create-ponder/templates`, excludes multi-app examples (`with-nextjs`, `with-foundry`, `with-trpc`, `with-client`, `with-offchain`), renames dotfiles, and blanks RPC URLs in generated `_dot_env.local` files.
- Biome intentionally ignores `docs/`, `dist/`, generated folders, `.ponder`, cache/out directories, Solidity files, and `bun.lock`.

## Docs, Examples, Releases
- Docs are a Vocs app in `docs`; use `bun --filter ponder-docs dev` or `bun --filter ponder-docs build`.
- CI separately verifies the Next.js frontend example with `bun --filter ponder-examples-with-nextjs-frontend build` after `bun run build`.

## Changesets
- Changesets are fixed for `ponder`, `create-ponder`, `@ponder/client`, and `@ponder/react`; docs/examples are ignored. Create changesets with `bun changeset`. Public API or bug-fix PRs normally need a patch changeset.
- Write changesets in the same voice as `packages/core/CHANGELOG.md`: concise, user-facing, past tense, and focused on observable behavior.
- Start with the outcome, not the implementation. Prefer phrasing like "Fixed a bug that caused...", "Fixed a regression introduced in `v0.16.0` that caused...", "Improved...", "Added...", "Updated...", or "Removed...".
- Include concrete symptoms when helpful, especially exact error messages in backticks. Use patterns like "Fixed the error `...`" or "that caused `...`".
- Name affected APIs, config fields, commands, packages, and options with backticks, such as `ponder.config.ts`, `context.client`, `context.db`, `@ponder/client`, `p.bytes()`, `ordering: "omnichain"`, and `ponder db list`.
- Use repository vocabulary consistently: Ponder, GraphQL, JSON-RPC, RPC, Postgres, PGlite, backfill, live, crash recovery, factory, and rpc cache.
- Avoid implementation details, internal refactors, PR narration, and vague language unless the detail explains user impact. Do not write "this PR", "we", "users may notice", "various fixes", or "some improvements".
- Keep each changeset entry narrow. If a PR includes unrelated user-facing changes, use multiple changesets or multiple short paragraphs so each changelog bullet is easy to scan.
- For dependency-only updates, only write a custom changeset if there is a user-facing reason, such as a security patch or a fixed runtime error.
