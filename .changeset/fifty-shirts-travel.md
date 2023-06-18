---
"@ponder/core": patch
---

Fixed a bug in the historical sync queue where block tasks were not being prioritzed properly. Now, when starting the historical sync, events should be available and processed almost immediately.
