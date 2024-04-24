---
"@ponder/core": patch
---

Fixed a bug where the dev server would often crash with the error "The database connection is not open" when using SQLite or "Cannot use a pool after calling end on the pool" when using Postgres.
