---
"@ponder/core": patch
---

BREAKING: Dropped support for `rpcUrl` in favor of `transport` in `ponder.config.ts` network configuration.

The new `transport` field accepts a [viem transport](https://viem.sh/docs/clients/intro.html#transports) instead of an RPC url. This makes it possible to use transports other than HTTP, such as WebSockets and Fallback transports.

Prior to this update, Ponder used an HTTP transport internally. To upgrade with no change in behavior:

```diff
+ import { http } from "viem";

export const config = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
-     rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/...",
+     transport: http("https://eth-mainnet.g.alchemy.com/v2/..."),
    },
  ],
  contracts: [
    {
      name: "BaseRegistrar",
      network: "mainnet",
      abi: "./abis/BaseRegistrar.json",
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 9380410,
    },
  ],
};
```
