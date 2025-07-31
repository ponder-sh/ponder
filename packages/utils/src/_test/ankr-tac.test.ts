import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest(process.env.RPC_URL_ANKR_239!);
const fromBlock = 3105972n;
const maxBlockRange = 10000n;

test("ankr success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0xB63B9f0eb4A6E6f191529D71d4D88cc8900Df2C9",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(185);
});

test("ankr request range", async () => {
  const params: Params = [
    {
      address: "0xB63B9f0eb4A6E6f191529D71d4D88cc8900Df2C9",
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes(
    "maximum [from, to] blocks distance: 10000",
  );

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

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
