---
"ponder": patch
---

Added an opt-in HyperSync fast path for historical sync. With `PONDER_HYPERSYNC=true` and an API token in `ENVIO_API_TOKEN`, bounded-range `eth_getLogs` requests are served by a single HyperSync query whose join also returns the blocks and transactions those logs touch, and the per-eventful-block `eth_getBlockByNumber` requests are answered from that data. Requests near the chain tip, cache misses, and realtime sync use the RPC unchanged. The client library is an optional peer dependency, imported lazily — installs that never enable the path carry no native module, and if it is absent every request falls back to the RPC.
