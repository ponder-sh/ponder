---
"@ponder/core": minor
---

BREAKING: Simplified Postgres schema usage pattern. Now, the indexed tables, reorg tables, and metadata table for a Ponder app are contained in one Postgres schema, specified by the user in `ponder.config.ts` (defaults to `public`). Removed usage of the shared `ponder` schema. Removed the view publishing pattern and removed the `publishSchema` option from `ponder.config.ts`. Fixed an issue where the `Schema is locked by a different Ponder app` warning would appear when running `ponder dev`. Read the [migration guide](https://ponder.sh/docs/migration-guide#060) for more details.
