# @ponder/utils

## 0.2.12

### Patch Changes

- [#2014](https://github.com/ponder-sh/ponder/pull/2014) [`5de9cc0`](https://github.com/ponder-sh/ponder/commit/5de9cc0de28711b3e1d1e36a7ae60c83eb7fed39) Thanks [@odiinnn](https://github.com/odiinnn)! - Added support for retrying tron eth_getLogs errors.

## 0.2.11

### Patch Changes

- [#1978](https://github.com/ponder-sh/ponder/pull/1978) [`5e6f338`](https://github.com/ponder-sh/ponder/commit/5e6f3380a6a78b800dd4c31dd3e3ddc6cc772eab) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for erpc eth_getLogs retry ranges.

## 0.2.10

### Patch Changes

- [#1941](https://github.com/ponder-sh/ponder/pull/1941) [`f1df991`](https://github.com/ponder-sh/ponder/commit/f1df991ca83d934568289fc6c117c650d60066ad) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed eth_getLogs retry ranges for ankr TAC.

## 0.2.9

### Patch Changes

- [#1876](https://github.com/ponder-sh/ponder/pull/1876) [`9d9c4b9`](https://github.com/ponder-sh/ponder/commit/9d9c4b9ca8516388874a246d7b9d179ab0fd861f) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed moonriver eth_getLogs error handling.

## 0.2.8

### Patch Changes

- [#1792](https://github.com/ponder-sh/ponder/pull/1792) [`58cb1c5`](https://github.com/ponder-sh/ponder/commit/58cb1c5ab6c867bbf8e86b28cb8848607282166b) Thanks [@iHiteshAgrawal](https://github.com/iHiteshAgrawal)! - Added support for Avalanche.

## 0.2.7

### Patch Changes

- [#1749](https://github.com/ponder-sh/ponder/pull/1749) [`5507be933867f74b16db6e842897b6545f2e7567`](https://github.com/ponder-sh/ponder/commit/5507be933867f74b16db6e842897b6545f2e7567) Thanks [@kyscott18](https://github.com/kyscott18)! - Added support for merkle.io.

## 0.2.6

### Patch Changes

- [#1714](https://github.com/ponder-sh/ponder/pull/1714) [`27886fef0788e7ee1c25221087ecd6af05ea6197`](https://github.com/ponder-sh/ponder/commit/27886fef0788e7ee1c25221087ecd6af05ea6197) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated eth_getLogs retry helper to support somnia chain.

## 0.2.5

### Patch Changes

- [#1710](https://github.com/ponder-sh/ponder/pull/1710) [`e9b0fb99772baff7d3008a9dd1c8383e6182df59`](https://github.com/ponder-sh/ponder/commit/e9b0fb99772baff7d3008a9dd1c8383e6182df59) Thanks [@kyscott18](https://github.com/kyscott18)! - Updated eth_getLogs retry helper to support swell chain.

## 0.2.4

### Patch Changes

- [#1709](https://github.com/ponder-sh/ponder/pull/1709) [`4157106917d81df2809616a19297c7e80a70f1f5`](https://github.com/ponder-sh/ponder/commit/4157106917d81df2809616a19297c7e80a70f1f5) Thanks [@kyscott18](https://github.com/kyscott18)! - Fixed eth_getLogs error handling for thirdweb that was causing the error: `Log response size exceeded. Maximum allowed number of requested blocks is 1000`.

## 0.2.3

### Patch Changes

- [#1284](https://github.com/ponder-sh/ponder/pull/1284) [`0bb76fdc10bdf4f88980ed99d06c0e672094dce7`](https://github.com/ponder-sh/ponder/commit/0bb76fdc10bdf4f88980ed99d06c0e672094dce7) Thanks [@0xOlias](https://github.com/0xOlias)! - Improved eth_getLogs retry behavior for `https://mainnet.optimism.io`.

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

- [`4ef2d6212e59b4c4ba0723e78a1c204db3d94542`](https://github.com/ponder-sh/ponder/commit/4ef2d6212e59b4c4ba0723e78a1c204db3d94542) Thanks [@0xOlias](https://github.com/0xOlias)! - Added `replaceBigInts` utility function to `@ponder/utils` (re-exported from `@ponder/core`). [Read more](https://ponder.sh/docs/api-reference/ponder-utils#replacebigints).

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
