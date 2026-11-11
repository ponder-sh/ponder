import {
  type Address,
  createWalletClient,
  hexToNumber,
  http,
  parseEther,
  toHex,
} from "viem";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { ALICE } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import { deployErc20, mintErc20, simulateBlock } from "@/_test/simulate.js";
import { anvil, getChain, getFreePort, testClient } from "@/_test/utils.js";
import type { SyncBlock, SyncBlockHeader, SyncLog } from "@/internal/types.js";
import { createRpc, type RpcLogTrigger, sanitizeLogTopics } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("createRpc()", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() handles rate limiting", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() retry BlockNotFoundError", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ jsonrpc: "2.0", result: null, id: 1 })),
  );

  const block = await rpc.request(
    { method: "eth_getBlockByNumber", params: ["0x1", true] },
    {
      retryNullBlockRequest: true,
    },
  );

  expect(block).not.toBeNull();
});

test("https://github.com/ponder-sh/ponder/pull/2143", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  let now = Date.now();
  const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  onTestFinished(() => {
    dateSpy.mockRestore();
  });

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 20; j++) {
      await rpc.request({ method: "eth_blockNumber" });
    }
    now += 1000;
  }

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
});

const topic0 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const topic1 =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

test("sanitizeLogTopics removes trailing null values", () => {
  expect(sanitizeLogTopics([topic0, topic1, null, null])).toStrictEqual([
    topic0,
    topic1,
  ]);
});

test("sanitizeLogTopics preserves null wildcards before a topic", () => {
  expect(sanitizeLogTopics([topic0, null, topic1, null])).toStrictEqual([
    topic0,
    null,
    topic1,
  ]);
});

test("sanitizeLogTopics does not mutate the input", () => {
  const topics = [topic0, null, null] as const;

  expect(sanitizeLogTopics(topics)).toStrictEqual([topic0]);
  expect(topics).toStrictEqual([topic0, null, null]);
});

test("sanitizeLogTopics preserves omitted and empty topics", () => {
  expect(sanitizeLogTopics([])).toStrictEqual([]);
  expect(sanitizeLogTopics([null, null])).toStrictEqual([]);
});

test("subscribe() polls full blocks", async () => {
  const chain = { ...getChain(), pollingInterval: 100 };
  const rpc = createRpc({ common: context.common, chain });
  onTestFinished(() => rpc.unsubscribe());

  await simulateBlock();

  const requestSpy = vi.spyOn(rpc, "request");
  const block = await new Promise<SyncBlock | SyncBlockHeader>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block);
        return true;
      },
      onError: () => {},
    });
  });

  expect(requestSpy.mock.calls[0]![0]).toMatchObject({
    method: "eth_getBlockByNumber",
    params: ["latest", true],
  });
  expect(block.transactions).toBeInstanceOf(Array);
});

test("subscribe() polls instead of using ws when range scanning", async () => {
  const chain = {
    ...getChain({ experimentalRangeScan: true }),
    pollingInterval: 100,
    ws: "ws://127.0.0.1:8545",
  };
  const rpc = createRpc({ common: context.common, chain });
  onTestFinished(() => rpc.unsubscribe());

  await simulateBlock();

  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const requestSpy = vi.spyOn(rpc, "request");
  const block = await new Promise<SyncBlock | SyncBlockHeader>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block);
        return true;
      },
      onError: () => {},
    });
  });

  // Polled over HTTP despite `ws`.
  expect(requestSpy.mock.calls[0]![0]).toMatchObject({
    method: "eth_getBlockByNumber",
    params: ["latest", true],
  });
  expect(block.transactions).toBeInstanceOf(Array);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: expect.stringContaining("Ignoring 'ws'"),
    }),
  );
});

