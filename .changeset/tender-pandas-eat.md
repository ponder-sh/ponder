---
"@ponder/core": patch
---

Fixed a bug where the realtime sync service would crash on bad requests. Now, a warning will be logged and the service will wait until the next poll.
