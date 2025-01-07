---
"ponder": patch
---

Fixed the `FlushError: invalid byte sequence for encoding "UTF8": 0x00` error by removing null characters from decoded ABI parameters.
