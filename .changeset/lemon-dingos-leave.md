---
"@ponder/core": patch
---

Improved the performance an important internal SQL query (`getEvents`) for large apps. An app with ~5M rows in the `ponder_sync.logs` table saw a ~20x reduction in execution time for this query. Smaller apps will see a more modest improvement.
