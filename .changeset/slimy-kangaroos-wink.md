---
"@ponder/core": patch
---

Increased realtime sync retry threshold. Now, realtime sync errors will continue retrying for 10 minutes before throwing a fatal error. This improves stability when using RPC providers that are slow to index block hashes for [EIP-234](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-234.md) requests.
