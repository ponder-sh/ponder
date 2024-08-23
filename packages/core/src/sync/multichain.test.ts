import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { beforeEach, expect, test } from "vitest";
import { createMultichainSync } from "./multichain.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createMultichainSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createMultichainSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    network: context.networks[0],
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  expect(sync).toBeDefined();

  expect(sync.getStatus().mainnet!.ready).toBe(false);
  expect(sync.getStartCheckpoint()).not.toBe(encodeCheckpoint(zeroCheckpoint));
  expect(sync.getFinalizedCheckpoint()).not.toBe(
    encodeCheckpoint(zeroCheckpoint),
  );

  await sync.kill();

  await cleanup();
});
