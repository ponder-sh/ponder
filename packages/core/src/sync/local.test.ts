import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { createLocalSync } from "./local.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createLocalSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createLocalSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    network: context.networks[0],
  });

  expect(sync).toBeDefined();
  expect(sync.startBlock.number).toBe("0x0");
  expect(sync.endBlock).toBe(undefined);
  expect(sync.finalizedBlock.number).toBe("0x1");
  expect(sync.latestBlock).toBe(undefined);

  await cleanup();
});

test("sync()", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const sync = await createLocalSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    network: context.networks[0],
  });

  await sync.sync();

  const intervals = await database.syncDb
    .selectFrom("interval")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(4);

  await cleanup();
});

test("latestBlock resolves to finalizedBlock", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createLocalSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    network: context.networks[0],
  });

  sync.finalizedBlock.number = "0x4";

  await sync.sync();

  expect(sync.latestBlock).toBeDefined();
  expect(sync.latestBlock!.number).toBe("0x4");
  expect(sync.latestBlock).toStrictEqual(sync.finalizedBlock);

  await cleanup();
});

test("latestBlock resolves to endBlock", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const filter = context.sources[0].filter;
  filter.toBlock = 3;

  const sync = await createLocalSync({
    syncStore,
    sources: [{ ...context.sources[0], filter }],
    common: context.common,
    network: context.networks[0],
  });

  sync.finalizedBlock.number = "0x4";

  await sync.sync();

  expect(sync.latestBlock).toBeDefined();
  expect(sync.endBlock).toBeDefined();
  expect(sync.latestBlock!.number).toBe("0x3");
  expect(sync.latestBlock).toStrictEqual(sync.endBlock);

  await cleanup();
});
