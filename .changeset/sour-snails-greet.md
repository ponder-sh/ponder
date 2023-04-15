---
"@ponder/core": patch
---

Added support for custom log filters.

```ts
// ponder.config.ts
import type { PonderConfig } from "@ponder/core";
import { parseAbiItem } from "abitype";

export const config: PonderConfig = {
  networks: [
    /* ... */
  ],
  contracts: [
    {
      name: "AllTransfers",
      network: "mainnet",
      abi: "./abis/ERC20.json",
      filter: {
        event: parseAbiItem(
          "event Transfer(address indexed, address indexed, uint256)"
        )
      }
      fromBlock: 17030328
    }
  ]
};
```
