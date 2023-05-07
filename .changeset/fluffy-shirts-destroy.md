---
"@ponder/core": patch
---

Fixed bug where the server would fail to start if the desired port was in use. The server will not use the next available port via `detect-port`.
