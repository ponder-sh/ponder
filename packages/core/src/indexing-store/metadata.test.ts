import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import { beforeEach, expect, test } from "vitest";
import { getMetadataStore } from "./metadata.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const schema = createSchema(() => ({}));

test("getMetadata() empty", async (context) => {
  const { database, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );
  const metadataStore = getMetadataStore({
    encoding: database.kind,
    namespaceInfo,
    db: database.indexingDb,
  });

  const latest = await metadataStore.getLatest();

  expect(latest).toBeUndefined();

  await cleanup();
});

test("setMetadata()", async (context) => {
  const { database, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );
  const metadataStore = getMetadataStore({
    encoding: database.kind,
    namespaceInfo,
    db: database.indexingDb,
  });

  await metadataStore.setLatest({
    mainnet: { blockNumber: 10, sync: "realtime" },
  });

  const latest = await metadataStore.getLatest();

  expect(latest).toStrictEqual({
    mainnet: { blockNumber: 10, sync: "realtime" },
  });

  await cleanup();
});
