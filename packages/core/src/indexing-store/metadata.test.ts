import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { getMetadataStore } from "./metadata.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("getMetadata() empty", async (context) => {
  const { database } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({ database });

  const status = await metadataStore.getStatus();

  expect(status).toBe(null);
});

test("setMetadata()", async (context) => {
  const { database } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({ database });

  await metadataStore.setStatus({
    [1]: { block: { number: 10, timestamp: 10 }, ready: false },
  });

  const status = await metadataStore.getStatus();

  expect(status).toStrictEqual({
    [1]: { block: { number: 10, timestamp: 10 }, ready: false },
  });
});
