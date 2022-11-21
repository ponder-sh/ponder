# Event handler context

Event handler functions receive two arguments: `event` and `context`.

The `event` object contains the event params, the transaction that produced the event, and the block containing that transaction.

## `event`

```ts
interface ExampleEvent extends EventLog {
  name: string;
  params: {
    /* ExampleEvent arguments/parameters */
  };
  block: Block;
  transaction: Transaction;
}

interface EventLog {
  logId: string; // `${log.blockHash}-${log.logIndex}`
  logSortKey: number;

  address: string;
  data: string;
  topics: string; // JSON.stringify-ed array of topic strings

  blockHash: string;
  blockNumber: number;
  logIndex: number;

  transactionHash: string;
  transactionIndex: number;

  removed: number; // boolean, 0 or 1
}

interface Block {
  hash: string;
  number: number;
  timestamp: number;

  gasLimit: string; // BigNumber
  gasUsed: string; // BigNumber
  baseFeePerGas: string; // BigNumber

  miner: string;
  extraData: string;
  size: number;

  parentHash: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  totalDifficulty: string; // BigNumber
}

interface Transaction {
  hash: string;
  nonce: number;

  from: string;
  to?: string; // null if contract creation
  value: string; // BigNumber
  input: string;

  gas: string; // BigNumber
  gasPrice: string; // BigNumber
  maxFeePerGas?: string; // BigNumber
  maxPriorityFeePerGas?: string; // BigNumber

  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  chainId: number;
}
```

## `context`

`context.entities` contains an object-relational mapper for each entity in your `schema.graphql`. You can use these objects to insert and update entities that will be served automatically by the GraphQL server.

`context.contracts` contains `ethers.Contract` objects for each contract defined in your `ponder.config.js`. You can use these to read data directly from a smart contract.

```ts
interface Context {
  contracts: {
    MyNftContract: MyNftContract;
  };
  entities: {
    MyTokenEntity: MyTokenEntityModel;
  };
}

type MyNftContract = ethers.Contract;

interface MyTokenEntityModel {
  get: (id: string) => Promise<MyTokenEntity | null>;
  insert: (id: string, obj: MyTokenEntity) => Promise<MyTokenEntity>;
  update: (id: string, obj: Partial<MyTokenEntity>) => Promise<MyTokenEntity>;
  delete: (id: string) => Promise<boolean>;
  upsert: (id: string, obj: MyTokenEntity) => Promise<MyTokenEntity>;
}
```

## Example event handler

Here's an example handler for an ERC20 `Transfer` event that tracks user balances.

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
  const { timestamp } = event.block;
  const { to, from, amount } = event.params;

  let sender = await Account.find({ id: from });
  if (!sender) {
    sender = await Account.insert({ id: from, balance: 0 });
  }
  await sender.update({
    balance: sender.balance - amount,
    lastActiveAt: timestamp
  });

  let recipient = await Account.find({ id: to });
  if (!recipient) {
    recipient = await Account.insert({ id: to, balance: 0 });
  }
  await recipient.update({
    balance: recipient.balance + amount
  });
};

export const MyERC20Token = {
  Transfer: handleTransfer
};
```
