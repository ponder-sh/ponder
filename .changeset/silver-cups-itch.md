---
"ponder": patch
---

Fixed a bug that caused factories to miss child addresses after updating the factory start block. Please note that this did not affect the rpc cache, users do not have to refetch block data.