const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const waitFor = async (condition: () => boolean, timeout = 5_000) => {
  const start = Date.now();
  while (condition() === false) {
    if (Date.now() - start > timeout) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const subscribeLogTriggers = (params: {
  address: Address;
  pollingInterval?: number;
  heartbeatInterval?: number;
  ws?: string;
  onBlock?: (block: SyncBlock | SyncBlockHeader) => Promise<void>;
  filters?: RpcLogTrigger["filters"];
  isTrigger?: RpcLogTrigger["isTrigger"];
  isScanned?: RpcLogTrigger["isScanned"];
  hasFailed?: RpcLogTrigger["hasFailed"];
}) => {
  const chain = {
    ...getChain({ experimentalRangeScan: true }),
    pollingInterval: params.pollingInterval ?? 60_000,
    ws: params.ws ?? anvil.rpcUrls.default.webSocket[0],
  };
  const rpc = createRpc({ common: context.common, chain });
  onTestFinished(() => rpc.unsubscribe());

  const blocks: (SyncBlock | SyncBlockHeader)[] = [];
  const logs: SyncLog[] = [];
  const expected: SyncLog[] = [];
  const pollingStates: boolean[] = [];
  rpc.subscribe({
    onBlock: async (block) => {
      blocks.push(block);
      await params.onBlock?.(block);
      return true;
    },
    onError: () => {},
    logTrigger: {
      filters: params.filters ?? [
        { address: [params.address], topics: [[TRANSFER_TOPIC0]] },
      ],
      isTrigger: (log) => {
        logs.push(log);
        return params.isTrigger?.(log) ?? true;
      },
      expect: (log) => {
        expected.push(log);
      },
      // Note: as in the realtime sync, a block is scanned once a scan reached it.
      isScanned:
        params.isScanned ??
        ((log) =>
          blocks.some(
            (block) =>
              hexToNumber(block.number) >= hexToNumber(log.blockNumber),
          )),
      heartbeatInterval: params.heartbeatInterval ?? 60_000,
      setPolling: (isPolling) => {
        pollingStates.push(isPolling);
      },
      hasFailed: params.hasFailed ?? (() => false),
    },
  });

  return { rpc, blocks, logs, expected, pollingStates };
};

const mint = (erc20: Address) =>
  mintErc20({ erc20, to: ALICE, amount: parseEther("1"), sender: ALICE });

/** A WebSocket server that answers `eth_subscribe` as `onSubscribe` says. */
const startWebSocketServer = async (
  onSubscribe: (socket: import("ws").WebSocket, id: number) => void,
) => {
  const port = await getFreePort();
  const server = new WebSocketServer({ port });
  let connections = 0;
  server.on("connection", (socket) => {
    connections += 1;
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === "eth_subscribe") onSubscribe(socket, msg.id);
    });
  });
  // Note: `close` waits for open connections, and the client may still be
  // connected when this runs, depending on the order of cleanups.
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  );
  return { url: `ws://127.0.0.1:${port}`, getConnections: () => connections };
};

/** A log in block 1 to notify from a `startWebSocketServer` socket. */
const getNotifiedLog = (address: Address, logIndex = 0): SyncLog => ({
  address,
  topics: [TRANSFER_TOPIC0],
  data: "0x",
  blockNumber: "0x1",
  blockHash: `0x${"11".repeat(32)}`,
  transactionHash: `0x${"22".repeat(32)}`,
  transactionIndex: "0x0",
  logIndex: toHex(logIndex),
  removed: false,
});

const notify = (
  socket: import("ws").WebSocket,
  subscription: string,
  log: SyncLog,
) =>
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription, result: log },
    }),
  );

test("subscribe() scans when a log notification triggers", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  const { blocks, logs, expected } = subscribeLogTriggers({ address });

  // The subscription scans once when it's created.
  await waitFor(() => blocks.length === 1);

  const { block } = await mint(address);

  await waitFor(() => blocks.length === 2);
  expect(logs).toHaveLength(1);
  expect(expected.map((log) => log.blockHash)).toStrictEqual([block.hash]);
  expect(blocks[1]!.hash).toBe(block.hash);
  expect(blocks[1]!.transactions).toBeInstanceOf(Array);
});

