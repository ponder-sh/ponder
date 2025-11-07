---
"ponder": patch
---

Fixed a bug that caused factories to miss child addresses after updating the factory start block. Please note that this affects the rpc cache for apps with factories that have different start blocks than the corresponding contract or account. Affected apps will refetch block data automatically.
