import { setupAnvil } from "@/_test/setup.js";
import { getNetworks } from "@/_test/utils.js";
import { RpcRequestError, zeroHash } from "viem";
import { beforeEach, expect, test } from "vitest";
import { wait } from "./wait.js";

beforeEach((context) => setupAnvil(context));

test("pause + start", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;
  queue.pause();

  queue.request({ method: "eth_chainId" }, null);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  queue.start();

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(1);
});

test("size and pending", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

  const r1 = queue.request({ method: "eth_chainId" }, null);
  queue.request({ method: "eth_chainId" }, null);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  await r1;

  expect(await queue.size()).toBe(1);
});

test("request per second", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

  const r1 = queue.request({ method: "eth_chainId" }, null);
  const r2 = queue.request({ method: "eth_chainId" }, null);

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

test("add() returns promise", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

  const r1 = queue.request({ method: "eth_chainId" }, null);

  expect(await r1).toBe("0x1");
});

test.only("add() ordering", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;
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

test("kill()", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

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

test("request() error", async () => {
  const queue = (await getNetworks(1))[0].requestQueue;

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
