---
"@ponder/core": minor
---

Updated internal checkpoint logic to eliminate costly SQL queries, which led to a 30-50% speed up for a key query. Busted the indexing cache.
