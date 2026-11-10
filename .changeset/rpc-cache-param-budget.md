---
"ponder": patch
---

Fixed a bug that caused storing more than about 16,000 RPC responses in the rpc cache at once to fail, because the statement had more than 65,535 parameters.
