import { LimitExceededRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest, validUrl } from "./utils.js";

const request = getRequest(process.env.RPC_URL_COINBASE_8453!);
const invalidRPC = !validUrl(process.env.RPC_URL_COINBASE_8453);
const fromBlock = 10_000_000n;
const maxBlockRange = 999n;

test.skipIf(invalidRPC)("coinbase success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(77);
});

test.skipIf(invalidRPC)(
  "coinbase block range",
  async () => {
    const params: Params = [
      {
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(error).toBeInstanceOf(LimitExceededRpcError);
    expect(JSON.stringify(error)).includes(
      "please limit the query to at most 1000 blocks",
    );

    const retry = getLogsRetryHelper({
      params,
      error,
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
  },
  { timeout: 15_000 },
);
