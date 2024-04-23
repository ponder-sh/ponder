---
"@ponder/core": patch
---

Changed retry behavior of indexing functions so that they are no longer globally retried and instead each rpc request or database query is individually retried. Also, improved performance for historical indexing by ~50%.
