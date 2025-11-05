import http from "node:http";
import type { AddressInfo } from "node:net";
import { setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { TimeoutError } from "viem";
import { beforeEach, expect, test } from "vitest";
import { getHttpRpcClient } from "./http.js";

beforeEach(setupCommon);

test("slow body returns TimeoutError", async (context) => {
  const responseDelayMs = 500;
  const timeoutMs = 300;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });

    const start = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      res.write(`data:${elapsed}\n`);

      if (elapsed >= responseDelayMs) {
        clearInterval(interval);
        res.end("done\n"); // final chunk terminates the response
      }
    }, 100);
  });

  const port = await new Promise<number>((resolve, reject) => {
    // Pass 0 to listen() for a random available port
    server.listen(0, () => {
      const port = (server.address() as AddressInfo)?.port;
      if (typeof port !== "number") {
        reject(new Error("Failed to get available port"));
      }
      resolve(port);
    });
  });

  const client = getHttpRpcClient(`http://localhost:${port}`, {
    timeout: timeoutMs,
    common: context.common,
    chain: getChain(),
  });

  await expect(() =>
    client.request({
      body: { method: "test", id: 1, jsonrpc: "2.0", params: ["test"] },
    }),
  ).rejects.toThrow(TimeoutError);
});
