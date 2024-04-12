---
"@ponder/core": patch
---

Fixed a bug where transaction and log insertion during the realtime sync was not using a bulk insert. This improves realtime indexing latency, particularly for apps with many matched transactions and logs per block in realtime.
