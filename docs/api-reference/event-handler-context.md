# Event handler context

Event handler functions receive two arguments: `event` and `context`.

The `event` object contains the event params, the transaction that produced the event, and the block containing that transaction.

```ts
interface MyNftContractEvent {
  name: string;
  params: {
    /* event-specific parameters */
  };
  block: Block;
  transaction: Transaction;
}

interface Block {
  /* TODO */
}

interface Transaction {
  /* TODO */
}
```

The `context` argument contains an object-relational mapping object for each entity in your `schema.graphql`. You can use these ORM methods to insert and update entities that will be served automatically by the GraphQL server.

It also contains `ethers.Contract` objects for each contract defined in your `ponder.config.js`. You can use these to read data directly from a smart contract.

```ts
interface Context {
  entities: {
    MyTokenEntity: MyTokenEntityModel;
  };
  contracts: {
    MyNftContract: MyNftContract;
  };
}

interface MyTokenEntityModel {
  get: (id: string) => Promise<MyTokenEntity | null>;
  insert: (obj: MyTokenEntity) => Promise<MyTokenEntity>;
  update: (
    obj: { id: string } & Partial<MyTokenEntity>
  ) => Promise<MyTokenEntity>;
  delete: (id: string) => Promise<void>;
}

type MyNftContract = ethers.Contract;
```

[TODO - Convert this example to an NFT contract] Here's an example handler function for an ERC20 `Transfer` event.

```graphql
# schema.graphql
type Account @entity {
  id: ID!
  balance: BigInt!
  lastActiveAt: Int
}
```

```ts
// handlers/MyERC20Token.ts
const handleTransfer = async (event, context) => {
  const { Account } = context.entities;
  const { timestamp } = event.block
  const { to, from, amount } = event.params;

  let sender = await Account.find({ id: from })
  if (!sender) {
    sender = await Account.insert({ id: from, balance: 0 })
  }
  await sender.update({
    balance: sender.balance - amount,
    lastActiveAt: timestamp
  })

  let recipient = await Account.find({ id: to })
  if (!recipient) {
    recipient = await Account.insert({ id: to, balance: 0 })
  }
  await recipient.update({
    balance: recipient.balance + amount
  })
};

export {
  Transfer: handleTransfer
}
```

[TODO - find a better place for this]
The `handlers/` directory contains a file for each source defined in `ponder.config.js`. The `handlers/index.ts` file must export an object that maps event names to event handler functions.
