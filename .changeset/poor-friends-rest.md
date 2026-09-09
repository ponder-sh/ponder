---
"ponder": minor
---

Added `reorgWindow` to chain configuration in `ponder.config.ts` to control how long Ponder retains the data required to recover from reorgs. The window is measured in seconds and defaults to `180`.
