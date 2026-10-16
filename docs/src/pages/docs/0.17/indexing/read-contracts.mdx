# Read contract data [Call read-only functions directly]

Sometimes, indexing function _triggers_ (event logs, traces, etc.) do not contain all of the onchain data you need to build your application. It's often useful to call read-only contract functions, fetch transaction receipts, or simulate contract interactions.

Ponder natively supports this pattern through a custom [Viem Client](https://viem.sh/docs/clients/intro) that includes performance & usability improvements specific to indexing.

## Basic example

To read data from a contract, use `context.client.readContract()` and include the contract address and ABI from `context.contracts`.

:::code-group

```ts [ponder.config.ts]
import { createConfig } from "ponder";
import { BlitmapAbi } from "./abis/Blitmap";

export default createConfig({
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
  },
  contracts: {
    Blitmap: {
      chain: "mainnet",
      abi: BlitmapAbi,
      address: "0x8d04...D3Ff63",
      startBlock: 12439123,
    },
  },
});
```

```ts [src/index.ts]
import { ponder } from "ponder:registry";
import { tokens } from "ponder:schema";

ponder.on("Blitmap:Mint", async ({ event, context }) => {
  const { client } = context;
  //      ^? ReadonlyClient<"mainnet">
  const { Blitmap } = context.contracts;
  //      ^? {
  //           abi: [...]
  //           address: "0x8d04...D3Ff63",
  //         }

  // Fetch the URI for the newly minted token.
  const tokenUri = await client.readContract({
    abi: Blitmap.abi,
    address: Blitmap.address,
    functionName: "tokenURI",
    args: [event.args.tokenId],
  });

  // Insert a Token record, including the URI.
  await context.db.insert(tokens).values({
    id: event.args.tokenId,
    uri: tokenUri,
  });
});
```

:::

## Client

The `context.client` object is a custom [Viem Client](https://viem.sh/docs/clients/intro) that caches RPC responses.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("Blitmap:Mint", async ({ event, context }) => {
  const tokenUri = await context.client.readContract({
    abi: context.contracts.Blitmap.abi,
    address: context.contracts.Blitmap.address,
    method: "tokenUri",
    args: [event.args.tokenId],
  });
});
```

:::warning
  **_Do not manually set up a Viem Client._** If `context.client` is not working
  for you, please open a GitHub issue or send a message to the chat. We'd like
  to understand and accommodate your workflow.

  ```ts [src/index.ts]
  import { ponder } from "ponder:registry";
  import { createPublicClient, http } from "viem";

  // Don't do this! ❌ ❌ ❌
  const publicClient = createPublicClient({
    transport: http("https://eth-mainnet.g.alchemy.com/v2/..."),
  });

  ponder.on("Blitmap:Mint", async ({ event, context }) => {
    const tokenUri = await publicClient.readContract({
      abi: context.contracts.Blitmap.abi,
      address: context.contracts.Blitmap.address,
      method: "tokenUri",
      args: [event.args.tokenId],
    });
  });
  ```
:::

### Supported actions

The `context.client` object supports most Viem actions.

| name                        | description                                                                                         | Viem docs                                                                                      |
| :-------------------------- | :-------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| readContract                | Returns the result of a read-only function on a contract.                                           | [readContract](https://viem.sh/docs/contract/readContract)                                     |
| multicall                   | Similar to readContract, but batches requests.                                                      | [multicall](https://viem.sh/docs/contract/multicall)                                           |
| simulateContract            | Simulates & validates a contract interaction.                                                       | [simulateContract](https://viem.sh/docs/contract/simulateContract)                             |
| getBalance                  | Returns the balance of an address in wei.                                                           | [getBalance](https://viem.sh/docs/actions/public/getBalance)                                   |
| getBytecode                 | Returns the bytecode at an address.                                                                 | [getBytecode](https://viem.sh/docs/contract/getBytecode.html)                                  |
| getStorageAt                | Returns the value from a storage slot at a given address.                                           | [getStorageAt](https://viem.sh/docs/contract/getStorageAt)                                     |
| getBlock                    | Returns information about a block at a block number, hash or tag.                                   | [getBlock](https://viem.sh/docs/actions/public/getBlock)                                       |
| getTransactionCount         | Returns the number of transactions an account has broadcast / sent.                                 | [getTransactionCount](https://viem.sh/docs/actions/public/getTransactionCount)                 |
| getBlockTransactionCount    | Returns the number of Transactions at a block number, hash or tag.                                  | [getBlockTransactionCount](https://viem.sh/docs/actions/public/getBlockTransactionCount)       |
| getTransaction              | Returns information about a transaction given a hash or block identifier.                           | [getTransaction](https://viem.sh/docs/actions/public/getTransaction)                           |
| getTransactionReceipt       | Returns the transaction receipt given a transaction hash.                                           | [getTransactionReceipt](https://viem.sh/docs/actions/public/getTransactionReceipt)             |
| getTransactionConfirmations | Returns the number of blocks passed (confirmations) since the transaction was processed on a block. | [getTransactionConfirmations](https://viem.sh/docs/actions/public/getTransactionConfirmations) |
| call                        | An Action for executing a new message call.                                                         | [call](https://viem.sh/docs/actions/public/call)                                               |
| estimateGas                 | An Action for estimating gas for a transaction.                                                     | [estimateGas](https://viem.sh/docs/actions/public/estimateGas)                                 |
| getFeeHistory               | Returns a collection of historical gas information.                                                 | [getFeeHistory](https://viem.sh/docs/actions/public/getFeeHistory)                             |
| getProof                    | Returns the account and storage values of the specified account including the Merkle-proof.         | [getProof](https://viem.sh/docs/actions/public/getProof)                                       |
| getEnsAddress               | Gets address for ENS name.                                                                          | [getEnsAddress](https://viem.sh/docs/ens/actions/getEnsAddress)                                |
| getEnsAvatar                | Gets the avatar of an ENS name.                                                                     | [getEnsAvatar](https://viem.sh/docs/ens/actions/getEnsAvatar)                                  |
| getEnsName                  | Gets primary name for specified address.                                                            | [getEnsName](https://viem.sh/docs/ens/actions/getEnsName)                                      |
| getEnsResolver              | Gets resolver for ENS name.                                                                         | [getEnsResolver](https://viem.sh/docs/ens/actions/getEnsResolver)                              |
| getEnsText                  | Gets a text record for specified ENS name.                                                          | [getEnsText](https://viem.sh/docs/ens/actions/getEnsText)                                      |

### Direct RPC requests

Use the `context.client.request` method to make direct RPC requests. This low-level approach can be useful for advanced RPC request patterns that are not supported by the actions above.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("ENS:NewOwner", async ({ event, context }) => {
  const traces = await context.client.request({ // [!code focus]
    method: 'debug_traceTransaction', // [!code focus]
    params: [event.transaction.hash, { tracer: "callTracer" }] // [!code focus]
  }); // [!code focus]

  // ...
});
```

