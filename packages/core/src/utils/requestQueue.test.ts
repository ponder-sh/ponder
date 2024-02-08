import type { Common } from "@/Ponder.js";
import { setupAnvil } from "@/_test/setup.js";
import type { Network } from "@/config/networks.js";
import { RpcRequestError } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createRequestQueue } from "./requestQueue.js";
import { startClock } from "./timer.js";
import { wait } from "./wait.js";

beforeEach((context) => setupAnvil(context));

/** Creates a request queue with a `maxRequestsPerSecond` of 1. */
const getQueue = (network: Network, common: Common) => {
  return createRequestQueue({
    network: { ...network, maxRequestsPerSecond: 1 },
    metrics: common.metrics,
  });
};

test("pause + start", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);
  queue.pause();

  const r = queue.request({ method: "eth_chainId" });

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  queue.start();

  await r;

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("size and pending", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);
  queue.pause();

  const r1 = queue.request({ method: "eth_chainId" });
  queue.request({ method: "eth_chainId" });

  queue.start();

  await r1;

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);
});

test("request per second", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  const r1 = queue.request({ method: "eth_chainId" });
  const r2 = queue.request({ method: "eth_chainId" });

  await r1;

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  await wait(500);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  await r2;

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("request() returns promise", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  const r1 = queue.request({ method: "eth_chainId" });

  expect(await r1).toBe("0x1");
});

test("request() error", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  let error: any;

  const r1 = queue
    .request({
      method: "eth_getBlocByHash" as "eth_getBlockByHash",
      params: ["0x", false],
    })
    .catch((_error: any) => {
      error = _error;
    });

  await r1;

  expect(error.cause).toBeInstanceOf(RpcRequestError);
});

test("clear()", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  queue.pause();

  queue.request({ method: "eth_chainId" });
  queue.request({ method: "eth_chainId" });
  queue.request({ method: "eth_chainId" });

  queue.clear();

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("onIdle() resolves once idle", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  queue.request({ method: "eth_chainId" });
  queue.request({ method: "eth_chainId" });

  queue.clear();
  await queue.onIdle();

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("onIdle() resolves immediately if idle", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);

  queue.request({ method: "eth_chainId" });
  queue.request({ method: "eth_chainId" });

  queue.clear();
  await queue.onIdle();

  const endClock = startClock();
  await queue.onIdle();
  expect(endClock()).toBeLessThan(5);
});
