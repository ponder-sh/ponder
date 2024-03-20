import { numberToHex } from "viem";
import { expect, test } from "vitest";
import { getRequest } from "./utils.js";

const request = getRequest("https://forno.celo.org");
const fromBlock = 10_000_000n;

test("celo success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0x471EcE3750Da237f93B8E339c536989b8978a438",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 1_000n),
      },
    ],
  });

  expect(logs).toHaveLength(3649);
});
