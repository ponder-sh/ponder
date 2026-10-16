import {
  InvalidInputRpcError,
  numberToHex,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import type { Params } from "./utils.js";

const timeout = () => new TimeoutError({ body: {}, url: "" }) as any;

const rpcError = (message: string) =>
  new InvalidInputRpcError(
    new RpcRequestError({
      body: {},
      url: "",
      error: { code: -32000, message },
    }),
  ) as any;

const params = (fromBlock: bigint, toBlock: bigint): Params => [
  { fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock) },
];

test("timeout halves the range", () => {
  expect(
    getLogsRetryHelper({ params: params(0n, 1000n), error: timeout() }),
  ).toStrictEqual({
    shouldRetry: true,
    isSuggestedRange: false,
    ranges: [
      { fromBlock: numberToHex(0n), toBlock: numberToHex(500n) },
      { fromBlock: numberToHex(501n), toBlock: numberToHex(1000n) },
    ],
  });
});

test("the ranges cover the request with no gap", () => {
  // A gap here loses logs silently, which is worse than the stall being fixed.
  const retry = getLogsRetryHelper({
    params: params(1000n, 2000n),
    error: timeout(),
  });
  const ranges = retry.ranges!;

  expect(ranges[0]!.fromBlock).toBe(numberToHex(1000n));
  expect(ranges.at(-1)!.toBlock).toBe(numberToHex(2000n));
  for (let i = 1; i < ranges.length; i++) {
    expect(BigInt(ranges[i]!.fromBlock)).toBe(
      BigInt(ranges[i - 1]!.toBlock) + 1n,
    );
  }
});

test("repeated timeouts converge on a single block and stop", () => {
  let to = 1_000_000n;
  let rounds = 0;

  while (rounds < 100) {
    const retry = getLogsRetryHelper({
      params: params(0n, to),
      error: timeout(),
    });
    if (retry.shouldRetry === false) break;
    to = BigInt(retry.ranges![0]!.toBlock);
    rounds++;
  }

  expect(rounds).toBeLessThan(25);
  expect(to).toBe(0n);
});

test("a single block has nothing left to split", () => {
  // Splitting cannot help, so this falls through to the provider-level backoff
  // rather than retrying the same request forever.
  expect(
    getLogsRetryHelper({ params: params(100n, 100n), error: timeout() })
      .shouldRetry,
  ).toBe(false);
});

test("an inverted range does not throw", () => {
  expect(() =>
    getLogsRetryHelper({ params: params(200n, 100n), error: timeout() }),
  ).not.toThrow();
});

test("only a TimeoutError counts, not the word in a message", () => {
  const retry = getLogsRetryHelper({
    params: params(0n, 1000n),
    error: rpcError(
      "upstream connect error or disconnect/reset before headers: connection timeout",
    ),
  });

  expect(retry.shouldRetry).toBe(false);
});

test("errors that are not about range still do not retry", () => {
  for (const message of [
    "execution reverted",
    "invalid argument 0",
    "method not found",
  ]) {
    expect(
      getLogsRetryHelper({
        params: params(0n, 1000n),
        error: rpcError(message),
      }).shouldRetry,
    ).toBe(false);
  }
});

test("a suggested range still wins over halving", () => {
  const retry = getLogsRetryHelper({
    params: params(0n, 10_000n),
    error: rpcError("Try with this block range [0x0, 0x64]."),
  });

  expect(retry).toMatchObject({ shouldRetry: true, isSuggestedRange: true });
});
