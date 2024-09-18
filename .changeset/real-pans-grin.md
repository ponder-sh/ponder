---
"@ponder/core": minor
---

BREAKING: Introduced the `/ready` endpoint, which returns an HTTP `200` response once the app has finished historical indexing and is ready to serve requests. Changed the behavior of the `/health` endpoint. Now, `/health` returns an HTTP `200` response as soon as the process starts. Removed the `maxHealthcheckDuration` option from `ponder.config.ts`, and removed the top-level `options` property. Read the [migration guide](https://ponder.sh/docs/migration-guide#060) for more details.
