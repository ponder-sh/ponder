# create-ponder

## 0.0.53

## 0.0.52

## 0.0.51

## 0.0.50

## 0.0.49

## 0.0.48

## 0.0.47

### Patch Changes

- [#137](https://github.com/0xOlias/ponder/pull/137) [`5e59712`](https://github.com/0xOlias/ponder/commit/5e59712b50fc2e535ac83ad9acc24df2e305222d) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated Subgraph templates to automatically convert `ID` to `String` and `BigDecimal` to `Float`.

## 0.0.46

## 0.0.45

## 0.0.44

## 0.0.43

## 0.0.42

## 0.0.41

## 0.0.40

### Patch Changes

- [#123](https://github.com/0xOlias/ponder/pull/123) [`9d6f820`](https://github.com/0xOlias/ponder/commit/9d6f820e9d0d1815aa6ebf7b001c0a3139c58f7c) Thanks [@0xOlias](https://github.com/0xOlias)! - Migrated to viem and added `@/generated` alias in generated handler code

## 0.0.39

### Patch Changes

- [`636f205`](https://github.com/0xOlias/ponder/commit/636f2051f6e1591fb14158d7b46d063343aa6e5e) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed script path bug

## 0.0.38

### Patch Changes

- [#118](https://github.com/0xOlias/ponder/pull/118) [`84b4ca0`](https://github.com/0xOlias/ponder/commit/84b4ca0b7e3b4e73ff6daa8c317b48a22b4ca652) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated package exports to include cjs and esm

## 0.0.37

### Patch Changes

- [#114](https://github.com/0xOlias/ponder/pull/114) [`857f099`](https://github.com/0xOlias/ponder/commit/857f0997263e9c816bc6ad2695d9a03bcf269672) Thanks [@0xOlias](https://github.com/0xOlias)! - Refactored @ponder/core internals and updated `ponder dev` logs

## 0.0.19

### Patch Changes

- [#110](https://github.com/0xOlias/ponder/pull/110) [`754f8dd`](https://github.com/0xOlias/ponder/commit/754f8dd019039dfe306a2b3796621089de5d39c7) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `--from-subgraph-id` option, renamed `--from-subgraph` to `--from-subgraph-repo`, and added `prompts`

## 0.0.18

### Patch Changes

- [#101](https://github.com/0xOlias/ponder/pull/101) [`08d5157`](https://github.com/0xOlias/ponder/commit/08d515796b8a737a9f5c4210aefcc89e879a8a7e) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed plugins from generated code

## 0.0.17

### Patch Changes

- [#89](https://github.com/0xOlias/ponder/pull/89) [`e3ba756`](https://github.com/0xOlias/ponder/commit/e3ba756eed30aa7c4427d2ff6b22b5f07152bcc3) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where array types could not be persisted

## 0.0.16

### Patch Changes

- [#85](https://github.com/0xOlias/ponder/pull/85) [`ce8d773`](https://github.com/0xOlias/ponder/commit/ce8d773e5a6fff665cdea2f3936d7b0e9df6c128) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed handler file gen to use event names instead of signatures

## 0.0.15

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

- [#72](https://github.com/0xOlias/ponder/pull/72) [`df3ec60`](https://github.com/0xOlias/ponder/commit/df3ec601852556be788335c016c99710c4277487) Thanks [@0xOlias](https://github.com/0xOlias)! - **BREAKING** Changes ponder config naming.

  1. The ponder config file was changed (back) to `ponder.config.ts`.
  2. The `sources` field in `ponder.config.ts` was changes to `contracts`.

## 0.0.14

### Patch Changes

- [`6d613c4`](https://github.com/0xOlias/ponder/commit/6d613c4ad5d88e0e358499125115e4b90a32a58a) Thanks [@0xOlias](https://github.com/0xOlias)! - Fix node types

## 0.0.13

### Patch Changes

- [#65](https://github.com/0xOlias/ponder/pull/65) [`6141376`](https://github.com/0xOlias/ponder/commit/61413763a2660eb240bd50e8d4e0044906fafa98) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed `--from-etherscan` option for testnets

## 0.0.12

### Patch Changes

- [#57](https://github.com/0xOlias/ponder/pull/57) [`3f358dd`](https://github.com/0xOlias/ponder/commit/3f358dddbcb4c0f7dfe427a9db847bd2388be019) Thanks [@0xOlias](https://github.com/0xOlias)! - Generate ponder.ts according to new format from @ponder/core

## 0.0.11

### Patch Changes

- [#58](https://github.com/0xOlias/ponder/pull/58) [`227d3bf`](https://github.com/0xOlias/ponder/commit/227d3bf2c1cb64af0ae55f206e932b350965fff9) Thanks [@0xOlias](https://github.com/0xOlias)! - fix path to package json
