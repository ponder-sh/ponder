import { RpcRequestError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://dream-rpc.somnia.network");
const fromBlock = 53_580_000n;
const maxBlockRange = 1_000n;

test(
  "somnia success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });

    expect(logs).toHaveLength(5616);
  },
  { timeout: 15_000 },
);

test(
  "somnia block range",
  async () => {
    const params: Params = [
      {
        address: "0x4200000000000000000000000000000000000006",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(error).toBeInstanceOf(RpcRequestError);
    expect(JSON.stringify(error)).includes("block range exceeds 1000");

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
