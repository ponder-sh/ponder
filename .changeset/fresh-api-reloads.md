---
"ponder": patch
---

Fixed a bug that caused a hot reload of the API file in `ponder dev` to use a closed database after a failed build. The hot reload now rebuilds the app.
