# @ponder/utils

## 0.2.2

### Patch Changes

- [#1193](https://github.com/ponder-sh/ponder/pull/1193) [`0cbdf01f85f4180a62d0de671c7adc299b704104`](https://github.com/ponder-sh/ponder/commit/0cbdf01f85f4180a62d0de671c7adc299b704104) Thanks [@kyscott18](https://github.com/kyscott18)! - Added retry range support for hyperliquid.

## 0.2.1

### Patch Changes

- [#1110](https://github.com/ponder-sh/ponder/pull/1110) [`6a5c8a54b9d976fa760c863512044d82702d0bb7`](https://github.com/ponder-sh/ponder/commit/6a5c8a54b9d976fa760c863512044d82702d0bb7) Thanks [@chenxsan](https://github.com/chenxsan)! - Added retry mechanism for publicnode.

## 0.2.0

### Minor Changes

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated `viem` peer dependency to `>=2`.

- [#1074](https://github.com/ponder-sh/ponder/pull/1074) [`d9656a9af390f6c0a375cbbabfc85f90f510b13f`](https://github.com/ponder-sh/ponder/commit/d9656a9af390f6c0a375cbbabfc85f90f510b13f) Thanks [@kyscott18](https://github.com/kyscott18)! - Added `isSuggestedRange` property to the return type of `getLogsRetryHelper`.

## 0.1.8

### Patch Changes

- [#1065](https://github.com/ponder-sh/ponder/pull/1065) [`7c17ff32e8907b4a38d74cea2a431b689236048c`](https://github.com/ponder-sh/ponder/commit/7c17ff32e8907b4a38d74cea2a431b689236048c) Thanks [@kyscott18](https://github.com/kyscott18)! - Added retry range detection for coinbase rpcs.

## 0.1.7

### Patch Changes

- [#964](https://github.com/ponder-sh/ponder/pull/964) [`e82e385b777cf6fccaf779fe8b12151b56456b68`](https://github.com/ponder-sh/ponder/commit/e82e385b777cf6fccaf779fe8b12151b56456b68) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated logs retry logic for several providers.

## 0.1.6

### Patch Changes

- [`4ef2d6212e59b4c4ba0723e78a1c204db3d94542`](https://github.com/ponder-sh/ponder/commit/4ef2d6212e59b4c4ba0723e78a1c204db3d94542) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `replaceBigInts` utility function to `@ponder/utils` (re-exported from `@ponder/core`). [Read more](https://ponder.sh/docs/utilities/replace-bigints).

## 0.1.5

### Patch Changes

- [#894](https://github.com/ponder-sh/ponder/pull/894) [`9d64a31a527914145c86b0c8e43b9d185e35a1e1`](https://github.com/ponder-sh/ponder/commit/9d64a31a527914145c86b0c8e43b9d185e35a1e1) Thanks [@kyscott18](https://github.com/kyscott18)! - Supported retrying chainstack eth_getLogs requests.

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
