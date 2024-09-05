import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  CheckConstraintError,
  UniqueConstraintError,
} from "@/common/errors.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { beforeEach, expect, test } from "vitest";

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

const hexSchema = createSchema((p) => ({
  table: p.createTable({
    id: p.hex(),
    n: p.int(),
  }),
}));

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

test("create() inserts a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("create() throws on unique constraint violation", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip" },
  });

  const error = await indexingStore
    .create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
      id: "id1",
      data: { name: "Skip", age: 13 },
    })
    .catch((_error) => _error);

  expect(error).instanceOf(UniqueConstraintError);

  await cleanup();
});

test("create() respects optional fields", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: null });

  await cleanup();
});

test("create() accepts enums", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", kind: "CAT" });

  await cleanup();
});

test("create() throws on invalid enum value", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  const error = await indexingStore
    .create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    })
    .catch((error) => error);

  expect(error).toBeInstanceOf(CheckConstraintError);

  await cleanup();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await cleanup();
});

test("create() accepts float fields as float and returns as float", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", rating: 1.0 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", rating: 1.0 });

  await cleanup();
});

test("create() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toMatchObject([
    {
      id: "id1",
      checkpoint: encodeCheckpoint(createCheckpoint(10)),
      operation: 0,
    },
  ]);

  await cleanup();
});

test("update() updates a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  await cleanup();
});

test("update() updates a record using an update function", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    id: "id1",
    data: ({ current }) => ({
      name: `${current.name} and Skipper`,
    }),
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({
    id: "id1",
    name: "Skip and Skipper",
  });

  await cleanup();
});

test("update() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(2);
  expect(logs[1]).toMatchObject({
    id: "id1",
    checkpoint: encodeCheckpoint(createCheckpoint(11)),
    operation: 1,
  });

  await cleanup();
});

test("upsert() inserts a new record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.upsert({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    create: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("upsert() updates a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.upsert({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(12)),
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Jelly", age: 12 });

  await cleanup();
});

test("upsert() updates a record using an update function", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.upsert({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(12)),
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: ({ current }) => ({
      age: (current.age as number) - 5,
    }),
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Skip", age: 7 });

  await cleanup();
});

test("upsert() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.upsert({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(12)),
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(2);
  expect(logs[1]).toMatchObject({
    id: "id1",
    checkpoint: encodeCheckpoint(createCheckpoint(12)),
    operation: 1,
  });

  await cleanup();
});

test("delete() removes a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.delete({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(15)),
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("delete() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.delete({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(15)),
    id: "id1",
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(2);
  expect(logs[1]).toMatchObject({
    id: "id1",
    checkpoint: encodeCheckpoint(createCheckpoint(15)),
    operation: 2,
  });

  await cleanup();
});

test("createMany() inserts multiple entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });
  expect(createdItems.length).toBe(3);

  const { items } = await indexingStore.findMany({ tableName: "Pet" });
  expect(items.length).toBe(3);

  await cleanup();
});

test("createMany() inserts a large number of entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  const RECORD_COUNT = 100_000;

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [...Array(RECORD_COUNT).keys()].map((i) => ({
      id: `id${i}`,
      name: "Alice",
      bigAge: BigInt(i),
    })),
  });
  expect(createdItems.length).toBe(RECORD_COUNT);

  const { pageInfo } = await indexingStore.findMany({
    tableName: "Pet",
    limit: 1_000,
  });
  const { items } = await indexingStore.findMany({
    tableName: "Pet",
    after: pageInfo.endCursor,
    limit: 1_000,
  });
  expect(items.length).toBe(1_000);

  await cleanup();
});

test("createMany() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(3);
  expect(logs).toMatchObject([
    {
      id: "id1",
      checkpoint: encodeCheckpoint(createCheckpoint(10)),
      operation: 0,
    },
    {
      id: "id2",
      checkpoint: encodeCheckpoint(createCheckpoint(10)),
      operation: 0,
    },
    {
      id: "id3",
      checkpoint: encodeCheckpoint(createCheckpoint(10)),
      operation: 0,
    },
  ]);

  await cleanup();
});

test("updateMany() updates multiple entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    indexing: "realtime",
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updateditems = await indexingStore.updateMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  expect(updateditems.length).toBe(2);

  const { items } = await indexingStore.findMany({ tableName: "Pet" });

  expect(items.map((i) => i.bigAge)).toMatchObject([300n, 10n, 300n]);

  await cleanup();
});

test("updateMany() inserts into the log table", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  await indexingStore.updateMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  const logs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(5);
  expect(logs[3]).toMatchObject({
    id: "id1",
    checkpoint: encodeCheckpoint(createCheckpoint(11)),
    operation: 1,
  });
  expect(logs[4]).toMatchObject({
    id: "id3",
    checkpoint: encodeCheckpoint(createCheckpoint(11)),
    operation: 1,
  });

  await cleanup();
});

test("updateMany() updates a large number of entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const RECORD_COUNT = 1_000;

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [...Array(RECORD_COUNT).keys()].map((i) => ({
      id: `id${i}`,
      name: "Alice",
      bigAge: BigInt(i),
    })),
  });

  const updatedItems = await indexingStore.updateMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    where: {},
    data: ({ current }) => ({
      bigAge: (current.bigAge as bigint) + 1n,
    }),
  });
  expect(updatedItems.length).toBe(RECORD_COUNT);

  await cleanup();
});

test("update() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.update({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0x0A",
    data: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    id: "0x0A",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("updateMany() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.updateMany({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    where: { n: { gt: 0 } },
    data: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    id: "0x0a",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("upsert() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.upsert({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0xA",
    update: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    id: "0xA",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("delete() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    indexing: "realtime",
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0xa",
    data: { n: 1 },
  });

  await indexingStore.delete({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(25)),
    id: "0xA",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "table",
    id: "0xa",
  });

  expect(deletedInstance).toBe(null);

  await cleanup();
});
