import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { getMetadataStore } from "./metadata.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("getMetadata() empty", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({
    db: database.qb.user,
  });

  const status = await metadataStore.getStatus();

  expect(status).toBe(null);

  await cleanup();
});

test("setMetadata()", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({
    db: database.qb.user,
  });

  await metadataStore.setStatus({
    mainnet: { block: { number: 10, timestamp: 10 }, ready: false },
  });

  const status = await metadataStore.getStatus();

  expect(status).toStrictEqual({
    mainnet: { block: { number: 10, timestamp: 10 }, ready: false },
  });

  await cleanup();
});
