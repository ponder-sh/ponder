---
"@ponder/core": patch
---

Fixed a bug where some Ponder apps would OOM soon after startup if most of the historical data was present in the cache. Also fixed an annoying behavior where the event handlers progress bar would not update during development, and the process would not handle `SIGINT` properly.
