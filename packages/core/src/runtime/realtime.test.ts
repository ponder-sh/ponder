import { numberToHex } from "viem";
import { expect, test } from "vitest";
import { getChain } from "@/_test/utils.js";
import type { Chain } from "@/internal/types.js";
import type { RealtimeSyncEvent } from "@/sync-realtime/index.js";
import { mergeAsyncGeneratorsWithRealtimeOrder } from "./realtime.js";

type Item = { chain: Chain; event: RealtimeSyncEvent };
type Iter = AsyncGenerator<Item> & {
  waiting?: Promise<IteratorResult<Item>>;
};

const now = () => Math.floor(Date.now() / 1_000);

/** A chain whose events are pushed by the test. `next()` waits until one is. */
function createChain(id: number, allowLateBlocks = false) {
  const chain = { ...getChain(), id, name: `chain${id}`, allowLateBlocks };
  const queue: RealtimeSyncEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let error: Error | undefined;

  async function* generator(): AsyncGenerator<Item> {
    while (true) {
      while (queue.length === 0 && !done && !error) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (error) throw error;
      if (queue.length === 0) return;
      yield { chain, event: queue.shift()! };
    }
  }

  const push = (event: RealtimeSyncEvent) => {
    queue.push(event);
    wake?.();
  };

  return {
    chain,
    generator: generator(),
    block(timestamp: number, number = timestamp) {
      const block = {
        timestamp: numberToHex(timestamp),
        number: numberToHex(number),
        hash: numberToHex(number, { size: 32 }),
      };
      push({ type: "block", block } as unknown as RealtimeSyncEvent);
    },
    finalize() {
      push({ type: "finalize" } as unknown as RealtimeSyncEvent);
    },
    end() {
      done = true;
      wake?.();
    },
    fail(e: Error) {
      error = e;
      wake?.();
    },
  };
}

type TestChain = ReturnType<typeof createChain>;

/**
 * Pulls up to `n` items within `ms`. An unanswered `next()` is kept and reused,
 * so no item is lost to a timed-out call.
 */
async function take(iterator: Iter, n: number, ms = 1_500) {
  const items: Item[] = [];
  const deadline = Date.now() + ms;
  while (items.length < n) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    iterator.waiting ??= iterator.next();
    const result = await Promise.race([
      iterator.waiting,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), left),
      ),
    ]);
    if (result === "timeout") break;
    iterator.waiting = undefined;
    if (result.done) break;
    items.push(result.value);
  }
  return items.map(label);
}

/** Ends every chain and drains the merge, so its re-check timer stops. */
async function close(iterator: Iter, ...chains: TestChain[]) {
  for (const chain of chains) chain.end();
  while (!(await (iterator.waiting ?? iterator.next())).done) {
    iterator.waiting = undefined;
  }
}

const label = ({ chain, event }: Item) =>
  event.type === "block"
    ? `${chain.id}@${Number(event.block.timestamp)}`
    : `${chain.id}:${event.type}`;

async function drain(iterator: AsyncGenerator<Item>) {
  const labels: string[] = [];
  for await (const item of iterator) labels.push(label(item));
  return labels;
}

test("mergeAsyncGeneratorsWithRealtimeOrder() orders blocks by checkpoint", async () => {
  const a = createChain(1);
  const b = createChain(2);
  const t = now() - 1_000;
  for (const d of [0, 3, 6, 9]) a.block(t + d);
  for (const d of [1, 2, 7, 8]) b.block(t + d);
  a.end();
  b.end();

  const labels = await drain(
    mergeAsyncGeneratorsWithRealtimeOrder([a.generator, b.generator]),
  );

  expect(labels).toStrictEqual(
    [0, 1, 2, 3, 6, 7, 8, 9].map(
      (d) => `${[0, 3, 6, 9].includes(d) ? 1 : 2}@${t + d}`,
    ),
  );
});

