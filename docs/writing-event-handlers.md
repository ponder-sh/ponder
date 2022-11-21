# Event handlers

Event handlers are TypeScript/JavaScript functions that respond to blockchain events. The Ponder engine fetches events from the sources specified in `ponder.config.js`, and then runs the event handlers you have written.

## Differences from Graph Protocol mapping functions

### Entity objects are injected via `context.entities`

You can access the entities defined in `schema.graphql` on the `context.entities` object. These ORM-style entity objects have `get`, `insert`, `update`, `delete`, and `upsert` methods.

### Event handlers must be exported from `handlers/index.ts`

The `handlers/index.ts` file must export an object mapping source names -> event names -> event handler functions.

### Contract calls must specify a block number

**Note: contract calls are very bad for performance, and should be avoided.**

`context.contracts` contains `ethers.Contract` objects for each source defined in `ponder.config.js`. These contracts are already hooked up to an `ethers.Provider`, so you can make contract calls within your event handler functions. By default, contract calls will occur using the `"latest"` blockTag, which means they will not be cached. To benefit from caching, you must specify a blockTag.

To achieve the Graph Protocol behavior of calling the contract at the same block height as the event, use `{ blockTag: event.block.number }`:

```ts
// handlers/MyERC20Token.ts

const handleTransfer = async (event, context) => {
  const { MyERC20Token } = context.contracts;
  const { to, from, amount } = event.params;

  const senderBalance = await MyERC20Token.balanceOf(from, {
    blockTag: event.block.number
  });
};
```
