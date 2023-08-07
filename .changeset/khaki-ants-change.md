---
"create-ponder": patch
"@ponder/core": patch
---

Updated event ordering to use block number and log index, replacing a more complex timestamp-based ordering system that worked across chains. This means that (for now) Ponder apps must only index one chain at a time. The `ponder.config.ts` `networks` field has been renamed to `network`, and accepts a single network object instead of an array of networks. The `contracts` and `filters` objects no longer require a `network` property, because they always correspond to the single network specified in the `network` field.

```diff
// ponder.config.ts
import type { Config } from "@ponder/core";

export const config: Config = {
-  networks: [
-    {
-      name: "mainnet",
-      chainId: 1,
-      rpcUrl: process.env.PONDER_RPC_URL_1,
-    }
-  ],
+  network: {
+    name: "mainnet",
+    chainId: 1,
+    rpcUrl: process.env.PONDER_RPC_URL_1,
+  },
  contracts: [
    {
      name: "MyNftContract",
-      network: "mainnet",
      abi: ERC721Abi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      // ...
    }
  ],
};
```

The `contracts` and `filters` objects do not require a `network` property, because they will always correspond to the single network specified in the `network` field.

```diff
// ponder.config.ts
import type { Config } from "@ponder/core";

export const config: Config = {
  network: { /* ... */ },
  contracts: [
    {
      name: "MyNftContract",
-      network: "mainnet",
      abi: ERC721Abi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      // ...
    }
  ],
};
```
