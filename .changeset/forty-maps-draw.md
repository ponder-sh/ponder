---
"@ponder/core": patch
---

Fixed a bug leading to `event.transaction` to be undefined. If your app was affected by this bug it is recommended to drop the "ponder_sync" database schema and resync.
