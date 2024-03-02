import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { parseGetLogsError } from "../parseGetLogsError.js";
import { type Params, UNI, fromBlock, getRequest } from "./utils.js";

const request = getRequest("https://rpc.ankr.com/eth");
const maxBlockRange = 3000n;

test("ankr success", async () => {
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

  expect(logs).toHaveLength(13);
});

test("ankr block range", async () => {
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

  expect(error).toBeInstanceOf(RpcError);

  const retry = parseGetLogsError({
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
