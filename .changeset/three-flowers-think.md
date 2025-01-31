---
"ponder": patch
---

Fixed a bug where `t.bigint().array()` column values greater than `Number.MAX_SAFE_INTEGER` would lose precision when using Postgres.
