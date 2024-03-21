import { InvalidInputRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, fromBlock, getRequest } from "./utils.js";

const request = getRequest("https://1rpc.io/eth");
const maxBlockRange = 10_000n;

test(
  "1rpc success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: UNI,
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });

    expect(logs).toHaveLength(49);
  },
  { timeout: 30_000 },
);

test("1rpc block range", async () => {
  const params: Params = [
    {
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(InvalidInputRpcError);
  expect(JSON.stringify(error)).includes(
    "eth_getLogs is limited to a 10000 blocks range",
  );

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry).toStrictEqual({
    shouldRetry: true,
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
