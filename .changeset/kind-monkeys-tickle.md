---
"ponder": patch
---

Fixes the bug that would deadlock getting block data from db for event-intensive apps due to the faulty pagination.
