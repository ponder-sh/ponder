import { http, createClient, toHex } from "viem";
import { mainnet } from "viem/chains";
import { createQueue } from "./queue.js";
import { range } from "./range.js";

/**
 * Evalutes an rpc by sending 100 getBlockByNumber requests, with a concurrency of 20.
 */

const client = createClient({
  chain: mainnet,
  transport: http(process.env.ANVIL_FORK_URL, {}),
});

const queue = createQueue<bigint>({
  worker: async ({ task }) => {
    await client.request({
      method: "eth_getBlockByNumber",
      params: [toHex(task), true],
    })!;
  },
  options: {
    autoStart: false,
    concurrency: 20,
  },
});

for (const i of range(16380000, 16380100)) {
  queue.addTask(BigInt(i));
}

const start = performance.now();

queue.start();
await queue.onIdle();

const end = performance.now();

console.log(`Finished getting 100 blocks in ${end - start} milliseconds`);
