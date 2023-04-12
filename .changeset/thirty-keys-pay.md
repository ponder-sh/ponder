---
"@ponder/core": patch
---

Renamed config fields `contracts.blockLimit` -> `contracts.maxBlockRange` and `contracts.isIndexed` -> `contracts.isLogEventSource`.

```diff
// ponder.config.ts
import type { PonderConfig } from "@ponder/core";
export const config: PonderConfig = {
  networks: [ /* ... */ ],
  contracts: [
    {
      name: "Contract",
      network: "mainnet",
      abi: "./abis/ArtGobblers.json",
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
-     blockLimit: 50,
+     maxBlockRange: 50,
    },
    {
      name: "StaticReadOnlyContract",
      network: "mainnet",
      abi: "./abis/ArtGobblers.json",
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
-     isIndexed: false,
+     isLogEventSource: false,
    }
  ],
};
```
