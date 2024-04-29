---
"@ponder/core": patch
---

Fixed a bug where failed RPC requests were being logged as an error even when they were retried and ultimately succeeded.
