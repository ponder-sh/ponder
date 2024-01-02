import { HttpRequestError, InvalidParamsRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogFilterRetryRanges } from "./getLogFilterRetryRanges.js";

test("getLogFilterRetryRanges handles Alchemy 'Log response size exceeded' error", async () => {
  const error = new InvalidParamsRpcError(
    new Error(
      "Log response size exceeded. this block range should work: [0x1, 0x2]",
    ),
  );

  const retryRanges = getLogFilterRetryRanges(error, "0x1", "0x3");

  expect(retryRanges).toHaveLength(2);
  expect(retryRanges[0]).toMatchObject(["0x1", "0x2"]);
  expect(retryRanges[1]).toMatchObject(["0x3", "0x3"]);
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async () => {
  const error = new HttpRequestError({
    url: "http://",
    details:
      "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range",
  });

  const retryRanges = getLogFilterRetryRanges(
    error,
    numberToHex(1),
    numberToHex(20_000),
  );

  expect(retryRanges).toHaveLength(2);
  expect(retryRanges[0]).toMatchObject([numberToHex(1), numberToHex(10000)]);
  expect(retryRanges[1]).toMatchObject([
    numberToHex(10_001),
    numberToHex(20000),
  ]);
});
