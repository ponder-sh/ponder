---
"@ponder/core": patch
---

Removed custom timeout and retry logic for RPC requests. Now, the timeout and retry logic of user-provided view transport will be used.
