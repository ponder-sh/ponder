---
"@ponder/core": patch
---

Fixed a bug where the default finality checkpoint of several chains (including Arbitrum) was set to zero. The target finality interval for reorg-safe chains like Arbitrum and Optimism is now 10 seconds (e.g. 40 blocks on Arbitrum).
