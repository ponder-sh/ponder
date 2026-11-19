---
"ponder": patch
---

Added the experimental `experimentalRangeScan` chain option. When enabled, live indexing scans each polling interval with ranged `eth_getLogs` requests instead of fetching every block, so a `pollingInterval` larger than the chain's block time reduces RPC usage. Applies to chains whose sources are all `log` sources, including factory sources.
