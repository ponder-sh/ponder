---
"@ponder/core": patch
---

Added a `checkpoint` column to the internal `logs` table, which speeds up the internal `getEvents` query by ~6x. Apps with many contracts will see the greatest gains.
