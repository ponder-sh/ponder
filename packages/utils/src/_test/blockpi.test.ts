import { InvalidParamsRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, fromBlock, getRequest } from "./utils.js";

const request = getRequest("https://ethereum.blockpi.network/v1/rpc/public");
const maxBlockRange = 1024n;

test(
  "blast success",
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

    expect(logs).toHaveLength(9);
  },
  { timeout: 15_000 },
);

test(
  "blast block range",
  async () => {
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
    expect(JSON.stringify(error)).includes(
      "eth_getLogs is limited to 1024 block range",
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