test("subscribe() doesn't scan for a log that isn't a trigger", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  const { blocks, logs } = subscribeLogTriggers({
    address,
    isTrigger: () => false,
  });
  await waitFor(() => blocks.length === 1);

  await mint(address);

  await waitFor(() => logs.length === 1);
  await sleep(300);
  expect(blocks).toHaveLength(1);
});

test("subscribe() scans a block with several notified logs once", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  const { blocks, logs } = subscribeLogTriggers({ address });
  await waitFor(() => blocks.length === 1);

  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: ALICE,
  });
  for (let i = 0; i < 3; i++) {
    await walletClient.writeContract({
      abi: erc20ABI,
      functionName: "mint",
      address,
      args: [ALICE, parseEther("1")],
    });
  }
  await testClient.mine({ blocks: 1 });

  await waitFor(() => logs.length === 3);
  await sleep(300);
  expect(blocks).toHaveLength(2);
});

test("subscribe() tests a log again after the scan it arrived during", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  // Note: the second log's emitter is only known once the first scan ends,
  // as a factory child would be.
  let isSecondLogKnown = false;
  const { blocks } = subscribeLogTriggers({
    address,
    isTrigger: (log) =>
      isSecondLogKnown || hexToNumber(log.blockNumber) === firstBlockNumber,
    onBlock: async () => {
      if (blocks.length === 2) {
        await sleep(1_000);
        isSecondLogKnown = true;
      }
    },
  });
  await waitFor(() => blocks.length === 1);

  const firstBlockNumber = hexToNumber(blocks[0]!.number) + 1;
  await mint(address);
  const { block } = await mint(address);

  await waitFor(() => blocks.length === 3);
  expect(blocks[2]!.hash).toBe(block.hash);
});

test("subscribe() scans again until the notified block is scanned", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  // Note: the realtime sync rejects the first scan that reaches the block.
  const { blocks } = subscribeLogTriggers({
    address,
    isScanned: (log) =>
      blocks.filter(
        (block) => hexToNumber(block.number) >= hexToNumber(log.blockNumber),
      ).length >= 2,
  });
  await waitFor(() => blocks.length === 1);

  await mint(address);

  await waitFor(() => blocks.length === 3);
  await sleep(300);
  expect(blocks).toHaveLength(3);
});

test("subscribe() retries a notified log its scans didn't reach, with backoff", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  // Note: as when the node answering is over a second behind the node that
  // sent the notification, or the local tip passed the block without its log.
  const { blocks } = subscribeLogTriggers({
    address,
    isScanned: (log) =>
      blocks.filter(
        (block) => hexToNumber(block.number) >= hexToNumber(log.blockNumber),
      ).length >= 6,
  });
  await waitFor(() => blocks.length === 1);

  await mint(address);

  // Five scans over a second, then a retry a second later rather than at the
  // heartbeat a minute away. The retries stop once the log is reconciled.
  await waitFor(() => blocks.length === 7, 4_000);
  await sleep(2_500);
  expect(blocks).toHaveLength(7);
});

test("subscribe() stops retrying a notified log that a reorg removed", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  let socket: import("ws").WebSocket | undefined;
  const server = await startWebSocketServer((serverSocket, id) => {
    socket = serverSocket;
    serverSocket.send(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }));
  });
  const log = getNotifiedLog(address);
  const { blocks } = subscribeLogTriggers({
    address,
    ws: server.url,
    // Note: no scan returns the log.
    isScanned: () => false,
  });
  await waitFor(() => blocks.length === 1);

  notify(socket!, "0x1", log);
  await waitFor(() => blocks.length === 6);
  notify(socket!, "0x1", { ...log, removed: true });

  // The removal triggers one scan, and no retry follows.
  await sleep(2_500);
  expect(blocks).toHaveLength(7);
});

test("subscribe() scans every pollingInterval while ws is unavailable", async () => {
  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const { address } = await deployErc20({ sender: ALICE });
  const { blocks, pollingStates } = subscribeLogTriggers({
    address,
    pollingInterval: 100,
    ws: "ws://127.0.0.1:1",
  });

  await waitFor(() => blocks.length >= 2);
  // Note: a refused connection can take seconds to fail, as on Windows.
  await waitFor(() =>
    warnSpy.mock.calls.some(
      ([log]) =>
        (log as { msg: string }).msg ===
        "Failed JSON-RPC WebSocket subscription",
    ),
  );
  // Note: never driven by notifications, so every poll is sampled for cost.
  expect(pollingStates).not.toContain(false);
});

