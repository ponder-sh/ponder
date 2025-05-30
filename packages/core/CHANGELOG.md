# ponder

## 0.11.9

### Patch Changes

- [#1791](https://github.com/ponder-sh/ponder/pull/1791) [`db7f3af`](https://github.com/ponder-sh/ponder/commit/db7f3af8ebeeadcfd96ad40f411cd1e8561b497b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added validations against updating primary key columns in `db.update().set()` and `db.insert().values().onConflictDoNothing()`.

- [#1789](https://github.com/ponder-sh/ponder/pull/1789) [`621fed0`](https://github.com/ponder-sh/ponder/commit/621fed0856ee239d5ce3cadea71fd1a255fc3324) Thanks [@typedarray](https://github.com/typedarray)! - Moved 0.10 migration logs to debug level.

- [#1787](https://github.com/ponder-sh/ponder/pull/1787) [`1d3b5b8`](https://github.com/ponder-sh/ponder/commit/1d3b5b856f77fdd93f12a744790b1e9358c454f5) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in `v0.9.21` that caused the dev ui to leave out some data.

## 0.11.8

### Patch Changes

- [#1785](https://github.com/ponder-sh/ponder/pull/1785) [`acee346`](https://github.com/ponder-sh/ponder/commit/acee34601710394e0e2094e35c9c0a4757042c2f) Thanks [@typedarray](https://github.com/typedarray)! - Improved validation error message for common 0.11 migration mistake.

## 0.11.7

### Patch Changes

- [#1762](https://github.com/ponder-sh/ponder/pull/1762) [`9072b07`](https://github.com/ponder-sh/ponder/commit/9072b0733c0216d3e8e9b9fd1649aece85f7efb3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed several bugs that caused events to be missed.

- [#1629](https://github.com/ponder-sh/ponder/pull/1629) [`074a138`](https://github.com/ponder-sh/ponder/commit/074a13829091f286e951a1f88bb2cfb33120fcea) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Introduced the feature of specifying factory block range independent from source block range.

- [#1762](https://github.com/ponder-sh/ponder/pull/1762) [`9072b07`](https://github.com/ponder-sh/ponder/commit/9072b0733c0216d3e8e9b9fd1649aece85f7efb3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that caused `[account]:transaction:to` indexing functions to process extra events.

- [#1762](https://github.com/ponder-sh/ponder/pull/1762) [`9072b07`](https://github.com/ponder-sh/ponder/commit/9072b0733c0216d3e8e9b9fd1649aece85f7efb3) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder_realtime_block_arrival_latency` metric.

- [#1762](https://github.com/ponder-sh/ponder/pull/1762) [`9072b07`](https://github.com/ponder-sh/ponder/commit/9072b0733c0216d3e8e9b9fd1649aece85f7efb3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with `ponder_realtime_latency` overreporting with `omnichain` ordering.

## 0.11.6

### Patch Changes

- [#1763](https://github.com/ponder-sh/ponder/pull/1763) [`16736b2`](https://github.com/ponder-sh/ponder/commit/16736b2ce30498f3bea9abdcbab66b6216cc3925) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an event ordering bug for deep reorg retries.

- [#1774](https://github.com/ponder-sh/ponder/pull/1774) [`a069bd8`](https://github.com/ponder-sh/ponder/commit/a069bd8d984a8958df81c6d0249423d91483fda0) Thanks [@scottrepreneur](https://github.com/scottrepreneur)! - Fixed broken docs links.

## 0.11.5

### Patch Changes

- [#1767](https://github.com/ponder-sh/ponder/pull/1767) [`6b78535`](https://github.com/ponder-sh/ponder/commit/6b785356df1d38b1a94e580966fd78b625fe3929) Thanks [@kyscott18](https://github.com/kyscott18)! - Added "debug\_" rpc method support to the `context.client` cache.

## 0.11.4

### Patch Changes

- [#1765](https://github.com/ponder-sh/ponder/pull/1765) [`a039e7be46c80a4a5ecad927b6c808a94e56b1d8`](https://github.com/ponder-sh/ponder/commit/a039e7be46c80a4a5ecad927b6c808a94e56b1d8) Thanks [@kyscott18](https://github.com/kyscott18)! - Exported more types to fix error in `ponder.schema.ts`: `error TS2742: The inferred type of '[table]' cannot be named without a reference`.

## 0.11.3

### Patch Changes

- [#1755](https://github.com/ponder-sh/ponder/pull/1755) [`5cb9130cc62870e440ce393b49b749c1ae838e54`](https://github.com/ponder-sh/ponder/commit/5cb9130cc62870e440ce393b49b749c1ae838e54) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing views with enums to error with `error: cannot change data type of view column`.

## 0.11.2

### Patch Changes

- [#1751](https://github.com/ponder-sh/ponder/pull/1751) [`5c0283884e860fd6b016c6ff8b5c39d7249ef48b`](https://github.com/ponder-sh/ponder/commit/5c0283884e860fd6b016c6ff8b5c39d7249ef48b) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in `v0.10.25` that caused one -> many relations to break in graphql.

## 0.11.1

### Patch Changes

- Updated dependencies [[`5507be933867f74b16db6e842897b6545f2e7567`](https://github.com/ponder-sh/ponder/commit/5507be933867f74b16db6e842897b6545f2e7567)]:
  - @ponder/utils@0.2.7

## 0.11.0

### Minor Changes

- [#1736](https://github.com/ponder-sh/ponder/pull/1736) [`8c012a3168af5a6f28d166279082a9fc0a672d8e`](https://github.com/ponder-sh/ponder/commit/8c012a3168af5a6f28d166279082a9fc0a672d8e) Thanks [@kyscott18](https://github.com/kyscott18)! - Released `0.11`. Visit the [migration guide](https://ponder.sh/docs/migration-guide#011) for details.

## 0.10.27

### Patch Changes

- [#1737](https://github.com/ponder-sh/ponder/pull/1737) [`7db4e4b848db4cd5f09dff6a24ec9a5b6a978b29`](https://github.com/ponder-sh/ponder/commit/7db4e4b848db4cd5f09dff6a24ec9a5b6a978b29) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing duplicate events after the warning "Encountered unrecoverable '[chain]' reorg".

## 0.10.26

### Patch Changes

- [#1721](https://github.com/ponder-sh/ponder/pull/1721) [`149872c4b4d1b62e0f0caf441db305761d1ba171`](https://github.com/ponder-sh/ponder/commit/149872c4b4d1b62e0f0caf441db305761d1ba171) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved log for lagging networks.

## 0.10.25

### Patch Changes

- [#1725](https://github.com/ponder-sh/ponder/pull/1725) [`f8cb9634a67bd75098f86fc57585c400b8dd70e8`](https://github.com/ponder-sh/ponder/commit/f8cb9634a67bd75098f86fc57585c400b8dd70e8) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed graphql resolver for `many` relations.

## 0.10.24

### Patch Changes

- [#1719](https://github.com/ponder-sh/ponder/pull/1719) [`69ce57fb1987a6bc5e960feae38ebcc81064964e`](https://github.com/ponder-sh/ponder/commit/69ce57fb1987a6bc5e960feae38ebcc81064964e) Thanks [@kyscott18](https://github.com/kyscott18)! - Added more rpc response validation. Fixed inconsistent logs and transactions for some degraded rpc providers leading `event.transaction` being undefined.

## 0.10.23

### Patch Changes

- [#1716](https://github.com/ponder-sh/ponder/pull/1716) [`610388dbd11dbf472a2727fe30ada71ec43f0a3e`](https://github.com/ponder-sh/ponder/commit/610388dbd11dbf472a2727fe30ada71ec43f0a3e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing events from sources with factories to be missed.

  Any users that were affected by this bug can removed corrupted `ponder_sync` rows with the query:

  ```sql
  DELETE FROM ponder_sync.intervals WHERE fragment_id like '%offset%' OR fragment_id like '%topic%';
  ```

- [#1717](https://github.com/ponder-sh/ponder/pull/1717) [`abb8f9d710360d23ef79269709f006aa2572ce4f`](https://github.com/ponder-sh/ponder/commit/abb8f9d710360d23ef79269709f006aa2572ce4f) Thanks [@typedarray](https://github.com/typedarray)! - Fixed an issue where the historical sync would sometimes fail with the error "RangeError: Invalid array length" when indexing very large factory contracts.

- [#1712](https://github.com/ponder-sh/ponder/pull/1712) [`4670b7eb5ed10b2ca51aca0ea0b7fcb0e2eeaac4`](https://github.com/ponder-sh/ponder/commit/4670b7eb5ed10b2ca51aca0ea0b7fcb0e2eeaac4) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where the `0.10` database migration to `ponder_sync` failed on databases where logical replication was enabled.

## 0.10.22

### Patch Changes

- Updated dependencies [[`27886fef0788e7ee1c25221087ecd6af05ea6197`](https://github.com/ponder-sh/ponder/commit/27886fef0788e7ee1c25221087ecd6af05ea6197)]:
  - @ponder/utils@0.2.6

## 0.10.21

### Patch Changes

- Updated dependencies [[`e9b0fb99772baff7d3008a9dd1c8383e6182df59`](https://github.com/ponder-sh/ponder/commit/e9b0fb99772baff7d3008a9dd1c8383e6182df59)]:
  - @ponder/utils@0.2.5

## 0.10.20

### Patch Changes

- [#1701](https://github.com/ponder-sh/ponder/pull/1701) [`1f547d61d8821e10ae7f22cbd2b60d86ba4a727a`](https://github.com/ponder-sh/ponder/commit/1f547d61d8821e10ae7f22cbd2b60d86ba4a727a) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Fixed "Invalid Query" error when using `@ponder/client` queries using `findMany` or `findFirst` that include the `with` option (relational queries).

- Updated dependencies [[`4157106917d81df2809616a19297c7e80a70f1f5`](https://github.com/ponder-sh/ponder/commit/4157106917d81df2809616a19297c7e80a70f1f5)]:
  - @ponder/utils@0.2.4

## 0.10.19

### Patch Changes

- [#1702](https://github.com/ponder-sh/ponder/pull/1702) [`da5c3052f40799cd234f4917f62e032a0354d759`](https://github.com/ponder-sh/ponder/commit/da5c3052f40799cd234f4917f62e032a0354d759) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with reorg handling that would sometimes cause a duplicate event after the log `Error: Encountered unrecoverable 'arbitrum' reorg beyond finalized block 330098801`.

## 0.10.18

### Patch Changes

- [#1685](https://github.com/ponder-sh/ponder/pull/1685) [`cb23aab8ff5337c98bdaeaad954319012c1a72fd`](https://github.com/ponder-sh/ponder/commit/cb23aab8ff5337c98bdaeaad954319012c1a72fd) Thanks [@typedarray](https://github.com/typedarray)! - Fixed `Cannot convert undefined to a BigInt` error by allowing `block.size` to be `undefined`. Fixes indexing on some chains including Somnia network.

- [#1688](https://github.com/ponder-sh/ponder/pull/1688) [`26c818c337f6300eb5a186c827d37766d6e5c766`](https://github.com/ponder-sh/ponder/commit/26c818c337f6300eb5a186c827d37766d6e5c766) Thanks [@typedarray](https://github.com/typedarray)! - Increased statement timeout for `CREATE INDEX` statements from 2 minutes to 60 minutes.

## 0.10.17

### Patch Changes

- [#1680](https://github.com/ponder-sh/ponder/pull/1680) [`c1b6a4de54d33cb229f2248b7b41e37cbf57d449`](https://github.com/ponder-sh/ponder/commit/c1b6a4de54d33cb229f2248b7b41e37cbf57d449) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved import rules between config, schema, indexing functions, and api function files.

- [#1684](https://github.com/ponder-sh/ponder/pull/1684) [`92e1358cbf8817aea425a8c5e683ddfb1a9bc02d`](https://github.com/ponder-sh/ponder/commit/92e1358cbf8817aea425a8c5e683ddfb1a9bc02d) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug affecting logs and traces with no args that would cause the error `TypeError: Cannot convert undefined or null to object`.

## 0.10.16

### Patch Changes

- [`6b8cc2d5bdcbc0c7f2fe048cac4353eed79f180a`](https://github.com/ponder-sh/ponder/commit/6b8cc2d5bdcbc0c7f2fe048cac4353eed79f180a) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved realtime sync robustness against unrecoverable reorgs.

## 0.10.15

### Patch Changes

- [#1628](https://github.com/ponder-sh/ponder/pull/1628) [`4bc64795ebf265cc75f7ba816fe96920fab4e7a1`](https://github.com/ponder-sh/ponder/commit/4bc64795ebf265cc75f7ba816fe96920fab4e7a1) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder_indexing_rpc_action_duration`, `ponder_indexing_rpc_prefetch_total`, and `ponder_indexing_rpc_requests_total` metrics.

- [#1676](https://github.com/ponder-sh/ponder/pull/1676) [`cfdf1423bc64829bfadbc6fa12e631a1047a03a7`](https://github.com/ponder-sh/ponder/commit/cfdf1423bc64829bfadbc6fa12e631a1047a03a7) Thanks [@kyscott18](https://github.com/kyscott18)! - Improve sql query validation.

- [#1628](https://github.com/ponder-sh/ponder/pull/1628) [`4bc64795ebf265cc75f7ba816fe96920fab4e7a1`](https://github.com/ponder-sh/ponder/commit/4bc64795ebf265cc75f7ba816fe96920fab4e7a1) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved `context.client.readContract()` and `context.client.multicall()` performance.

- [#1675](https://github.com/ponder-sh/ponder/pull/1675) [`e921162a2b16bc0415a80d381ce9df0bf13ac016`](https://github.com/ponder-sh/ponder/commit/e921162a2b16bc0415a80d381ce9df0bf13ac016) Thanks [@kyscott18](https://github.com/kyscott18)! - Improve rpc request performance by skipping retries for reverted requests.

## 0.10.14

### Patch Changes

- [#1672](https://github.com/ponder-sh/ponder/pull/1672) [`7abdc96849ccbd4d72be731616d464cddfd03079`](https://github.com/ponder-sh/ponder/commit/7abdc96849ccbd4d72be731616d464cddfd03079) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with `insert().onConflictDoNothing()` that would cause an error "Cannot read properties of undefined".

## 0.10.13

### Patch Changes

- [#1663](https://github.com/ponder-sh/ponder/pull/1663) [`c6c603fa7f0c07ddc307dfb199dd2ee92f36bb0e`](https://github.com/ponder-sh/ponder/commit/c6c603fa7f0c07ddc307dfb199dd2ee92f36bb0e) Thanks [@kyscott18](https://github.com/kyscott18)! - Increased `idle_in_transaction_session_timeout` to 1 hour.

## 0.10.12

### Patch Changes

- [#1658](https://github.com/ponder-sh/ponder/pull/1658) [`7e4fe861fb4a6788d7d272da2434409d1979ac51`](https://github.com/ponder-sh/ponder/commit/7e4fe861fb4a6788d7d272da2434409d1979ac51) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that would cause errors similar to `error: invalid input syntax for type numeric: "{"1"}"`.

## 0.10.11

### Patch Changes

- [#1653](https://github.com/ponder-sh/ponder/pull/1653) [`4447771a45dc81887586845801becf83cfdb6387`](https://github.com/ponder-sh/ponder/commit/4447771a45dc81887586845801becf83cfdb6387) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated drizzle-orm from v0.39.3 to v0.41.0.

## 0.10.10

### Patch Changes

- [#1654](https://github.com/ponder-sh/ponder/pull/1654) [`3dde8fdbf40a14ae04f491943062122cb2dea107`](https://github.com/ponder-sh/ponder/commit/3dde8fdbf40a14ae04f491943062122cb2dea107) Thanks [@kyscott18](https://github.com/kyscott18)! - Increased statement timeout for ponder_sync migrations to 60 minutes.

## 0.10.9

### Patch Changes

- [#1640](https://github.com/ponder-sh/ponder/pull/1640) [`22b4593e53b93569d95fd45a89532040f1f98ac2`](https://github.com/ponder-sh/ponder/commit/22b4593e53b93569d95fd45a89532040f1f98ac2) Thanks [@kyscott18](https://github.com/kyscott18)! - Added retry logic for "ContractFunctionZeroDataError" when a rpc incorrectly returns "0x".

- [#1639](https://github.com/ponder-sh/ponder/pull/1639) [`37dff4a356c644464f8e9a8a7767696994981f04`](https://github.com/ponder-sh/ponder/commit/37dff4a356c644464f8e9a8a7767696994981f04) Thanks [@kyscott18](https://github.com/kyscott18)! - Added validation for schemas with duplicate table names.

## 0.10.8

### Patch Changes

- [#1596](https://github.com/ponder-sh/ponder/pull/1596) [`559226b33cb8cf6b6d939a2a2d611230a193ddc6`](https://github.com/ponder-sh/ponder/commit/559226b33cb8cf6b6d939a2a2d611230a193ddc6) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved historical indexing performance.

## 0.10.7

### Patch Changes

- [#1631](https://github.com/ponder-sh/ponder/pull/1631) [`4045aea473eb68b304357851fa47c9a165a00e49`](https://github.com/ponder-sh/ponder/commit/4045aea473eb68b304357851fa47c9a165a00e49) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved raw SQL performance.

- [#1634](https://github.com/ponder-sh/ponder/pull/1634) [`faac60dbb9b201639a91e3b5ddcd50ea83c21860`](https://github.com/ponder-sh/ponder/commit/faac60dbb9b201639a91e3b5ddcd50ea83c21860) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved performance for factories during the historical sync.

## 0.10.6

### Patch Changes

- [#1623](https://github.com/ponder-sh/ponder/pull/1623) [`5af3aaceb9b53da7b968e09a683040d5cc151ac2`](https://github.com/ponder-sh/ponder/commit/5af3aaceb9b53da7b968e09a683040d5cc151ac2) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed `timestamp` column.

- [#1620](https://github.com/ponder-sh/ponder/pull/1620) [`bc519502afe7794c26122d6d6c0c26de58632de3`](https://github.com/ponder-sh/ponder/commit/bc519502afe7794c26122d6d6c0c26de58632de3) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved historical indexing performance.

- [#1613](https://github.com/ponder-sh/ponder/pull/1613) [`940cdda510eedeaa7527a93c415d9ede5f39189c`](https://github.com/ponder-sh/ponder/commit/940cdda510eedeaa7527a93c415d9ede5f39189c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed missing checksums for addresses.

## 0.10.5

### Patch Changes

- [#1619](https://github.com/ponder-sh/ponder/pull/1619) [`a2e98bb1953b645114d28f5a6d659351721c0ea3`](https://github.com/ponder-sh/ponder/commit/a2e98bb1953b645114d28f5a6d659351721c0ea3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with `client.getStatus()`.

## 0.10.4

### Patch Changes

- [#1618](https://github.com/ponder-sh/ponder/pull/1618) [`e68750a1c46ccb4ef671fa07d160051168cf710a`](https://github.com/ponder-sh/ponder/commit/e68750a1c46ccb4ef671fa07d160051168cf710a) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with `client.multicall` introduced in v0.10.0.

- [#1608](https://github.com/ponder-sh/ponder/pull/1608) [`8e5dc9dfa3b648a4f2a8a9421471bac47bb0b970`](https://github.com/ponder-sh/ponder/commit/8e5dc9dfa3b648a4f2a8a9421471bac47bb0b970) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder db prune` command to drop all inactive tables and schemas.

## 0.10.3

### Patch Changes

- [#1615](https://github.com/ponder-sh/ponder/pull/1615) [`fac32d1811b162a6df641e818267a159f444fcea`](https://github.com/ponder-sh/ponder/commit/fac32d1811b162a6df641e818267a159f444fcea) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.10.1 with trace encoding.

- [#1604](https://github.com/ponder-sh/ponder/pull/1604) [`4b9cf21fa85f94b88beb80790aae3bd4f34f0dfa`](https://github.com/ponder-sh/ponder/commit/4b9cf21fa85f94b88beb80790aae3bd4f34f0dfa) Thanks [@SukkaW](https://github.com/SukkaW)! - Updated the `graphql` middleware to use the jsDelivr CDN for the GraphiQL bundle.

- [#1605](https://github.com/ponder-sh/ponder/pull/1605) [`8aafdde458fc899ef4f8fb591b982e35525ed250`](https://github.com/ponder-sh/ponder/commit/8aafdde458fc899ef4f8fb591b982e35525ed250) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder_historical_concurrency_group_duration`, `ponder_historical_extract_duration`, `ponder_historical_transform_duration` metrics.

## 0.10.2

### Patch Changes

- [#1611](https://github.com/ponder-sh/ponder/pull/1611) [`21560f3927abd3389832a510ac1fb3dc2009204e`](https://github.com/ponder-sh/ponder/commit/21560f3927abd3389832a510ac1fb3dc2009204e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.10.1 with text column encoding.

## 0.10.1

### Patch Changes

- [#1607](https://github.com/ponder-sh/ponder/pull/1607) [`e723e358fe2909485afc97782bef8819b66374e3`](https://github.com/ponder-sh/ponder/commit/e723e358fe2909485afc97782bef8819b66374e3) Thanks [@kyscott18](https://github.com/kyscott18)! - Changed event decoding behavior to allow users to handle null bytes.

## 0.10.0

### Minor Changes

- [#1603](https://github.com/ponder-sh/ponder/pull/1603) [`c4452f6798e44b62704ad38d8217cfcc9cabb496`](https://github.com/ponder-sh/ponder/commit/c4452f6798e44b62704ad38d8217cfcc9cabb496) Thanks [@kyscott18](https://github.com/kyscott18)! - Released `0.10`. Visit the [migration guide](https://ponder.sh/docs/migration-guide#010) for details.

### Patch Changes

- [#1603](https://github.com/ponder-sh/ponder/pull/1603) [`c4452f6798e44b62704ad38d8217cfcc9cabb496`](https://github.com/ponder-sh/ponder/commit/c4452f6798e44b62704ad38d8217cfcc9cabb496) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with factories incorrectly filtering events.

- [#1603](https://github.com/ponder-sh/ponder/pull/1603) [`c4452f6798e44b62704ad38d8217cfcc9cabb496`](https://github.com/ponder-sh/ponder/commit/c4452f6798e44b62704ad38d8217cfcc9cabb496) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where `eth_call` responses containing `0x` were being cached. Now, only non-empty responses are cached.

- [#1603](https://github.com/ponder-sh/ponder/pull/1603) [`c4452f6798e44b62704ad38d8217cfcc9cabb496`](https://github.com/ponder-sh/ponder/commit/c4452f6798e44b62704ad38d8217cfcc9cabb496) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where setting a network `maxRequestsPerSecond` value greater than ~256 could freeze the indexer and cause contention with other chains.

## 0.9.28

### Patch Changes

- [#1592](https://github.com/ponder-sh/ponder/pull/1592) [`75bdb0fc83e8fb48c1764a601377afabc8abc8b6`](https://github.com/ponder-sh/ponder/commit/75bdb0fc83e8fb48c1764a601377afabc8abc8b6) Thanks [@tk-o](https://github.com/tk-o)! - Improved error message for invalid database connection strings.

- [#1599](https://github.com/ponder-sh/ponder/pull/1599) [`3950e751bfda0795a667a59e119d8b0ccf27c304`](https://github.com/ponder-sh/ponder/commit/3950e751bfda0795a667a59e119d8b0ccf27c304) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue with stale indexing cache values being used after raw sql queries.

## 0.9.27

### Patch Changes

- [#1582](https://github.com/ponder-sh/ponder/pull/1582) [`8dde38dfbb81777f1ab22fe65ea1166cce1b944f`](https://github.com/ponder-sh/ponder/commit/8dde38dfbb81777f1ab22fe65ea1166cce1b944f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that would cause crash recovery and reorg handling to error for some apps.

## 0.9.26

### Patch Changes

- [#1580](https://github.com/ponder-sh/ponder/pull/1580) [`e601d84bd44c708be9de017fdb393fbf037cebf0`](https://github.com/ponder-sh/ponder/commit/e601d84bd44c708be9de017fdb393fbf037cebf0) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed crash behavior when an unrecoverable reorg occurs.

- [#1579](https://github.com/ponder-sh/ponder/pull/1579) [`d87b12a772e1f7f5891ab66bc05afafa24a2a9bb`](https://github.com/ponder-sh/ponder/commit/d87b12a772e1f7f5891ab66bc05afafa24a2a9bb) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `bytes()` column type for low-level byte arrays.

## 0.9.25

### Patch Changes

- [#1571](https://github.com/ponder-sh/ponder/pull/1571) [`e05716bd35ead4f0a305c2bdd92050d63042f01b`](https://github.com/ponder-sh/ponder/commit/e05716bd35ead4f0a305c2bdd92050d63042f01b) Thanks [@typedarray](https://github.com/typedarray)! - Fixed React 19 compatibility issues in monorepos. Removed `ink` and `react` dependencies, introduced a new terminal UI implementation with the same functionality as before.

## 0.9.24

### Patch Changes

- [#1447](https://github.com/ponder-sh/ponder/pull/1447) [`2c6f2aaa743483169f3913ae3757e70eda38f073`](https://github.com/ponder-sh/ponder/commit/2c6f2aaa743483169f3913ae3757e70eda38f073) Thanks [@typedarray](https://github.com/typedarray)! - Added support for `ssl` options in Postgres pool configuration.

## 0.9.23

### Patch Changes

- [#1552](https://github.com/ponder-sh/ponder/pull/1552) [`b0618efd5b07feb851463327b4517fdfb31c2384`](https://github.com/ponder-sh/ponder/commit/b0618efd5b07feb851463327b4517fdfb31c2384) Thanks [@normanzb](https://github.com/normanzb)! - Fixed an issue where libraries that subclass `Hono` (like `@hono/zod-openapi`) were not supported by API functions.

- [#1560](https://github.com/ponder-sh/ponder/pull/1560) [`818d20eef48a247b513d7eadfa7c04be74f36477`](https://github.com/ponder-sh/ponder/commit/818d20eef48a247b513d7eadfa7c04be74f36477) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug introduced in `0.9.20` where the `ponder` entrypoint included Node.js-only imports like `"node:path"`, breaking some workflows that use `@ponder/client` in browser environments.

## 0.9.22

### Patch Changes

- [#1557](https://github.com/ponder-sh/ponder/pull/1557) [`3b92c7312889398986e82da543b5872ef15a27f5`](https://github.com/ponder-sh/ponder/commit/3b92c7312889398986e82da543b5872ef15a27f5) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in v0.9.20 that caused an error when using raw sql queries.

## 0.9.21

### Patch Changes

- [#1554](https://github.com/ponder-sh/ponder/pull/1554) [`37be92975a985a296b08355b809a5256236bba8e`](https://github.com/ponder-sh/ponder/commit/37be92975a985a296b08355b809a5256236bba8e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where crash recovery during historical indexing did not work when using `ordering: "multichain"`.

- [#1555](https://github.com/ponder-sh/ponder/pull/1555) [`035899c90545ce46cf8bbccf62f91600ede8a7cc`](https://github.com/ponder-sh/ponder/commit/035899c90545ce46cf8bbccf62f91600ede8a7cc) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression with evicting cached indexing data introduced in v0.9.20.

- [#1550](https://github.com/ponder-sh/ponder/pull/1550) [`f1231b3cd108cf5e380b47c118863be27bbb4467`](https://github.com/ponder-sh/ponder/commit/f1231b3cd108cf5e380b47c118863be27bbb4467) Thanks [@farrellh1](https://github.com/farrellh1)! - Fixed display of long event names in terminal ui.

## 0.9.20

### Patch Changes

- [#1522](https://github.com/ponder-sh/ponder/pull/1522) [`74eb695c996723cb20e43f78b04aed64c1e685de`](https://github.com/ponder-sh/ponder/commit/74eb695c996723cb20e43f78b04aed64c1e685de) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder_indexing_cache_requests_total`, `ponder_indexing_cache_query_duration`, `ponder_indexing_store_queries_total` and `ponder_indexing_store_raw_sql_duration` metrics.

- [#1522](https://github.com/ponder-sh/ponder/pull/1522) [`74eb695c996723cb20e43f78b04aed64c1e685de`](https://github.com/ponder-sh/ponder/commit/74eb695c996723cb20e43f78b04aed64c1e685de) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved historical indexing performance.

## 0.9.19

### Patch Changes

- [#1546](https://github.com/ponder-sh/ponder/pull/1546) [`f8f2994381d7a62c3ec60682d384d8a7018e46f1`](https://github.com/ponder-sh/ponder/commit/f8f2994381d7a62c3ec60682d384d8a7018e46f1) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where GraphQL queries filtering on `null` values did not work.

## 0.9.18

### Patch Changes

- [#1544](https://github.com/ponder-sh/ponder/pull/1544) [`ea793aeed7c3555df7115fed164a1070c06f2bf7`](https://github.com/ponder-sh/ponder/commit/ea793aeed7c3555df7115fed164a1070c06f2bf7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with `db.delete()` sometimes not persisting to the database.

- [#1541](https://github.com/ponder-sh/ponder/pull/1541) [`953b45991780edc4c224a74d002d421eedf0fbb1`](https://github.com/ponder-sh/ponder/commit/953b45991780edc4c224a74d002d421eedf0fbb1) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `ponder_historical_start_timestamp_seconds`, `ponder_historical_end_timestamp_seconds`, `ponder_version_info`, and `ponder_settings_info` metrics.

## 0.9.17

### Patch Changes

- [#1539](https://github.com/ponder-sh/ponder/pull/1539) [`8b44612a16ebf40cb26d5fdfa9ccb75fb1963c91`](https://github.com/ponder-sh/ponder/commit/8b44612a16ebf40cb26d5fdfa9ccb75fb1963c91) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed bug with `disableCache` missing events.

## 0.9.16

### Patch Changes

- [#1537](https://github.com/ponder-sh/ponder/pull/1537) [`89a451b5361aba47bf2463a0f1a38a3570e9daa6`](https://github.com/ponder-sh/ponder/commit/89a451b5361aba47bf2463a0f1a38a3570e9daa6) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where the indexing cache would sometimes use stale values.

## 0.9.15

### Patch Changes

- [#1533](https://github.com/ponder-sh/ponder/pull/1533) [`00f1ec17e891d46559596391bbfe893a3ca51fc8`](https://github.com/ponder-sh/ponder/commit/00f1ec17e891d46559596391bbfe893a3ca51fc8) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed result of context.db with null values.

## 0.9.14

### Patch Changes

- [#1530](https://github.com/ponder-sh/ponder/pull/1530) [`17e2d7b5096de3a4cd247bd07c4cdac0c72e50f3`](https://github.com/ponder-sh/ponder/commit/17e2d7b5096de3a4cd247bd07c4cdac0c72e50f3) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed indexing metrics for apps with crash recovery.

- [#1530](https://github.com/ponder-sh/ponder/pull/1530) [`d6d4bd541ae83aec6aa4cc2c940b1c6ff83984ea`](https://github.com/ponder-sh/ponder/commit/d6d4bd541ae83aec6aa4cc2c940b1c6ff83984ea) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed `/status` response.

## 0.9.13

### Patch Changes

- [#1528](https://github.com/ponder-sh/ponder/pull/1528) [`3c8aecebd9c0b697b5583adedfcf047db2e515ab`](https://github.com/ponder-sh/ponder/commit/3c8aecebd9c0b697b5583adedfcf047db2e515ab) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.9.6 causing realtime events to be missed.

## 0.9.12

### Patch Changes

- [#1520](https://github.com/ponder-sh/ponder/pull/1520) [`f5d690aeeabea8449c76a5e042042bd0367a03fc`](https://github.com/ponder-sh/ponder/commit/f5d690aeeabea8449c76a5e042042bd0367a03fc) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with passing undefined values to `db.update().set()`.

## 0.9.11

### Patch Changes

- [#1517](https://github.com/ponder-sh/ponder/pull/1517) [`452c6997466144b775f7f7e8e43715c6a1f287e1`](https://github.com/ponder-sh/ponder/commit/452c6997466144b775f7f7e8e43715c6a1f287e1) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where hex value arguments to singular query fields in GraphQL did not respect case-insensitive comparison.

- [#1509](https://github.com/ponder-sh/ponder/pull/1509) [`e267f7e29d0996384590f898553e323499a8b616`](https://github.com/ponder-sh/ponder/commit/e267f7e29d0996384590f898553e323499a8b616) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed some (not all) type compatibility issues when using `@ponder/client` and `@ponder/react`.

## 0.9.10

### Patch Changes

- [#1514](https://github.com/ponder-sh/ponder/pull/1514) [`ad78e7c69374ffac17c9b410452fef0be226a402`](https://github.com/ponder-sh/ponder/commit/ad78e7c69374ffac17c9b410452fef0be226a402) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with parsing array column values.

## 0.9.9

### Patch Changes

- [#1499](https://github.com/ponder-sh/ponder/pull/1499) [`6afbd955c3bb00bf35729593164eb568354b72a1`](https://github.com/ponder-sh/ponder/commit/6afbd955c3bb00bf35729593164eb568354b72a1) Thanks [@kyscott18](https://github.com/kyscott18)! - Improve historical indexing performance.

## 0.9.8

### Patch Changes

- [#1510](https://github.com/ponder-sh/ponder/pull/1510) [`66dcd4d0a1aeeee63b54fe54dc12b5428f99f1e6`](https://github.com/ponder-sh/ponder/commit/66dcd4d0a1aeeee63b54fe54dc12b5428f99f1e6) Thanks [@kyscott18](https://github.com/kyscott18)! - Set statement timeout for graphql and ponder client queries to 30 seconds.

- [#1488](https://github.com/ponder-sh/ponder/pull/1488) [`388cd50d52716cfe1b2e00afff0ae7e0da844822`](https://github.com/ponder-sh/ponder/commit/388cd50d52716cfe1b2e00afff0ae7e0da844822) Thanks [@jaydenwindle](https://github.com/jaydenwindle)! - Added `--disable-ui` CLI flag to `ponder dev`.

## 0.9.7

### Patch Changes

- [#1504](https://github.com/ponder-sh/ponder/pull/1504) [`ecef4427af4d2209ce98898b15a2f7e051134974`](https://github.com/ponder-sh/ponder/commit/ecef4427af4d2209ce98898b15a2f7e051134974) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a memory leak for apps with `ordering: "multichain"` introduced in v0.9.3.

## 0.9.6

### Patch Changes

- [#1500](https://github.com/ponder-sh/ponder/pull/1500) [`55735c31b8a2c0a5a57e9bbb9977fc8f13771055`](https://github.com/ponder-sh/ponder/commit/55735c31b8a2c0a5a57e9bbb9977fc8f13771055) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug when decoding events in realtime mode.

## 0.9.5

### Patch Changes

- [#1489](https://github.com/ponder-sh/ponder/pull/1489) [`36ed9e722e8416015d5f6172646028428c3c882f`](https://github.com/ponder-sh/ponder/commit/36ed9e722e8416015d5f6172646028428c3c882f) Thanks [@jaydenwindle](https://github.com/jaydenwindle)! - Improve error message when forgetting to export enum from `ponder.schema.ts`.

- [#1494](https://github.com/ponder-sh/ponder/pull/1494) [`bfdac22887465b440f3c3075f16a490376c25350`](https://github.com/ponder-sh/ponder/commit/bfdac22887465b440f3c3075f16a490376c25350) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved eth_getLogs retry estimate and shutdown behavior.

## 0.9.4

### Patch Changes

- [#1485](https://github.com/ponder-sh/ponder/pull/1485) [`57eee3f9800674b2da71667749860d6d4e382632`](https://github.com/ponder-sh/ponder/commit/57eee3f9800674b2da71667749860d6d4e382632) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Added support for the `"latest"` block tag as a `startBlock` or `endBlock` value in `ponder.config.ts`. This option fetches the latest block during the build step and uses that block number.

## 0.9.3

### Patch Changes

- [#1441](https://github.com/ponder-sh/ponder/pull/1441) [`626e5244aca1d32ad4686d434975e28b691f618b`](https://github.com/ponder-sh/ponder/commit/626e5244aca1d32ad4686d434975e28b691f618b) Thanks [@kyscott18](https://github.com/kyscott18)! - Removed metrics `ponder_indexing_total_seconds` and `ponder_indexing_completed_seconds`. Added metrics `ponder_historical_total_indexing_seconds`, `ponder_historical_cached_indexing_seconds`, and `ponder_historical_completed_indexing_seconds`. Renamed metric `ponder_indexing_completed_timestamp` to `ponder_indexing_timestamp`.

- [#1441](https://github.com/ponder-sh/ponder/pull/1441) [`626e5244aca1d32ad4686d434975e28b691f618b`](https://github.com/ponder-sh/ponder/commit/626e5244aca1d32ad4686d434975e28b691f618b) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved shutdown behavior and hot reload reliability.

- [#1441](https://github.com/ponder-sh/ponder/pull/1441) [`626e5244aca1d32ad4686d434975e28b691f618b`](https://github.com/ponder-sh/ponder/commit/626e5244aca1d32ad4686d434975e28b691f618b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added debug and info-level logs to the realtime and historical sync to improve observability.

- [#1441](https://github.com/ponder-sh/ponder/pull/1441) [`626e5244aca1d32ad4686d434975e28b691f618b`](https://github.com/ponder-sh/ponder/commit/626e5244aca1d32ad4686d434975e28b691f618b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added a new optional `ordering` field to `ponder.config.ts`, which specifies how events across multiple chains should be ordered. The options are `"omnichain"` (default, current behavior) and `"multichain"` (new strategy, opt-in). [Read more](https://ponder.sh/docs/api-reference/config#event-ordering).

## 0.9.2

### Patch Changes

- [#1479](https://github.com/ponder-sh/ponder/pull/1479) [`b7a6fcf1e74ec69404611a723adf6344b6d3614e`](https://github.com/ponder-sh/ponder/commit/b7a6fcf1e74ec69404611a723adf6344b6d3614e) Thanks [@typedarray](https://github.com/typedarray)! - Fixed peer dependency resolution issues with `kysely`.

- [`3855a47dd4cb8199e7260969a57714a40c13c898`](https://github.com/ponder-sh/ponder/commit/3855a47dd4cb8199e7260969a57714a40c13c898) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where the process would crash with "crypto" is not defined on Node 18.

- [#1482](https://github.com/ponder-sh/ponder/pull/1482) [`375e2935bf11f31aaa3825d257a7de5af4c08ae3`](https://github.com/ponder-sh/ponder/commit/375e2935bf11f31aaa3825d257a7de5af4c08ae3) Thanks [@shrugs](https://github.com/shrugs)! - Fixed a bug where `t.bigint().array()` column values greater than `Number.MAX_SAFE_INTEGER` would lose precision when using Postgres.

## 0.9.1

### Patch Changes

- [#1473](https://github.com/ponder-sh/ponder/pull/1473) [`02756d0809ca57369c13e6988a3b275be70f3df9`](https://github.com/ponder-sh/ponder/commit/02756d0809ca57369c13e6988a3b275be70f3df9) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a Windows build error introduced in `0.9.0`.

## 0.9.0

### Minor Changes

- [#1367](https://github.com/ponder-sh/ponder/pull/1367) [`68097b429752e429291b71e5d2722ee944b0915a`](https://github.com/ponder-sh/ponder/commit/68097b429752e429291b71e5d2722ee944b0915a) Thanks [@kyscott18](https://github.com/kyscott18)! - Released `0.9`. Visit the [migration guide](https://ponder.sh/docs/migration-guide) for details.

## 0.8.33

### Patch Changes

- [#1467](https://github.com/ponder-sh/ponder/pull/1467) [`32991725dd89cb1384f6de747c729b94bd0d4421`](https://github.com/ponder-sh/ponder/commit/32991725dd89cb1384f6de747c729b94bd0d4421) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Improved rpc error retry logic.

## 0.8.32

### Patch Changes

- [#1460](https://github.com/ponder-sh/ponder/pull/1460) [`e54f9b5ebf9595ce299d32d5389b9ac14ad1c852`](https://github.com/ponder-sh/ponder/commit/e54f9b5ebf9595ce299d32d5389b9ac14ad1c852) Thanks [@holic](https://github.com/holic)! - Improved logging for realtime sync errors.

## 0.8.31

### Patch Changes

- [#1458](https://github.com/ponder-sh/ponder/pull/1458) [`e4f6c199308ce8e6173931321e4231cadb1632a2`](https://github.com/ponder-sh/ponder/commit/e4f6c199308ce8e6173931321e4231cadb1632a2) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where indexing errors would sometimes be obfuscated by an internal error like `Cannot read properties of undefined (reading 'hash')`.

## 0.8.30

### Patch Changes

- [#1454](https://github.com/ponder-sh/ponder/pull/1454) [`14959005f40bd7bff4e7a91df16f1bf4565e9e30`](https://github.com/ponder-sh/ponder/commit/14959005f40bd7bff4e7a91df16f1bf4565e9e30) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with schema awareness when two ponder apps are in the same database.

## 0.8.29

### Patch Changes

- [#1451](https://github.com/ponder-sh/ponder/pull/1451) [`0cea2677997a24299e62a0dc040ce1f9ba4f4a47`](https://github.com/ponder-sh/ponder/commit/0cea2677997a24299e62a0dc040ce1f9ba4f4a47) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved reorg handling resilience.

## 0.8.28

### Patch Changes

- [#1448](https://github.com/ponder-sh/ponder/pull/1448) [`fea49c5eac99ad811061ab532021fcbf1869e976`](https://github.com/ponder-sh/ponder/commit/fea49c5eac99ad811061ab532021fcbf1869e976) Thanks [@kyscott18](https://github.com/kyscott18)! - Added more rpc response validation.

## 0.8.27

### Patch Changes

- [#1443](https://github.com/ponder-sh/ponder/pull/1443) [`595e9684684be414465efb910dc03e0d489c5011`](https://github.com/ponder-sh/ponder/commit/595e9684684be414465efb910dc03e0d489c5011) Thanks [@typedarray](https://github.com/typedarray)! - Improve trace-level logging and retry logic for database operations.

## 0.8.26

### Patch Changes

- [#1438](https://github.com/ponder-sh/ponder/pull/1438) [`c4e17d9ac89e01c2591c49af486417131a59369b`](https://github.com/ponder-sh/ponder/commit/c4e17d9ac89e01c2591c49af486417131a59369b) Thanks [@kyscott18](https://github.com/kyscott18)! - Added "ponder_realtime_latency" metric.

## 0.8.25

### Patch Changes

- [#1437](https://github.com/ponder-sh/ponder/pull/1437) [`229419634521e287dd7f642f8b08dfe16cd17653`](https://github.com/ponder-sh/ponder/commit/229419634521e287dd7f642f8b08dfe16cd17653) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved the granularity of rpc cache.

## 0.8.24

### Patch Changes

- [#1435](https://github.com/ponder-sh/ponder/pull/1435) [`d891abaf25a939684f473cc2df90e3c89cfe6f2d`](https://github.com/ponder-sh/ponder/commit/d891abaf25a939684f473cc2df90e3c89cfe6f2d) Thanks [@tk-o](https://github.com/tk-o)! - Fixed a bug causing setup function with multiple networks to error.

## 0.8.23

### Patch Changes

- [#1430](https://github.com/ponder-sh/ponder/pull/1430) [`b3ec95059103c7bcc2babd9ff5f7d6dbdb239982`](https://github.com/ponder-sh/ponder/commit/b3ec95059103c7bcc2babd9ff5f7d6dbdb239982) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where ZKsync system logs with transaction receipts failed with the error `Detected inconsistent RPC responses. 'transaction.hash' 0x0000000000000000000000000000000000000000000000000000000000000000 not found in eth_getBlockReceipts response for block (...)`.

## 0.8.22

### Patch Changes

- [#1426](https://github.com/ponder-sh/ponder/pull/1426) [`bd52302092d5393012a100617541d533362ac927`](https://github.com/ponder-sh/ponder/commit/bd52302092d5393012a100617541d533362ac927) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with traces containing invalid byte sequences.

## 0.8.21

### Patch Changes

- [#1424](https://github.com/ponder-sh/ponder/pull/1424) [`60e7b6a33f3280eb08412cbec742e3d23d0d4404`](https://github.com/ponder-sh/ponder/commit/60e7b6a33f3280eb08412cbec742e3d23d0d4404) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where indexing errors did not include the block number and transaction hash of the event being indexed.

## 0.8.20

### Patch Changes

- [`85c9b3247bcb52c8d567f93ab19aee5746d8923d`](https://github.com/ponder-sh/ponder/commit/85c9b3247bcb52c8d567f93ab19aee5746d8923d) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug introduced in 0.8.14 which caused unnecessary `eth_getBlockReceipts` requests.

- [#1421](https://github.com/ponder-sh/ponder/pull/1421) [`de4b398fba7c1d93e12e5500fcc598239b04597a`](https://github.com/ponder-sh/ponder/commit/de4b398fba7c1d93e12e5500fcc598239b04597a) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where events between the historical backfill and live indexing were skipped. This does not affect the rpc cache.

## 0.8.19

### Patch Changes

- [#1416](https://github.com/ponder-sh/ponder/pull/1416) [`7234384afb6d18e1ca3d6c291ebe7db111773c06`](https://github.com/ponder-sh/ponder/commit/7234384afb6d18e1ca3d6c291ebe7db111773c06) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing the error: `trigger "_reorg__xyz" for relation "xyz" already exists`.

## 0.8.18

### Patch Changes

- [#1414](https://github.com/ponder-sh/ponder/pull/1414) [`3aa89415a528152c32cd5d9fea0f4b65061bb232`](https://github.com/ponder-sh/ponder/commit/3aa89415a528152c32cd5d9fea0f4b65061bb232) Thanks [@typedarray](https://github.com/typedarray)! - Fixed the `FlushError: invalid byte sequence for encoding "UTF8": 0x00` error by removing null characters from decoded ABI parameters.

## 0.8.17

### Patch Changes

- [#1411](https://github.com/ponder-sh/ponder/pull/1411) [`60704d3974387cb625c8fe2e45026fc2235622b9`](https://github.com/ponder-sh/ponder/commit/60704d3974387cb625c8fe2e45026fc2235622b9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where ZKsync system logs failed with the error `Detected inconsistent RPC responses. 'log.transactionHash' 0x0000000000000000000000000000000000000000000000000000000000000000 not found in 'block.transactions' (...)`.

## 0.8.16

### Patch Changes

- [#1407](https://github.com/ponder-sh/ponder/pull/1407) [`bfc51efc1e767ff2670494ecbb14b332bc2d3d05`](https://github.com/ponder-sh/ponder/commit/bfc51efc1e767ff2670494ecbb14b332bc2d3d05) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a Windows bug introduced in `0.8.0` where the build would fail with the error "Failed to load url (...) in ponder:schema". Fixed a Windows bug where the build would fail when using an in-memory PGlite database with the error "Path contains invalid characters: memory://".

## 0.8.15

### Patch Changes

- [#1403](https://github.com/ponder-sh/ponder/pull/1403) [`95aa8102cb44c4628dc89634724fd6432cb4f93f`](https://github.com/ponder-sh/ponder/commit/95aa8102cb44c4628dc89634724fd6432cb4f93f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where a reorg sometimes caused events to be skipped. This does not affect the rpc cache.

## 0.8.14

### Patch Changes

- [#1342](https://github.com/ponder-sh/ponder/pull/1342) [`f49e62d888cd1e9ed2555331b84701ad8b0e8604`](https://github.com/ponder-sh/ponder/commit/f49e62d888cd1e9ed2555331b84701ad8b0e8604) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Added support for "eth_getBlockReceipts" request for better performance and cost.

## 0.8.13

### Patch Changes

- [#1397](https://github.com/ponder-sh/ponder/pull/1397) [`787a8dc1d92b08ed85ee9762ef41fd0918f163ef`](https://github.com/ponder-sh/ponder/commit/787a8dc1d92b08ed85ee9762ef41fd0918f163ef) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug resulting in `error: ON CONFLICT DO UPDATE command cannot affect row a second time`.

## 0.8.12

### Patch Changes

- [#1389](https://github.com/ponder-sh/ponder/pull/1389) [`f78e29ace56bdf2746a452c113e88cba5172401c`](https://github.com/ponder-sh/ponder/commit/f78e29ace56bdf2746a452c113e88cba5172401c) Thanks [@kyscott18](https://github.com/kyscott18)! - Pinned @electric-sql/pglite dependency to v0.2.13. Fixed `"information_schema.schemata" does not exist` error.

## 0.8.11

### Patch Changes

- [#1394](https://github.com/ponder-sh/ponder/pull/1394) [`4ea0ef5f055e38e60f59ea4a03046b64100d92bc`](https://github.com/ponder-sh/ponder/commit/4ea0ef5f055e38e60f59ea4a03046b64100d92bc) Thanks [@kyscott18](https://github.com/kyscott18)! - Added trace level logs for rpc requests.

## 0.8.10

### Patch Changes

- [#1370](https://github.com/ponder-sh/ponder/pull/1370) [`61b0b04c3306929bf2ff1ef781be874f561d8e11`](https://github.com/ponder-sh/ponder/commit/61b0b04c3306929bf2ff1ef781be874f561d8e11) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Fixed a bug causing future end blocks to error.

## 0.8.9

### Patch Changes

- [#1381](https://github.com/ponder-sh/ponder/pull/1381) [`dae8801ea3ddf732d8284ff84bc7dc21ada22f0e`](https://github.com/ponder-sh/ponder/commit/dae8801ea3ddf732d8284ff84bc7dc21ada22f0e) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where data inserted using raw SQL near the beginning of historical indexing was not found by subsequent `find`, `update`, or `delete` operations using the store/in-memory API.

- [#1375](https://github.com/ponder-sh/ponder/pull/1375) [`1687033a74fb8e7a7d843b4fe1f7f1cd4cf866a9`](https://github.com/ponder-sh/ponder/commit/1687033a74fb8e7a7d843b4fe1f7f1cd4cf866a9) Thanks [@typedarray](https://github.com/typedarray)! - Improved logs for Postgres pool errors.

## 0.8.8

### Patch Changes

- [#1368](https://github.com/ponder-sh/ponder/pull/1368) [`492d7e7744dbddede2e72b0649cd7dffb96173cd`](https://github.com/ponder-sh/ponder/commit/492d7e7744dbddede2e72b0649cd7dffb96173cd) Thanks [@typedarray](https://github.com/typedarray)! - Improved debug-level logs for historical indexing observability.

## 0.8.7

### Patch Changes

- [#1355](https://github.com/ponder-sh/ponder/pull/1355) [`083f11420a4030b15dd710f86521406fdbb52b74`](https://github.com/ponder-sh/ponder/commit/083f11420a4030b15dd710f86521406fdbb52b74) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with detecting cached rpc requests.

## 0.8.6

### Patch Changes

- [#1349](https://github.com/ponder-sh/ponder/pull/1349) [`4b18d8d2ab45475eea651e0db5c515b1242031f5`](https://github.com/ponder-sh/ponder/commit/4b18d8d2ab45475eea651e0db5c515b1242031f5) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue leading to "could not determine data type of parameter" for some postgres versions.

## 0.8.5

### Patch Changes

- [#1345](https://github.com/ponder-sh/ponder/pull/1345) [`7ec278f0fe5d71ebb5386a5f948ef63f158c174c`](https://github.com/ponder-sh/ponder/commit/7ec278f0fe5d71ebb5386a5f948ef63f158c174c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that caused no events to be found in the historical backfill. Affected users should resync their apps to get rid of the incorrect cached data.

## 0.8.4

### Patch Changes

- [#1335](https://github.com/ponder-sh/ponder/pull/1335) [`77b92ef14fa4a0491f04a009cd2158af8f77c656`](https://github.com/ponder-sh/ponder/commit/77b92ef14fa4a0491f04a009cd2158af8f77c656) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that occassionaly caused reorgs to lead to missing events. Please note that this did not affect the rpc cache, users do not have to re-sync.

## 0.8.3

### Patch Changes

- [#1333](https://github.com/ponder-sh/ponder/pull/1333) [`7e9e92ad16654350b787e8c5f15545860bad3b35`](https://github.com/ponder-sh/ponder/commit/7e9e92ad16654350b787e8c5f15545860bad3b35) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a graphql bug when using enums in a primary key.

## 0.8.2

### Patch Changes

- [#1330](https://github.com/ponder-sh/ponder/pull/1330) [`0c7395ff2e86ac9f6431e4d702965e2036c35d64`](https://github.com/ponder-sh/ponder/commit/0c7395ff2e86ac9f6431e4d702965e2036c35d64) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with crash recovery.

## 0.8.1

### Patch Changes

- [#1328](https://github.com/ponder-sh/ponder/pull/1328) [`6df44c91095ec337faf27a8eb6e3ddfa48641b7c`](https://github.com/ponder-sh/ponder/commit/6df44c91095ec337faf27a8eb6e3ddfa48641b7c) Thanks [@3commascapital](https://github.com/3commascapital)! - Fixed a bug introduced in v0.8.0 with using an array of addresses in `ponder.config.ts`.

## 0.8.0

### Minor Changes

- [#1235](https://github.com/ponder-sh/ponder/pull/1235) [`37ed2e1278cb70c6ff2c82b64852ff4c6324e969`](https://github.com/ponder-sh/ponder/commit/37ed2e1278cb70c6ff2c82b64852ff4c6324e969) Thanks [@kyscott18](https://github.com/kyscott18)! - Released `0.8`. Visit the [migration guide](https://ponder.sh/docs/migration-guide) for a full list of changes.

## 0.7.17

### Patch Changes

- [#1321](https://github.com/ponder-sh/ponder/pull/1321) [`63d95d5e7fd79d7f276746fc5fe3f9c38bb43762`](https://github.com/ponder-sh/ponder/commit/63d95d5e7fd79d7f276746fc5fe3f9c38bb43762) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that caused too many rows to be reverted after a reorg when using `.sql()` raw database access.

## 0.7.16

### Patch Changes

- [`df699d14b75bf65fd4be9d9587f8192f3b3c9271`](https://github.com/ponder-sh/ponder/commit/df699d14b75bf65fd4be9d9587f8192f3b3c9271) Thanks [@typedarray](https://github.com/typedarray)! - Reset latest tag.

## 0.7.15

### Patch Changes

- [#1311](https://github.com/ponder-sh/ponder/pull/1311) [`0a02afa0512b30150935bf424a742bbb04a2915b`](https://github.com/ponder-sh/ponder/commit/0a02afa0512b30150935bf424a742bbb04a2915b) Thanks [@typedarray](https://github.com/typedarray)! - Fixed a bug where the GraphiQL explorer displayed "Loading..." as soon as React 19 was released. The fix pins the `react` and `react-dom` versions in the GraphiQL HTML to `18.3.1`.

## 0.7.14

### Patch Changes

- [#1305](https://github.com/ponder-sh/ponder/pull/1305) [`6ebb19dc51d97f311455b4091183c52bba716081`](https://github.com/ponder-sh/ponder/commit/6ebb19dc51d97f311455b4091183c52bba716081) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.7.6 that caused errors with `flush()`.

## 0.7.13

### Patch Changes

- [#1293](https://github.com/ponder-sh/ponder/pull/1293) [`f7190e313ab6aa7b0180e8dc0f96c9195799bd74`](https://github.com/ponder-sh/ponder/commit/f7190e313ab6aa7b0180e8dc0f96c9195799bd74) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue where the database did not contain recent records when running `ponder dev`. Now, the indexing store flushes to the database every 5 seconds regardless of the size of the in-memory cache.

## 0.7.12

### Patch Changes

- [#1300](https://github.com/ponder-sh/ponder/pull/1300) [`31fa94b34bc4fd9f7c64f3934b2a92f709e17bc8`](https://github.com/ponder-sh/ponder/commit/31fa94b34bc4fd9f7c64f3934b2a92f709e17bc8) Thanks [@kyscott18](https://github.com/kyscott18)! - Update drizzle-orm to v0.36.

## 0.7.11

### Patch Changes

- [#1280](https://github.com/ponder-sh/ponder/pull/1280) [`38ffc034b80ac0e5259efaebd2e170e95b75fa9c`](https://github.com/ponder-sh/ponder/commit/38ffc034b80ac0e5259efaebd2e170e95b75fa9c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed values returned by indexing store in realtime.

- [#1280](https://github.com/ponder-sh/ponder/pull/1280) [`38ffc034b80ac0e5259efaebd2e170e95b75fa9c`](https://github.com/ponder-sh/ponder/commit/38ffc034b80ac0e5259efaebd2e170e95b75fa9c) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed return type for `db.insert()` with multiple values.

- Updated dependencies [[`0bb76fdc10bdf4f88980ed99d06c0e672094dce7`](https://github.com/ponder-sh/ponder/commit/0bb76fdc10bdf4f88980ed99d06c0e672094dce7)]:
  - @ponder/utils@0.2.3

## 0.7.10

### Patch Changes

- [#1274](https://github.com/ponder-sh/ponder/pull/1274) [`faf616adf82c0f8dd8482414efdf8723b06f6f8a`](https://github.com/ponder-sh/ponder/commit/faf616adf82c0f8dd8482414efdf8723b06f6f8a) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed several GraphQL bugs introduced in `0.7.0` that affected tables and columns using snake_case.

## 0.7.9

### Patch Changes

- [#1268](https://github.com/ponder-sh/ponder/pull/1268) [`68f786197ae0d44a7aa19852e17ac792549188f7`](https://github.com/ponder-sh/ponder/commit/68f786197ae0d44a7aa19852e17ac792549188f7) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where `one` relations were sometimes incorrectly marked as non-null in the GraphQL schema, which caused "Cannot return null for non-nullable field" errors when the related entity was not found.

- [#1269](https://github.com/ponder-sh/ponder/pull/1269) [`700e060791a5575ba684fac49c3a32edfac16726`](https://github.com/ponder-sh/ponder/commit/700e060791a5575ba684fac49c3a32edfac16726) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed tables not being cleaned up.

- [#1273](https://github.com/ponder-sh/ponder/pull/1273) [`a0e1613c47a0ebcaaf2a4cabc5d8bf62ce8489bf`](https://github.com/ponder-sh/ponder/commit/a0e1613c47a0ebcaaf2a4cabc5d8bf62ce8489bf) Thanks [@0xOlias](https://github.com/0xOlias)! - Improve logging for flush errors.

## 0.7.8

### Patch Changes

- [#1263](https://github.com/ponder-sh/ponder/pull/1263) [`08e6fd2dea41f083ebdf4c2759819803c8619171`](https://github.com/ponder-sh/ponder/commit/08e6fd2dea41f083ebdf4c2759819803c8619171) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed "Failed '[table].flush()' database method" bug introduced in v0.7.6.

## 0.7.7

### Patch Changes

- [#1257](https://github.com/ponder-sh/ponder/pull/1257) [`dc768bdd06077915e7b37bf84bc0a0d23fc1c8b8`](https://github.com/ponder-sh/ponder/commit/dc768bdd06077915e7b37bf84bc0a0d23fc1c8b8) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the `codegen` command did not generate `generated/schema.graphql`.

- [#1259](https://github.com/ponder-sh/ponder/pull/1259) [`1e5119ddeb9494f9c420ee2e11bf55bbdfc387ee`](https://github.com/ponder-sh/ponder/commit/1e5119ddeb9494f9c420ee2e11bf55bbdfc387ee) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `totalCount` field to the plural GraphQL connection type, which returns the total number of records in the database that match the specified `where` clause. [Read more](https://ponder.sh/docs/query/graphql#total-count).

## 0.7.6

### Patch Changes

- [#1251](https://github.com/ponder-sh/ponder/pull/1251) [`2806076d48803d3dd39789eeb71d1ec75ef70f86`](https://github.com/ponder-sh/ponder/commit/2806076d48803d3dd39789eeb71d1ec75ef70f86) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved memory usage during historical indexing.

- [#1250](https://github.com/ponder-sh/ponder/pull/1250) [`a142bbd005af561187d48588c4ce50fb59e25de1`](https://github.com/ponder-sh/ponder/commit/a142bbd005af561187d48588c4ce50fb59e25de1) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug in reorg reconciliation logic.

## 0.7.5

### Patch Changes

- [#1252](https://github.com/ponder-sh/ponder/pull/1252) [`8b211d652dce3c0449d20e39a2d88c0463f44891`](https://github.com/ponder-sh/ponder/commit/8b211d652dce3c0449d20e39a2d88c0463f44891) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved error log for `context.db.update()`.

## 0.7.4

### Patch Changes

- [#1247](https://github.com/ponder-sh/ponder/pull/1247) [`214b7fad6272a402a57e0e11d5e9d7680c0f1ea7`](https://github.com/ponder-sh/ponder/commit/214b7fad6272a402a57e0e11d5e9d7680c0f1ea7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed `onchainSchema()` with pglite.

- [#1247](https://github.com/ponder-sh/ponder/pull/1247) [`214b7fad6272a402a57e0e11d5e9d7680c0f1ea7`](https://github.com/ponder-sh/ponder/commit/214b7fad6272a402a57e0e11d5e9d7680c0f1ea7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed crash recovery, specifically build ID generation.

## 0.7.3

### Patch Changes

- [#1245](https://github.com/ponder-sh/ponder/pull/1245) [`7f4f456ab574a5017c7e45e3667eb16ab8a719a9`](https://github.com/ponder-sh/ponder/commit/7f4f456ab574a5017c7e45e3667eb16ab8a719a9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with the `.default()` column modifier causing the value to be undefined.

## 0.7.2

### Patch Changes

- [#1243](https://github.com/ponder-sh/ponder/pull/1243) [`2cf9d8d45a688039c186884ff5dd97aa3fd5c7ae`](https://github.com/ponder-sh/ponder/commit/2cf9d8d45a688039c186884ff5dd97aa3fd5c7ae) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed `onchainSchema`.

- [#1242](https://github.com/ponder-sh/ponder/pull/1242) [`26edcd1c66741288fcce9600769bc27268c50e9e`](https://github.com/ponder-sh/ponder/commit/26edcd1c66741288fcce9600769bc27268c50e9e) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Fixed a bug with database instance id.

## 0.7.1

### Patch Changes

- [#1237](https://github.com/ponder-sh/ponder/pull/1237) [`ea872481f6eaf61fbc7a94fe60a21bdabd7a0352`](https://github.com/ponder-sh/ponder/commit/ea872481f6eaf61fbc7a94fe60a21bdabd7a0352) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with database instance id.

## 0.7.0

### Minor Changes

- [#1177](https://github.com/ponder-sh/ponder/pull/1177) [`374e7af4dba05ce7297a1d11c610ff01f5e3c991`](https://github.com/ponder-sh/ponder/commit/374e7af4dba05ce7297a1d11c610ff01f5e3c991) Thanks [@kyscott18](https://github.com/kyscott18)! - Introduced several breaking changes to `ponder.schema.ts` and the store API. Please read the [migration guide](https://ponder.sh/docs/migration-guide#07) for more information.

## 0.6.25

### Patch Changes

- [#1223](https://github.com/ponder-sh/ponder/pull/1223) [`bbc5cda48670010dd2d229d95a2da4e23c1a414d`](https://github.com/ponder-sh/ponder/commit/bbc5cda48670010dd2d229d95a2da4e23c1a414d) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a compatibility issue with hono 4.6.9.

## 0.6.24

### Patch Changes

- [#1218](https://github.com/ponder-sh/ponder/pull/1218) [`e988a4f3182da132333057b750cd9bad4aa44e92`](https://github.com/ponder-sh/ponder/commit/e988a4f3182da132333057b750cd9bad4aa44e92) Thanks [@kyscott18](https://github.com/kyscott18)! - Pinned hono version to fix a regression with cors headers.

## 0.6.23

### Patch Changes

- [#1199](https://github.com/ponder-sh/ponder/pull/1199) [`a21a309d477c0e5ac1d80f462aab699a41fc9423`](https://github.com/ponder-sh/ponder/commit/a21a309d477c0e5ac1d80f462aab699a41fc9423) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the build could fail with the opaque error `TypeError: Cannot set property message of ... which has only a getter`.

## 0.6.22

### Patch Changes

- Updated dependencies [[`0cbdf01f85f4180a62d0de671c7adc299b704104`](https://github.com/ponder-sh/ponder/commit/0cbdf01f85f4180a62d0de671c7adc299b704104)]:
  - @ponder/utils@0.2.2

## 0.6.21

### Patch Changes

- [#1191](https://github.com/ponder-sh/ponder/pull/1191) [`3ac88a6b4c172212f8713babd82b3f51d2e9f11f`](https://github.com/ponder-sh/ponder/commit/3ac88a6b4c172212f8713babd82b3f51d2e9f11f) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved error handling for failing `readContract` requests.

## 0.6.20

### Patch Changes

- [#1187](https://github.com/ponder-sh/ponder/pull/1187) [`02917d17e89edf002b1bcd3d8fac45ca00a6077f`](https://github.com/ponder-sh/ponder/commit/02917d17e89edf002b1bcd3d8fac45ca00a6077f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug leading to `event.transaction` to be undefined. If your app was affected by this bug it is recommended to drop the "ponder_sync" database schema and resync.

## 0.6.19

### Patch Changes

- [#1185](https://github.com/ponder-sh/ponder/pull/1185) [`c1c3c166300a93c3f2970eed94a82241ddeb31e4`](https://github.com/ponder-sh/ponder/commit/c1c3c166300a93c3f2970eed94a82241ddeb31e4) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved performance of `updateMany()`.

## 0.6.18

### Patch Changes

- [#1180](https://github.com/ponder-sh/ponder/pull/1180) [`87893bc915c4bc8be78ff9301e29baf56ac9edbf`](https://github.com/ponder-sh/ponder/commit/87893bc915c4bc8be78ff9301e29baf56ac9edbf) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that causes some events to be skipped in realtime for apps with multiple chains. This bug did not affect the sync cache and does not require the app to be resynced.

## 0.6.17

### Patch Changes

- [#1178](https://github.com/ponder-sh/ponder/pull/1178) [`b48cf539df9672b26f3af601e5bc7c599c600db9`](https://github.com/ponder-sh/ponder/commit/b48cf539df9672b26f3af601e5bc7c599c600db9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.6.9 that caused new child contracts to be missed for factories with a list of addresses after the historical backfill was complete.

## 0.6.16

### Patch Changes

- [#1175](https://github.com/ponder-sh/ponder/pull/1175) [`a037110d558b4288feeff2a028305d7b5349d6df`](https://github.com/ponder-sh/ponder/commit/a037110d558b4288feeff2a028305d7b5349d6df) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved RPC validation error messages for matching `log.blockHash` and `trace.blockHash` with `block.hash`.

- [#1169](https://github.com/ponder-sh/ponder/pull/1169) [`b5992bca84949f6ac41f3587468e0b9f51c47887`](https://github.com/ponder-sh/ponder/commit/b5992bca84949f6ac41f3587468e0b9f51c47887) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the terminal UI would display the HTTP port as `0` after a hot reload. Fixed a bug where API function build errors would not trigger the terminal UI error state.

## 0.6.15

### Patch Changes

- [#1164](https://github.com/ponder-sh/ponder/pull/1164) [`087d393da96a5368b1c9594887b63485931518ec`](https://github.com/ponder-sh/ponder/commit/087d393da96a5368b1c9594887b63485931518ec) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.6.0 where the `disableCache` option did not correctly ignore the cache in some cases.

## 0.6.13

### Patch Changes

- [#1160](https://github.com/ponder-sh/ponder/pull/1160) [`c75f6587dc4cf9f5a35bd7a239f482f4ae2c6b7d`](https://github.com/ponder-sh/ponder/commit/c75f6587dc4cf9f5a35bd7a239f482f4ae2c6b7d) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.6 that caused events to be skipped near the end of the historical backfill. This bug did not affect the sync cache and does not require the app to be resynced.

## 0.6.12

### Patch Changes

- [#1152](https://github.com/ponder-sh/ponder/pull/1152) [`d436bdbeda7329658f127e01e0e2bfc9aeedff1a`](https://github.com/ponder-sh/ponder/commit/d436bdbeda7329658f127e01e0e2bfc9aeedff1a) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Added validations for inconsistent RPC responses.

## 0.6.11

### Patch Changes

- [#1155](https://github.com/ponder-sh/ponder/pull/1155) [`84889e6c00bae8f004a4e8665ec101a2a2f45e64`](https://github.com/ponder-sh/ponder/commit/84889e6c00bae8f004a4e8665ec101a2a2f45e64) Thanks [@sinasab](https://github.com/sinasab)! - Bumped `@hono/node-server` to fix a regression introduced in `0.5.0` that caused the HTTP server to not listen on IPv6 by default.

## 0.6.10

### Patch Changes

- [#1115](https://github.com/ponder-sh/ponder/pull/1115) [`1a7d1f8eaeddcc65730fecc89dd55594aa0b6920`](https://github.com/ponder-sh/ponder/commit/1a7d1f8eaeddcc65730fecc89dd55594aa0b6920) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved performance of realtime event processing.

## 0.6.9

### Patch Changes

- [#1149](https://github.com/ponder-sh/ponder/pull/1149) [`988289e97bb47e122d0dd177a890bbb6fbd719ea`](https://github.com/ponder-sh/ponder/commit/988289e97bb47e122d0dd177a890bbb6fbd719ea) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug where the `/status` endpoint would temporarily return incorrect data during realtime.

## 0.6.8

### Patch Changes

- [#1143](https://github.com/ponder-sh/ponder/pull/1143) [`9f86d5f56b17231bd412b2d231bf623b5948fbaa`](https://github.com/ponder-sh/ponder/commit/9f86d5f56b17231bd412b2d231bf623b5948fbaa) Thanks [@khaidarkairbek](https://github.com/khaidarkairbek)! - Eliminated unnecessary `eth_getTransactionReceipt` requests in realtime when `includeTransactionReceipts` was set to `true`.

## 0.6.7

### Patch Changes

- [#1137](https://github.com/ponder-sh/ponder/pull/1137) [`1f9482c7e402305eb837006bb8c659d5b2c8c900`](https://github.com/ponder-sh/ponder/commit/1f9482c7e402305eb837006bb8c659d5b2c8c900) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug that caused factory contracts with multiple addresses not to be cached.

## 0.6.6

### Patch Changes

- [#1130](https://github.com/ponder-sh/ponder/pull/1130) [`a50db23dda44c32289c661d8799a37c5c6a88ec4`](https://github.com/ponder-sh/ponder/commit/a50db23dda44c32289c661d8799a37c5c6a88ec4) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in `0.6.0` that caused some apps to log progress greater than 100% and re-sync blocks unnecessarily.

## 0.6.5

### Patch Changes

- [#1126](https://github.com/ponder-sh/ponder/pull/1126) [`0a3adb000d60e091b24a6e8facce194c41712fc6`](https://github.com/ponder-sh/ponder/commit/0a3adb000d60e091b24a6e8facce194c41712fc6) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.6 where extra transaction may be added to the database in the "realtime" sync when using factory contracts.

  Any users that were affected by this bug and want to reduce the database size can do so with the query:

  ```sql
  DELETE FROM ponder_sync.transactions WHERE
    hash NOT IN (SELECT "transactionHash" FROM ponder_sync.logs)
    AND
    hash NOT IN (SELECT "transactionHash" FROM ponder_sync."callTraces");
  ```

## 0.6.4

### Patch Changes

- [#1124](https://github.com/ponder-sh/ponder/pull/1124) [`75dc61d2c3bbbdfc0dd00fa8713428de7d0518c1`](https://github.com/ponder-sh/ponder/commit/75dc61d2c3bbbdfc0dd00fa8713428de7d0518c1) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing "getIntervals" to error on startup for some large, long-running apps.

## 0.6.3

### Patch Changes

- [#1118](https://github.com/ponder-sh/ponder/pull/1118) [`91cc17009eb8446c949eb8e352492dd8dff23b78`](https://github.com/ponder-sh/ponder/commit/91cc17009eb8446c949eb8e352492dd8dff23b78) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in `0.6.0` that caused a crash shortly after startup for some apps with a partial cache hit.

- [#1121](https://github.com/ponder-sh/ponder/pull/1121) [`2612ba2284f928303ad96db0496a7f1853c52de5`](https://github.com/ponder-sh/ponder/commit/2612ba2284f928303ad96db0496a7f1853c52de5) Thanks [@kyscott18](https://github.com/kyscott18)! - Pinned vite version. Some newer versions were known to cause hot reloading bugs.

## 0.6.2

### Patch Changes

- [#1113](https://github.com/ponder-sh/ponder/pull/1113) [`6c3b6cff1358cd0d8c30d2983183ba806797dedf`](https://github.com/ponder-sh/ponder/commit/6c3b6cff1358cd0d8c30d2983183ba806797dedf) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed address validation in config.

## 0.6.1

### Patch Changes

- Updated dependencies [[`6a5c8a54b9d976fa760c863512044d82702d0bb7`](https://github.com/ponder-sh/ponder/commit/6a5c8a54b9d976fa760c863512044d82702d0bb7)]:
  - @ponder/utils@0.2.1

## 0.6.0

### Minor Changes

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Deprecated the `maxBlockRange` option from the `networks` object in `ponder.config.ts`.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - BREAKING: Metrics changes. Replaced `ponder_historical_start_timestamp` with `ponder_historical_duration`, which improves the accuracy of sync duration estimates. Removed `ponder_indexing_function_error_total`. Removed the "network" label from `ponder_indexing_function_duration` and `ponder_indexing_completed_events`. Removed the "source" and "type" labels from `ponder_historical_total_blocks`, `ponder_historical_cached_blocks`, and `ponder_historical_completed_blocks`. Replaced `ponder_realtime_is_connected`, `ponder_realtime_latest_block_number`, and `ponder_realtime_latest_block_timestamp` with `ponder_sync_block`, `ponder_sync_is_realtime`, and `ponder_sync_is_complete`.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - BREAKING: Introduced the `/ready` endpoint, which returns an HTTP `200` response once the app has finished historical indexing and is ready to serve requests. Changed the behavior of the `/health` endpoint. Now, `/health` returns an HTTP `200` response as soon as the process starts. Removed the `maxHealthcheckDuration` option from `ponder.config.ts`, and removed the top-level `options` property. Read the [migration guide](https://ponder.sh/docs/migration-guide#060) for more details.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - BREAKING: Simplified Postgres schema usage pattern. Now, the indexed tables, reorg tables, and metadata table for a Ponder app are contained in one Postgres schema, specified by the user in `ponder.config.ts` (defaults to `public`). Removed usage of the shared `ponder` schema. Removed the view publishing pattern and removed the `publishSchema` option from `ponder.config.ts`. Fixed an issue where the `Schema is locked by a different Ponder app` warning would appear when running `ponder dev`. Read the [migration guide](https://ponder.sh/docs/migration-guide#060) for more details.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Removed the `maxHistoricalTaskConcurrency` option from the `networks` object in `ponder.config.ts`.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated `viem` peer dependency to `>=2`. Renamed the `context.client` action `getBytecode` to `getCode`. The `getEnsName` action is now supported. Improved performance of address checksum operations.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved `eth_getLogs` retry behavior. Now, the sync engine automatically determines the optimal block range for `eth_getLogs` requests.

### Patch Changes

- Updated dependencies [[`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f), [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f)]:
  - @ponder/utils@0.2.0

## 0.5.24

### Patch Changes

- [#1105](https://github.com/ponder-sh/ponder/pull/1105) [`b7a3bb586c7a12eaf05f070a3bbae38139d7607d`](https://github.com/ponder-sh/ponder/commit/b7a3bb586c7a12eaf05f070a3bbae38139d7607d) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug introduced in `0.4.33` where the `--trace`, `--debug`, `-v`, and `-vv` CLI options and the `PONDER_LOG_LEVEL` env var did not correctly set the log level. (The `--log-level` option still worked).

- [#1106](https://github.com/ponder-sh/ponder/pull/1106) [`ad7907468ab529c61ccdecb0001802b51e17bb2c`](https://github.com/ponder-sh/ponder/commit/ad7907468ab529c61ccdecb0001802b51e17bb2c) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved error message when registering no indexing functions.

## 0.5.23

### Patch Changes

- [#1096](https://github.com/ponder-sh/ponder/pull/1096) [`9b4a07716ad790e3bb3bac02d9af81f934b14a81`](https://github.com/ponder-sh/ponder/commit/9b4a07716ad790e3bb3bac02d9af81f934b14a81) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed metrics for event sources with unfinalized start blocks.

- [#1064](https://github.com/ponder-sh/ponder/pull/1064) [`5760e6ff2e067807cb7e29a5b1bf5677b1d0dd82`](https://github.com/ponder-sh/ponder/commit/5760e6ff2e067807cb7e29a5b1bf5677b1d0dd82) Thanks [@jaylmiller](https://github.com/jaylmiller)! - Fixed a bug where the terminal UI would display the wrong hostname.

## 0.5.22

### Patch Changes

- [#1087](https://github.com/ponder-sh/ponder/pull/1087) [`8fb12bcc6dc79d70f0da86ef6deeda3509096303`](https://github.com/ponder-sh/ponder/commit/8fb12bcc6dc79d70f0da86ef6deeda3509096303) Thanks [@kyscott18](https://github.com/kyscott18)! - Upgraded `@hono/node-server` to fix a bug where HTTP TRACE requests would throw an error.

## 0.5.21

### Patch Changes

- [#1077](https://github.com/ponder-sh/ponder/pull/1077) [`0f6213f7d907ea0de27deebb994823d20f379349`](https://github.com/ponder-sh/ponder/commit/0f6213f7d907ea0de27deebb994823d20f379349) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed "ponder_realtime_is_connected" metric.

- [#1075](https://github.com/ponder-sh/ponder/pull/1075) [`6f1a57947e2062ce2f8d1a59068fe751bfc764ef`](https://github.com/ponder-sh/ponder/commit/6f1a57947e2062ce2f8d1a59068fe751bfc764ef) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved performance of reorg handling, that in some cases was leading to query timeouts and stalled indexing.

## 0.5.20

### Patch Changes

- [#1063](https://github.com/ponder-sh/ponder/pull/1063) [`d849b052c16b774d5d5eaa6e3f77b4ac26983088`](https://github.com/ponder-sh/ponder/commit/d849b052c16b774d5d5eaa6e3f77b4ac26983088) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in 0.5.9 where extra blocks were being written to the database during the realtime sync.

- [#1070](https://github.com/ponder-sh/ponder/pull/1070) [`2b28d8368f531ce61556e706504e6372a620fd78`](https://github.com/ponder-sh/ponder/commit/2b28d8368f531ce61556e706504e6372a620fd78) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug causing out of order events when a contract is used as both a normal contract and a factory.

- [#1068](https://github.com/ponder-sh/ponder/pull/1068) [`a1557d9a16ea6d6a4060838d06f03c4a251da1b9`](https://github.com/ponder-sh/ponder/commit/a1557d9a16ea6d6a4060838d06f03c4a251da1b9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with factory contracts fetching and writing extra logs to the database.

- Updated dependencies [[`7c17ff32e8907b4a38d74cea2a431b689236048c`](https://github.com/ponder-sh/ponder/commit/7c17ff32e8907b4a38d74cea2a431b689236048c)]:
  - @ponder/utils@0.1.8

## 0.5.19

### Patch Changes

- [#1059](https://github.com/ponder-sh/ponder/pull/1059) [`7b8129dd2817fd7749511b5d0937a2818a9365c0`](https://github.com/ponder-sh/ponder/commit/7b8129dd2817fd7749511b5d0937a2818a9365c0) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved precision of historical sync cache for faster startup times.

## 0.5.18

### Patch Changes

- [#1056](https://github.com/ponder-sh/ponder/pull/1056) [`313267cbe93679b9b18a38929ee07b3a2008bb0f`](https://github.com/ponder-sh/ponder/commit/313267cbe93679b9b18a38929ee07b3a2008bb0f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug introduced in v0.5.9 that caused events to be missed in realtime when indexing multiple chains. This issue does not affect database integrity, but affected apps should restart to ensure all events are indexed.

## 0.5.17

### Patch Changes

- [#1050](https://github.com/ponder-sh/ponder/pull/1050) [`b3225f46f905addfa6e8eb9d5f181a595d2b0858`](https://github.com/ponder-sh/ponder/commit/b3225f46f905addfa6e8eb9d5f181a595d2b0858) Thanks [@jwahdatehagh](https://github.com/jwahdatehagh)! - Fixed a bug that caused a build error when including `BigInt` literals in the config object (e.g. in `filter.args`).

- [#1051](https://github.com/ponder-sh/ponder/pull/1051) [`aa2aecd8d0f6157cef849bd77f94ec9e7fd0a05e`](https://github.com/ponder-sh/ponder/commit/aa2aecd8d0f6157cef849bd77f94ec9e7fd0a05e) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed misconfigured Postgres pool size for `ponder serve`.

## 0.5.16

### Patch Changes

- [#1048](https://github.com/ponder-sh/ponder/pull/1048) [`c88b78ab0f91b9f4c499b936bacb4602c418f8dc`](https://github.com/ponder-sh/ponder/commit/c88b78ab0f91b9f4c499b936bacb4602c418f8dc) Thanks [@kyscott18](https://github.com/kyscott18)! - Exported Drizzle [`alias`](https://orm.drizzle.team/docs/joins#aliases--selfjoins) function which can be used in API functions.

## 0.5.15

### Patch Changes

- [#1045](https://github.com/ponder-sh/ponder/pull/1045) [`662c45f676307ed35b46cfed363e4cabf476d5c0`](https://github.com/ponder-sh/ponder/commit/662c45f676307ed35b46cfed363e4cabf476d5c0) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed `/status` endpoint not being updated during the historical backfill.

## 0.5.14

### Patch Changes

- [#1042](https://github.com/ponder-sh/ponder/pull/1042) [`2c21ffab0339675e4577017f06ee01dd3852a4fc`](https://github.com/ponder-sh/ponder/commit/2c21ffab0339675e4577017f06ee01dd3852a4fc) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in `0.5.9` that sometimes caused events to be skipped during indexing if any `startBlock` was set earlier than in a previous indexing run. This issue did not affect the database integrity, but affected apps should restart to ensure all events are indexed.

## 0.5.13

### Patch Changes

- [#1040](https://github.com/ponder-sh/ponder/pull/1040) [`1593d0cc6714c140132c9e855e4396c1386f67a2`](https://github.com/ponder-sh/ponder/commit/1593d0cc6714c140132c9e855e4396c1386f67a2) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in 0.5.9 that caused the terminal ui to error.

## 0.5.12

### Patch Changes

- [#1036](https://github.com/ponder-sh/ponder/pull/1036) [`118cadc90459f9d3d482e59b952743c06e4d9d12`](https://github.com/ponder-sh/ponder/commit/118cadc90459f9d3d482e59b952743c06e4d9d12) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in 0.5.9 that slowed down the historical backfill for apps with a large number of events.

## 0.5.11

### Patch Changes

- [#1032](https://github.com/ponder-sh/ponder/pull/1032) [`57b9b1373b45e6585ade689c63591294d60cc612`](https://github.com/ponder-sh/ponder/commit/57b9b1373b45e6585ade689c63591294d60cc612) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved historical sync efficiency by inserting transactions in batches

## 0.5.10

### Patch Changes

- [#1024](https://github.com/ponder-sh/ponder/pull/1024) [`47f1030a00b9d72f4d477641aafe5d99a6dc7a0e`](https://github.com/ponder-sh/ponder/commit/47f1030a00b9d72f4d477641aafe5d99a6dc7a0e) Thanks [@tmm](https://github.com/tmm)! - Fixed CLI syncing ETA table column formatting to be less jumpy.

- [#1026](https://github.com/ponder-sh/ponder/pull/1026) [`d39f3b3de52d5ccc6850c7b951c2d8d069c04316`](https://github.com/ponder-sh/ponder/commit/d39f3b3de52d5ccc6850c7b951c2d8d069c04316) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved accuracy of historical to realtime handoff by dynamically refetching finalized blocks.

- [#1029](https://github.com/ponder-sh/ponder/pull/1029) [`ea38d18fb36b2757e75362c221cec48dc4411450`](https://github.com/ponder-sh/ponder/commit/ea38d18fb36b2757e75362c221cec48dc4411450) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for factory contracts with multiple addresses.

- [#1025](https://github.com/ponder-sh/ponder/pull/1025) [`f7aafb6f3926493f45e2362a0edfa92099c6a7a5`](https://github.com/ponder-sh/ponder/commit/f7aafb6f3926493f45e2362a0edfa92099c6a7a5) Thanks [@kyscott18](https://github.com/kyscott18)! - Added "ponder_indexing_abi_decoding_duration" to metrics to track abi decoding duration.

- [#1025](https://github.com/ponder-sh/ponder/pull/1025) [`f7aafb6f3926493f45e2362a0edfa92099c6a7a5`](https://github.com/ponder-sh/ponder/commit/f7aafb6f3926493f45e2362a0edfa92099c6a7a5) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved ABI decoding performance, leading to a ~10% improvement in historical indexing speed.

- [#1027](https://github.com/ponder-sh/ponder/pull/1027) [`76b1a5b90f26dc86183cac3aaa1ec1a30fafac12`](https://github.com/ponder-sh/ponder/commit/76b1a5b90f26dc86183cac3aaa1ec1a30fafac12) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved historical sync efficiency by inserting blocks in batches

## 0.5.9

### Patch Changes

- [#1014](https://github.com/ponder-sh/ponder/pull/1014) [`d3507deaad1ec46efabb93e5a345576c156f508a`](https://github.com/ponder-sh/ponder/commit/d3507deaad1ec46efabb93e5a345576c156f508a) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved accurary of `/status` endpoint during historical indexing.

- [#1014](https://github.com/ponder-sh/ponder/pull/1014) [`d3507deaad1ec46efabb93e5a345576c156f508a`](https://github.com/ponder-sh/ponder/commit/d3507deaad1ec46efabb93e5a345576c156f508a) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved sync performance for factory contracts and removed the 10,000 child address limit.

## 0.5.8

### Patch Changes

- [#1019](https://github.com/ponder-sh/ponder/pull/1019) [`6ce5ce70df8101826b02779ea52a8e04725ad2a9`](https://github.com/ponder-sh/ponder/commit/6ce5ce70df8101826b02779ea52a8e04725ad2a9) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed issue with multi-network block intervals.

- [#1003](https://github.com/ponder-sh/ponder/pull/1003) [`f609fbee88f1cc49f59eb06e722a9345aef0174f`](https://github.com/ponder-sh/ponder/commit/f609fbee88f1cc49f59eb06e722a9345aef0174f) Thanks [@sinasab](https://github.com/sinasab)! - Fix default ipv6 support

## 0.5.7

### Patch Changes

- [#1015](https://github.com/ponder-sh/ponder/pull/1015) [`c19358158d3be13e0c8bab8450ba16ab3f71011d`](https://github.com/ponder-sh/ponder/commit/c19358158d3be13e0c8bab8450ba16ab3f71011d) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where requests to the HTTP server could cause a metric label cardinality explosion.

## 0.5.6

### Patch Changes

- [#1009](https://github.com/ponder-sh/ponder/pull/1009) [`98344a111f47a6a95b766afaf8ecbec5ef57542e`](https://github.com/ponder-sh/ponder/commit/98344a111f47a6a95b766afaf8ecbec5ef57542e) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated internal rpc request logic to not include invalid "eth_call" requests.

## 0.5.5

### Patch Changes

- [`1ced31b0acdf0c95e0e5029aeac774d0cff09a07`](https://github.com/ponder-sh/ponder/commit/1ced31b0acdf0c95e0e5029aeac774d0cff09a07) Thanks [@0xOlias](https://github.com/0xOlias)! - Updated `Access-Control-Max-Age` response header to `86400` seconds.

## 0.5.4

### Patch Changes

- [#1005](https://github.com/ponder-sh/ponder/pull/1005) [`bba168613896b84139d6546f8cf16855c5a3dcc9`](https://github.com/ponder-sh/ponder/commit/bba168613896b84139d6546f8cf16855c5a3dcc9) Thanks [@kyscott18](https://github.com/kyscott18)! - Enforced minimum polling interval of 100ms.

## 0.5.3

### Patch Changes

- [#1000](https://github.com/ponder-sh/ponder/pull/1000) [`8bbe39048e7dff402bfc14a4f77a6c7d5f431069`](https://github.com/ponder-sh/ponder/commit/8bbe39048e7dff402bfc14a4f77a6c7d5f431069) Thanks [@kyscott18](https://github.com/kyscott18)! - Update bloom filter logic.

## 0.5.2

### Patch Changes

- [#995](https://github.com/ponder-sh/ponder/pull/995) [`44f7bbcd000b47359003b84a771eaadb0d835fe7`](https://github.com/ponder-sh/ponder/commit/44f7bbcd000b47359003b84a771eaadb0d835fe7) Thanks [@erensanlier](https://github.com/erensanlier)! - Fixed a bug where the SQLite `directory` option in `ponder.config.ts` was not respected.

## 0.5.1

### Patch Changes

- [#970](https://github.com/ponder-sh/ponder/pull/970) [`5b5a92ee9ab14fdd3cc4cc0b05e4aa1e69a77ad9`](https://github.com/ponder-sh/ponder/commit/5b5a92ee9ab14fdd3cc4cc0b05e4aa1e69a77ad9) Thanks [@robiiinos](https://github.com/robiiinos)! - Added `CASCADE` to the `DROP VIEW` statements that run during the PostgreSQL view publish step. This fixes a bug where Ponder would crash during the publish step if there were database objects dependent on the Ponder-managed views.

- [#981](https://github.com/ponder-sh/ponder/pull/981) [`b715545ed416e409089e10b01aeb32cf26c4b384`](https://github.com/ponder-sh/ponder/commit/b715545ed416e409089e10b01aeb32cf26c4b384) Thanks [@robiiinos](https://github.com/robiiinos)! - Fixed a broken link to the telemetry documentation.

- [#980](https://github.com/ponder-sh/ponder/pull/980) [`e039f1210a72409f5df268b38adf3d45360f5a14`](https://github.com/ponder-sh/ponder/commit/e039f1210a72409f5df268b38adf3d45360f5a14) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed an issue that prevented `ponder dev` from shutting down gracefully when using SQLite.

## 0.5.0

### Minor Changes

- [#943](https://github.com/ponder-sh/ponder/pull/943) [`e997102fce758d532668430b14c0067955c462fd`](https://github.com/ponder-sh/ponder/commit/e997102fce758d532668430b14c0067955c462fd) Thanks [@kyscott18](https://github.com/kyscott18)! - Introduced API functions. [Read more](https://ponder.sh/docs/query/api-functions). Please read the [migration guide](https://ponder.sh/docs/migration-guide) for more information.

## 0.4.43

### Patch Changes

- [#972](https://github.com/ponder-sh/ponder/pull/972) [`93e36a2735fc1e4688e620a68aea60353fdeac09`](https://github.com/ponder-sh/ponder/commit/93e36a2735fc1e4688e620a68aea60353fdeac09) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed type error for `p.many()` with self reference.

## 0.4.42

### Patch Changes

- [#967](https://github.com/ponder-sh/ponder/pull/967) [`a143279fd2a200d9955eac06132b254107a13a41`](https://github.com/ponder-sh/ponder/commit/a143279fd2a200d9955eac06132b254107a13a41) Thanks [@0xOlias](https://github.com/0xOlias)! - Bumped `better-sqlite3` to `11.1.2` to improve prebuilt binary coverage.

- [#963](https://github.com/ponder-sh/ponder/pull/963) [`c58d6316d03d0e229ee8c9255f4a3d0604378241`](https://github.com/ponder-sh/ponder/commit/c58d6316d03d0e229ee8c9255f4a3d0604378241) Thanks [@kyscott18](https://github.com/kyscott18)! - Added an indexing status endpoint at `/status` and a `{ _meta { status } }` field in the GraphQL API. [Read more](https://ponder.sh/docs/advanced/status).

- Updated dependencies [[`e82e385b777cf6fccaf779fe8b12151b56456b68`](https://github.com/ponder-sh/ponder/commit/e82e385b777cf6fccaf779fe8b12151b56456b68)]:
  - @ponder/utils@0.1.7

## 0.4.41

### Patch Changes

- [#952](https://github.com/ponder-sh/ponder/pull/952) [`a3f30201f9d123b76b39abcc331f71a01f26c7f8`](https://github.com/ponder-sh/ponder/commit/a3f30201f9d123b76b39abcc331f71a01f26c7f8) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where circular imports between files (like `ponder.config.ts` and `src/index.ts`) would sometimes return `undefined` during the initial build.

## 0.4.40

### Patch Changes

- [#946](https://github.com/ponder-sh/ponder/pull/946) [`d6cc62e69670cc683596ab0dc0b90357b7bce644`](https://github.com/ponder-sh/ponder/commit/d6cc62e69670cc683596ab0dc0b90357b7bce644) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an indexing bug causing the "syntax error at end of input" error.

## 0.4.39

### Patch Changes

- [#944](https://github.com/ponder-sh/ponder/pull/944) [`7ca63a8f42c7a6650508a5c7904785c1a4780c47`](https://github.com/ponder-sh/ponder/commit/7ca63a8f42c7a6650508a5c7904785c1a4780c47) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed "too many SQL variables" bug for tables with >30 columns.

## 0.4.38

### Patch Changes

- [#939](https://github.com/ponder-sh/ponder/pull/939) [`81705fa2640754c42ddc3172aca8c3bd15bb7465`](https://github.com/ponder-sh/ponder/commit/81705fa2640754c42ddc3172aca8c3bd15bb7465) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issue introduced in v0.4.37 where updating a table with only an "id" column would cause a SQL syntax error.

## 0.4.37

### Patch Changes

- [#929](https://github.com/ponder-sh/ponder/pull/929) [`42f2e9194343fc9e851656c1baedb9d9dd5d66a4`](https://github.com/ponder-sh/ponder/commit/42f2e9194343fc9e851656c1baedb9d9dd5d66a4) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved indexing performance by using a dynamic checkpoint range when querying raw events from the sync store. The checkpoint range adjusts based on the density of events in the previous batch. This eliminates performance issues when using databases that had >1M rows in the `ponder_sync.logs` table.

- [#929](https://github.com/ponder-sh/ponder/pull/929) [`42f2e9194343fc9e851656c1baedb9d9dd5d66a4`](https://github.com/ponder-sh/ponder/commit/42f2e9194343fc9e851656c1baedb9d9dd5d66a4) Thanks [@kyscott18](https://github.com/kyscott18)! - Improved indexing performance by batching database writes using an in-memory LRU record cache.

## 0.4.36

### Patch Changes

- [#931](https://github.com/ponder-sh/ponder/pull/931) [`3bf69809b25c7d3e50be6eaf2f8d3564c7bb8f14`](https://github.com/ponder-sh/ponder/commit/3bf69809b25c7d3e50be6eaf2f8d3564c7bb8f14) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed bug with cache intervals occasionally causing statement timeouts for large apps.

## 0.4.35

### Patch Changes

- [`b77a43fb7fbad4e2710d31537ce21a29c1f6aafe`](https://github.com/ponder-sh/ponder/commit/b77a43fb7fbad4e2710d31537ce21a29c1f6aafe) Thanks [@0xOlias](https://github.com/0xOlias)! - Improves support for indexing local nodes by adding a `disableCache` network option. [Read more](https://ponder.sh/docs/advanced/foundry).

- [#927](https://github.com/ponder-sh/ponder/pull/927) [`3be6365c4c71dd0ac8275d485eb0317a656672b7`](https://github.com/ponder-sh/ponder/commit/3be6365c4c71dd0ac8275d485eb0317a656672b7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed an issues that would cause unexpected blocks to immediately cause a fatal error with a deep reorg.

## 0.4.34

### Patch Changes

- [#925](https://github.com/ponder-sh/ponder/pull/925) [`2a95909da55c816a9ea77f23170b1370f11ee555`](https://github.com/ponder-sh/ponder/commit/2a95909da55c816a9ea77f23170b1370f11ee555) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a regression introduced in `0.4.33` that could cause events to be skipped.

## 0.4.33

### Patch Changes

- [`e29efbb4c51181e723ca25ba35c2dd7263738f77`](https://github.com/ponder-sh/ponder/commit/e29efbb4c51181e723ca25ba35c2dd7263738f77) Thanks [@0xOlias](https://github.com/0xOlias)! - Added new CLI options `--log-level` and `--log-format`. Added support for structured logs using newline delimited JSON. [Read more](https://ponder.sh/docs/advanced/logging).

- [#922](https://github.com/ponder-sh/ponder/pull/922) [`ec5472749ee195a7f6ec8753d622ecf575656983`](https://github.com/ponder-sh/ponder/commit/ec5472749ee195a7f6ec8753d622ecf575656983) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated `hono` and `@hono/node-server` to fix a memory leak in the server.

- [#917](https://github.com/ponder-sh/ponder/pull/917) [`1e423a1c4f5eb303711842cc6389f9e13cfeecde`](https://github.com/ponder-sh/ponder/commit/1e423a1c4f5eb303711842cc6389f9e13cfeecde) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for `startBlock` or `endBlock` to be greater than the finalized or latest block.

- [#907](https://github.com/ponder-sh/ponder/pull/907) [`c9886d9dd86bea13b85fe0335a96c8ca24a30fd9`](https://github.com/ponder-sh/ponder/commit/c9886d9dd86bea13b85fe0335a96c8ca24a30fd9) Thanks [@erensanlier](https://github.com/erensanlier)! - Improved the performance an important internal SQL query (`getEvents`) for large apps. An app with ~5M rows in the `ponder_sync.logs` table saw a ~20x reduction in execution time for this query. Smaller apps will see a more modest improvement.

## 0.4.32

### Patch Changes

- [`4ef2d6212e59b4c4ba0723e78a1c204db3d94542`](https://github.com/ponder-sh/ponder/commit/4ef2d6212e59b4c4ba0723e78a1c204db3d94542) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `replaceBigInts` utility function to `@ponder/utils` (re-exported from `@ponder/core`). [Read more](https://ponder.sh/docs/utilities/replace-bigints).

- Updated dependencies [[`4ef2d6212e59b4c4ba0723e78a1c204db3d94542`](https://github.com/ponder-sh/ponder/commit/4ef2d6212e59b4c4ba0723e78a1c204db3d94542)]:
  - @ponder/utils@0.1.6

## 0.4.31

### Patch Changes

- [#912](https://github.com/ponder-sh/ponder/pull/912) [`dff08b880c348bf99396a86d282b8eb25d366fe7`](https://github.com/ponder-sh/ponder/commit/dff08b880c348bf99396a86d282b8eb25d366fe7) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed a bug with the GraphQL schema where many-to-one fields were using the wrong filter type.

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

- [#270](https://github.com/0xOlias/ponder/pull/270) [`9919db8`](https://github.com/0xOlias/ponder/commit/9919db807e546d220d92706f00910afaa4424ea2) Thanks [@0xOlias](https://github.com/0xOlias)! - Fixed a bug where the server would crash if no event handlers were registered in a file that had `import { ponder } from "ponder:registry"`

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
  import { ponder } from "ponder:registry";

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

- [#118](https://github.com/0xOlias/ponder/pull/118) [`84b4ca0`](https://github.com/0xOlias/ponder/commit/84b4ca0b7e3b4e73ff6daa8c317b48a22b4ca652) Thanks [@0xOlias](https://github.com/0xOlias)! - Added support for a path alias `ponder:registry` in Ponder project `src` files.

  ```ts
  // src/SomeContract.ts
  import { ponder } from "ponder:registry";

  ponder.on(...)
  ```

  ```ts
  // src/nested/AnotherContract.ts
  import { ponder } from "ponder:registry";

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
