---
"@ponder/core": patch
---

Fixed a bug where `updateMany` store method calls were not batched properly. Now `updateMany` follows the same batch size limit as `createMany` (1000).
