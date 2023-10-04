---
"@ponder/core": patch
---

Support viem transport as configuration option.

Instead of specifying a rpc url, you can now pass in a [viem transport](https://viem.sh/docs/clients/intro.html#transports) directly to the ponder network config. This allows you to have more control over the connection. For example, you can use a websocket transport to subscribe to events, or specify multiple transports to fallback to if one fails.

```ts
import { http } from "viem";

export const config = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      transport: http("https://eth-mainnet.g.alchemy.com/v2/..."),
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
