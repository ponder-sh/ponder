---
"@ponder/core": patch
---

Fixed a bug where including a factory contract in `ponder.config.ts` without registering an indexing function for every event that it emits would throw an error.
