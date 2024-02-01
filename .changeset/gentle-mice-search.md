---
"@ponder/core": patch
---

Migrated Postgres chain ID columns to use `int8` rather than `int4`. Now, Postgres should behave the same as SQLite and can safely store chain IDs <= `Number.MAX_SAFE_INTEGER`.