test("mergeAsyncGeneratorsWithRealtimeOrder() yields finalize and reorg events first", async () => {
  const a = createChain(1);
  const b = createChain(2);
  const t = now() - 1_000;
  a.block(t);
  b.finalize();
  b.block(t + 5);
  a.end();
  b.end();

  const labels = await drain(
    mergeAsyncGeneratorsWithRealtimeOrder([a.generator, b.generator]),
  );

  expect(labels).toStrictEqual(["2:finalize", `1@${t}`, `2@${t + 5}`]);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() ends when every generator ends", async () => {
  const a = createChain(1);
  const b = createChain(2);
  const t = now() - 1_000;
  b.end();
  a.block(t);
  a.block(t + 1);
  a.end();

  const labels = await drain(
    mergeAsyncGeneratorsWithRealtimeOrder([a.generator, b.generator]),
  );

  expect(labels).toStrictEqual([`1@${t}`, `1@${t + 1}`]);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() waits on an idle chain without allowLateBlocks", async () => {
  const a = createChain(1);
  const b = createChain(2);
  const t = now();
  b.block(t - 600);
  a.block(t - 300);
  const caughtUpAt = new Map([[2, Date.now()]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 2, 2_500)).toStrictEqual([`2@${t - 600}`]);
  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() waits on an idle chain that was never confirmed caught up", async () => {
  const a = createChain(1);
  const b = createChain(2, true);
  const t = now() - 600;
  b.block(t);
  a.block(t + 1);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder([
    a.generator,
    b.generator,
  ]);

  expect(await take(iterator, 2, 2_500)).toStrictEqual([`2@${t}`]);
  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() continues past a caught-up chain with allowLateBlocks", async () => {
  const a = createChain(1);
  const b = createChain(2, true);
  const t = now();
  b.block(t - 600);
  a.block(t - 300);
  a.block(t - 100);
  a.block(t - 5); // inside the clock margin
  const caughtUpAt = new Map([[2, Date.now()]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 4, 2_500)).toStrictEqual([
    `2@${t - 600}`,
    `1@${t - 300}`,
    `1@${t - 100}`,
  ]);

  // Chain 1 doesn't allow late blocks, so chain 2's block waits for its next block.
  b.block(t);
  expect(await take(iterator, 2, 2_500)).toStrictEqual([`1@${t - 5}`]);
  a.block(t + 1);
  expect(await take(iterator, 1, 2_500)).toStrictEqual([`2@${t}`]);

  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() holds blocks newer than the caught-up time", async () => {
  const a = createChain(1);
  const b = createChain(2, true);
  const t = now();
  b.block(t - 1_000);
  a.block(t - 900);
  a.block(t - 500);
  const caughtUpAt = new Map([[2, (t - 800) * 1_000]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 3, 2_500)).toStrictEqual([
    `2@${t - 1_000}`,
    `1@${t - 900}`,
  ]);
  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() releases held blocks when the caught-up time advances", async () => {
  const a = createChain(1);
  const b = createChain(2, true);
  const t = now();
  b.block(t - 1_000);
  a.block(t - 500);
  const caughtUpAt = new Map([[2, (t - 800) * 1_000]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 2, 2_000)).toStrictEqual([`2@${t - 1_000}`]);
  caughtUpAt.set(2, Date.now());
  expect(await take(iterator, 1, 2_500)).toStrictEqual([`1@${t - 500}`]);
  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() yields a late block from a chain with allowLateBlocks", async () => {
  const a = createChain(1);
  const b = createChain(2, true);
  const t = now();
  b.block(t - 1_000);
  a.block(t - 300);
  const caughtUpAt = new Map([[2, Date.now()]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 2, 2_500)).toStrictEqual([
    `2@${t - 1_000}`,
    `1@${t - 300}`,
  ]);

  // A late block, e.g. from a stale RPC.
  b.block(t - 400);
  a.block(t - 200);
  expect(await take(iterator, 1, 2_500)).toStrictEqual([`2@${t - 400}`]);

  await close(iterator, a, b);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() throws a generator error without an unhandled rejection", async () => {
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled++;
  };
  process.on("unhandledRejection", onUnhandled);

  const a = createChain(1);
  const b = createChain(2, true);
  const t = now();
  b.block(t - 600);
  a.block(t - 300);
  a.block(t - 200);
  const caughtUpAt = new Map([[2, Date.now()]]);

  const iterator: Iter = mergeAsyncGeneratorsWithRealtimeOrder(
    [a.generator, b.generator],
    caughtUpAt,
  );

  expect(await take(iterator, 2, 1_500)).toHaveLength(2);
  b.fail(new Error("rpc error"));
  await new Promise((resolve) => setTimeout(resolve, 50));

  await expect(
    (async () => {
      for (let i = 0; i < 5; i++) {
        await (iterator.waiting ?? iterator.next());
        iterator.waiting = undefined;
      }
    })(),
  ).rejects.toThrow("rpc error");

  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toBe(0);
});

test("mergeAsyncGeneratorsWithRealtimeOrder() keeps checkpoint order on random input", async () => {
  for (let round = 0; round < 20; round++) {
    const chains = [createChain(1), createChain(2), createChain(3)];
    const base = now() - 5_000;
    for (const [i, chain] of chains.entries()) {
      let timestamp = base + i;
      for (let k = 0; k < 30; k++) {
        timestamp += 1 + Math.floor(Math.random() * 20);
        chain.block(timestamp, timestamp * 10 + i);
      }
      chain.end();
    }

    const seen: [number, number][] = [];
    for await (const { chain, event } of mergeAsyncGeneratorsWithRealtimeOrder(
      chains.map((c) => c.generator),
    )) {
      if (event.type === "block") {
        seen.push([Number(event.block.timestamp), chain.id]);
      }
    }

    expect(seen).toHaveLength(90);
    for (let k = 1; k < seen.length; k++) {
      const [t0, c0] = seen[k - 1]!;
      const [t1, c1] = seen[k]!;
      expect(t0 < t1 || (t0 === t1 && c0 <= c1)).toBe(true);
    }
  }
});
