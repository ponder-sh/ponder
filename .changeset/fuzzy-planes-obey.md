---
"@ponder/core": patch
---

Added support for overloaded event names. If an ABI contains overloaded event names, conflicting events will be named using the full signature, e.g. `ponder.on("MyContract:Transfer(address indexed, address indexed, uint256)", ...)` and `ponder.on("MyContract:Transfer(uint8 indexed, uint256 indexed, address)", ...)`.