### Block number

By default, the `blockNumber` option is set to the block number of the current event (`event.block.number`).

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("Blitmap:Mint", async ({ event, context }) => {
  const totalSupply = await context.client.readContract({
    abi: context.contracts.Blitmap.abi,
    address: context.contracts.Blitmap.address,
    functionName: "totalSupply",
    // This is set automatically, no need to include it yourself.
    // blockNumber: event.block.number,
  });
});
```

You can also specify a `blockNumber` to read data at a specific block height. It will still be cached.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("Blitmap:Mint", async ({ event, context }) => {
  const totalSupply = await context.client.readContract({
    abi: context.contracts.Blitmap.abi,
    address: context.contracts.Blitmap.address,
    functionName: "totalSupply",
    blockNumber: 15439123n, // [!code focus]
  });
});
```

:::info
  The `blockTag` option is not supported by custom client actions.
:::

### Caching

Most RPC requests made using `context.client` are cached in the database. When an indexing function calls a method with a specific set of arguments for the first time, it will make an RPC request. Any subsequent calls to the same method with the same arguments will be served from the cache.

See the [full list](https://github.com/ponder-sh/ponder/blob/main/packages/core/src/indexing/client.ts#L73-L121) of cache-enabled RPC methods in the source code.

## Contract addresses & ABIs

The `context.contracts` object contains each contract address and ABI you provide in `ponder.config.ts`.

### Multiple chains

If a contract is configured to run on multiple chains, `context.contracts` contains the contract addresses for whichever chain the current event is from.

:::warning
  It's not currently possible to call a contract that's on a different chain
  than the current event. If you need this feature, please open an issue or send
  a message to the chat.
:::

:::code-group

```ts [ponder.config.ts]
import { createConfig } from "ponder";
import { UniswapV3FactoryAbi } from "./abis/UniswapV3Factory";

export default createConfig({
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
  },
  contracts: {
    UniswapV3Factory: {
      abi: UniswapV3FactoryAbi,
      chain: { // [!code focus]
        mainnet: { // [!code focus]
          address: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // [!code focus]
          startBlock: 12369621, // [!code focus]
        }, // [!code focus]
        base: { // [!code focus]
          address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", // [!code focus]
          startBlock: 1371680, // [!code focus]
        }, // [!code focus]
      }, // [!code focus]
    },
  },
});
```

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("UniswapV3Factory:FeeAmountEnabled", async ({ event, context }) => {
  const tickSpacing = await context.client.readContract({
    abi: context.contracts.UniswapV3Factory.abi,
    address: context.contracts.UniswapV3Factory.address,
    functionName: "feeAmountTickSpacing",
    args: [event.args.fee],
  });
});
```

:::

### Factory contracts

The `context.contracts` object does not include an `address` property for contracts that use `factory()`. To read data from the contract that emitted the current event, use `event.log.address`.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("SudoswapPool:Transfer", async ({ event, context }) => {
  const { SudoswapPool } = context.contracts;
  //      ^? { abi: [...] }

  const totalSupply = await context.client.readContract({
    abi: SudoswapPool.abi,
    address: event.log.address,
    functionName: "totalSupply",
  });
});
```

To call a factory contract child from an indexing function for a _different_ contract, use your application logic to determine the correct address. For example, the address might come from `event.args`.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("LendingProtocol:RegisterPool", async ({ event, context }) => {
  const totalSupply = await context.client.readContract({
    abi: context.contracts.SudoswapPool.abi,
    address: event.args.pool,
    functionName: "totalSupply",
  });
});
```

### Read a contract without indexing it

The `context.contracts` object only contains addresses & ABIs for the contracts in `ponder.config.ts`.

To read an external contract, import the ABI object directly and include the address manually. Ad-hoc requests like this are still cached and the block number will be set automatically.

:::code-group

```ts [ponder.config.ts]
import { createConfig } from "ponder";
import { AaveTokenAbi } from "./abis/AaveToken";

export default createConfig({
  contracts: {
    AaveToken: {
      chain: "mainnet",
      abi: AaveTokenAbi,
      address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
      startBlock: 10926829,
    },
  },
});
```

```ts [src/index.ts]
import { ponder } from "ponder:registry";
import { ChainlinkPriceFeedAbi } from "../abis/ChainlinkPriceFeed";

ponder.on("AaveToken:Mint", async ({ event, context }) => {
  const priceData = await context.client.readContract({
    abi: ChainlinkPriceFeedAbi,
    address: "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9",
    functionName: "latestRoundData",
  });

  const usdValue = priceData.answer * event.args.amount;
  // ...
});
```

:::

## More examples

### Zorbs gradient data

Suppose we're building an application that stores the gradient metadata of each [Zorb NFT](https://etherscan.io/address/0xca21d4228cdcc68d4e23807e5e370c07577dd152#code). Here's a snippet from the contract.

```solidity [ZorbNft.sol]
contract ZorbNft is ERC721 {

    function mint() public {
        // ...
    }

    function gradientForAddress(address user) public pure returns (bytes[5] memory) { // [!code focus]
        return ColorLib.gradientForAddress(user); // [!code focus]
    } // [!code focus]
}
```

Every Zorb has a gradient, but the contract doesn't emit gradient data in any event logs. To read the gradient data for each new Zorb, we can call the `gradientForAddress` function.

```ts [src/index.ts]
import { ponder } from "ponder:registry";
import { zorbs } from "ponder:schema";

ponder.on("ZorbNft:Transfer", async ({ event, context }) => {
  if (event.args.from === ZERO_ADDRESS) {
    // If this is a mint, read gradient metadata from the contract. // [!code focus]
    const gradientData = await context.client.readContract({ // [!code focus]
      abi: context.contracts.ZorbNft.abi, // [!code focus]
      address: context.contracts.ZorbNft.address, // [!code focus]
      functionName: "gradientForAddress", // [!code focus]
      args: [event.args.to], // [!code focus]
    }); // [!code focus]

    await context.db.insert(zorbs).values({
      id: event.args.tokenId,
      gradient: gradientData,
      ownerId: event.args.to,
    });
  } else {
    // If not a mint, just update ownership information.
    await context.db
      .update(zorbs, { id: event.args.tokenId })
      .set({ ownerId: event.args.to });
  }
});
```
