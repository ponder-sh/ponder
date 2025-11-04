import assert from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { TimeoutError } from "viem";
import { beforeEach, expect, test } from "vitest";
import { getHttpRpcClient } from "./http.js";

beforeEach(setupCommon);

test("slow body returns TimeoutError", async (context) => {
  const respDurationMs = 1500;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });

    const start = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      res.write(`data:${elapsed}\n`);

      if (elapsed >= respDurationMs) {
        clearInterval(interval);
        res.end("done\n"); // final chunk terminates the response
        console.log("stream finished");
      }
    }, 100);
  });

  const port = await new Promise<number>((resolve, _reject) => {
    // Pass 0 to listen() for a random available port
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve(port);
    });
  });

  assert(typeof port === "number");

  const client = getHttpRpcClient(
    context.common,
    getChain(),
    `http://localhost:${port}`,
    {
      timeout: 1000,
    },
  );
  try {
    await client.request({
      body: { method: "test", id: 1, jsonrpc: "2.0", params: ["test"] },
    });
  } catch (e) {
    expect(e).instanceOf(TimeoutError);
  }
});
