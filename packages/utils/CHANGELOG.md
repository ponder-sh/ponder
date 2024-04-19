# @ponder/utils

## 0.1.4

### Patch Changes

- [#816](https://github.com/ponder-sh/ponder/pull/816) [`2d9fcbae895b1c7388683fec5c0f36999ead29ce`](https://github.com/ponder-sh/ponder/commit/2d9fcbae895b1c7388683fec5c0f36999ead29ce) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for automatically detecting blockpi retry ranges.

## 0.1.3

### Patch Changes

- [#811](https://github.com/ponder-sh/ponder/pull/811) [`db106f5ffc302f1a02dcb54f31432420fae3c3cc`](https://github.com/ponder-sh/ponder/commit/db106f5ffc302f1a02dcb54f31432420fae3c3cc) Thanks [@kyscott18](https://github.com/kyscott18)! - Added automatic eth_getLogs retry range detection for the paid version of blast API.

## 0.1.2

### Patch Changes

- [`464a98f1500815739a3384e6b34eb05aaf0c0253`](https://github.com/ponder-sh/ponder/commit/464a98f1500815739a3384e6b34eb05aaf0c0253) Thanks [@kyscott18](https://github.com/kyscott18)! - Added several more chain providers to getLogRetryRanges.

## 0.1.1

### Patch Changes

- [#722](https://github.com/ponder-sh/ponder/pull/722) [`fe99c31a100acfc602cc511a15b1f625e034c29e`](https://github.com/ponder-sh/ponder/commit/fe99c31a100acfc602cc511a15b1f625e034c29e) Thanks [@kyscott18](https://github.com/kyscott18)! - Changed getLogsRetryHelper to not retry when the retry range is the same as the original range.

## 0.1.0

### Minor Changes

- [#692](https://github.com/ponder-sh/ponder/pull/692) [`5d6b541dd4a3bda979d26bb38754b77209674a98`](https://github.com/ponder-sh/ponder/commit/5d6b541dd4a3bda979d26bb38754b77209674a98) Thanks [@kyscott18](https://github.com/kyscott18)! - Added two new viem transports. `rateLimit` for throttling the frequency of requests and `loadBalance` for distributing requests between multiple child transports.

## 0.0.1

### Patch Changes

- [#688](https://github.com/ponder-sh/ponder/pull/688) [`2a1842e1db2329b1c88c613b0a64ff8c7695e829`](https://github.com/ponder-sh/ponder/commit/2a1842e1db2329b1c88c613b0a64ff8c7695e829) Thanks [@kyscott18](https://github.com/kyscott18)! - Created `@ponder/utils` package. Moved `eth_getLogs` retry helper from `@ponder/core` to `@ponder/utils`.
