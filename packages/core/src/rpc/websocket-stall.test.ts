import { createServer, type Server } from "node:http";
import { beforeEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { context, setupCommon } from "@/_test/setup.js";
import { anvil, getFreePort } from "@/_test/utils.js";
import type { Chain } from "@/internal/types.js";
import { createRpc } from "./index.js";

beforeEach(setupCommon);

// A chain served over HTTP plus a `newHeads` socket that can be told to go
// quiet while staying open: no error, no close, just silence.
const createFakeChain = async () => {
  const httpPort = await getFreePort();
  const wsPort = await getFreePort();

  let height = 1_000;
  // socket stops pushing but stays open
  let isSocketQuiet = false;
  // the chain itself stops producing, which is not a fault
  let isChainQuiet = false;

  const block = (n: number) => ({
    number: `0x${n.toString(16)}`,
    hash: `0x${n.toString(16).padStart(64, "0")}`,
    parentHash: `0x${(n - 1).toString(16).padStart(64, "0")}`,
    timestamp: `0x${(1_700_000_000 + n).toString(16)}`,
    logsBloom: `0x${"0".repeat(512)}`,
    transactions: [],
  });

  const httpServer: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const request = JSON.parse(body);
      const { id, method } = Array.isArray(request) ? request[0] : request;
      const result =
        method === "eth_blockNumber" ? `0x${height.toString(16)}` : null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(httpPort, resolve));

  const wss = new WebSocketServer({ port: wsPort });
  wss.on("connection", (socket) => {
    let subscriptionId: string | undefined;

    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.method === "eth_subscribe") {
        subscriptionId = "0x1";
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: subscriptionId,
          }),
        );
      } else {
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result: true }),
        );
      }
    });

    const push = setInterval(() => {
      if (subscriptionId === undefined || socket.readyState !== socket.OPEN)
        return;
      if (isChainQuiet) return;
      if (isSocketQuiet) {
        // chain keeps moving, socket does not say so
        height += 1;
        return;
      }
      height += 1;
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_subscription",
          params: { subscription: subscriptionId, result: block(height) },
        }),
      );
    }, 20);

    socket.on("close", () => clearInterval(push));
  });

  const chain = {
    name: "fake",
    id: 1,
    rpc: `http://127.0.0.1:${httpPort}`,
    ws: `ws://127.0.0.1:${wsPort}`,
    pollingInterval: 25,
    finalityBlockCount: 1,
    disableCache: false,
    ethGetLogsBlockRange: undefined,
    viemChain: anvil,
  } satisfies Chain;

  return {
    chain,
    silenceSocket: () => {
      isSocketQuiet = true;
    },
    quietChain: () => {
      isChainQuiet = true;
    },
    async close() {
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
};

const collectWarnings = () => {
  const warnings: string[] = [];
  const original = context.common.logger.warn.bind(context.common.logger);
  context.common.logger.warn = (log: any) => {
    warnings.push(log.msg);
    return original(log);
  };
  return warnings;
};

test("createRpc() reconnects when the socket stops delivering blocks", async () => {
  const fake = await createFakeChain();
  const warnings = collectWarnings();
  const rpc = createRpc({ common: context.common, chain: fake.chain });

  let blockCount = 0;
  rpc.subscribe({
    onBlock: async () => {
      blockCount += 1;
      return true;
    },
    onError: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(blockCount).toBeGreaterThan(0);

  fake.silenceSocket();
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  expect(
    warnings.filter(
      (msg) => msg === "WebSocket stopped delivering blocks, reconnecting",
    ).length,
  ).toBeGreaterThan(0);

  await rpc.unsubscribe();
  await fake.close();
}, 20_000);

test("createRpc() leaves a quiet chain alone", async () => {
  const fake = await createFakeChain();
  const warnings = collectWarnings();
  const rpc = createRpc({ common: context.common, chain: fake.chain });

  rpc.subscribe({ onBlock: async () => true, onError: () => {} });

  await new Promise((resolve) => setTimeout(resolve, 200));
  fake.quietChain();
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  expect(
    warnings.filter(
      (msg) => msg === "WebSocket stopped delivering blocks, reconnecting",
    ),
  ).toHaveLength(0);

  await rpc.unsubscribe();
  await fake.close();
}, 20_000);

test("createRpc() reconnects when the socket never delivers a block", async () => {
  const fake = await createFakeChain();
  const warnings = collectWarnings();
  fake.silenceSocket();
  const rpc = createRpc({ common: context.common, chain: fake.chain });

  rpc.subscribe({ onBlock: async () => true, onError: () => {} });

  await new Promise((resolve) => setTimeout(resolve, 3_000));

  expect(
    warnings.filter(
      (msg) => msg === "WebSocket stopped delivering blocks, reconnecting",
    ).length,
  ).toBeGreaterThan(0);

  await rpc.unsubscribe();
  await fake.close();
}, 20_000);
