import { http, toHex } from "viem";
import { mainnet } from "viem/chains";
import { great } from "../great.js";

/**
 * Simulate a Ponder-like load to test performance of different Viem transport implementations.
 */

const transport = great([
  http(process.env.RPC_URL_ALCHEMY_1),
  http(process.env.RPC_URL_INFURA_1),
  http(process.env.RPC_URL_QUICKNODE_1),
  // http("https://cloudflare-eth.com"),
  // http("https://rpc.ankr.com/eth"),
])({ chain: mainnet, retryCount: 5 });

for (let i = 0; i < 10; i++) {
  const start = performance.now();
  // Request logs
  await transport.request({
    method: "eth_getLogs",
    params: [
      {
        fromBlock: toHex(13140000),
        toBlock: toHex(13141000),
        address: "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      },
    ],
  });

  // Request many blocks
  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 500; i++) {
    promises.push(
      transport.request({
        method: "eth_getBlockByNumber",
        params: [toHex(13140000 + i), true],
      }),
    );
  }

  await Promise.all(promises);

  console.log(
    `Completed requests in ${
      performance.now() - start
    } milliseconds with 0 errors`,
  );
}
