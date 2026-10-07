---
"ponder": patch
---

Fixed a bug that caused live indexing to miss events for `factory()` child addresses created during live indexing, when the factory is only used by accounts or call traces. Live indexing now requests logs for blocks that can create a child address.
