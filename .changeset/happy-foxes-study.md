---
"@ponder/core": patch
---

Removed retries for indexing functions in favor of better retry behavior for RPC requests and database queries. To achieve the same behavior as before, add retry logic to any code that could produce occasional errors (HTTP requests).