test("subscribe() backs off a connection that keeps closing", async () => {
  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const { address } = await deployErc20({ sender: ALICE });
  const server = await startWebSocketServer((socket, id) => {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }));
    socket.close();
  });
  const { blocks } = subscribeLogTriggers({
    address,
    pollingInterval: 1_000,
    ws: server.url,
  });

  await sleep(2_000);
  // Without backoff, a reconnect every 125 ms, each with a scan.
  expect(server.getConnections()).toBeGreaterThanOrEqual(2);
  expect(server.getConnections()).toBeLessThanOrEqual(5);
  expect(blocks.length).toBeLessThanOrEqual(3);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: "Closed JSON-RPC WebSocket connection unexpectedly",
    }),
  );
});

test("subscribe() fails a subscription that is never confirmed", async () => {
  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const { address } = await deployErc20({ sender: ALICE });
  const server = await startWebSocketServer(() => {});
  subscribeLogTriggers({
    address,
    pollingInterval: 1_000,
    heartbeatInterval: 300,
    ws: server.url,
  });

  await waitFor(() => server.getConnections() >= 2);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: "Failed JSON-RPC WebSocket subscription",
      error: expect.objectContaining({
        message: "Timed out waiting for 'eth_subscribe'",
      }),
    }),
  );
});

test("subscribe() pauses log notifications that trigger more scans than polling", async () => {
  const infoSpy = vi.spyOn(context.common.logger, "info");
  const { address } = await deployErc20({ sender: ALICE });
  const { blocks, pollingStates } = subscribeLogTriggers({
    address,
    pollingInterval: 1_000,
  });
  await waitFor(() => blocks.length === 1);
  await waitFor(() => pollingStates.includes(false));

  // More notified blocks within 10 polling intervals than polling would scan.
  for (let i = 0; i < 12; i++) await mint(address);

  await waitFor(() =>
    infoSpy.mock.calls.some(
      ([log]) =>
        (log as { msg: string }).msg ===
        "Paused JSON-RPC WebSocket log notifications, which would trigger more scans than polling",
    ),
  );
  // Note: scans run every `pollingInterval` again while paused.
  await waitFor(() => pollingStates.at(-1) === true);
});

test("subscribe() pauses log notifications that arrive more often than polling would request", async () => {
  const infoSpy = vi.spyOn(context.common.logger, "info");
  const { address } = await deployErc20({ sender: ALICE });
  const server = await startWebSocketServer((socket, id) => {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }));
    // Note: as a source subscribed by `topic0` alone receives other
    // contracts' logs with that signature, which trigger no scan.
    for (let i = 0; i < 25; i++) {
      notify(socket, "0x1", getNotifiedLog(address, i));
    }
  });
  // Note: the first pause, 5 heartbeats, lasts 1 s and polls 10 times.
  const { pollingStates, logs } = subscribeLogTriggers({
    address,
    pollingInterval: 100,
    heartbeatInterval: 200,
    ws: server.url,
    isTrigger: () => false,
  });
  const getPauseCount = () =>
    infoSpy.mock.calls.filter(
      ([log]) =>
        (log as { msg: string }).msg ===
        "Paused JSON-RPC WebSocket log notifications, which arrive more often than polling would request",
    ).length;

  // More notifications within the first pause's length than two per poll.
  // Note: a notification that arrives during a scan is tested again after it,
  // so distinct logs count the notifications let through.
  await waitFor(() => getPauseCount() === 1);
  await waitFor(() => pollingStates.at(-1) === true);
  expect(new Set(logs).size).toBe(20);

  // After resuming, the same budget applies, though the next pause doubles.
  await waitFor(() => getPauseCount() === 2, 3_000);
  expect(new Set(logs).size).toBe(40);
});

