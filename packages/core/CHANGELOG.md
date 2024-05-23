# @ponder/core

## 0.4.30

### Patch Changes

- [#873](https://github.com/ponder-sh/ponder/pull/873) [`3335dc2d3c2fd48d6279feed8cb24489c69ba3e5`](https://github.com/ponder-sh/ponder/commit/3335dc2d3c2fd48d6279feed8cb24489c69ba3e5) Thanks [@sinasab](https://github.com/sinasab)! - Exported config helper types: `ContractConfig`, `NetworkConfig`, `BlockConfig`, and `DatabaseConfig`.

## 0.4.29

### Patch Changes

- [`48b4176f2aec79ef74a62e88eaf3bb4ecfcfcb2e`](https://github.com/ponder-sh/ponder/commit/48b4176f2aec79ef74a62e88eaf3bb4ecfcfcb2e) Thanks [@0xOlias](https://github.com/0xOlias)! - Bumped `better-sqlite3` from `9.1.1` to `10.0.0` which added prebuilt binaries for Node.js 22. This fixes a bug where builds on Railway (using Nixpacks `>=1.22.0`) failed while attempting to build `better-sqlite3` from source.

- [`c596b4c45224e0e5de84e021096b09730c351dba`](https://github.com/ponder-sh/ponder/commit/c596b4c45224e0e5de84e021096b09730c351dba) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where `updateMany` store method calls were not batched properly. Now `updateMany` follows the same batch size limit as `createMany` (1000).

## 0.4.28

### Patch Changes

- [#892](https://github.com/ponder-sh/ponder/pull/892) [`0c6901f266635e9bd4e96dab00b3e2af892ec584`](https://github.com/ponder-sh/ponder/commit/0c6901f266635e9bd4e96dab00b3e2af892ec584) Thanks [@kyscott18](https://github.com/kyscott18)! - Increased RPC request & database query retry threshold from 4 attempts over 2 seconds to 10 attempts over 1 minute.

- [#898](https://github.com/ponder-sh/ponder/pull/898) [`a2286b06292c20b0fc77aef5cd845cc27f3bad43`](https://github.com/ponder-sh/ponder/commit/a2286b06292c20b0fc77aef5cd845cc27f3bad43) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue causing apps using custom indexes to crash with the error: `Database error during 'createIndexes' ... [index] already exists`.

- [#892](https://github.com/ponder-sh/ponder/pull/892) [`0c6901f266635e9bd4e96dab00b3e2af892ec584`](https://github.com/ponder-sh/ponder/commit/0c6901f266635e9bd4e96dab00b3e2af892ec584) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where certain RPC errors were incorrectly marked as non-retryable.

## 0.4.27

### Patch Changes

- [#893](https://github.com/ponder-sh/ponder/pull/893) [`d0ec6b3022f8a3463bfdd41d100c178242c11d1c`](https://github.com/ponder-sh/ponder/commit/d0ec6b3022f8a3463bfdd41d100c178242c11d1c) Thanks [@kyscott18](https://github.com/kyscott18)! - Added a JSON column type with `p.json()`.

- Updated dependencies [[`9d64a31a527914145c86b0c8e43b9d185e35a1e1`](https://github.com/ponder-sh/ponder/commit/9d64a31a527914145c86b0c8e43b9d185e35a1e1)]:
  - @ponder/utils@0.1.5

## 0.4.26

### Patch Changes

- [#890](https://github.com/ponder-sh/ponder/pull/890) [`3e4a6387d46b35cb73c123ad210ba28f09a0d883`](https://github.com/ponder-sh/ponder/commit/3e4a6387d46b35cb73c123ad210ba28f09a0d883) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug introduced in 0.4.25 where call traces with an 'out of gas' error could not be inserted into the database.

## 0.4.25

### Patch Changes

- [#867](https://github.com/ponder-sh/ponder/pull/867) [`e5498ad304a7bc54ccdd8b91327d431b15af388b`](https://github.com/ponder-sh/ponder/commit/e5498ad304a7bc54ccdd8b91327d431b15af388b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for call trace indexing. [See the docs for more details](https://ponder.sh/docs/indexing/call-traces).

## 0.4.24

### Patch Changes

- [`793483c4a4defd8653c8dc67176a95f2a0d7e4bc`](https://github.com/ponder-sh/ponder/commit/793483c4a4defd8653c8dc67176a95f2a0d7e4bc) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with the "has" condition in the "findMany" function and graphQL affecting "hex" and "bigint" list columns.

## 0.4.23

### Patch Changes

- [#880](https://github.com/ponder-sh/ponder/pull/880) [`10e25480e862b7ffc8ad184c85a773d85d375f64`](https://github.com/ponder-sh/ponder/commit/10e25480e862b7ffc8ad184c85a773d85d375f64) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved realtime detection for invalid "eth_getLogs" responses by comparing response length with a block's bloom filter.

## 0.4.22

### Patch Changes

- [`91e6328c2bb9b8c80d1afbdc0f4ba545b768f2ed`](https://github.com/ponder-sh/ponder/commit/91e6328c2bb9b8c80d1afbdc0f4ba545b768f2ed) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where some historical sync logs would be duplicated when using `ponder start`.

- [#871](https://github.com/ponder-sh/ponder/pull/871) [`7c60c0cb10eb7093b33bde24e9842b54ded458ad`](https://github.com/ponder-sh/ponder/commit/7c60c0cb10eb7093b33bde24e9842b54ded458ad) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a logger bug that caused a memory leak during historical indexing that could crash large apps when the sync is fully cached. Stopped writing logs to files in the `.ponder/logs` directory.

## 0.4.21

### Patch Changes

- [#852](https://github.com/ponder-sh/ponder/pull/852) [`b16ab1ac805a418614eb87ea2b16f06394bd67e0`](https://github.com/ponder-sh/ponder/commit/b16ab1ac805a418614eb87ea2b16f06394bd67e0) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for database indexes using the `p.index()` function in `ponder.schema.ts`. [Read more](https://ponder.sh/docs/schema#indexes).

## 0.4.20

### Patch Changes

- [#863](https://github.com/ponder-sh/ponder/pull/863) [`3f46d9e1303c178dc3da9839675a4e52f1d7adea`](https://github.com/ponder-sh/ponder/commit/3f46d9e1303c178dc3da9839675a4e52f1d7adea) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a regression introduced in 0.4.15 that caused apps using SQLite to encounter errors like `NOT NULL constraint failed: blocks.mixHash` when using chains that do not include all properties on the RPC block object.

- [#860](https://github.com/ponder-sh/ponder/pull/860) [`e07956a9f1c0117e6b27aee6ea9c06ca2217b4c5`](https://github.com/ponder-sh/ponder/commit/e07956a9f1c0117e6b27aee6ea9c06ca2217b4c5) Thanks [@kyscott18](https://github.com/kyscott18)! - Increased realtime sync retry threshold. Now, realtime sync errors will continue retrying for 10 minutes before throwing a fatal error. This improves stability when using RPC providers that are slow to index block hashes for [EIP-234](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-234.md) requests.

- [#865](https://github.com/ponder-sh/ponder/pull/865) [`ba16f324f8b591d57714320c01f10d46497c8894`](https://github.com/ponder-sh/ponder/commit/ba16f324f8b591d57714320c01f10d46497c8894) Thanks [@0xOlias](https://github.com/0xOlias)! - Added GraphQL operation validations for max token count (1000).

## 0.4.19

### Patch Changes

- [#853](https://github.com/ponder-sh/ponder/pull/853) [`19eef7b5873a4786e03d83ff2205f2e1bf86d2c6`](https://github.com/ponder-sh/ponder/commit/19eef7b5873a4786e03d83ff2205f2e1bf86d2c6) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the `maxHealthcheckDuration` option in `ponder.config.ts` was not being used. Removed support for setting the max healthcheck duration using the `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` environment variable (Railway no longer provides this variable).

- [#853](https://github.com/ponder-sh/ponder/pull/853) [`19eef7b5873a4786e03d83ff2205f2e1bf86d2c6`](https://github.com/ponder-sh/ponder/commit/19eef7b5873a4786e03d83ff2205f2e1bf86d2c6) Thanks [@0xOlias](https://github.com/0xOlias)! - Added GraphQL operation validations for max depth (100) and max number of aliases (30).

## 0.4.18

### Patch Changes

- [#857](https://github.com/ponder-sh/ponder/pull/857) [`e6638f38d24498a61c0d26fae99800ada3f85696`](https://github.com/ponder-sh/ponder/commit/e6638f38d24498a61c0d26fae99800ada3f85696) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug introduced in 0.4.15 where the initial build would sometimes fail with an "Maximum call stack size exceeded" error.

## 0.4.17

### Patch Changes

- [#855](https://github.com/ponder-sh/ponder/pull/855) [`92c99c45302c490708fcf0753096be72527ff640`](https://github.com/ponder-sh/ponder/commit/92c99c45302c490708fcf0753096be72527ff640) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a type-level bug with the utility type "Context".

## 0.4.16

### Patch Changes

- [#831](https://github.com/ponder-sh/ponder/pull/831) [`273079c40ebd3f7e68afc14fe534e134519c4c03`](https://github.com/ponder-sh/ponder/commit/273079c40ebd3f7e68afc14fe534e134519c4c03) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for block event indexing. For more details, please [visit the documentation](https://ponder.sh/block-events).

## 0.4.15

### Patch Changes

- [#848](https://github.com/ponder-sh/ponder/pull/848) [`94710535352d27d9ae877e8bb548a662e179d972`](https://github.com/ponder-sh/ponder/commit/94710535352d27d9ae877e8bb548a662e179d972) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved crash recovery mechanism. Now, when using `ponder start`, a restarted Ponder app (running the same code) will attempt to continue indexing where it previously left off.

## 0.4.14

### Patch Changes

- [`02068e48a1e50441643e456b85523038e9b9fdfe`](https://github.com/ponder-sh/ponder/commit/02068e48a1e50441643e456b85523038e9b9fdfe) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where failed RPC requests were being logged as an error even when they were retried and ultimately succeeded.

- [#846](https://github.com/ponder-sh/ponder/pull/846) [`e73bcb06f10b7c166db2a826d79a1d642fbd48da`](https://github.com/ponder-sh/ponder/commit/e73bcb06f10b7c166db2a826d79a1d642fbd48da) Thanks [@0xOlias](https://github.com/0xOlias)! - Added HTTP server metrics. Fixed a bug where the `ponder_indexing_completed_timestamp` and `ponder_realtime_is_connected` metrics were no longer being updated. Renamed `ponder_server_port` to `ponder_http_server_port`. Updated histogram metric bucket ranges.

- [#844](https://github.com/ponder-sh/ponder/pull/844) [`4f2c5d73fe4151afa9566a041b12d245e9133593`](https://github.com/ponder-sh/ponder/commit/4f2c5d73fe4151afa9566a041b12d245e9133593) Thanks [@0xOlias](https://github.com/0xOlias)! - Added a `poolConfig` option to `ponder.config.ts`. This option overrides the default [`PoolConfig`](https://node-postgres.com/apis/pool) used when constructing the `node-postgres` connection pool.

## 0.4.13

### Patch Changes

- [#838](https://github.com/ponder-sh/ponder/pull/838) [`b6d7f2189c4171a4d9f5bb10c2e1f022af2b8d3b`](https://github.com/ponder-sh/ponder/commit/b6d7f2189c4171a4d9f5bb10c2e1f022af2b8d3b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a regression introduced in `0.4.9` where `update` operations during historical indexing would fail with errors like `relation does not exist` or `column "columnName" of relation "TableName"` does not exist.

## 0.4.12

### Patch Changes

- [#834](https://github.com/ponder-sh/ponder/pull/834) [`12b3e2178aea5c72605d5125fac515a4b42eeeb2`](https://github.com/ponder-sh/ponder/commit/12b3e2178aea5c72605d5125fac515a4b42eeeb2) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where calling `update` or `upsert` with an empty update would throw a "RecordNotFound" store error instead of a no-op.

## 0.4.11

### Patch Changes

- [#830](https://github.com/ponder-sh/ponder/pull/830) [`1a445678cc59dc8e1f1c34b978e3551a3172c951`](https://github.com/ponder-sh/ponder/commit/1a445678cc59dc8e1f1c34b978e3551a3172c951) Thanks [@ChiTimesChi](https://github.com/ChiTimesChi)! - Added the network name to the historical sync log message and inserted missing commas in logs that contain more than one variable.

## 0.4.10

### Patch Changes

- [#828](https://github.com/ponder-sh/ponder/pull/828) [`7c17975f0710ce1531a2d9412b180e4b96ccb733`](https://github.com/ponder-sh/ponder/commit/7c17975f0710ce1531a2d9412b180e4b96ccb733) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the dev server would often crash with the error "The database connection is not open" when using SQLite or "Cannot use a pool after calling end on the pool" when using Postgres.

- [#828](https://github.com/ponder-sh/ponder/pull/828) [`7c17975f0710ce1531a2d9412b180e4b96ccb733`](https://github.com/ponder-sh/ponder/commit/7c17975f0710ce1531a2d9412b180e4b96ccb733) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved error messages for SQL constraint violations (unique, not-null, and no record found during an update).

## 0.4.9

### Patch Changes

- [#824](https://github.com/ponder-sh/ponder/pull/824) [`7c8edb3e184d4c73a766127320f556658e812977`](https://github.com/ponder-sh/ponder/commit/7c8edb3e184d4c73a766127320f556658e812977) Thanks [@kyscott18](https://github.com/kyscott18)! - Removed retries for indexing functions in favor of better retry behavior for RPC requests and database queries. To achieve the same behavior as before, add retry logic to any code that could produce occasional errors (HTTP requests).

- [#824](https://github.com/ponder-sh/ponder/pull/824) [`7c8edb3e184d4c73a766127320f556658e812977`](https://github.com/ponder-sh/ponder/commit/7c8edb3e184d4c73a766127320f556658e812977) Thanks [@kyscott18](https://github.com/kyscott18)! - ~50% faster historical indexing by skipping unnecessary database writes to reorg reconciliation tables. Realtime indexing speed is unaffected.

- [#823](https://github.com/ponder-sh/ponder/pull/823) [`344a3543839f20f19e072a8fc14d859ea2d7fc61`](https://github.com/ponder-sh/ponder/commit/344a3543839f20f19e072a8fc14d859ea2d7fc61) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for including transaction receipts (`event.transactionReceipt`). To enable transaction receipts for all events on a contract, set `includeTransactionReceipts: true` on the contract config. Receipts can be specified/overriden on a per-network basis. Note that including receipts may slow down the historical sync due to additional `eth_getTransactionReceipt` RPC requests.

## 0.4.8

### Patch Changes

- [#802](https://github.com/ponder-sh/ponder/pull/802) [`6a929eccb999b85d855f93720b65ff5e3a1a2d9c`](https://github.com/ponder-sh/ponder/commit/6a929eccb999b85d855f93720b65ff5e3a1a2d9c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed several bugs related to realtime reliability including handling reorgs when the head block number goes backwards commonly occurring in Polygon and inconsistent data returned by "eth_getLogs".

## 0.4.7

### Patch Changes

- [#806](https://github.com/ponder-sh/ponder/pull/806) [`398939198f5edcf9328410e5930f1ebc207ea502`](https://github.com/ponder-sh/ponder/commit/398939198f5edcf9328410e5930f1ebc207ea502) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for Windows via PowerShell and command prompt (cmd.exe).

- Updated dependencies [[`2d9fcbae895b1c7388683fec5c0f36999ead29ce`](https://github.com/ponder-sh/ponder/commit/2d9fcbae895b1c7388683fec5c0f36999ead29ce)]:
  - @ponder/utils@0.1.4

## 0.4.6

### Patch Changes

- Updated dependencies [[`db106f5ffc302f1a02dcb54f31432420fae3c3cc`](https://github.com/ponder-sh/ponder/commit/db106f5ffc302f1a02dcb54f31432420fae3c3cc)]:
  - @ponder/utils@0.1.3

## 0.4.5

### Patch Changes

- [#808](https://github.com/ponder-sh/ponder/pull/808) [`b59fda228f3a95702550adf9f86f81f401109b6b`](https://github.com/ponder-sh/ponder/commit/b59fda228f3a95702550adf9f86f81f401109b6b) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression causing indexing overloaded events to error.

- [#805](https://github.com/ponder-sh/ponder/pull/805) [`0873d31163aed8cb16012088735389d7452e3eaf`](https://github.com/ponder-sh/ponder/commit/0873d31163aed8cb16012088735389d7452e3eaf) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where logs for factory contracts would sometimes be fetched twice. This caused an error for some projects using factory contracts.

## 0.4.4

### Patch Changes

- [`182d47e1a8ea9b8c1a742cbe987509f1aea5c3b7`](https://github.com/ponder-sh/ponder/commit/182d47e1a8ea9b8c1a742cbe987509f1aea5c3b7) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved performance of sync migrations introduced in 0.4.0.

## 0.4.3

### Patch Changes

- [#799](https://github.com/ponder-sh/ponder/pull/799) [`f526c79ceeee880df611ed592de06e7fb3146af5`](https://github.com/ponder-sh/ponder/commit/f526c79ceeee880df611ed592de06e7fb3146af5) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for Harmony by updating the "totalDifficulty" block property to be nullable.

## 0.4.2

### Patch Changes

- [#795](https://github.com/ponder-sh/ponder/pull/795) [`23db73ee6e7984976d2d7888026fbf7513cbbada`](https://github.com/ponder-sh/ponder/commit/23db73ee6e7984976d2d7888026fbf7513cbbada) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where child contract creation events that are also being indexed via a normal contract would sometimes not be processed.

- [#795](https://github.com/ponder-sh/ponder/pull/795) [`23db73ee6e7984976d2d7888026fbf7513cbbada`](https://github.com/ponder-sh/ponder/commit/23db73ee6e7984976d2d7888026fbf7513cbbada) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where including a factory contract in `ponder.config.ts` without registering an indexing function for every event that it emits would throw an error.

- [#795](https://github.com/ponder-sh/ponder/pull/795) [`23db73ee6e7984976d2d7888026fbf7513cbbada`](https://github.com/ponder-sh/ponder/commit/23db73ee6e7984976d2d7888026fbf7513cbbada) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where transaction and log insertion during the realtime sync was not using a bulk insert. This improves realtime indexing latency, particularly for apps with many matched transactions and logs per block in realtime.

## 0.4.1

### Patch Changes

- [#791](https://github.com/ponder-sh/ponder/pull/791) [`c1f93cc5ced3ece9ae46e87f05c1decdb92dba8b`](https://github.com/ponder-sh/ponder/commit/c1f93cc5ced3ece9ae46e87f05c1decdb92dba8b) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where reorgs would occasionally cause the process to exit.

## 0.4.0

### Minor Changes

- [#770](https://github.com/ponder-sh/ponder/pull/770) [`85a5e03e17a00554f1977f4c761ebb100bc5ea3f`](https://github.com/ponder-sh/ponder/commit/85a5e03e17a00554f1977f4c761ebb100bc5ea3f) Thanks [@kyscott18](https://github.com/kyscott18)! - _BREAKING_. Updated location of database tables for direct SQL. Please read the [guide](https://ponder.sh/docs/query/direct-sql) for more information.

- [#770](https://github.com/ponder-sh/ponder/pull/770) [`85a5e03e17a00554f1977f4c761ebb100bc5ea3f`](https://github.com/ponder-sh/ponder/commit/85a5e03e17a00554f1977f4c761ebb100bc5ea3f) Thanks [@kyscott18](https://github.com/kyscott18)! - _BREAKING_. Removed support for time-travel queries. Please read the [time-series guide](https://ponder.sh/docs/indexing/time-series) to learn about alternative patterns.

### Patch Changes

- [#770](https://github.com/ponder-sh/ponder/pull/770) [`85a5e03e17a00554f1977f4c761ebb100bc5ea3f`](https://github.com/ponder-sh/ponder/commit/85a5e03e17a00554f1977f4c761ebb100bc5ea3f) Thanks [@kyscott18](https://github.com/kyscott18)! - Added a `checkpoint` column to the internal `logs` table, which speeds up the internal `getEvents` query by ~6x. Apps with many contracts will see the greatest gains.

- [#770](https://github.com/ponder-sh/ponder/pull/770) [`85a5e03e17a00554f1977f4c761ebb100bc5ea3f`](https://github.com/ponder-sh/ponder/commit/85a5e03e17a00554f1977f4c761ebb100bc5ea3f) Thanks [@kyscott18](https://github.com/kyscott18)! - Migrated the HTTP server from Express to Hono.

## 0.3.11

### Patch Changes

- [#778](https://github.com/ponder-sh/ponder/pull/778) [`c55fdd1f0199d6bfd70e21774042a8741a5cecfa`](https://github.com/ponder-sh/ponder/commit/c55fdd1f0199d6bfd70e21774042a8741a5cecfa) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where GraphQL queries that include a many -> `p.one()` path with a limit greater than 50 would fail with the error: "Cannot return null for non-nullable field".

## 0.3.10

### Patch Changes

- [#775](https://github.com/ponder-sh/ponder/pull/775) [`334f4c2b2fcbdaa0ad66f61ccd4f3a64cd74a6bc`](https://github.com/ponder-sh/ponder/commit/334f4c2b2fcbdaa0ad66f61ccd4f3a64cd74a6bc) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for the `getEnsName` Viem action in `context.client`.

## 0.3.9

### Patch Changes

- [#765](https://github.com/ponder-sh/ponder/pull/765) [`3f9c52f3b00bc10bf7b581616e0acb550a1598b9`](https://github.com/ponder-sh/ponder/commit/3f9c52f3b00bc10bf7b581616e0acb550a1598b9) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where some error messages and stack traces were not logged if the initial build failed.

- [#763](https://github.com/ponder-sh/ponder/pull/763) [`80b8e26b7b138ed4b0e84af16e203013580f5b0c`](https://github.com/ponder-sh/ponder/commit/80b8e26b7b138ed4b0e84af16e203013580f5b0c) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Fixed a bug where malformed requests to the `/metrics` path could cause the process to exit.

## 0.3.8

## 0.3.7

### Patch Changes

- [#754](https://github.com/ponder-sh/ponder/pull/754) [`395196b6ca802e77fc49145b2a6d26fdbed48973`](https://github.com/ponder-sh/ponder/commit/395196b6ca802e77fc49145b2a6d26fdbed48973) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where certain errors encountered during the initial build were not printed to the console.

## 0.3.6

### Patch Changes

- [#748](https://github.com/ponder-sh/ponder/pull/748) [`5f624562aa8b63116182bc6d482ddf6740040f5e`](https://github.com/ponder-sh/ponder/commit/5f624562aa8b63116182bc6d482ddf6740040f5e) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where GraphQL `where` arguments that specify multiple conditions for the same field would only apply the last condition.

- [#743](https://github.com/ponder-sh/ponder/pull/743) [`261457c06750c116717e8ed4a8b51f0d71dc352f`](https://github.com/ponder-sh/ponder/commit/261457c06750c116717e8ed4a8b51f0d71dc352f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed compatibility with chains that don't have a "logsBloom" in blocks.

## 0.3.5

### Patch Changes

- [#718](https://github.com/ponder-sh/ponder/pull/718) [`bc5e0165c825967e04f6fa3f7a48f53002364c4c`](https://github.com/ponder-sh/ponder/commit/bc5e0165c825967e04f6fa3f7a48f53002364c4c) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed hot reloading bugs. Now, the dev server shuts down the previous instance entirely before starting the new one. This should eliminate warnings and errors regarding use of stale database resources, and ensure that the dev server responds as expected to `SIGINT` (keyboard ctrl+c).

- [#730](https://github.com/ponder-sh/ponder/pull/730) [`2deab640fa5979aa4bab6123a4f7fb7ed2059bec`](https://github.com/ponder-sh/ponder/commit/2deab640fa5979aa4bab6123a4f7fb7ed2059bec) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated block finality for Ethereum and Polygon, fixing some known errors with large reorgs being detected.

- [#718](https://github.com/ponder-sh/ponder/pull/718) [`bc5e0165c825967e04f6fa3f7a48f53002364c4c`](https://github.com/ponder-sh/ponder/commit/bc5e0165c825967e04f6fa3f7a48f53002364c4c) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the process would sometimes not exit when it encountered a fatal error. Now, if there is a fatal error, the process will attempt a graceful shutdown and then exit. If the graceful shutdown does not finish within 5 seconds, the process will forcefully exit with code 1.

- Updated dependencies [[`464a98f1500815739a3384e6b34eb05aaf0c0253`](https://github.com/ponder-sh/ponder/commit/464a98f1500815739a3384e6b34eb05aaf0c0253)]:
  - @ponder/utils@0.1.2

## 0.3.4

### Patch Changes

- [#723](https://github.com/ponder-sh/ponder/pull/723) [`84b981ebfed6b6ea4707504da230aaaa7f59515f`](https://github.com/ponder-sh/ponder/commit/84b981ebfed6b6ea4707504da230aaaa7f59515f) Thanks [@kyscott18](https://github.com/kyscott18)! - Relaxed not null constraint for SQLite, which fixes zkSync.

- [#715](https://github.com/ponder-sh/ponder/pull/715) [`7e00af94777690c95cd7936b9ed9978d074b1b95`](https://github.com/ponder-sh/ponder/commit/7e00af94777690c95cd7936b9ed9978d074b1b95) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed issue with too large eth_getLogs calls not always being properly retried.

- [#727](https://github.com/ponder-sh/ponder/pull/727) [`3fca36582ce8e1a7bcd54cbe331a4f8e7d210ec5`](https://github.com/ponder-sh/ponder/commit/3fca36582ce8e1a7bcd54cbe331a4f8e7d210ec5) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Updated datatypes for p.float columns in postgres to double and sqlite to real. Note that this busts the indexing cache

- Updated dependencies [[`fe99c31a100acfc602cc511a15b1f625e034c29e`](https://github.com/ponder-sh/ponder/commit/fe99c31a100acfc602cc511a15b1f625e034c29e)]:
  - @ponder/utils@0.1.1

## 0.3.3

### Patch Changes

- [#709](https://github.com/ponder-sh/ponder/pull/709) [`eebb173d42307df060e348fea78ba2dffdfdd2b1`](https://github.com/ponder-sh/ponder/commit/eebb173d42307df060e348fea78ba2dffdfdd2b1) Thanks [@d-mooers](https://github.com/d-mooers)! - Made block.sha3Uncles column nullable

- [#693](https://github.com/ponder-sh/ponder/pull/693) [`a8b2a59ba565a01d46cbde115b6a163c626afc41`](https://github.com/ponder-sh/ponder/commit/a8b2a59ba565a01d46cbde115b6a163c626afc41) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Fixed a regression that may have caused bugs related to indexing progress or event ordering.

- [#711](https://github.com/ponder-sh/ponder/pull/711) [`8d12d0a23a88ccef4d6a20d5f1e8590798c1004e`](https://github.com/ponder-sh/ponder/commit/8d12d0a23a88ccef4d6a20d5f1e8590798c1004e) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for `ponder serve` a new CLI command that runs the GraphQL API server as a standalone process. This is useful for horizontally scaling the API layer of a Ponder app. See the [horizontal scaling](https://ponder.sh/docs/production/horizontal-scaling) docs for more information.

- [#710](https://github.com/ponder-sh/ponder/pull/710) [`9b0824b120b86dcceb73edc1f562d77ba3af36c3`](https://github.com/ponder-sh/ponder/commit/9b0824b120b86dcceb73edc1f562d77ba3af36c3) Thanks [@kyscott18](https://github.com/kyscott18)! - Moved "false positive logs bloom filter result" from warn to debug log level.

- [#713](https://github.com/ponder-sh/ponder/pull/713) [`e858c0e6c5faebdc35e2715be5f170073add6259`](https://github.com/ponder-sh/ponder/commit/e858c0e6c5faebdc35e2715be5f170073add6259) Thanks [@kyscott18](https://github.com/kyscott18)! - Allowed for null r, s, and v transaction properties, which is possible on zkSync.

- [#711](https://github.com/ponder-sh/ponder/pull/711) [`8d12d0a23a88ccef4d6a20d5f1e8590798c1004e`](https://github.com/ponder-sh/ponder/commit/8d12d0a23a88ccef4d6a20d5f1e8590798c1004e) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where SQLite raw tables were not prefixed with "_raw_". Note that upgrading to this version changes the SQLite database structure to be incompatible with prior versions.

## 0.3.2

### Patch Changes

- [#692](https://github.com/ponder-sh/ponder/pull/692) [`5d6b541dd4a3bda979d26bb38754b77209674a98`](https://github.com/ponder-sh/ponder/commit/5d6b541dd4a3bda979d26bb38754b77209674a98) Thanks [@kyscott18](https://github.com/kyscott18)! - Re-exported `rateLimit` and `loadBalance` from `@ponder/utils`.

- Updated dependencies [[`5d6b541dd4a3bda979d26bb38754b77209674a98`](https://github.com/ponder-sh/ponder/commit/5d6b541dd4a3bda979d26bb38754b77209674a98)]:
  - @ponder/utils@0.1.0

## 0.3.1

### Patch Changes

- [#701](https://github.com/ponder-sh/ponder/pull/701) [`bcc52adabc888cf476107a8074b6bdcb28d6e7c7`](https://github.com/ponder-sh/ponder/commit/bcc52adabc888cf476107a8074b6bdcb28d6e7c7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed bugs where the realtime sync would: incorrectly report reorgs with a very large depth, call `eth_getLogs` with `fromBlock > toBlock`, and skip events if the RPC returned logs out of order. Improved realtime sync debug logging.

## 0.3.0

### Minor Changes

- [#640](https://github.com/ponder-sh/ponder/pull/640) [`81d4a9bb537fa2611656e0c708724390acb79f3a`](https://github.com/ponder-sh/ponder/commit/81d4a9bb537fa2611656e0c708724390acb79f3a) Thanks [@kyscott18](https://github.com/kyscott18)! - Direct SQL. Public indexing tables (to be accessed directly) are created in the 'ponder' schema. Cached indexing tables are created in the 'ponder_cache' schema. Added migration script to move sync tables from 'public' to 'ponder_sync' schema. Private indexing tables use a numeric suffix like `ponder_instance_2' and are created/removed automatically. Please see the direct SQL docs for more information (https://ponder.sh/docs/guides/query-the-database).

### Patch Changes

- [#640](https://github.com/ponder-sh/ponder/pull/640) [`81d4a9bb537fa2611656e0c708724390acb79f3a`](https://github.com/ponder-sh/ponder/commit/81d4a9bb537fa2611656e0c708724390acb79f3a) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved database error retry behavior.

## 0.2.18

### Patch Changes

- [#698](https://github.com/ponder-sh/ponder/pull/698) [`e57f10dbf08f78e6569f35c7d0b47dce6ff480ce`](https://github.com/ponder-sh/ponder/commit/e57f10dbf08f78e6569f35c7d0b47dce6ff480ce) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for specifying a custom `blockNumber` in `context.client` actions.

## 0.2.17

### Patch Changes

- [#694](https://github.com/ponder-sh/ponder/pull/694) [`9e0c0f73c2066b623c21d4027a8cf11c7d6381be`](https://github.com/ponder-sh/ponder/commit/9e0c0f73c2066b623c21d4027a8cf11c7d6381be) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where contracts that specify multiple addresses or use a custom filter with multiple events would not be cached properly during the sync.

- [#696](https://github.com/ponder-sh/ponder/pull/696) [`aaf015730aa82398c1e407bd6eeaea145284feb6`](https://github.com/ponder-sh/ponder/commit/aaf015730aa82398c1e407bd6eeaea145284feb6) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where including a contract that specified an `endBlock` would sometimes stall the sync.

- [#696](https://github.com/ponder-sh/ponder/pull/696) [`aaf015730aa82398c1e407bd6eeaea145284feb6`](https://github.com/ponder-sh/ponder/commit/aaf015730aa82398c1e407bd6eeaea145284feb6) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the build service would watch for file changes and execute user code even when using `ponder start`, `ponder serve`, or `ponder codegen`.

- [#694](https://github.com/ponder-sh/ponder/pull/694) [`9e0c0f73c2066b623c21d4027a8cf11c7d6381be`](https://github.com/ponder-sh/ponder/commit/9e0c0f73c2066b623c21d4027a8cf11c7d6381be) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where `NaN` was an allowed value for `startBlock` and `endBlock`. Now, `NaN` values are coerced to `0` and `undefined` respectively.

## 0.2.16

### Patch Changes

- [#688](https://github.com/ponder-sh/ponder/pull/688) [`2a1842e1db2329b1c88c613b0a64ff8c7695e829`](https://github.com/ponder-sh/ponder/commit/2a1842e1db2329b1c88c613b0a64ff8c7695e829) Thanks [@kyscott18](https://github.com/kyscott18)! - Created `@ponder/utils` package. Moved `eth_getLogs` retry helper from `@ponder/core` to `@ponder/utils`.

- [#689](https://github.com/ponder-sh/ponder/pull/689) [`33b0fda4ca3f777fd9a8e1d6f3ca85efb12ec677`](https://github.com/ponder-sh/ponder/commit/33b0fda4ca3f777fd9a8e1d6f3ca85efb12ec677) Thanks [@kyscott18](https://github.com/kyscott18)! - Fix issue with maxHistoricalTaskConcurrency config being ignored.

- Updated dependencies [[`2a1842e1db2329b1c88c613b0a64ff8c7695e829`](https://github.com/ponder-sh/ponder/commit/2a1842e1db2329b1c88c613b0a64ff8c7695e829)]:
  - @ponder/utils@0.0.1

## 0.2.15

### Patch Changes

- [#685](https://github.com/ponder-sh/ponder/pull/685) [`27ba293e402304eb3de50177ecb46a430b8ced9d`](https://github.com/ponder-sh/ponder/commit/27ba293e402304eb3de50177ecb46a430b8ced9d) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed race condition in sync event debounce logic.

## 0.2.14

### Patch Changes

- [#681](https://github.com/ponder-sh/ponder/pull/681) [`1490ac801f646ef5d06694acf2ffda6054966c21`](https://github.com/ponder-sh/ponder/commit/1490ac801f646ef5d06694acf2ffda6054966c21) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved unique constraint violation and checkpoint violation error messages for `create`, `createMany`, `update`, `updateMany`, and `upsert` store methods.

## 0.2.13

### Patch Changes

- [#679](https://github.com/ponder-sh/ponder/pull/679) [`1ab3ff6a20941bdd00d422280714c206642b5e02`](https://github.com/ponder-sh/ponder/commit/1ab3ff6a20941bdd00d422280714c206642b5e02) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Fixed `filename` field in sqlite configuration, previously it was ignored.

## 0.2.12

### Patch Changes

- [#676](https://github.com/ponder-sh/ponder/pull/676) [`695fe00d0a630bab6835889d59221676519c1c87`](https://github.com/ponder-sh/ponder/commit/695fe00d0a630bab6835889d59221676519c1c87) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where paginated queries using `before` did not behave correctly.

## 0.2.11

### Patch Changes

- [#672](https://github.com/ponder-sh/ponder/pull/672) [`3b50ef2891917e3af18f11f48fff9fe6a5f15545`](https://github.com/ponder-sh/ponder/commit/3b50ef2891917e3af18f11f48fff9fe6a5f15545) Thanks [@0xOlias](https://github.com/0xOlias)! - Increased default Postgres statement timeout.

- [#669](https://github.com/ponder-sh/ponder/pull/669) [`41c72adec0c6c039f7e475d7e8aab8a5aa61651e`](https://github.com/ponder-sh/ponder/commit/41c72adec0c6c039f7e475d7e8aab8a5aa61651e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed indexing service event ordering bug.

## 0.2.10

### Patch Changes

- [#667](https://github.com/ponder-sh/ponder/pull/667) [`c3864c967dbd04cc240d0092829e10d49e7eaff0`](https://github.com/ponder-sh/ponder/commit/c3864c967dbd04cc240d0092829e10d49e7eaff0) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated ast-grep to 0.19.3 which fixed support for running Ponder on Alpine Linux-based Docker images.

- [#663](https://github.com/ponder-sh/ponder/pull/663) [`51aa6f7ae8266f5b29ed719aa85d48be1266ba17`](https://github.com/ponder-sh/ponder/commit/51aa6f7ae8266f5b29ed719aa85d48be1266ba17) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed sync-store metrics for Postgres apps.

- [#655](https://github.com/ponder-sh/ponder/pull/655) [`c7d7d3a4982ae162254014c0e2f6b1ec67056d7a`](https://github.com/ponder-sh/ponder/commit/c7d7d3a4982ae162254014c0e2f6b1ec67056d7a) Thanks [@kyscott18](https://github.com/kyscott18)! - Added a warning log when static analysis fails.

- [#662](https://github.com/ponder-sh/ponder/pull/662) [`ef704653d0b124a5fc917ccc160d86ea5cf950d7`](https://github.com/ponder-sh/ponder/commit/ef704653d0b124a5fc917ccc160d86ea5cf950d7) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved indexing performance when loading events from the database.

## 0.2.9

## 0.2.8

### Patch Changes

- [#648](https://github.com/ponder-sh/ponder/pull/648) [`e12bc8ac74a75d4e6e9962987894e107c98a87a3`](https://github.com/ponder-sh/ponder/commit/e12bc8ac74a75d4e6e9962987894e107c98a87a3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed static analysis issue affecting indexing functions using class methods as helper functions.

## 0.2.7

### Patch Changes

- [#636](https://github.com/ponder-sh/ponder/pull/636) [`c10a0b7bff99dd8cd2f38ea0714ff82f5e17f00b`](https://github.com/ponder-sh/ponder/commit/c10a0b7bff99dd8cd2f38ea0714ff82f5e17f00b) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for AND and OR filter operators in the `findMany` store API method and the GraphQL API. Fixed a bug where GraphQL `PageInfo` types were incorrectly marked as nullable.

- [#636](https://github.com/ponder-sh/ponder/pull/636) [`c10a0b7bff99dd8cd2f38ea0714ff82f5e17f00b`](https://github.com/ponder-sh/ponder/commit/c10a0b7bff99dd8cd2f38ea0714ff82f5e17f00b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a time-travel query bug where nested fields in GraphQL queries would not respect the `timestamp` argument passed to the top-level field. Removed the `timestamp` argument from nested `p.many()` fields. Now, use the `timestamp` argument on the top-level field and all nested fields will respect it.

## 0.2.6

### Patch Changes

- [#643](https://github.com/ponder-sh/ponder/pull/643) [`7328e54232cb85d7370c33aba783a2f1f7ef0ab0`](https://github.com/ponder-sh/ponder/commit/7328e54232cb85d7370c33aba783a2f1f7ef0ab0) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with the terminal ui showing "waiting to start..." when one event had been processed

- [#635](https://github.com/ponder-sh/ponder/pull/635) [`6e7d49f0f2ea05558affc996fc2ee83db881880c`](https://github.com/ponder-sh/ponder/commit/6e7d49f0f2ea05558affc996fc2ee83db881880c) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for the `DATABASE_PRIVATE_URL` environment variable. Added info log on startup that includes which database is being used. Added warning for missing `.env.local` file during development. Improved ponder.config.ts validation for misspelled keys.

## 0.2.5

### Patch Changes

- [#637](https://github.com/ponder-sh/ponder/pull/637) [`d055e9cee0dc25dcfaeb48a63dfa9664ec018acd`](https://github.com/ponder-sh/ponder/commit/d055e9cee0dc25dcfaeb48a63dfa9664ec018acd) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue with parsing indexing functions, leading to incorrect ordering

## 0.2.4

### Patch Changes

- [#632](https://github.com/ponder-sh/ponder/pull/632) [`d0c50c2c494c944d80804edc4b40388a86a81a7c`](https://github.com/ponder-sh/ponder/commit/d0c50c2c494c944d80804edc4b40388a86a81a7c) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug with cursor pagination when using a `"desc"` sort order.

- [#632](https://github.com/ponder-sh/ponder/pull/632) [`d0c50c2c494c944d80804edc4b40388a86a81a7c`](https://github.com/ponder-sh/ponder/commit/d0c50c2c494c944d80804edc4b40388a86a81a7c) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where `not` filter conditions were interpreted as `equals`.

## 0.2.3

### Patch Changes

- [#628](https://github.com/ponder-sh/ponder/pull/628) [`44137430aa2eb28aedc294350775f22460bee9a1`](https://github.com/ponder-sh/ponder/commit/44137430aa2eb28aedc294350775f22460bee9a1) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where indexing functions were improperly parsed causing them to be run out of order.

- [#619](https://github.com/ponder-sh/ponder/pull/619) [`506206b0151414cb7e6fc9586b0408a2f5a8ddb3`](https://github.com/ponder-sh/ponder/commit/506206b0151414cb7e6fc9586b0408a2f5a8ddb3) Thanks [@kyscott18](https://github.com/kyscott18)! - Changed realtime sync algorithm to be more efficient in terms of RPC requests/credits. Most notable for networks with fast block times or long polling intervals.

- [#630](https://github.com/ponder-sh/ponder/pull/630) [`cab9167476a11cf1ee4b9ea9d977531d216cf051`](https://github.com/ponder-sh/ponder/commit/cab9167476a11cf1ee4b9ea9d977531d216cf051) Thanks [@0xOlias](https://github.com/0xOlias)! - Hotfixed `ponder serve`.

- [#622](https://github.com/ponder-sh/ponder/pull/622) [`72adc7aca8cb9938ce5344f1a613b653ae072b1b`](https://github.com/ponder-sh/ponder/commit/72adc7aca8cb9938ce5344f1a613b653ae072b1b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `Schema` utility type to `ponder-env.d.ts`. Removed outdated `Infer` and `DatabaseModel` types.

## 0.2.2

### Patch Changes

- [#615](https://github.com/ponder-sh/ponder/pull/615) [`f158a66555bb69710267b43bfaafe499c2f123cd`](https://github.com/ponder-sh/ponder/commit/f158a66555bb69710267b43bfaafe499c2f123cd) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for `tsconfig.json` path aliases using `vite-tsconfig-paths`.

## 0.2.1

### Patch Changes

- [#611](https://github.com/ponder-sh/ponder/pull/611) [`b1f87f5b18004d971693c0a3e38c8a2c36562811`](https://github.com/ponder-sh/ponder/commit/b1f87f5b18004d971693c0a3e38c8a2c36562811) Thanks [@0xOlias](https://github.com/0xOlias)! - Migrated Postgres chain ID columns to use `int8` rather than `int4`. Now, Postgres should behave the same as SQLite and can safely store chain IDs <= `Number.MAX_SAFE_INTEGER`.

- [#613](https://github.com/ponder-sh/ponder/pull/613) [`b9f5db585ee60572c2286833200564d542981abd`](https://github.com/ponder-sh/ponder/commit/b9f5db585ee60572c2286833200564d542981abd) Thanks [@0xOlias](https://github.com/0xOlias)! - Migrated `"blocks.mixHash"` and `"blocks.nonce"` columns to be nullable in both Postgres and SQLite.

## 0.2.0

### Minor Changes

- [#596](https://github.com/ponder-sh/ponder/pull/596) [`ed7b8c7f881386f718e0f61ae863190c7f160953`](https://github.com/ponder-sh/ponder/commit/ed7b8c7f881386f718e0f61ae863190c7f160953) Thanks [@kyscott18](https://github.com/kyscott18)! - (BREAKING) Removed `p.bytes()` in favor of a new `p.hex()` primitive column type. `p.hex()` is suitable for Ethereum addresses and other hex-encoded data, including EVM `bytes` types. `p.hex()` values are stored as `bytea` (Postgres) or `blob` (SQLite). To migrate, replace each occurence of `p.bytes()` in `ponder.schema.ts` with `p.hex()`, and ensure that any values you pass into hex columns are valid hexadecimal strings. The GraphQL API returns `p.hex()` values as hexadecimal strings, and allows sorting/filtering on `p.hex()` columns using the numeric comparison operators (`gt`, `gte`, `le`, `lte`).

- [#596](https://github.com/ponder-sh/ponder/pull/596) [`ed7b8c7f881386f718e0f61ae863190c7f160953`](https://github.com/ponder-sh/ponder/commit/ed7b8c7f881386f718e0f61ae863190c7f160953) Thanks [@kyscott18](https://github.com/kyscott18)! - Released 0.2.0, please see the [migration guide](https://ponder.sh/docs/migration-guide) for details.

- [#596](https://github.com/ponder-sh/ponder/pull/596) [`ed7b8c7f881386f718e0f61ae863190c7f160953`](https://github.com/ponder-sh/ponder/commit/ed7b8c7f881386f718e0f61ae863190c7f160953) Thanks [@kyscott18](https://github.com/kyscott18)! - (BREAKING) Updated the GraphQL API to use cursor pagination instead of offset pagination. Note that this change also affects the `findMany` database method. See the [GraphQL pagination docs](https://ponder.sh/docs/guides/query-the-graphql-api#pagination) for more details.

  ```graphql
  # Before
  query {
    users(offset: 10, limit: 10) {
      id
      name
    }
  }
  # After
  query {
    users(after: "MTA=", limit: 10) {
      items {
        id
        name
      }
      pageInfo {
        hasPreviousPage
        hasNextPage
        starCursor
        endCursor
      }
    }
  }
  ```

## 0.1.9

### Patch Changes

- [`7e87372df15723c45b363d52d4b5b21303bb81c8`](https://github.com/ponder-sh/ponder/commit/7e87372df15723c45b363d52d4b5b21303bb81c8) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed an issue where malformed request headers could cause the server to crash.

## 0.1.8

### Patch Changes

- [#574](https://github.com/ponder-sh/ponder/pull/574) [`9cef6f5bb7a7d3e84e51a377b3d3efd3aa7d9200`](https://github.com/ponder-sh/ponder/commit/9cef6f5bb7a7d3e84e51a377b3d3efd3aa7d9200) Thanks [@kyscott18](https://github.com/kyscott18)! - Added new network option `maxRpcRequestsPerSecond` to limit the number of RPC requests that are made to a transport per second. Deprecated network option `maxHistoricalTaskConcurrency`.

## 0.1.7

### Patch Changes

- [#576](https://github.com/ponder-sh/ponder/pull/576) [`fe200fc942bf3a7b163d25f4ef0f2ce81cf4e921`](https://github.com/ponder-sh/ponder/commit/fe200fc942bf3a7b163d25f4ef0f2ce81cf4e921) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `EventNames`, `Event`, `Context`, and `IndexingFunctionArgs` utility types to `ponder-env.d.ts`. NOTE: After upgrading, Ponder will make a change to your project's `ponder-env.d.ts` file. Please commit this change to version control without editing the file manually.

- [#568](https://github.com/ponder-sh/ponder/pull/568) [`0c5d12a822086d8cbdbc2b0cff520676c0431997`](https://github.com/ponder-sh/ponder/commit/0c5d12a822086d8cbdbc2b0cff520676c0431997) Thanks [@grayleonard](https://github.com/grayleonard)! - Improve telemetry flush handling; Add heartbeat to telemetry service

## 0.1.6

### Patch Changes

- [#572](https://github.com/ponder-sh/ponder/pull/572) [`8bf9730a4c5ace1c10deab04483951ad3d4df6dd`](https://github.com/ponder-sh/ponder/commit/8bf9730a4c5ace1c10deab04483951ad3d4df6dd) Thanks [@kyscott18](https://github.com/kyscott18)! - Removed custom timeout and retry logic for RPC requests. Now, the timeout and retry logic of the user-provided Viem transport will be used.

## 0.1.5

### Patch Changes

- [#549](https://github.com/ponder-sh/ponder/pull/549) [`76c1e9721d784009196548dc468a7a862eb4337e`](https://github.com/ponder-sh/ponder/commit/76c1e9721d784009196548dc468a7a862eb4337e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed peer dependency rules with TypeScript and viem. User versions of these packages are now used.

- [#565](https://github.com/ponder-sh/ponder/pull/565) [`caf12cf27273e761805b091a4549a768ce87d692`](https://github.com/ponder-sh/ponder/commit/caf12cf27273e761805b091a4549a768ce87d692) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the hostname was not set properly for `ponder start` and `ponder serve`.

- [#549](https://github.com/ponder-sh/ponder/pull/549) [`76c1e9721d784009196548dc468a7a862eb4337e`](https://github.com/ponder-sh/ponder/commit/76c1e9721d784009196548dc468a7a862eb4337e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed ponder.config.ts typechecking with older versions of TypeScript. Also, improved abi type inference with ponder config types.

## 0.1.4

### Patch Changes

- [#557](https://github.com/ponder-sh/ponder/pull/557) [`83e2b4a7a05d847832ba60adde361736deeb3b2c`](https://github.com/ponder-sh/ponder/commit/83e2b4a7a05d847832ba60adde361736deeb3b2c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed bug in codegen command caused by undefined codegen service. Also no longer fails silently.

- [#559](https://github.com/ponder-sh/ponder/pull/559) [`ab3b3e544ae0b67937aa11462495b2d5e5f80eb3`](https://github.com/ponder-sh/ponder/commit/ab3b3e544ae0b67937aa11462495b2d5e5f80eb3) Thanks [@0xOlias](https://github.com/0xOlias)! - Added new CLI options `--port`/`-p`, `--hostname`/`-H`, `--debug`/`-v`, and `--trace`/`-vv`. Renamed options `--config-file` to `config` and `--root-dir` to `--root`.

## 0.1.3

### Patch Changes

- [#544](https://github.com/ponder-sh/ponder/pull/544) [`27faea77df50f92424ef8282495b31a2e90f7742`](https://github.com/ponder-sh/ponder/commit/27faea77df50f92424ef8282495b31a2e90f7742) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where contract calls within "setup" indexing functions did not use the correct block number. Now, they use the contract's `startBlock`.

- [#544](https://github.com/ponder-sh/ponder/pull/544) [`27faea77df50f92424ef8282495b31a2e90f7742`](https://github.com/ponder-sh/ponder/commit/27faea77df50f92424ef8282495b31a2e90f7742) Thanks [@0xOlias](https://github.com/0xOlias)! - Added new runtime validations for `ponder.schema.ts`, `ponder.config.ts`, and the indexing function API. Fixed a bug where rapid config reloads caused a race condition that often broke the app during development.

- [#536](https://github.com/ponder-sh/ponder/pull/536) [`4fc9480a53a9f485a4907adc41f495c8a968dcc5`](https://github.com/ponder-sh/ponder/commit/4fc9480a53a9f485a4907adc41f495c8a968dcc5) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the `database` option in `ponder.config.ts` was not being used.

- [#543](https://github.com/ponder-sh/ponder/pull/543) [`a696b2625ef1eef611ce507b177f6c1ca72c52a9`](https://github.com/ponder-sh/ponder/commit/a696b2625ef1eef611ce507b177f6c1ca72c52a9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fix compliance with some RPCs, primarily Ankr, by reformatting eth_getLogs calls

## 0.1.2

### Patch Changes

- [#537](https://github.com/ponder-sh/ponder/pull/537) [`9fa46f308a08b019867c4c3b857f81bd39cd242b`](https://github.com/ponder-sh/ponder/commit/9fa46f308a08b019867c4c3b857f81bd39cd242b) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with multichain configuration, causing indexing to be severely delayed

- [#533](https://github.com/ponder-sh/ponder/pull/533) [`689d97123bca57f36b6bcbdc29ba64657b06daf9`](https://github.com/ponder-sh/ponder/commit/689d97123bca57f36b6bcbdc29ba64657b06daf9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fix bug leading to multiple "server responding as healthy" logs

- [#532](https://github.com/ponder-sh/ponder/pull/532) [`30e687f1e76aedb07b0edfe202ca76b9011e6cfc`](https://github.com/ponder-sh/ponder/commit/30e687f1e76aedb07b0edfe202ca76b9011e6cfc) Thanks [@kyscott18](https://github.com/kyscott18)! - - Fix vite file watcher listening to changes on generated files

  - More intuitive errors, specifically from realtime and historical sync services
  - Free up listeners from the queue more rapidly

## 0.1.1

### Patch Changes

- [#527](https://github.com/ponder-sh/ponder/pull/527) [`6f245642e9cffdc35e0b24021749d1a85ef4f4c0`](https://github.com/ponder-sh/ponder/commit/6f245642e9cffdc35e0b24021749d1a85ef4f4c0) Thanks [@kyscott18](https://github.com/kyscott18)! - Fix bug in GraphQL server when resolving optional references

## 0.1.0

### Minor Changes

- [#437](https://github.com/ponder-sh/ponder/pull/437) [`df822e4ddad0a3c4002fa0efc0b758b1b7853f1c`](https://github.com/ponder-sh/ponder/commit/df822e4ddad0a3c4002fa0efc0b758b1b7853f1c) Thanks [@0xOlias](https://github.com/0xOlias)! - Released v0.1.0! Please read the [migration guide](https://ponder.sh/docs/migration-guide).

## 0.0.95

### Patch Changes

- [#409](https://github.com/0xOlias/ponder/pull/409) [`840f124`](https://github.com/0xOlias/ponder/commit/840f1240a844d6d7756be30ec757a763a251fffb) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the indexing progress bar had incorrect values.

- [#409](https://github.com/0xOlias/ponder/pull/409) [`840f124`](https://github.com/0xOlias/ponder/commit/840f1240a844d6d7756be30ec757a763a251fffb) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where Alchemy "Response size is larger than 150MB limit" errors wer enot handled properly.

## 0.0.94

### Patch Changes

- [#361](https://github.com/0xOlias/ponder/pull/361) [`54bbd92`](https://github.com/0xOlias/ponder/commit/54bbd92ddfde8a17c45c244f1e0e6cf0000e4e9b) Thanks [@0xOlias](https://github.com/0xOlias)! - BREAKING: This release includes a major update to Ponder's sync engine. Upgrading to this version will delete all cached sync progress and you will need to re-sync your app from scratch. If you're running a large Ponder app in production, please test this version on a branch + separate environment before upgrading on main.

  Added support for factory contracts. Please see the [documentation](https://ponder.sh/docs/contracts#factory-contracts) for a complete guide & API reference.

- [#405](https://github.com/0xOlias/ponder/pull/405) [`fb3a2a8`](https://github.com/0xOlias/ponder/commit/fb3a2a85225f8f1a03f90b6a66865c351530e6de) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where stale tables were left in the database after the service was stopped.

## 0.0.93

### Patch Changes

- [#392](https://github.com/0xOlias/ponder/pull/392) [`254d71d`](https://github.com/0xOlias/ponder/commit/254d71de1886aabcc428f7e99567cbb58efaa473) Thanks [@kyscott18](https://github.com/kyscott18)! - Fix bug affecting local interactive graphql ui

## 0.0.92

### Patch Changes

- [#383](https://github.com/0xOlias/ponder/pull/383) [`f3b0be6`](https://github.com/0xOlias/ponder/commit/f3b0be62bfe86e2347e00b87b422aba1d6396df9) Thanks [@o-az](https://github.com/o-az)! - Fixed a bug introduced in `0.0.91` that broke the GraphiQL interface.

- [#384](https://github.com/0xOlias/ponder/pull/384) [`2206f3c`](https://github.com/0xOlias/ponder/commit/2206f3c3653e4288278cd092bf494ec1a0ba8a1a) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where Infura "query returned more than 10000 results" errors would block the historical sync.

- [#355](https://github.com/0xOlias/ponder/pull/355) [`986c2e2`](https://github.com/0xOlias/ponder/commit/986c2e236178da53d0a15fccf3b840966d710a83) Thanks [@arberx](https://github.com/arberx)! - BREAKING: Dropped support for `rpcUrl` in favor of `transport` in `ponder.config.ts` network configuration.

  The new `transport` field accepts a [viem transport](https://viem.sh/docs/clients/intro.html#transports) instead of an RPC url. This makes it possible to use transports other than HTTP, such as WebSockets and Fallback transports.

  Prior to this update, Ponder used an HTTP transport internally. To upgrade with no change in behavior:

  ```diff
  + import { http } from "viem";

  export const config = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
  -     rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/...",
  +     transport: http("https://eth-mainnet.g.alchemy.com/v2/..."),
      },
    ],
    contracts: [
      {
        name: "BaseRegistrar",
        network: "mainnet",
        abi: "./abis/BaseRegistrar.json",
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 9380410,
      },
    ],
  };
  ```

## 0.0.91

### Patch Changes

- [#371](https://github.com/0xOlias/ponder/pull/371) [`5a21302`](https://github.com/0xOlias/ponder/commit/5a21302ee2fa6255eee3b7cc80a47e0d14d87030) Thanks [@o-az](https://github.com/o-az)! - Updated GraphiQL styles.

## 0.0.90

### Patch Changes

- [#362](https://github.com/0xOlias/ponder/pull/362) [`790946d`](https://github.com/0xOlias/ponder/commit/790946d8152621b207ef1a8b871ceacf153e4989) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where passing too many entities to createMany() fails.

## 0.0.89

### Patch Changes

- [#350](https://github.com/0xOlias/ponder/pull/350) [`fbf47ec`](https://github.com/0xOlias/ponder/commit/fbf47ecf940229b0647bd34385ee5b147d34d8bc) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed support for Node 16.

- [#360](https://github.com/0xOlias/ponder/pull/360) [`9b5e374`](https://github.com/0xOlias/ponder/commit/9b5e374b1eba49398081dcba35dc7c2d3bc1d831) Thanks [@bankisan](https://github.com/bankisan)! - Added GraphQL endpoint `/graphql`. The new endpoint will return an error until historical indexing has completed. This follows a similar behavior to the healthcheck (`/health`) endpoint. Serving GraphQL requests at the root `/` endpoint is being deprecated and will be removed in a future breaking release. We recommend switching API consumers to use the new endpoint at `/graphql`.

## 0.0.88

### Patch Changes

- [#328](https://github.com/0xOlias/ponder/pull/328) [`caaf75c`](https://github.com/0xOlias/ponder/commit/caaf75cf360b98499826349b5eb594d95e42cc98) Thanks [@eliobricenov](https://github.com/eliobricenov)! - Added support for Windows via WSL.

## 0.0.87

### Patch Changes

- [#326](https://github.com/0xOlias/ponder/pull/326) [`3d27645`](https://github.com/0xOlias/ponder/commit/3d27645aa70eb2d204ee99bc4048621acb73c509) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `updateMany` and `createMany` to public Model type.

## 0.0.86

### Patch Changes

- [#318](https://github.com/0xOlias/ponder/pull/318) [`66fda60`](https://github.com/0xOlias/ponder/commit/66fda60752c184c49695012dd03a215a0c5d7ce7) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `findMany`, `updateMany`, and `createMany` bulk methods to the entity store API.

- [#324](https://github.com/0xOlias/ponder/pull/324) [`ab3d684`](https://github.com/0xOlias/ponder/commit/ab3d68463fbc6bbc581b2e0fd583f9b71bdb9506) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the realtime sync service would crash on bad requests. Now, a warning will be logged and the service will wait until the next poll.

- [#318](https://github.com/0xOlias/ponder/pull/318) [`66fda60`](https://github.com/0xOlias/ponder/commit/66fda60752c184c49695012dd03a215a0c5d7ce7) Thanks [@0xOlias](https://github.com/0xOlias)! - Changed GraphQL filter suffix "\_contains" to "\_has" for checking if an value is present in a scalar list type.

## 0.0.85

### Patch Changes

- [#319](https://github.com/0xOlias/ponder/pull/319) [`e199267`](https://github.com/0xOlias/ponder/commit/e19926703b546b7ccefde862bb7128f621c7113a) Thanks [@Slokh](https://github.com/Slokh)! - Fixed a bug where a `delete` executed after an `update` in the same event handler would not properly delete the entity.

## 0.0.84

## 0.0.83

## 0.0.82

### Patch Changes

- [#308](https://github.com/0xOlias/ponder/pull/308) [`661c19a`](https://github.com/0xOlias/ponder/commit/661c19aa1a9b7250aa715120a6da21f7e5f7f9d3) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the GraphQL resolver for singular entities would return null for falsey (but valid) ID values like `0`.

## 0.0.81

### Patch Changes

- [#306](https://github.com/0xOlias/ponder/pull/306) [`f813a1d`](https://github.com/0xOlias/ponder/commit/f813a1d518afcb73da7e29a72ff9403ab72434c4) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for update functions in the entity store `update` and `upsert` API methods. This allows you to update an entity based on its current state, and solves a common ergonomics issue where users were manually constructing this operation using a combination of `findUnique`, `create`, and `update`.

  ```ts filename="src/index.ts"
  ponder.on("ERC20:Transfer", async ({ event, context }) => {
    const { Account } = context.entities;

    const recipient = await Account.update({
      id: event.params.to,
      data: ({ current }) => ({
        balance: current.balance + event.params.value,
      }),
    });
    // { id: "0x5D92..", balance: 11800000005n }
  });
  ```

## 0.0.80

### Patch Changes

- [#299](https://github.com/0xOlias/ponder/pull/299) [`31ee730`](https://github.com/0xOlias/ponder/commit/31ee730ff3390322c5ec9c89ebecf606179bae2f) Thanks [@0xOlias](https://github.com/0xOlias)! - Added anonymized telemetry. See `https://ponder.sh/advanced/telemetry` for details.

## 0.0.79

### Patch Changes

- [#292](https://github.com/0xOlias/ponder/pull/292) [`4e4009c`](https://github.com/0xOlias/ponder/commit/4e4009c3d1520253192d5bbe4347460262e3cae4) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for Node 20. Note: Some users may now run into an error during installation related to `better-sqlite3`. To fix, try installing `node-gyp` globally using your package manager, e.g. `pnpm install -g node-gyp`.

## 0.0.78

### Patch Changes

- [#285](https://github.com/0xOlias/ponder/pull/285) [`f8803bf`](https://github.com/0xOlias/ponder/commit/f8803bf7839128bd069cbb119c65c9bd5619dbfb) Thanks [@0xOlias](https://github.com/0xOlias)! - Added trace-level logs for more handler and store actions.

## 0.0.77

### Patch Changes

- [#274](https://github.com/0xOlias/ponder/pull/274) [`7a0057e`](https://github.com/0xOlias/ponder/commit/7a0057e1c20cb05081656b68c554f3ef3a10ecc4) Thanks [@0xOlias](https://github.com/0xOlias)! - Made internal improvements to the real-time sync service to properly reflect the data that is fetched and cached during the real-time sync. Also added a new cleanup migration that removes the `finalized` column from all tables.

- [#274](https://github.com/0xOlias/ponder/pull/274) [`7a0057e`](https://github.com/0xOlias/ponder/commit/7a0057e1c20cb05081656b68c554f3ef3a10ecc4) Thanks [@0xOlias](https://github.com/0xOlias)! - Removed export of internal `Ponder` and `Options` types.

- [#282](https://github.com/0xOlias/ponder/pull/282) [`4224d75`](https://github.com/0xOlias/ponder/commit/4224d75dc6feb1510d5153c9b2ade5dd6fe159df) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where Ponder apps with multiple contracts would not process events in real-time.

- [#274](https://github.com/0xOlias/ponder/pull/274) [`7a0057e`](https://github.com/0xOlias/ponder/commit/7a0057e1c20cb05081656b68c554f3ef3a10ecc4) Thanks [@0xOlias](https://github.com/0xOlias)! - Improve `Model` type to not require data/create/update fields if the entity only has an ID.

## 0.0.76

### Patch Changes

- [#270](https://github.com/0xOlias/ponder/pull/270) [`9919db8`](https://github.com/0xOlias/ponder/commit/9919db807e546d220d92706f00910afaa4424ea2) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the server would crash if no event handlers were registered in a file that had `import { ponder } from "@/generated"`

## 0.0.75

### Patch Changes

- [#267](https://github.com/0xOlias/ponder/pull/267) [`a683c22`](https://github.com/0xOlias/ponder/commit/a683c2281950cd99b7f74eec78128655993f7ff5) Thanks [@0xOlias](https://github.com/0xOlias)! - Added validations for log filter start blocks. Fixed a bug where, if the start block of a log filter was in the unfinalized range, the app would fail.

- [#267](https://github.com/0xOlias/ponder/pull/267) [`a683c22`](https://github.com/0xOlias/ponder/commit/a683c2281950cd99b7f74eec78128655993f7ff5) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where if a network is present in config that doesn't have any log filters associated with it, the entire app would fail to process events in real-time.

- [#267](https://github.com/0xOlias/ponder/pull/267) [`a683c22`](https://github.com/0xOlias/ponder/commit/a683c2281950cd99b7f74eec78128655993f7ff5) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where errors encountered during setup would not be logged when using `ponder start`.

## 0.0.74

### Patch Changes

- [#234](https://github.com/0xOlias/ponder/pull/234) [`0e90313`](https://github.com/0xOlias/ponder/commit/0e9031337b07a7b79503f472684be6fb34c426f7) Thanks [@r0ohafza](https://github.com/r0ohafza)! - Added support for passing arguments to derived fields. This means you can paginate entities returned in a derived field. Also added support for time-travel queries via the `timestamp` argument to all GraphQL root query types. NOTE: There is currently a limitation where `timestamp` arguments are not automatically passed to derived fields. If you are using time-travel queries on entities with derived fields, be sure the pass the same `timestamp` as an argument to the derived field. This will be fixed in a future release.

## 0.0.73

### Patch Changes

- [#261](https://github.com/0xOlias/ponder/pull/261) [`9cd3cf7`](https://github.com/0xOlias/ponder/commit/9cd3cf7c239aeec960f72eb30a11619dd4bdf142) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved internal SQL query performance.

- [#258](https://github.com/0xOlias/ponder/pull/258) [`07b836c`](https://github.com/0xOlias/ponder/commit/07b836c1621484ef5489a4028afcbd0e7c814ac8) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for overloaded event names. If an ABI contains overloaded event names, conflicting events will be named using the full signature, e.g. `ponder.on("MyContract:Transfer(address indexed, address indexed, uint256)", ...)` and `ponder.on("MyContract:Transfer(uint8 indexed, uint256 indexed, address)", ...)`.

- [#260](https://github.com/0xOlias/ponder/pull/260) [`1e5cb06`](https://github.com/0xOlias/ponder/commit/1e5cb06e70b30ae15021bbdea0428ce40c5982ea) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where some Ponder apps would OOM soon after startup if most of the historical data was present in the cache. Also fixed an annoying behavior where the event handlers progress bar would not update during development, and the process would not handle `SIGINT` properly.

## 0.0.72

### Patch Changes

- [#256](https://github.com/0xOlias/ponder/pull/256) [`1336fce`](https://github.com/0xOlias/ponder/commit/1336fce13c7ac5de9a656eabe45823b180ad6b2a) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a codegen bug where `BigInt` IDs for related entities were typed as `string`.

## 0.0.71

### Patch Changes

- [#253](https://github.com/0xOlias/ponder/pull/253) [`d96c735`](https://github.com/0xOlias/ponder/commit/d96c7359334c1991f794931f633c8d7ae1574c26) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the type of the `id` argument to singular entity fields on `Query` was hardcoded to `ID` rather than using the user-provided type of the `id` field (e.g. `String` or `BigInt`).

- [#253](https://github.com/0xOlias/ponder/pull/253) [`d96c735`](https://github.com/0xOlias/ponder/commit/d96c7359334c1991f794931f633c8d7ae1574c26) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed BigInt ID bugs by adding custom serialize and parse functions at the GraphQL layer.

## 0.0.70

### Patch Changes

- [#249](https://github.com/0xOlias/ponder/pull/249) [`b0fddce`](https://github.com/0xOlias/ponder/commit/b0fddce3a9943da4f71b3bd87e165dc2830564ec) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed multiple schema bugs related to `BigInt` id types. Removed all `_no_case` filter field types. Fixed a graceful shutdown bug.

## 0.0.69

### Patch Changes

- [#246](https://github.com/0xOlias/ponder/pull/246) [`4edc5e2`](https://github.com/0xOlias/ponder/commit/4edc5e2e2a481944d2ea733eabbb965a8cb2b4e5) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `maxRpcRequestConcurrency` option to `networks` type in `ponder.config.ts`.

- [#246](https://github.com/0xOlias/ponder/pull/246) [`4edc5e2`](https://github.com/0xOlias/ponder/commit/4edc5e2e2a481944d2ea733eabbb965a8cb2b4e5) Thanks [@0xOlias](https://github.com/0xOlias)! - Renamed types `PonderConfig` to `Config`, `ResolvedPonderConfig` to `ResolvedConfig`, and `PonderOptions` to `Options`.

## 0.0.68

### Patch Changes

- [#226](https://github.com/0xOlias/ponder/pull/226) [`1ae6a24`](https://github.com/0xOlias/ponder/commit/1ae6a24683371baeccbb70df7b3c8f566acac735) Thanks [@k-xo](https://github.com/k-xo)! - Added a database migration to create indices in the event store. This should improve event handler performance.

## 0.0.67

### Patch Changes

- [#241](https://github.com/0xOlias/ponder/pull/241) [`438813b`](https://github.com/0xOlias/ponder/commit/438813b7221c00bf89eb1ec66cf22f90e3d52ab1) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a race condition bug in the historical sync service

- [#239](https://github.com/0xOlias/ponder/pull/239) [`af90fb1`](https://github.com/0xOlias/ponder/commit/af90fb1710c529c760cb93cbde1b703d188a872a) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the Ponder server would occasionally fail to start due to a port detection race condition.

- [#239](https://github.com/0xOlias/ponder/pull/239) [`af90fb1`](https://github.com/0xOlias/ponder/commit/af90fb1710c529c760cb93cbde1b703d188a872a) Thanks [@0xOlias](https://github.com/0xOlias)! - Bumped `viem` and `abitype` versions.

## 0.0.66

### Patch Changes

- [#235](https://github.com/0xOlias/ponder/pull/235) [`0420400`](https://github.com/0xOlias/ponder/commit/04204001eb6173b797d0e03b2939fb1c2cd3840b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the default finality checkpoint of several chains (including Arbitrum) was set to zero. The target finality interval for reorg-safe chains like Arbitrum and Optimism is now 10 seconds (e.g. 40 blocks on Arbitrum).

- [#235](https://github.com/0xOlias/ponder/pull/235) [`0420400`](https://github.com/0xOlias/ponder/commit/04204001eb6173b797d0e03b2939fb1c2cd3840b) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the realtime sync service would process blocks out of order, leading to less efficient RPC request patterns.

- [#235](https://github.com/0xOlias/ponder/pull/235) [`0420400`](https://github.com/0xOlias/ponder/commit/04204001eb6173b797d0e03b2939fb1c2cd3840b) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated Ponder's logging behavior. Stdout log lines will not include timestamps, log level, service name, and a message. Logs are also written to files located at `/.ponder/logs/{timestamp}.log` in JSON format. There are now more log levels: `"silent"`, `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, and `"trace"`. These can be configured using the `PONDER_LOG_LEVEL` environment variable.

## 0.0.65

### Patch Changes

- [#230](https://github.com/0xOlias/ponder/pull/230) [`c9afd1b`](https://github.com/0xOlias/ponder/commit/c9afd1b627cba4f32197a2492a34ceb1be34fec3) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed transaction and block formatting to handle Arbitrum RPC data formats.

## 0.0.64

### Patch Changes

- [#183](https://github.com/0xOlias/ponder/pull/183) [`1d82c94`](https://github.com/0xOlias/ponder/commit/1d82c9423f6f11364c35b10f11e47e622fec78d5) Thanks [@pyk](https://github.com/pyk)! - Fixed a bug where codegen would fail for schemas that include a field typed as `Float`.

## 0.0.63

### Patch Changes

- [#225](https://github.com/0xOlias/ponder/pull/225) [`c474fb0`](https://github.com/0xOlias/ponder/commit/c474fb01fffc74aed17d247eb4bcea0168be5517) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug in the historical sync queue where block tasks were not being prioritzed properly. Now, when starting the historical sync, events should be available and processed almost immediately.

## 0.0.62

### Patch Changes

- [#213](https://github.com/0xOlias/ponder/pull/213) [`2bff2f8`](https://github.com/0xOlias/ponder/commit/2bff2f8bfdecb85a8be7c3ef61c9634dfb19b4c0) Thanks [@r0ohafza](https://github.com/r0ohafza)! - Added entity count limits to GraphQL API server responses. By default, the server now returns only the first 100 entities (equivalent to adding `first: 100`). There is also now a hard cap of 1000 entities (`first: 1000`) in a single response. There is also a cap of 5000 entities that can be skipped (`skip: 5000`) in a single response. To paginate through a large number of entities, maintain a cursor client-side and use `where: { id_gt: previousCursor }` to fetch the next page of entities.

- [#221](https://github.com/0xOlias/ponder/pull/221) [`cc7c60c`](https://github.com/0xOlias/ponder/commit/cc7c60c7ec09d4c2ccee735468efa6eb8122a9d2) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where `Keep-Alive` HTTP connections were not being terminated properly on process exit

- [#219](https://github.com/0xOlias/ponder/pull/219) [`a8e3b79`](https://github.com/0xOlias/ponder/commit/a8e3b791a5d7eb0c0cfcdd7f347519d9bb6caf88) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the "equals" filter argument was not working as expected for basic list field types.

## 0.0.61

### Patch Changes

- [#204](https://github.com/0xOlias/ponder/pull/204) [`f8ddf37`](https://github.com/0xOlias/ponder/commit/f8ddf3755ed1e358655152a956e57a7e080b6b52) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where sorting on BigInt fields was not working as expected.

## 0.0.60

### Patch Changes

- [#200](https://github.com/0xOlias/ponder/pull/200) [`50571b6`](https://github.com/0xOlias/ponder/commit/50571b64c2feb8f7e9fdd36d77625ca5c5162d38) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated `ReadOnlyContract` to be viem Contract Instances. Fixed bug where contract calls were not using the block number of the current event being handled.

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
  import type { Config } from "@ponder/core";
  import { parseAbiItem } from "abitype";

  export const config: Config = {
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
  import type { Config } from "@ponder/core";
  export const config: Config = {
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
      data: { ...setupData },
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

  import type { Config } from "@ponder/core";
  - import { graphqlPlugin } from "@ponder/graphql";

  export const config: Config = {
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

- [#57](https://github.com/0xOlias/ponder/pull/57) [`3f358dd`](https://github.com/0xOlias/ponder/commit/3f358dddbcb4c0f7dfe427a9db847bd2388be019) Thanks [@0xOlias](https://github.com/0xOlias)! - BREAKING! Updated ponder config to support typescript and to be called `ponder.ts` by default. `ponder.ts` must export a variable named `config` that is of the type `import { Config } from "@ponder/core"`. The `database` field in ponder config is now optional. By default, it uses `SQLite` with a filename of `./.ponder/cache.db`. If the environment variable `DATABASE_URL` is detected, it uses `Postgres` with that value as the `connectionString`.

  New sample `ponder.ts` file:

  ```ts
  // ponder.ts

  import type { Config } from "@ponder/core";
  import { graphqlPlugin } from "@ponder/graphql";

  export const config: Config = {
    networks: [
      {
        name: "mainnet",
        chainId: 1,
        rpcUrl: process.env.PONDER_RPC_URL_1,
      },
    ],
    sources: [
      {
        name: "ArtGobblers",
        network: "mainnet",
        abi: "./abis/ArtGobblers.json",
        address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
        startBlock: 15863321,
      },
    ],
    plugins: [graphqlPlugin()],
  };
  ```

  The exported value can also be a function, and it can return a Promise:

  ```ts
  // ponder.ts

  import type { Config } from "@ponder/core";

  export const config: Config = async () => {
    return {
      networks: [
        /* ... */
      ],
      sources: [
        /* ... */
      ],
    };
  };
  ```

## 0.0.22

### Patch Changes

- [#52](https://github.com/0xOlias/ponder/pull/52) [`39b3e00`](https://github.com/0xOlias/ponder/commit/39b3e00ea29142e1b893ca2170116b9988e8f623) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed bug where string array arguments to filter fields raised SQLite error

## 0.0.21

### Patch Changes

- [#50](https://github.com/0xOlias/ponder/pull/50) [`b26b0e4`](https://github.com/0xOlias/ponder/commit/b26b0e456674c2170bf23e84f79246f1a56e82d9) Thanks [@0xOlias](https://github.com/0xOlias)! - Changed PonderPlugin interface and setup pattern. Ponder plugins are now classes. The public API (in ponder.config.js) remains the same.
