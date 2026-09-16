---
"ponder": patch
---

Fixed a bug that caused live indexing to silently skip logs on Avalanche C-Chain after the Helicon upgrade (ACP-194 Continuous Execution), where `block.logsBloom` describes previously settled blocks instead of the block itself. Also fixed the error `Inconsistent RPC response data. The logs array has length 0, but the associated block has a non-empty 'block.logsBloom'.` on those chains.
