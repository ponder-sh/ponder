---
"ponder": patch
---

Fixed a bug that caused `ponder dev` to ignore changes to a file that failed to load, such as a `ponder.config.ts` with a syntax error at startup. Fixing the file now triggers a hot reload.
