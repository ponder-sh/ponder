---
"@ponder/utils": patch
---

Fixed `eth_getLogs` requests stalling indefinitely when a provider times out instead of returning a range error.