test("subscribe() keeps log notifications for a burst of logs within the budget", async () => {
  const infoSpy = vi.spyOn(context.common.logger, "info");
  const { address } = await deployErc20({ sender: ALICE });
  const server = await startWebSocketServer((socket, id) => {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }));
    // Note: as one transaction with many indexed logs.
    for (let i = 0; i < 50; i++) {
      notify(socket, "0x1", getNotifiedLog(address, i));
    }
  });
  // Note: a pause of 5 heartbeats, 5 minutes, would poll 150 times.
  const { pollingStates, logs } = subscribeLogTriggers({
    address,
    pollingInterval: 2_000,
    heartbeatInterval: 60_000,
    ws: server.url,
    isTrigger: () => false,
  });

  await waitFor(() => new Set(logs).size === 50);
  expect(infoSpy).not.toHaveBeenCalledWith(
    expect.objectContaining({
      msg: "Paused JSON-RPC WebSocket log notifications, which arrive more often than polling would request",
    }),
  );
  expect(pollingStates.at(-1)).toBe(false);
});

test("subscribe() never follows newHeads on a chain with experimentalRangeScan", async () => {
  // Note: the chain's sources rule the range scan out, so there's no trigger.
  const chain = {
    ...getChain({ experimentalRangeScan: true }),
    pollingInterval: 100,
    ws: anvil.rpcUrls.default.webSocket[0],
  };
  const rpc = createRpc({ common: context.common, chain });
  onTestFinished(() => rpc.unsubscribe());

  await simulateBlock();

  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const requestSpy = vi.spyOn(rpc, "request");
  await new Promise<SyncBlock | SyncBlockHeader>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block);
        return true;
      },
      onError: () => {},
    });
  });

  expect(requestSpy.mock.calls[0]![0]).toMatchObject({
    method: "eth_getBlockByNumber",
    params: ["latest", true],
  });
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: expect.stringContaining("Ignoring 'ws'"),
    }),
  );
});

test("subscribe() keeps backing off while a subscription is unconfirmed", async () => {
  const warnSpy = vi.spyOn(context.common.logger, "warn");
  const { address } = await deployErc20({ sender: ALICE });
  // Confirms the first filter only.
  const server = await startWebSocketServer((socket, id) => {
    if (id === 1) {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }));
    }
  });
  subscribeLogTriggers({
    address,
    pollingInterval: 50,
    heartbeatInterval: 300,
    ws: server.url,
    filters: [
      { address: [address], topics: [[TRANSFER_TOPIC0]] },
      { topics: [[TRANSFER_TOPIC0]] },
    ],
  });

  const getFailures = () =>
    warnSpy.mock.calls
      .map(([log]) => log as { msg: string; retry_count?: number })
      .filter((log) => log.msg === "Failed JSON-RPC WebSocket subscription");
  await waitFor(() => getFailures().length >= 3);
  // Note: the half-confirmed subscription must not reset the backoff.
  expect(getFailures().map((log) => log.retry_count)).toStrictEqual(
    expect.arrayContaining([1, 2, 3]),
  );
});

test("subscribe() retries a failed scan with backoff until one succeeds", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  const scannedAt: number[] = [];
  // Note: the realtime sync fails the first two scans.
  let failures = 2;
  const { blocks } = subscribeLogTriggers({
    address,
    // Note: no tick or heartbeat during the test.
    pollingInterval: 60_000,
    heartbeatInterval: 60_000,
    onBlock: async () => {
      scannedAt.push(Date.now());
    },
    hasFailed: () => failures-- > 0,
  });

  await waitFor(() => blocks.length === 3);
  // Retried after 1 s, then 2 s, rather than at the next tick a minute away.
  expect(scannedAt[1]! - scannedAt[0]!).toBeGreaterThanOrEqual(900);
  expect(scannedAt[2]! - scannedAt[1]!).toBeGreaterThanOrEqual(1_900);

  // A successful scan stops the retries.
  await sleep(4_500);
  expect(blocks).toHaveLength(3);
}, 15_000);
