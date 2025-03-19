---
"ponder": patch
---

Fixed an issue where `eth_call` responses containing `0x` were being cached. Now, only non-empty responses are cached.
