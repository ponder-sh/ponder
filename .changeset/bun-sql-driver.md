---
"ponder": patch
---

Added the `driver` option to the Postgres `database` config in `ponder.config.ts`. `driver: "bun"` uses `Bun.SQL` instead of `node-postgres` when Ponder runs with Bun, including `COPY` and `LISTEN`.
