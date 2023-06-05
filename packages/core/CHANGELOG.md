# @ponder/core

## 0.0.59

### Patch Changes

- [`869b920`](https://github.com/0xOlias/ponder/commit/869b920968108ecbcd93b96a10bdb537006fd0b9) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the type generated for contract functions that return no outputs was invalid

## 0.0.58

### Patch Changes

- [#188](https://github.com/0xOlias/ponder/pull/188) [`e1bddf1`](https://github.com/0xOlias/ponder/commit/e1bddf1963b6ad2b1332bfdb26816e272e128dfc) Thanks [@saribmah](https://github.com/saribmah)! - Fixes a bug where event handler was always using the minimum value for toTimestamp from all block timestamps, resulting in new events not being added for event handling.

## 0.0.57

### Patch Changes

- [#180](https://github.com/0xOlias/ponder/pull/180) [`f2d88c8`](https://github.com/0xOlias/ponder/commit/f2d88c8462cf94b8e430dfcc9df9d68812525f4f) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where codegen broke if an ABI included an event with an anonymous input.

## 0.0.56

### Patch Changes

- [#169](https://github.com/0xOlias/ponder/pull/169) [`2085703`](https://github.com/0xOlias/ponder/commit/208570358d4a895855109bc0eca0822b9ee8bfc2) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where the server would fail to start if the desired port was in use. The server will now use the next available port via `detect-port`.

## 0.0.55

## 0.0.54

### Patch Changes

- [#165](https://github.com/0xOlias/ponder/pull/165) [`21d06c0`](https://github.com/0xOlias/ponder/commit/21d06c0fbee082f6233d3ab4487caed8ea501f6c) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for multiple ABIs in `ponder.config.ts` contracts/log filters. This can be used to combine the proxy and implementation ABIs for proxy contracts. Ponder will internally merge the provided ABIs and de-duplicate any ABI items.

## 0.0.53

### Patch Changes

- [#158](https://github.com/0xOlias/ponder/pull/158) [`feb3379`](https://github.com/0xOlias/ponder/commit/feb3379b8d2e9f8ddecce7a213215d80b91ff30a) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for custom log filters.

  ```ts
  // ponder.config.ts
  import type { PonderConfig } from "@ponder/core";
  import { parseAbiItem } from "abitype";

  export const config: PonderConfig = {
    networks: [
      /* ... */
    ],
    contracts: [
      {
        name: "AllTransfers",
        network: "mainnet",
        abi: "./abis/ERC20.json",
        filter: {
          event: parseAbiItem(
            "event Transfer(address indexed, address indexed, uint256)"
          )
        }
        fromBlock: 17030328
      }
    ]
  };
  ```

- [#158](https://github.com/0xOlias/ponder/pull/158) [`feb3379`](https://github.com/0xOlias/ponder/commit/feb3379b8d2e9f8ddecce7a213215d80b91ff30a) Thanks [@0xOlias](https://github.com/0xOlias)! - Renamed config fields `contracts.blockLimit` -> `contracts.maxBlockRange` and `contracts.isIndexed` -> `contracts.isLogEventSource`.

  ```diff
  // ponder.config.ts
  import type { PonderConfig } from "@ponder/core";
  export const config: PonderConfig = {
    networks: [ /* ... */ ],
    contracts: [
      {
        name: "Contract",
        network: "mainnet",
        abi: "./abis/ArtGobblers.json",
        address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
  -     blockLimit: 50,
  +     maxBlockRange: 50,
      },
      {
        name: "StaticReadOnlyContract",
        network: "mainnet",
        abi: "./abis/ArtGobblers.json",
        address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
  -     isIndexed: false,
  +     isLogEventSource: false,
      }
    ],
  };
  ```

## 0.0.52

### Patch Changes

- [#154](https://github.com/0xOlias/ponder/pull/154) [`e3f949c`](https://github.com/0xOlias/ponder/commit/e3f949ca16ea06ad2ba92b9304a591c8210d3a21) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated `maxHealthcheckDuration` resolution to honor Railway's env var `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`

## 0.0.51

### Patch Changes

- [#153](https://github.com/0xOlias/ponder/pull/153) [`64fd31e`](https://github.com/0xOlias/ponder/commit/64fd31e00317e97a83cb6c1e930cc8c5578694e2) Thanks [@0xOlias](https://github.com/0xOlias)! - Changed graphql API path from `/graphql` to `/`

- [#151](https://github.com/0xOlias/ponder/pull/151) [`ace6a36`](https://github.com/0xOlias/ponder/commit/ace6a3664c2e1354701e2225d0f5c92c3eae9a28) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for a "setup" event which is processed before all log events. The "setup" event handler argument only includes `context` (no `event` property). Example:

  ```ts
  import { ponder } from "@/generated";

  ponder.on("setup", async ({ context }) => {
    const { MyEntity } = context.entities;

    const setupData = await fetch("https://...");

    await MyEntity.create({
      id: setupData.id,
      data: { ...setupData }
    });
  });
  ```

## 0.0.50

### Patch Changes

- [#144](https://github.com/0xOlias/ponder/pull/144) [`a683344`](https://github.com/0xOlias/ponder/commit/a6833444f5110a711ba9a982cf7fb041caec8b5f) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `options` field to ponder config with support for `maxHealthcheckDuration`

- [#144](https://github.com/0xOlias/ponder/pull/144) [`a683344`](https://github.com/0xOlias/ponder/commit/a6833444f5110a711ba9a982cf7fb041caec8b5f) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed support for `--silent` flag for ponder dev/start/codegen, use PONDER_LOG_LEVEL=0 env var instead

- [#144](https://github.com/0xOlias/ponder/pull/144) [`a683344`](https://github.com/0xOlias/ponder/commit/a6833444f5110a711ba9a982cf7fb041caec8b5f) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where Ponder would occasionally process the same event twice

## 0.0.49

### Patch Changes

- [#141](https://github.com/0xOlias/ponder/pull/141) [`da83257`](https://github.com/0xOlias/ponder/commit/da832579adcf4ee7540287e43c527e6f6ed2ac9d) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved error messages for event handler errors originating in `pg` and `better-sqlite3`

## 0.0.48

### Patch Changes

- [#139](https://github.com/0xOlias/ponder/pull/139) [`cd1ebe7`](https://github.com/0xOlias/ponder/commit/cd1ebe75157b1875be675021189eba4dc9c4af83) Thanks [@0xOlias](https://github.com/0xOlias)! - BREAKING. Updated entity store API to support `create`, `update`, `upsert`, `findUnique`, and `delete`. Moved `id` from the first positional argument to a field of the `options` object argument for all methods, and moved second positional argument to the `data` field of the `options` argument. See docs for new reference.

## 0.0.47

### Patch Changes

- [#137](https://github.com/0xOlias/ponder/pull/137) [`5e59712`](https://github.com/0xOlias/ponder/commit/5e59712b50fc2e535ac83ad9acc24df2e305222d) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed support for `ID` type in `schema.graphql`. Use `String`, `Int`, `BigInt`, or `Bytes` instead. Also removed support for `BigDecimal`, use `Float` instead.

## 0.0.46

### Patch Changes

- [#134](https://github.com/0xOlias/ponder/pull/134) [`7a18bd6`](https://github.com/0xOlias/ponder/commit/7a18bd6320dfee90bfe0e0d01cca89a626cddc67) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `pollingInterval` option to networks in `ponder.config.ts`

- [#134](https://github.com/0xOlias/ponder/pull/134) [`7a18bd6`](https://github.com/0xOlias/ponder/commit/7a18bd6320dfee90bfe0e0d01cca89a626cddc67) Thanks [@0xOlias](https://github.com/0xOlias)! - Added fetch polyfill to fix Node 16 compatibility

- [#134](https://github.com/0xOlias/ponder/pull/134) [`7a18bd6`](https://github.com/0xOlias/ponder/commit/7a18bd6320dfee90bfe0e0d01cca89a626cddc67) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where the server would start responding as healthy before the backfill was complete if there were no "live" contracts

## 0.0.45

### Patch Changes

- [#132](https://github.com/0xOlias/ponder/pull/132) [`236bcb4`](https://github.com/0xOlias/ponder/commit/236bcb46b461c8b1c8576d4fb95edd06bb240950) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated default block range limit logic to take the RPC provider (currently handles Quicknode and Alchemy) and chain ID into account. For example, contracts on Arbitrum and Optimism now use a default block range of `50_000`, while contracts on mainnet use `2_000`.

  Added logic to handle `"Log response size exceeded."` errors from Alchemy. Ponder will now re-enqueue failed backfill tasks using the suggested block range present in the response. Also handled a similar error from Quicknode, though this error should only occur if the user overrides the `blockLimit` argument to something greater than `10_000`.

- [`b177d05`](https://github.com/0xOlias/ponder/commit/b177d053e18b78705a2d12995b1375a2a8407d78) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated shutdown sequence to set `process.exitCode = 1` when using `ponder start`

- [#132](https://github.com/0xOlias/ponder/pull/132) [`236bcb4`](https://github.com/0xOlias/ponder/commit/236bcb46b461c8b1c8576d4fb95edd06bb240950) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the frontfill would happen multiple times for the same network

## 0.0.44

### Patch Changes

- [`9efcf85`](https://github.com/0xOlias/ponder/commit/9efcf85ce2e76cf1e3d1e18c2ea392f0d8ab81ef) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where Ponder instances would not close all open handles when killed

## 0.0.43

### Patch Changes

- [`7833912`](https://github.com/0xOlias/ponder/commit/78339121197d861b7d03f733b7c935a0063f0e33) Thanks [@0xOlias](https://github.com/0xOlias)! - Fix baseFeePerGas bug on optimism/postgres

## 0.0.42

### Patch Changes

- [#127](https://github.com/0xOlias/ponder/pull/127) [`b308f2f`](https://github.com/0xOlias/ponder/commit/b308f2ff034ff367a217791a35e45943650ab790) Thanks [@0xOlias](https://github.com/0xOlias)! - Changed how frontfill logs and blocks are fetched to improve performance on high-throughput chains like Arbitrum and Optimism. Also made a small change to the dev UI as a result.

## 0.0.41

### Patch Changes

- [`c5abf10`](https://github.com/0xOlias/ponder/commit/c5abf10dcb3d172d029daae76b735cee9eb39d9e) Thanks [@0xOlias](https://github.com/0xOlias)! - Bumped viem to fix event decoding bug

## 0.0.40

### Patch Changes

- [#123](https://github.com/0xOlias/ponder/pull/123) [`9d6f820`](https://github.com/0xOlias/ponder/commit/9d6f820e9d0d1815aa6ebf7b001c0a3139c58f7c) Thanks [@0xOlias](https://github.com/0xOlias)! - **BREAKING** Migrated to [viem](https://viem.sh). Notes:

  Ponder projects must now use **Node 18** or a fetch polyfill (see [viem docs](https://viem.sh/docs/compatibility.html)).

  Many of the values in `event.block`, `event.transaction`, and `event.log` are now `bigint` instead of `ethers.BigNumber`. `context.contracts` objects will also have slightly different types.

  Projects should remove `ethers` as a dependency, and will need to add dev dependencies on `viem`, `abitype`, and `typescript`.

## 0.0.39

## 0.0.38

### Patch Changes

- [#118](https://github.com/0xOlias/ponder/pull/118) [`84b4ca0`](https://github.com/0xOlias/ponder/commit/84b4ca0b7e3b4e73ff6daa8c317b48a22b4ca652) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated package exports to include cjs and esm

- [#118](https://github.com/0xOlias/ponder/pull/118) [`84b4ca0`](https://github.com/0xOlias/ponder/commit/84b4ca0b7e3b4e73ff6daa8c317b48a22b4ca652) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for a path alias `@/generated` in Ponder project `src` files.

  ```ts
  // src/SomeContract.ts
  import { ponder } from "@/generated";

  ponder.on(...)
  ```

  ```ts
  // src/nested/AnotherContract.ts
  import { ponder } from "@/generated";

  ponder.on(...)

  ```

## 0.0.37

### Patch Changes

- [#114](https://github.com/0xOlias/ponder/pull/114) [`857f099`](https://github.com/0xOlias/ponder/commit/857f0997263e9c816bc6ad2695d9a03bcf269672) Thanks [@0xOlias](https://github.com/0xOlias)! - Refactored @ponder/core internals and updated `ponder dev` logs

## 0.0.36

### Patch Changes

- [#110](https://github.com/0xOlias/ponder/pull/110) [`754f8dd`](https://github.com/0xOlias/ponder/commit/754f8dd019039dfe306a2b3796621089de5d39c7) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated schema definition to allow `Bytes` and `String` types for entity `id` fields

## 0.0.35

### Patch Changes

- [#109](https://github.com/0xOlias/ponder/pull/109) [`1563946`](https://github.com/0xOlias/ponder/commit/15639465d68082bde7eb6a8be0f86cd0a9858d5b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed zero downtime deployment bug

- [`73bd492`](https://github.com/0xOlias/ponder/commit/73bd4927b570b38ede61f63ea075b2811089a68e) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed schema type generation bugs

## 0.0.34

### Patch Changes

- [#104](https://github.com/0xOlias/ponder/pull/104) [`d36fcd8`](https://github.com/0xOlias/ponder/commit/d36fcd882745a0769f1723306ae913fedc278973) Thanks [@0xOlias](https://github.com/0xOlias)! - Added a health check path at `/health` to enable zero-downtime deployments

## 0.0.33

### Patch Changes

- [`4d98b5d`](https://github.com/0xOlias/ponder/commit/4d98b5d9c710c5c2f872521016cf1b3e2151f299) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where postgres would throw an error if no handlers were registered

## 0.0.32

### Patch Changes

- [#101](https://github.com/0xOlias/ponder/pull/101) [`08d5157`](https://github.com/0xOlias/ponder/commit/08d515796b8a737a9f5c4210aefcc89e879a8a7e) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed notion of plugins

  Moved HTTP server from `@ponder/graphql` to `@ponder/core`

  **BREAKING**. Ponder apps no longer depend on `@ponder/graphql` and do not need to include the `plugins` key in `ponder.config.ts`.

  For now, this also means that the only way to configure the server port is through the $port environment variable.

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
