import { describe } from "node:test";
import {
  setupContext,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { zeroCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { type TestContext, bench } from "vitest";
import type { IndexingStore } from "./store.js";

let context: TestContext;
let indexingStore: IndexingStore;
let cleanup: () => Promise<void>;

let count = 50_000;

const schema = createSchema((p) => ({
  IntTable: p.createTable({
    id: p.int(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
  StringTable: p.createTable({
    id: p.string(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
  HexTable: p.createTable({
    id: p.hex(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
  BigintTable: p.createTable({
    id: p.bigint(),
    name: p.string(),
    bigAge: p.bigint(),
  }),
}));

const setup = async () => {
  context = {} as TestContext;

  setupContext(context);
  const cleanupDatabase = await setupIsolatedDatabase(context);
  const { indexingStore: indexingStore_, cleanup: cleanupIndexingStore } =
    await setupDatabaseServices(context, {
      schema,
      tableIds: getTableIds(schema),
    });

  indexingStore = indexingStore_;
  cleanup = async () => {
    await cleanupIndexingStore();
    await cleanupDatabase();
  };

  await indexingStore.createMany({
    tableName: "IntTable",
    checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
    data: range(0, count).map((i) => ({ id: i, name: "Kevin", bigAge: 22n })),
  });
  await indexingStore.createMany({
    tableName: "StringTable",
    checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
    data: range(0, count).map((i) => ({
      id: `${i}`,
      name: "Kevin",
      bigAge: 22n,
    })),
  });
  await indexingStore.createMany({
    tableName: "HexTable",
    checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
    data: range(0, count).map((i) => ({
      id: `0x${i.toString(16)}`,
      name: "Kevin",
      bigAge: 22n,
    })),
  });
  await indexingStore.createMany({
    tableName: "BigintTable",
    checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
    data: range(0, count).map((i) => ({
      id: BigInt(i),
      name: "Kevin",
      bigAge: 22n,
    })),
  });
};

const teardown = async () => {
  await cleanup();
};

// IntTable

describe("IntTable", () => {
  bench(
    "IntTable create",
    async () => {
      await indexingStore.create({
        tableName: "IntTable",
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
    "IntTable update",
    async () => {
      await indexingStore.update({
        tableName: "IntTable",
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
    "IntTable upsert",
    async () => {
      await indexingStore.upsert({
        tableName: "IntTable",
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
    "IntTable delete",
    async () => {
      await indexingStore.delete({
        tableName: "IntTable",
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
    "IntTable findUnique",
    async () => {
      await indexingStore.findUnique({
        tableName: "IntTable",
        id: 500,
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "IntTable findMany",
    async () => {
      await indexingStore.findMany({
        tableName: "IntTable",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "IntTable createMany",
    async () => {
      await indexingStore.createMany({
        tableName: "IntTable",
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
    "IntTable updateMany",
    async () => {
      await indexingStore.updateMany({
        tableName: "IntTable",
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
    "IntTable revert",
    async () => {
      await indexingStore.revert({
        checkpoint: { ...zeroCheckpoint, blockTimestamp: 500 },
      });
    },
    {
      setup,
      teardown,
    },
  );
});

// StringTable

describe("StringTable", () => {
  bench(
    "StringTable create",
    async () => {
      await indexingStore.create({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: (count++).toString(),
        data: { name: "Kyle", bigAge: 10n },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable update",
    async () => {
      await indexingStore.update({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: "500",
        data: { name: "Kyle" },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable upsert",
    async () => {
      await indexingStore.upsert({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: (count++).toString(),
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
    "StringTable delete",
    async () => {
      await indexingStore.delete({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: (count--).toString(),
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable findUnique",
    async () => {
      await indexingStore.findUnique({
        tableName: "StringTable",
        id: "500",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable findMany",
    async () => {
      await indexingStore.findMany({
        tableName: "StringTable",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable createMany",
    async () => {
      await indexingStore.createMany({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: [
          { id: (count++).toString(), name: "Kevin", bigAge: 22n },
          { id: (count++).toString(), name: "Kevin", bigAge: 22n },
          { id: (count++).toString(), name: "Kevin", bigAge: 22n },
        ],
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable updateMany",
    async () => {
      await indexingStore.updateMany({
        tableName: "StringTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: { name: "Kevin", bigAge: 22n },
        where: { id: { equals: "500" } },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "StringTable revert",
    async () => {
      await indexingStore.revert({
        checkpoint: { ...zeroCheckpoint, blockTimestamp: 500 },
      });
    },
    {
      setup,
      teardown,
    },
  );
});

// HexTable

describe("HexTable", () => {
  bench(
    "HexTable create",
    async () => {
      await indexingStore.create({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: `0x${(count++).toString(16)}`,
        data: { name: "Kyle", bigAge: 10n },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable update",
    async () => {
      await indexingStore.update({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: "0x500",
        data: { name: "Kyle" },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable upsert",
    async () => {
      await indexingStore.upsert({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: `0x${(count++).toString(16)}`,
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
    "HexTable delete",
    async () => {
      await indexingStore.delete({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: `0x${(count--).toString(16)}`,
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable findUnique",
    async () => {
      await indexingStore.findUnique({
        tableName: "HexTable",
        id: "0x500",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable findMany",
    async () => {
      await indexingStore.findMany({
        tableName: "HexTable",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable createMany",
    async () => {
      await indexingStore.createMany({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: [
          { id: `0x${(count++).toString(16)}`, name: "Kevin", bigAge: 22n },
          { id: `0x${(count++).toString(16)}`, name: "Kevin", bigAge: 22n },
          { id: `0x${(count++).toString(16)}`, name: "Kevin", bigAge: 22n },
        ],
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable updateMany",
    async () => {
      await indexingStore.updateMany({
        tableName: "HexTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: { name: "Kevin", bigAge: 22n },
        where: { id: { equals: "0x500" } },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "HexTable revert",
    async () => {
      await indexingStore.revert({
        checkpoint: { ...zeroCheckpoint, blockTimestamp: 500 },
      });
    },
    {
      setup,
      teardown,
    },
  );
});

// BigintTable

describe("BigintTable", () => {
  bench(
    "BigintTable create",
    async () => {
      await indexingStore.create({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: BigInt(count++),
        data: { name: "Kyle", bigAge: 10n },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable update",
    async () => {
      await indexingStore.update({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: 500n,
        data: { name: "Kyle" },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable upsert",
    async () => {
      await indexingStore.upsert({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: BigInt(count++),
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
    "BigintTable delete",
    async () => {
      await indexingStore.delete({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        id: BigInt(count--),
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable findUnique",
    async () => {
      await indexingStore.findUnique({
        tableName: "BigintTable",
        id: 500n,
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable findMany",
    async () => {
      await indexingStore.findMany({
        tableName: "BigintTable",
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable createMany",
    async () => {
      await indexingStore.createMany({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: [
          { id: BigInt(count++), name: "Kevin", bigAge: 22n },
          { id: BigInt(count++), name: "Kevin", bigAge: 22n },
          { id: BigInt(count++), name: "Kevin", bigAge: 22n },
        ],
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable updateMany",
    async () => {
      await indexingStore.updateMany({
        tableName: "BigintTable",
        checkpoint: { ...zeroCheckpoint, blockTimestamp: count },
        data: { name: "Kevin", bigAge: 22n },
        where: { id: { equals: 500n } },
      });
    },
    {
      setup,
      teardown,
    },
  );

  bench(
    "BigintTable revert",
    async () => {
      await indexingStore.revert({
        checkpoint: { ...zeroCheckpoint, blockTimestamp: 500 },
      });
    },
    {
      setup,
      teardown,
    },
  );
});
