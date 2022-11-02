# Event handlers

Ponder event handler functions are similar but not identical to Graph Protocol mapping functions.

**Entity objects are injected via `context.entities`**

You can access the entities defined in `schema.graphql` on the `context.entities` object. These ORM-style entity objects have `get`, `insert`, `update`, and `remove` methods.

**You must export event handler functions**

The `handlers/index.ts` file must export an object mapping source names -> event names -> event handler functions.

**You must specify block numbers for contract calls**

`context.contracts` contains an `ethers.Contract` object for each source defined in `ponder.config.js`. These contracts are already hooked up to an `ethers.Provider`, so you can make contract calls within your event handler functions. By default, contract calls will occur using the `"latest"` blockTag, which means they will not be cached. To benefit from caching, you should specify a blockTag:

```ts
// handlers/MyERC20Token.ts
const handleTransfer = async (event, context) => {
  const { MyERC20Token } = context.contracts;
  const { Account } = context.entities;
  const { to, from, amount } = event.params;

  const senderBalance = await MyERC20Token.balanceOf(from, {
    blockTag: event.block.number
  });
};

export {
  Transfer: handleTransfer
}
```
