import { HttpRequestError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://rpc.blast.io");
const fromBlock = 1_000_000n;
const maxBlockRange = 10_000n;

test(
  "blast success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: "0xb9dfCd4CF589bB8090569cb52FaC1b88Dbe4981F",
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });

    expect(logs).toHaveLength(109);
  },
  { timeout: 15_000 },
);

test(
  "blast block range",
  async () => {
    const params: Params = [
      {
        address: "0xb9dfCd4CF589bB8090569cb52FaC1b88Dbe4981F",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect(JSON.stringify(error)).includes(
      "eth_getLogs is limited to a 10,000 range",
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
