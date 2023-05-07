---
description: "Guide to proxy contracts"
---

# Proxy contracts

Ponder supports [EIP-1967 proxy contracts](https://docs.openzeppelin.com/contracts/4.x/api/proxy) (Transparent and UUPS). Ponder handles proxy contracts by merging the ABI of the proxy contract with the ABI of the implementation contract.

The `create-ponder` Etherscan [contract link template](/api-reference/create-ponder#etherscan-contract-link) will automatically detect proxy contracts and fetch the required implementation contract ABIs.

::: info
To decode event logs emitted by a proxy contract, Ponder searches for a matching event in the implementation contract ABI(s). To avoid missing any events, make sure to include the ABI of every implementation contract that the proxy has ever had.
:::

## Add a proxy contract

1. Find the implementation contract ABI (or ABIs) and paste each into a JSON file in the `abis/` directory. Tip: On Etherscan, there is a link to the implementation contract on the **Contract → Read as Proxy** tab.

      ![Etherscan contract proxy address](/etherscan-proxy-contract.png)

2. Add the implementation contract ABI to the contract's `abi` field in `ponder.config.ts`.

    ```ts filename="ponder.config.ts"
    import type { PonderConfig } from "@ponder/core";

    export const config: PonderConfig = {
      networks: [ /* ... */ ],
      contracts: [
        {
          name: "MyTokenContract",
          abi: [
            "./abis/MyTokenContract.json", // Proxy ABI
            "./abis/ERC1155.json" // Implementation ABI
          ],
          // ...
        }
      ]
    };
    ```

3. Add event handlers for events defined in the implementation ABI. That's it!

    ```ts filename="src/index.ts"
    import { ponder } from "@/generated";

    ponder.on("MyTokenContract:TransferBatch", async ({ event }) => {
      // ...
    });
    ```
