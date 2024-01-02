import { setupAnvil } from "@/_test/setup.js";
import { getNetworks } from "@/_test/utils.js";
import { RpcRequestError, zeroHash } from "viem";
import { beforeEach, expect, test } from "vitest";
import { wait } from "./wait.js";

beforeEach((context) => setupAnvil(context));

test("pause + start", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;
  queue.pause();

  const r = queue.request({ method: "eth_chainId" }, null);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  queue.start();

  await r;

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("size and pending", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;
  queue.pause();

  const r1 = queue.request({ method: "eth_chainId" }, null);
  queue.request({ method: "eth_chainId" }, null);

  queue.start();

  await r1;

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);
});

test("request per second", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;

  const r1 = queue.request({ method: "eth_chainId" }, null);
  const r2 = queue.request({ method: "eth_chainId" }, null);

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

test("add() returns promise", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;

  const r1 = queue.request({ method: "eth_chainId" }, null);

  expect(await r1).toBe("0x1");
});

test("add() ordering", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;
  queue.pause();

  queue.request(
    { method: "eth_getLogs", params: [{ blockHash: "0x5" }] },
    null,
  );
  queue.request(
    { method: "eth_getLogs", params: [{ blockHash: "0x1" }] },
    "latest",
  );

  expect(queue.queue[0].params.params).toStrictEqual([{ blockHash: "0x1" }]);
  expect(queue.queue[1].params.params).toStrictEqual([{ blockHash: "0x5" }]);

  queue.request({ method: "eth_getLogs", params: [{ blockHash: "0x3" }] }, 3);
  queue.request({ method: "eth_getLogs", params: [{ blockHash: "0x4" }] }, 4);
  queue.request({ method: "eth_getLogs", params: [{ blockHash: "0x2" }] }, 2);

  expect(queue.queue[0].params.params).toStrictEqual([{ blockHash: "0x1" }]);
  expect(queue.queue[1].params.params).toStrictEqual([{ blockHash: "0x2" }]);
  expect(queue.queue[2].params.params).toStrictEqual([{ blockHash: "0x3" }]);
  expect(queue.queue[3].params.params).toStrictEqual([{ blockHash: "0x4" }]);
  expect(queue.queue[4].params.params).toStrictEqual([{ blockHash: "0x5" }]);
});

test("kill()", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;

  let reject1 = false;
  let reject2 = false;
  queue.request({ method: "eth_chainId" }, null).catch(() => {
    reject1 = true;
  });
  queue.request({ method: "eth_chainId" }, null).catch(() => {
    reject2 = true;
  });

  queue.kill();

  await new Promise((resolve) => setImmediate(resolve)).then(() => {
    expect(reject1).toBe(true);
    expect(reject2).toBe(true);
  });
});

test("request() error", async ({ common }) => {
  const queue = (await getNetworks(common, 1))[0].requestQueue;

  let error: any;

  const r1 = queue
    .request(
      {
        method: "eth_getBlocByHash" as "eth_getBlockByHash",
        params: [zeroHash, false],
      },
      null,
    )
    .catch((_error) => {
      error = _error;
    });

  await r1;

  expect(error).toBeInstanceOf(RpcRequestError);
});
