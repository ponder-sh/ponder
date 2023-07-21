---
"@ponder/core": patch
---

Fixed a bug where if a network is present in config that doesn't have any log filters associated with it, the entire app would fail to process events in real-time.
