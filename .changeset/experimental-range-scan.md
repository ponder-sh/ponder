---
"ponder": minor
---

Added an experimental `experimentalRangeScan` chain config option. When enabled, the realtime indexing engine scans each polling interval with a single ranged `eth_getLogs` request instead of fetching every block, so a `pollingInterval` larger than the chain's block time reduces RPC usage. Useful for high-throughput L2 chains. Only applies to chains whose indexed sources are exclusively non-factory `log` events.
