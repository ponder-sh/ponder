### **NOTE: Not ready for public use. Please reach out via [twitter](https://twitter.com/0xOlias) dm or [email](mailto:0xolias@gmail.com) if you're interested in using Ponder.**

# Ponder

A framework for blockchain-enabled web services

## Features

|                      | ponder                       | Graph Protocol                                 |
| -------------------- | ---------------------------- | ---------------------------------------------- |
| Runtime              | Node.js                      | WebAssembly                                    |
| Supported networks   | Any EVM blockchain           | Ethereum mainnet only[^1]                      |
| Local dev server     | ✅                           | ❌                                             |
| Hosting requirements | Node.js; Postgres (optional) | Graph Node; IPFS node; Ethereum node; Postgres |

## Quickstart

### I'm replacing a Graph Protocol subgraph

Ponder is an alternative to the Graph Protocol that aims to be more developer-friendly. You can quickly migrate an existing subgraph repository to Ponder using the `create-ponder-app` CLI tool.

#### 1. Run `create-ponder-app`

This command will create a project folder called `ponder` in your current working directory. Include the `--from-subgraph` option to bootstrap your project using an existing Graph Protocol subgraph.

```
npx create-ponder-app@latest --from-subgraph ./subgraph-directory
# or
yarn create ponder-app --from-subgraph ./subgraph-directory
# or
pnpm create ponder-app --from-subgraph ./subgraph-directory
```

#### 2. Start the development server

```
cd ponder
```

```
npm run dev
# or
yarn dev
# or
pnpm run dev
```

The dev server prints logs to help you debug any configuration issues or errors. The server automatically reloads whenever you save changes in any project file.

#### 3. Migrate event handler functions

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

## Guides

[Getting started](https://github.com/0xOlias/ponder/blob/main/docs/getting-started.md)

[Event sources & networks](https://github.com/0xOlias/ponder/blob/main/docs/event-sources-and-networks.md)

[Event handlers](https://github.com/0xOlias/ponder/blob/main/docs/event-handlers.md)

[Database](https://github.com/0xOlias/ponder/blob/main/docs/database.md)

[Deploying to production](https://github.com/0xOlias/ponder/blob/main/docs/deploying-to-production.md)

## API reference

[Create ponder app](https://github.com/0xOlias/ponder/blob/main/docs/api-reference/create-ponder-app.md)

[Event handler context](https://github.com/0xOlias/ponder/blob/main/docs/api-reference/event-handler-context.md)

[`ponder.config.js`](https://github.com/0xOlias/ponder/blob/main/docs/api-reference/ponder-config-js.md)

[`schema.graphql`](https://github.com/0xOlias/ponder/blob/main/docs/api-reference/schema-graphql.md)

## Packages

- `@ponder/ponder`
- `create-ponder-app`

## About

Ponder is MIT-licensed open-source software.

#### Goals

- Be the best tool for building web services that rely on blockchain events
- Work seamlessly alongside frameworks like Foundry and Next.js

#### Non-goals

- Efficiently index massive amounts of data
- Serve analytics queries/workloads

[^1]: Describes the Graph Decentalized Network (the hosted service supports [more chains](https://thegraph.com/docs/en/deploying/deploying-a-subgraph-to-hosted/)).
