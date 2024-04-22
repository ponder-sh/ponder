import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { type TestContext, bench } from "vitest";
import type { IndexingStore } from "./store.js";

let context: TestContext;
let indexingStore: IndexingStore;
let cleanup: () => Promise<void>;

let count = 50_000;

const schema = createSchema((p) => ({
  table: p.createTable({
    id: p.string(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
}));

const setup = async () => {
  context = {} as TestContext;

  setupCommon(context);
  const cleanupDatabase = await setupIsolatedDatabase(context);
  const { indexingStore: indexingStore_, cleanup: cleanupIndexingStore } =
    await setupDatabaseServices(context, {
      schema,
    });

  indexingStore = indexingStore_;
  cleanup = async () => {
    await cleanupIndexingStore();
    await cleanupDatabase();
  };

  await indexingStore.createMany({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      blockTimestamp: count,
    }),
    data: range(0, count).map((i) => ({
      id: `${i}`,
      name: "Kevin",
      bigAge: 22n,
    })),
  });
};

const teardown = async () => {
  await cleanup();
};

bench(
  "create",
  async () => {
    await indexingStore.create({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      id: (count++).toString(),
      data: { name: "Kyle", bigAge: 10n },
    });
  },
  { setup, teardown },
);

bench(
  "update",
  async () => {
    await indexingStore.update({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      id: "500",
      data: { name: "Kyle" },
    });
  },
  { setup, teardown },
);

bench(
  "upsert",
  async () => {
    await indexingStore.upsert({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      id: (count++).toString(),
      create: { name: "Kyle", bigAge: 23n },
      update: { name: "Kyle" },
    });
  },
  { setup, teardown },
);

bench(
  "delete",
  async () => {
    await indexingStore.delete({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      id: (count--).toString(),
    });
  },
  { setup, teardown },
);

bench(
  "findUnique",
  async () => {
    await indexingStore.findUnique({
      tableName: "table",
      id: "500",
    });
  },
  { setup, teardown },
);

bench(
  "findMany",
  async () => {
    await indexingStore.findMany({
      tableName: "table",
    });
  },
  { setup, teardown },
);

bench(
  "createMany",
  async () => {
    await indexingStore.createMany({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      data: [
        { id: (count++).toString(), name: "Kevin", bigAge: 22n },
        { id: (count++).toString(), name: "Kevin", bigAge: 22n },
        { id: (count++).toString(), name: "Kevin", bigAge: 22n },
      ],
    });
  },
  { setup, teardown },
);

bench(
  "updateMany",
  async () => {
    await indexingStore.updateMany({
      tableName: "table",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: count,
      }),
      data: { name: "Kevin", bigAge: 22n },
      where: { id: { equals: "500" } },
    });
  },
  { setup, teardown },
);
