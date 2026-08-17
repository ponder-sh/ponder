import { expect, test, vi } from "vitest";
import type { Chain } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { getFinalizedBlock, isAsyncExecutionChain } from "./finality.js";

test("isAsyncExecutionChain()", () => {
  expect(isAsyncExecutionChain(143)).toBe(true);
  expect(isAsyncExecutionChain(10143)).toBe(true);
  expect(isAsyncExecutionChain(1)).toBe(false);
});

const getBlock = (number: number, timestamp: number) =>
  ({
    hash: `0x${number.toString(16)}`,
    parentHash: `0x${Math.max(number - 1, 0).toString(16)}`,
    number: `0x${number.toString(16)}`,
    timestamp: `0x${timestamp.toString(16)}`,
    logsBloom: "0x",
  }) as any;

const getRpc = (blocks: Map<number, ReturnType<typeof getBlock>>) => {
  const request = vi.fn(async (request: any) =>
    blocks.get(Number(request.params[0])),
  );

  return {
    request,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    hostnames: [],
  } as unknown as Rpc & { request: typeof request };
};

const getChain = (reorgWindow: number, blockTime?: number) =>
  ({
    reorgWindow,
    viemChain: blockTime === undefined ? undefined : { blockTime },
  }) as Chain;

test("getFinalizedBlock() skips the search when finality has not advanced", async () => {
  const lowerBound = getBlock(80, 80);
  const rpc = getRpc(new Map());

  const result = await getFinalizedBlock({
    chain: getChain(30),
    rpc,
    lowerBound,
    latestBlock: getBlock(100, 100),
  });

  expect(result).toBe(lowerBound);
  expect(rpc.request).not.toHaveBeenCalled();
});

test("getFinalizedBlock() uses blockTime for its initial guess", async () => {
  const blocks = new Map<number, ReturnType<typeof getBlock>>();
  for (let i = 0; i <= 100; i++) blocks.set(i, getBlock(i, i));
  const rpc = getRpc(blocks);

  const result = await getFinalizedBlock({
    chain: getChain(20, 2_000),
    rpc,
    latestBlock: getBlock(100, 100),
  });

  expect(Number(result.number)).toBe(80);
  expect(Number(rpc.request.mock.calls[0]![0].params[0])).toBe(90);
});

test("getFinalizedBlock() assumes one-second blocks without blockTime", async () => {
  const blocks = new Map<number, ReturnType<typeof getBlock>>();
  for (let i = 0; i <= 100; i++) blocks.set(i, getBlock(i, i));
  const rpc = getRpc(blocks);

  await getFinalizedBlock({
    chain: getChain(20),
    rpc,
    latestBlock: getBlock(100, 100),
  });

  expect(Number(rpc.request.mock.calls[0]![0].params[0])).toBe(80);
});

test("getFinalizedBlock() returns genesis when the chain is younger than the reorg window", async () => {
  const genesis = getBlock(0, 100);
  const blocks = new Map<number, ReturnType<typeof getBlock>>([
    [0, genesis],
    [1, getBlock(1, 110)],
  ]);
  const rpc = getRpc(blocks);

  const result = await getFinalizedBlock({
    chain: getChain(180),
    rpc,
    latestBlock: getBlock(1, 110),
  });

  expect(result).toEqual(genesis);
});

test("getFinalizedBlock() returns the newest block at the exact cutoff", async () => {
  const blocks = new Map<number, ReturnType<typeof getBlock>>();
  for (let i = 0; i <= 100; i++) blocks.set(i, getBlock(i, i));
  const rpc = getRpc(blocks);

  const result = await getFinalizedBlock({
    chain: getChain(20),
    rpc,
    latestBlock: getBlock(100, 100),
  });

  expect(Number(result.number)).toBe(80);
});
