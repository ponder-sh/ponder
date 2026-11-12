---
"ponder": patch
---

Reduced the memory and CPU usage of live indexing with a single live chain. Executed events were kept until their block was finalized, but with a single live chain a reorg never reads them.
