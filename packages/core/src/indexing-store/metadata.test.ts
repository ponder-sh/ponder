import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { getLiveMetadataStore, getMetadataStore } from "./metadata.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("getLiveMetadata() empty", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const metadataStore = getLiveMetadataStore({
    db: database.qb.user,
  });

  const status = await metadataStore.getStatus();

  expect(status).toBe(null);

  await cleanup();
});

test("getLiveMetadata()", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  await getMetadataStore({
    db: database.qb.user,
    instanceId: "1234",
  }).setStatus({
    mainnet: { block: { number: 10, timestamp: 10 }, ready: false },
  });

  const metadataStore = getLiveMetadataStore({
    db: database.qb.user,
  });

  const status = await metadataStore.getStatus();

  expect(status).toStrictEqual({
    mainnet: { block: { number: 10, timestamp: 10 }, ready: false },
  });

  await cleanup();
});

test("getMetadata() empty", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({
    db: database.qb.user,
    instanceId: "1234",
  });

  const status = await metadataStore.getStatus();

  expect(status).toBe(null);

  await cleanup();
});

test("setMetadata()", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);
  const metadataStore = getMetadataStore({
    db: database.qb.user,
    instanceId: "1234",
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
