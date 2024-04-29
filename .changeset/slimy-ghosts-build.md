---
"@ponder/core": patch
---

Added a `poolConfig` option to `ponder.config.ts`. This option overrides the default [`PoolConfig`](https://node-postgres.com/apis/pool) used when constructing the `node-postgres` connection pool.
