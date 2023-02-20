# @ponder/core

## 0.0.32

### Patch Changes

- [#101](https://github.com/0xOlias/ponder/pull/101) [`08d5157`](https://github.com/0xOlias/ponder/commit/08d515796b8a737a9f5c4210aefcc89e879a8a7e) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed notion of plugins

  Moved HTTP server from `@ponder/graphql` to `@ponder/core`

  **BREAKING**. Ponder apps no longer depend on `@ponder/graphql` and do not need to include the `plugins` key in `ponder.config.ts`.

  For now, this also means that the only way to configure the server port is through the $PORT environment variable.

  ```diff
  // package.json

  {
    "private": true,
    "scripts": {
      "dev": "ponder dev",
      "start": "ponder start",
      "codegen": "ponder codegen"
    },
    "dependencies": {
      "@ponder/core": "^0.0.32",
  -   "@ponder/graphql": "latest"
    },
    "devDependencies": {
      "@types/node": "^18.11.18",
      "ethers": "^5.6.9"
    },
    "engines": {
      "node": ">=16.0.0 <19.0.0"
    }
  }
  ```

  ```diff
  // ponder.config.ts

  import type { PonderConfig } from "@ponder/core";
  - import { graphqlPlugin } from "@ponder/graphql";

  export const config: PonderConfig = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        rpcUrl: process.env.PONDER_RPC_URL_1
      }
    ],
    sources: [
      {
        name: "ArtGobblers",
        network: "mainnet",
        abi: "./abis/ArtGobblers.json",
        address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
        startBlock: 15863321
      }
    ],
  - plugins: [graphqlPlugin({ port: 8080 })]
  };
  ```

## 0.0.31

### Patch Changes

- [#97](https://github.com/0xOlias/ponder/pull/97) [`7fd75cc`](https://github.com/0xOlias/ponder/commit/7fd75cc148040ed868983f1e2cb73efccda27bcf) Thanks [@0xOlias](https://github.com/0xOlias)! - Improve stack traces

- [#100](https://github.com/0xOlias/ponder/pull/100) [`e754315`](https://github.com/0xOlias/ponder/commit/e7543152a8d17b41317eb2b823c1f198cc97c7f3) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where unhandled logs would be fetched from the cache store, also bumped cache store to v2

## 0.0.30

### Patch Changes

- [#91](https://github.com/0xOlias/ponder/pull/91) [`555888f`](https://github.com/0xOlias/ponder/commit/555888f1f9a5ba91ca1f1da8529aab3c7f52b87b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed inserting and deleting individual entities when using postgres

## 0.0.29

### Patch Changes

- [#89](https://github.com/0xOlias/ponder/pull/89) [`e3ba756`](https://github.com/0xOlias/ponder/commit/e3ba756eed30aa7c4427d2ff6b22b5f07152bcc3) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where array types could not be persisted

## 0.0.28

### Patch Changes

- [`b33e538`](https://github.com/0xOlias/ponder/commit/b33e538b518a4fc0b8615ed684acb9bcafaca616) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed RPC response parsing for Optimism

## 0.0.27

### Patch Changes

- [#79](https://github.com/0xOlias/ponder/pull/79) [`6222818`](https://github.com/0xOlias/ponder/commit/622281822df281246c305b0e165fffc5dfd93fe5) Thanks [@0xOlias](https://github.com/0xOlias)! - Fix file watching on linux

## 0.0.26

### Patch Changes

- [`a0a7132`](https://github.com/0xOlias/ponder/commit/a0a713271dbcc6ce2f63f34595b85d63f474f30b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fix leading zeroes in hex values in rpc request params

## 0.0.25

### Patch Changes

- [#69](https://github.com/0xOlias/ponder/pull/69) [`1d6b777`](https://github.com/0xOlias/ponder/commit/1d6b77778d4004946ca4aafcdbac1aff1f6453a0) Thanks [@0xOlias](https://github.com/0xOlias)! - **BREAKING** Changed the way Ponder expects handlers to be registered.

  1. Source files must be located in `src/` instead of `handlers/`
  2. Handlers are registered using an `EventEmitter`-like pattern (see below)
  3. Any `*.ts` file inside `src/` can register event handlers this way. Small projects might only need one file in `src` (e.g. `src/app.ts` or `src/{SourceName}.ts`)

  ```ts
  import { ponder } from "../generated";

  ponder.on("SourceName:EventName", async ({ event, context }) => {
    // same handler function body as before!
  });

  ponder.on("SourceName:EventName2", async ({ event, context }) => {
    // ...
  });

  ponder.on("AnotherSourceName:EventName", async ({ event, context }) => {
    // ...
  });
  ```

  Updated `create-ponder` to use this pattern for newly generated projects

- [#71](https://github.com/0xOlias/ponder/pull/71) [`e90c241`](https://github.com/0xOlias/ponder/commit/e90c2410a33ea61a05d24f82c8aa2bafb0696612) Thanks [@0xOlias](https://github.com/0xOlias)! - Added two options to Source (in ponder.ts): `source.endBlock` and `source.isIndexed`.

  `source.endBlock` is an optional field (default: undefined). If specified, Ponder will only fetch & process events up to the provided block number. Alongside `source.startBlock`, it can be used to only index a specific block range for a contract.

  `source.isIndexed` is an optional field (default: `true`). If `false`, **Ponder will not fetch any events for this contract**, and the user will not be able to define event handlers for events coming from this contract. This contract will still be available on `context.contracts` for other event handlers in your project. Use this field if you're only using a contract to call it, and don't care about processing events emitted by it.

- [#72](https://github.com/0xOlias/ponder/pull/72) [`df3ec60`](https://github.com/0xOlias/ponder/commit/df3ec601852556be788335c016c99710c4277487) Thanks [@0xOlias](https://github.com/0xOlias)! - **BREAKING** Changes ponder config naming.

  1. The ponder config file was changed (back) to `ponder.config.ts`.
  2. The `sources` field in `ponder.config.ts` was changes to `contracts`.

## 0.0.24

### Patch Changes

- [#63](https://github.com/0xOlias/ponder/pull/63) [`46c72f0`](https://github.com/0xOlias/ponder/commit/46c72f0f66364098eb2ea2c328259c46f78735d4) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where handler functions would fail if an event was fetched but not present in the ABI. This means partial ABIs are now supported.

## 0.0.23

### Patch Changes

- [#57](https://github.com/0xOlias/ponder/pull/57) [`3f358dd`](https://github.com/0xOlias/ponder/commit/3f358dddbcb4c0f7dfe427a9db847bd2388be019) Thanks [@0xOlias](https://github.com/0xOlias)! - BREAKING! Updated ponder config to support typescript and to be called `ponder.ts` by default. `ponder.ts` must export a variable named `config` that is of the type `import { PonderConfig } from "@ponder/core"`. The `database` field in ponder config is now optional. By default, it uses `SQLite` with a filename of `./.ponder/cache.db`. If the environment variable `DATABASE_URL` is detected, it uses `Postgres` with that value as the `connectionString`.

  New sample `ponder.ts` file:

  ```ts
  // ponder.ts

  import type { PonderConfig } from "@ponder/core";
  import { graphqlPlugin } from "@ponder/graphql";

  export const config: PonderConfig = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        rpcUrl: process.env.PONDER_RPC_URL_1
      }
    ],
    sources: [
      {
        name: "ArtGobblers",
        network: "mainnet",
        abi: "./abis/ArtGobblers.json",
        address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
        startBlock: 15863321
      }
    ],
    plugins: [graphqlPlugin()]
  };
  ```

  The exported value can also be a function, and it can return a Promise:

  ```ts
  // ponder.ts

  import type { PonderConfig } from "@ponder/core";

  export const config: PonderConfig = async () => {
    return {
      networks: [
        /* ... */
      ],
      sources: [
        /* ... */
      ]
    };
  };
  ```

## 0.0.22

### Patch Changes

- [#52](https://github.com/0xOlias/ponder/pull/52) [`39b3e00`](https://github.com/0xOlias/ponder/commit/39b3e00ea29142e1b893ca2170116b9988e8f623) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where string array arguments to filter fields raised SQLite error

## 0.0.21

### Patch Changes

- [#50](https://github.com/0xOlias/ponder/pull/50) [`b26b0e4`](https://github.com/0xOlias/ponder/commit/b26b0e456674c2170bf23e84f79246f1a56e82d9) Thanks [@0xOlias](https://github.com/0xOlias)! - Changed PonderPlugin interface and setup pattern. Ponder plugins are now classes. The public API (in ponder.config.js) remains the same.
