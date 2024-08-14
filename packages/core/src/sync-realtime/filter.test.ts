import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getRawRPCData } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import {
  isCallTraceFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
} from "./filter.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("isLogFactoryMatched()", async (context) => {
  const rpcData = await getRawRPCData();

  let isMatched = isLogFactoryMatched({
    filter: context.sources[1].filter.address,
    log: rpcData.block3.logs[0],
  });
  expect(isMatched).toBe(true);

  isMatched = isLogFactoryMatched({
    filter: context.sources[1].filter.address,
    log: rpcData.block2.logs[0],
  });
  expect(isMatched).toBe(false);

  isMatched = isLogFactoryMatched({
    filter: context.sources[2].filter.toAddress,
    log: rpcData.block3.logs[0],
  });
  expect(isMatched).toBe(true);

  isMatched = isLogFactoryMatched({
    filter: context.sources[2].filter.toAddress,
    log: rpcData.block2.logs[0],
  });
  expect(isMatched).toBe(false);
});

test("isLogFilterMatched", async (context) => {
  const rpcData = await getRawRPCData();

  let isMatched = isLogFilterMatched({
    filter: context.sources[0].filter,
    block: rpcData.block2.block,
    log: rpcData.block2.logs[1],
  });
  expect(isMatched).toBe(true);

  isMatched = isLogFilterMatched({
    filter: context.sources[1].filter,
    block: rpcData.block4.block,
    log: rpcData.block4.logs[0],
  });
  expect(isMatched).toBe(true);

  isMatched = isLogFilterMatched({
    filter: context.sources[0].filter,
    block: rpcData.block4.block,
    log: rpcData.block4.logs[0],
  });
  expect(isMatched).toBe(false);
});

test("isCallTraceFilterMatched", async (context) => {
  const rpcData = await getRawRPCData();

  let isMatched = isCallTraceFilterMatched({
    filter: context.sources[3].filter,
    block: rpcData.block3.block,
    callTrace: rpcData.block3.traces[0],
  });
  expect(isMatched).toBe(true);

  isMatched = isCallTraceFilterMatched({
    filter: context.sources[2].filter,
    block: rpcData.block3.block,
    callTrace: rpcData.block3.traces[0],
  });
  expect(isMatched).toBe(true);

  isMatched = isCallTraceFilterMatched({
    filter: context.sources[3].filter,
    block: rpcData.block2.block,
    callTrace: rpcData.block2.traces[0],
  });
  expect(isMatched).toBe(false);
});
