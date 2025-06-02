import { InvalidInputRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://api.avax.network/ext/bc/C/rpc");
const maxBlockRange = 2047n;
const fromBlock = 53_164_500n;

test(
  "avalanche success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });
    expect(logs).toHaveLength(3135);
  },
  { timeout: 15_000 },
);

test("avalanche block range", async () => {
  const params: Params = [
    {
      address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({ method: "eth_getLogs", params }).catch(
    (error) => error,
  );

  expect(error).toBeInstanceOf(InvalidInputRpcError);
  expect(JSON.stringify(error?.details)).includes("maximum is set to 2048");

  const retry = getLogsRetryHelper({ params, error });

  expect(retry).toStrictEqual({
    shouldRetry: true,
    isSuggestedRange: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange + 1n),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ],
  });
});
