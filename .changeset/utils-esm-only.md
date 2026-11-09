---
"@ponder/utils": minor
---

Removed the CommonJS build of `@ponder/utils`. The package is now ESM-only; `require("@ponder/utils")` still works on Node 22.12+ through `require(esm)`, which Node 22 flags as experimental with a warning.
