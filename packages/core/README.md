# ponder

[![CI status][ci-badge]][ci-url]
[![Version][version-badge]][version-url]
[![Telegram chat][tg-badge]][tg-url]
[![License][license-badge]][license-url]

Ponder is an open-source TypeScript framework for EVM data indexing.

## Documentation

Visit [ponder.sh](https://ponder.sh) for documentation, guides, and the API reference.

## Support

Join [Ponder's telegram chat](https://t.me/pondersh) for support, feedback, and general chatter.

## Features

* Index any contract or account on any EVM-compatible chain
* Write indexed data to Postgres
* Query indexed data over HTTP using GraphQL or SQL
* Build rapidly with a powerful local development server
* Deploy anywhere that runs Node.js or Bun

## Quickstart

### 1. Run `create-ponder`

You will be asked for a project name, and if you are using a [template](https://ponder.sh/docs/api-reference/create-ponder#templates) (recommended).

After the prompts, the CLI will create a project directory, install dependencies, and initialize a git repository.

```bash
bun create ponder
# or
pnpm create ponder
# or
npm init ponder@latest
```

### 2. Start the development server

Ponder has a development server that automatically reloads when you save changes in any project file. It also prints `console.log` statements and errors encountered while running your code.

First, `cd` into your project directory, then start the server.

```bash
bun dev
# or
pnpm dev
# or
npm run dev
```

### 3. Specify contracts & chains

Ponder fetches event logs for the contracts in `ponder.config.ts`, and passes those events to the indexing functions you write.

```ts
// ponder.config.ts

import { createConfig } from "ponder";
import { BaseRegistrarAbi } from "./abis/BaseRegistrar";
 
export default createConfig({
  chains: {
    mainnet: { 
      id: 1,
      rpc: "https://eth-mainnet.g.alchemy.com/v2/...",
    },
  },
  contracts: {
    BaseRegistrar: {
      abi: BaseRegistrarAbi,
      chain: "mainnet",
      address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      startBlock: 9380410,
    },
  },
});
```

### 4. Define your schema

The `ponder.schema.ts` file specifies the database schema, which should match the shape of your application's data model.

```ts
// ponder.schema.ts

import { onchainTable } from "ponder";

export const ensName = onchainTable("ens_name", (t) => ({
  name: p.text().primaryKey(),
  owner: p.text().notNull(),
  registeredAt: p.integer().notNull(),
}));
```

### 5. Write indexing functions

Files in the `src/` directory contain **indexing functions**, which are TypeScript functions that process a contract event. The purpose of these functions is to write indexed data to the database.

```ts
// src/BaseRegistrar.ts

import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("BaseRegistrar:NameRegistered", async ({ event, context }) => {
  const { name, owner } = event.params;

  await context.db.insert(schema.ensName).values({
    name: name,
    owner: owner,
    registeredAt: event.block.timestamp,
  });
});
```

### 6. Query the GraphQL API

Ponder automatically generates a GraphQL API based on your `ponder.schema.ts` file. The API serves data that you inserted in your indexing functions.

```ts
{
  ensNames(limit: 2) {
    items {
      name
      owner
      registeredAt
    }
  }
}
```

```json
{
  "ensNames": {
    "items": [
      {
        "name": "vitalik.eth",
        "owner": "0x0904Dac3347eA47d208F3Fd67402D039a3b99859",
        "registeredAt": 1580345271
      },
      {
        "name": "joe.eth",
        "owner": "0x6109DD117AA5486605FC85e040ab00163a75c662",
        "registeredAt": 1580754710
      }
    ]
  }
}
```

That's it! Visit [ponder.sh](https://ponder.sh) for documentation, guides for deploying to production, and the API reference.

## Contributing

If you're interested in contributing to Ponder, please read the [contribution guide](/.github/CONTRIBUTING.md).

## Packages

- [`ponder`](https://www.npmjs.com/package/ponder)
- [`@ponder/client`](https://www.npmjs.com/package/@ponder/client)
- [`@ponder/react`](https://www.npmjs.com/package/@ponder/react)
- [`@ponder/utils`](https://www.npmjs.com/package/@ponder/utils)
- [`create-ponder`](https://www.npmjs.com/package/create-ponder)
- [`eslint-config-ponder`](https://www.npmjs.com/package/eslint-config-ponder)

## About

Ponder is MIT-licensed open-source software.

[ci-badge]: https://github.com/ponder-sh/ponder/actions/workflows/main.yml/badge.svg
[ci-url]: https://github.com/ponder-sh/ponder/actions/workflows/main.yml
[tg-badge]: https://img.shields.io/endpoint?color=neon&logo=telegram&label=chat&url=https%3A%2F%2Ftg.sumanjay.workers.dev%2Fpondersh
[tg-url]: https://t.me/pondersh
[license-badge]: https://img.shields.io/npm/l/ponder?label=License
[license-url]: https://github.com/ponder-sh/ponder/blob/main/LICENSE
[version-badge]: https://img.shields.io/npm/v/ponder
[version-url]: https://github.com/ponder-sh/ponder/releases
