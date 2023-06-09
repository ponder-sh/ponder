---
"@ponder/core": patch
---

This patch adds default pagination to the ponder server. Server will now by default return the first 100 rows in the query response. Users can query at most a 1000 rows in a single query. The query API also limits the number of skips to 5000 in a single query.
