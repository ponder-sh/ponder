---
"ponder": patch
---

Fixed a regression introduced in `v0.11.33` where creating views would cause the error: `cannot change data type of view column "chain_id" from integer to bigint`.
