### **NOTE: Not ready for public use. Please reach out via [twitter](https://twitter.com/0xOlias) dm or [email](mailto:0xolias@gmail.com) if you're interested in using Ponder.**

# Ponder

A framework for blockchain-enabled web services

## Features

|                      | ponder                       | Graph Protocol                                 |
| -------------------- | ---------------------------- | ---------------------------------------------- |
| Runtime              | Node.js                      | WebAssembly                                    |
| Supported networks   | Any EVM blockchain           | Ethereum mainnet only[^1]                      |
| Local dev server     | ✅                           | ❌                                             |
| Hot reloading        | ✅                           | N/A                                            |
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

### I'm starting a new project

[TODO]

## Guides

Getting started

Event sources & networks

Event handlers

Database

Deploying to production

## API reference

Create ponder app

Event handler context

ponder.config.js

schema.graphql

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
