---
"@ponder/core": patch
---

Fixed a bug where the server would crash if no event handlers were registered in a file that had `import { ponder } from "@/generated"`
