---
"ponder": minor
"@ponder/client": minor
---

Updated `drizzle-orm` to `0.45.3`. Errors thrown by `context.db.sql` queries are now a `DrizzleQueryError`, and the original database error is available as `error.cause`.
