---
"ponder": patch
---

Fixed an unhandled rejection in the `client()` middleware when the `LISTEN` query failed on PGlite. The failure is now logged as a warning, matching the Postgres behavior.
