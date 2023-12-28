import { setupAnvil } from "@/_test/setup.js";
import { getNetworks } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import { wait } from "./wait.js";

beforeEach((context) => setupAnvil(context));

test("start", async ({ networks }) => {
  const queue = networks[0].requestQueue;

  queue.request("realtime", { method: "eth_chainId" });

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(1);
});

test("size and pending", async ({ networks }) => {
  const queue = networks[0].requestQueue;

  const r1 = queue.request("realtime", { method: "eth_chainId" });
  queue.request("realtime", { method: "eth_chainId" });

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  await r1;

  expect(await queue.size()).toBe(1);
});

test("request per second", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

  const r1 = queue.request("realtime", { method: "eth_chainId" });
  const r2 = queue.request("realtime", { method: "eth_chainId" });

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

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

test("add() returns promise", async ({ networks }) => {
  const queue = networks[0].requestQueue;

  const r1 = queue.request("realtime", { method: "eth_chainId" });

  expect(await r1).toBe("0x1");
});

test("add() ordering", async ({ networks }) => {
  const queue = networks[0].requestQueue;
  queue.pause();

  queue.request("historical", {
    method: "eth_chainId",
  });
  const r2 = queue.request("realtime", { method: "eth_chainId" });

  queue.start();

  await r2;

  expect(await queue.realtimeSize()).toBe(0);
  expect(await queue.historicalSize()).toBe(1);
});

test("kill()", async ({ networks }) => {
  const queue = networks[0].requestQueue;

  let reject1 = false;
  let reject2 = false;
  queue.request("realtime", { method: "eth_chainId" }).catch(() => {
    reject1 = true;
  });
  queue.request("realtime", { method: "eth_chainId" }).catch(() => {
    reject2 = true;
  });

  queue.kill();

  await new Promise((resolve) => setImmediate(resolve)).then(() => {
    expect(reject1).toBe(true);
    expect(reject2).toBe(true);
  });
});
