import { setupAnvil, setupContext } from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { type RealtimeLog, sortLogs } from "./format.js";

beforeEach(setupContext);
beforeEach(setupAnvil);

test("sort logs", async (context) => {
  const logs = await context.requestQueues[0].request({
    method: "eth_getLogs",
    params: [
      {
        address: context.erc20.address,
        fromBlock: "0x0",
        toBlock: "0x4",
      },
    ],
  });

  const sorted = sortLogs([logs[1], logs[0]] as RealtimeLog[]);

  expect(sorted[0].logIndex).toBe("0x0");
  expect(sorted[1].logIndex).toBe("0x1");
});
