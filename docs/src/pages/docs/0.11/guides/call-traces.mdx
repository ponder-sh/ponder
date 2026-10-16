# Call traces [Index call traces for a contract]

Ponder supports indexing **call traces**, which represent a _function call_ instead of an event log.

:::warning
  Call traces are slower, more expensive, and less widely supported than logs. You might struggle to find an RPC provider that supports `debug_traceBlockByNumber` and `debug_traceBlockByHash` for new chains.
:::

## Guide

:::steps

### Enable call traces

To enable call traces, use the `includeCallTraces` option on the contract configuration.

```ts [ponder.config.ts]
import { createConfig } from "ponder";
import { BlitmapAbi } from "./abis/Blitmap";

export default createConfig({
  contracts: {
    Blitmap: {
      abi: BlitmapAbi,
      chain: "mainnet",
      address: "0x8d04a8c79cEB0889Bdd12acdF3Fa9D207eD3Ff63",
      startBlock: 12439123,
      includeCallTraces: true, // [!code focus]
    },
  },
  // ...
});
```

### Register an indexing function

Now, each function in the contract ABI will become available as an indexing function event name using the `"ContractName.functionName()"{:ts}` scheme.

```ts [src/index.ts]
import { ponder } from "ponder:registry";

ponder.on("Blitmap.mintOriginal()", async ({ event }) => {
  event.args;
  //    ^? [tokenData: Hex, name: string]
  event.trace.gasUsed;
  //          ^? bigint
});
```

:::

## What is a call trace?

Let's define call traces from three different perspectives.

- **Ponder**: A call trace is similar to a log, but it represents a function call instead of an event log. You can register an indexing function that will run whenever a specific function on one of your contracts gets called.
- **Solidity**: A call trace records a function call. For example, whenever someone calls the `transfer(address to, uint256 amount){:solidity}` function of an ERC20 token contract, it produces a call trace.
- **EVM**: A call trace records the execution of the [`CALL`, `STATICCALL`, `DELEGATECALL`, or `CALLCODE`](https://www.evm.codes/#f1) opcode within a transaction.

### Top-level vs. internal calls

A call trace can be a **top-level call** or an **internal call**. A top-level call is from an externally-owned account, and an internal call is from another contract.

To check if a call trace is a top-level call, use `event.trace.traceAddress.length === 0{:ts}`.

```ts [src/index.ts]
ponder.on("ERC20.transfer()", async ({ event }) => {
  const isTopLevelCall = event.trace.traceAddress.length === 0; // [!code focus]
  // ...
});
```

:::info
Top-level calls also always have `event.trace.to === event.transaction.to{:ts}`, but this can also be true for internal calls.
:::

### `eth_call` and `view` functions

The `eth_call` RPC method **does not** produce a call trace. These calls do not occur during the execution of a transaction, so they are not recorded as call traces.

However, calls made to `view` or `pure` functions **do** produce call traces if they are made during the execution of a transaction. These call traces are rarely useful for indexing, but they do happen.
