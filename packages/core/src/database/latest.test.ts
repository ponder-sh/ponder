import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { beforeEach, test } from "vitest";
import { getLatest } from "./latest.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const schema = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable({
    id: p.string(),
    name: p.string(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
    kind: p.enum("PetKind").optional(),
    rating: p.float().optional(),
  }),
  Person: p.createTable({
    id: p.string(),
    name: p.string(),
  }),
}));

test.skip("getLatest()", async (context) => {
  const { indexingStore, database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context, {
      schema,
      indexing: "realtime",
    });
  const metadataStore = await getMetadataStore({
    encoding: database.kind,
    namespaceInfo,
    db: database.indexingDb,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      chainId: 1n,
    }),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      chainId: 2n,
    }),
    id: "id2",
    data: { name: "Kevin" },
  });

  await metadataStore.setLatest({
    mainnet: { blockNumber: 10, sync: "realtime" },
  });

  await getLatest({
    db: database.indexingDb,
    namespaceInfo,
  });

  await metadataStore.getLatest().then(console.log);

  await cleanup();
});
