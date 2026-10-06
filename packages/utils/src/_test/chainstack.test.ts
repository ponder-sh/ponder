import { InvalidParamsRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { fromBlock, getRequest, type Params, UNI } from "./utils.js";

const request = getRequest(process.env.RPC_URL_CHAINSTACK_1!);
const maxBlockRange = 110n;

test("chainstack success", { timeout: 15_000 }, async () => {
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

  expect(logs).toHaveLength(1);
});

test("chainstack block range", { timeout: 15_000 }, async () => {
  const params: Params = [
    {
      address: UNI,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(InvalidParamsRpcError);
  expect(JSON.stringify(error)).includes("Block range limit exceeded.");

  const retry = getLogsRetryHelper({
    params,
    error,
  });

  expect(retry).toStrictEqual({
    shouldRetry: true,
    isSuggestedRange: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange - 10n),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange - 10n + 1n),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ],
  });
});
