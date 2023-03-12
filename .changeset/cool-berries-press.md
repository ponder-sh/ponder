---
"@ponder/core": patch
---

Updated default block range limit logic to take the RPC provider (currently handles Quicknode and Alchemy) and chain ID into account. For example, contracts on Arbitrum and Optimism now use a default block range of `50_000`, while contracts on mainnet use `2_000`.

Added logic to handle `"Log response size exceeded."` errors from Alchemy. Ponder will now re-enqueue failed backfill tasks using the suggested block range present in the response. Also handled a similar error from Quicknode, though this error should only occur if the user overrides the `blockLimit` argument to something greater than `10_000`.
