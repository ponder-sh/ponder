---
"@ponder/core": patch
---

Implemented a global queue that throttles RPC requests according to a new network config property "maxRequestsPerSecond". Increased compatibility with less powerful RPCs.
