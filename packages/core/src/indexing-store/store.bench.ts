import { setupContext, setupIndexingStore } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import { zeroCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { type TestContext, bench } from "vitest";

let context: TestContext;
let teardownIndexingStore: () => Promise<void>;
let count = 50_000;

const schema = createSchema((p) => ({
  Table: p.createTable({
    id: p.int(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
}));

const setup = async () => {
  context = {} as TestContext;

  setupContext(context);

  teardownIndexingStore = await setupIndexingStore(context);

  await context.indexingStore.reload({ schema });
  await context.indexingStore.createMany({
    tableName: "Table",
    checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
    data: range(0, count).map((i) => ({ id: i, name: "Kevin", bigAge: 22n })),
  });
};

const teardown = async () => {
  await teardownIndexingStore();
};

bench(
  "IndexingStore create",
  async () => {
    await context.indexingStore.create({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      id: count++,
      data: { name: "Kyle", bigAge: 10n },
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore update",
  async () => {
    await context.indexingStore.update({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      id: 500,
      data: { name: "Kyle" },
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore upsert",
  async () => {
    await context.indexingStore.upsert({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      id: count++,
      create: { name: "Kyle", bigAge: 23n },
      update: { name: "Kyle" },
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore delete",
  async () => {
    await context.indexingStore.delete({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      id: --count,
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore findUnique",
  async () => {
    await context.indexingStore.findUnique({
      tableName: "Table",
      id: 500,
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore findMany",
  async () => {
    await context.indexingStore.findMany({
      tableName: "Table",
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore createMany",
  async () => {
    await context.indexingStore.createMany({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      data: [
        { id: count++, name: "Kevin", bigAge: 22n },
        { id: count++, name: "Kevin", bigAge: 22n },
        { id: count++, name: "Kevin", bigAge: 22n },
      ],
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore updateMany",
  async () => {
    await context.indexingStore.updateMany({
      tableName: "Table",
      checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
      data: { name: "Kevin", bigAge: 22n },
      where: { id: { equals: 500 } },
    });
  },
  {
    setup,
    teardown,
  },
);

bench(
  "IndexingStore revert",
  async () => {
    await context.indexingStore.revert({
      checkpoint: { ...zeroCheckpoint, blockTimestamp: 500 },
    });
  },
  {
    setup,
    teardown,
  },
);
