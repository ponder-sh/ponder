---
"ponder": patch
---

Added log notifications to `experimentalRangeScan`. With `ws`, a range-scanned chain now scans as soon as one of its indexed logs is notified, and otherwise every `heartbeatInterval`, a new experimental chain option that defaults to a third of `reorgWindow`, instead of every `pollingInterval`.

A chain with `experimentalRangeScan` never subscribes to new blocks over `ws`, including a chain whose sources rule out the range scan. It polls every `pollingInterval` instead.
