---
"@ponder/core": patch
---

Fixed a bug where circular imports between files (like `ponder.config.ts` and `src/index.ts`) would sometimes return `undefined` during the initial build.
