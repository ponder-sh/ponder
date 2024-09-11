import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  RecordNotFoundError,
  UniqueConstraintError,
} from "@/common/errors.js";
import { createSchema } from "@/schema/schema.js";
import { beforeEach, expect, test } from "vitest";
import type { HistoricalStore } from "./store.js";

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
    json: p.json().optional(),
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

test("findUnique()", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("findUnique() w/ cache miss", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("findMany()", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findMany({
    tableName: "Pet",
  });
  expect(instance.items).toHaveLength(1);
  expect(instance.items[0]).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("create() inserts a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("create() throws UniqueConstraintError", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip" },
  });

  const error = await indexingStore
    .create({
      tableName: "Pet",

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
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("create() throws on invalid json", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const error = await indexingStore
    .create({
      tableName: "Pet",

      id: "id1",
      data: {
        name: "Skip",
        age: 12,
        json: {
          kevin: 52n,
        },
      },
    })
    .catch((_error) => _error);

  expect(error).instanceOf(BigIntSerializationError);

  expect(error.message?.includes("Do not know how to serialize a BigInt")).toBe(
    true,
  );

  await cleanup();
});

test("create() accepts enums", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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
  });

  const error = await indexingStore
    .create({
      tableName: "Pet",

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
  });

  await indexingStore.create({
    tableName: "Pet",
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
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("create() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  const instance = await indexingStore.create({
    tableName: "table",
    id: "0xa",
    data: { n: 1 },
  });

  expect(instance).toMatchObject({ id: "0x0a", n: 1 });

  await cleanup();
});

test("update() updates a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("update() with an empty update object returns the original record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const record = await indexingStore.update({
    tableName: "Pet",
    id: "id1",
    data: {},
  });

  expect(record).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("update() with an update function that returns an empty object returns the record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const record = await indexingStore.update({
    tableName: "Pet",
    id: "id1",
    data: ({ current }) => {
      if (current.name === "blah") return { name: "newBlah" };
      return {};
    },
  });

  expect(record).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("update() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.create({
    tableName: "table",
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.update({
    tableName: "table",
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

test("update() throws RecordNotFoundError", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });
  const error = await indexingStore
    .update({
      tableName: "Pet",
      id: "id1",
      data: { name: "Peanut Butter" },
    })
    .catch((err) => err);

  expect(error).instanceOf(RecordNotFoundError);

  await cleanup();
});

test("update() w/ cache miss", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const updatedInstance = await indexingStore.update({
    tableName: "Pet",
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  await cleanup();
});

test("update() w/ find cache", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  await indexingStore.findUnique({ tableName: "Pet", id: "id1" });

  const updatedInstance = await indexingStore.update({
    tableName: "Pet",
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  const findInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(findInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "id1",
    name: "Peanut Butter",
  });

  await cleanup();
});

test("upsert() inserts a new record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.upsert({
    tableName: "Pet",
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
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("upsert() with an empty update object returns the original record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const record = await indexingStore.upsert({
    tableName: "Pet",
    id: "id1",
    create: { name: "Yellow", age: 14 },
    update: {},
  });

  expect(record).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("upsert() with an update function that returns an empty object returns the record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const record = await indexingStore.upsert({
    tableName: "Pet",
    id: "id1",
    create: { name: "Yellow", age: 14 },
    update: ({ current }) => {
      if (current.name === "blah") return { name: "newBlah" };
      return {};
    },
  });

  expect(record).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("upsert() updates a record using an update function", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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

test("upsert() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.create({
    tableName: "table",
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.upsert({
    tableName: "table",
    id: "0xA",
    create: { n: 0 },
    update: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    id: "0xA",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("upsert() w/ cache miss", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const updatedInstance = await indexingStore.upsert({
    tableName: "Pet",
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  expect(updatedInstance).toMatchObject({ id: "id1", name: "Jelly", age: 12 });

  await cleanup();
});

test("upsert() w/ find cache", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  // add pet.id1 to find cache

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  const createInstance = await indexingStore.upsert({
    tableName: "Pet",
    id: "id1",
    create: { name: "Peanut Butter" },
    update: {},
  });

  expect(createInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  let findInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(findInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  // add pet.id1 to find cache, remove from create cache

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  const updateInstance = await indexingStore.upsert({
    tableName: "Pet",
    id: "id1",
    create: {},
    update: { name: "Kevin" },
  });

  expect(updateInstance).toMatchObject({ id: "id1", name: "Kevin" });

  findInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(findInstance).toMatchObject({ id: "id1", name: "Kevin" });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "id1",
    name: "Kevin",
  });

  await cleanup();
});

test("delete() removes a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
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
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("delete() w/ find cache", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  await indexingStore.findUnique({ tableName: "Pet", id: "id1" });

  const _delete = await indexingStore.delete({
    tableName: "Pet",
    id: "id1",
  });

  expect(_delete).toBe(true);

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(0);

  await cleanup();
});

test("delete() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.create({
    tableName: "table",
    id: "0xa",
    data: { n: 1 },
  });

  await indexingStore.delete({
    tableName: "table",
    id: "0xA",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "table",
    id: "0xa",
  });

  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("createMany() inserts multiple entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
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
  });

  const RECORD_COUNT = 10_000;

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
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

test("updateMany() updates multiple entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updateditems = await indexingStore.updateMany({
    tableName: "Pet",
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  expect(updateditems.length).toBe(2);

  const { items } = await indexingStore.findMany({ tableName: "Pet" });

  expect(items.map((i) => i.bigAge)).toMatchObject([300n, 10n, 300n]);

  await cleanup();
});

test("updateMany() updates using a function", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updateditems = await indexingStore.updateMany({
    tableName: "Pet",
    where: { bigAge: { gt: 50n } },
    data: () => ({ bigAge: 300n }),
  });

  expect(updateditems.length).toBe(2);

  const { items } = await indexingStore.findMany({ tableName: "Pet" });

  expect(items.map((i) => i.bigAge)).toMatchObject([300n, 10n, 300n]);

  await cleanup();
});

test("updateMany() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.create({
    tableName: "table",
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.updateMany({
    tableName: "table",
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

test("updateMany() updates a large number of entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const RECORD_COUNT = 1_000;

  await indexingStore.createMany({
    tableName: "Pet",
    data: [...Array(RECORD_COUNT).keys()].map((i) => ({
      id: `id${i}`,
      name: "Alice",
      bigAge: BigInt(i),
    })),
  });

  const updatedItems = await indexingStore.updateMany({
    tableName: "Pet",
    where: {},
    data: ({ current }) => ({
      bigAge: (current.bigAge as bigint) + 1n,
    }),
  });
  expect(updatedItems.length).toBe(RECORD_COUNT);

  await cleanup();
});

test("flush() insert", async (context) => {
  const { indexingStore, cleanup, database } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "id1",
    name: "Skip",
    age: 12,
  });

  await cleanup();
});

test("flush() update", async (context) => {
  const { indexingStore, cleanup, database } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  await indexingStore.update({
    tableName: "Pet",
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "id1",
    name: "Peanut Butter",
    age: 12,
  });

  await cleanup();
});

test("flush() partial", async (context) => {
  const { indexingStore, cleanup, database } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.createMany({
    tableName: "Pet",
    data: [
      { id: "id0", name: "Skip" },
      { id: "id1", name: "Skip" },
      { id: "id2", name: "Foo" },
      { id: "id3", name: "Bar" },
      { id: "id4", name: "Skip" },
      { id: "id5", name: "Foo" },
      { id: "id6", name: "Bar" },
      { id: "id7", name: "Skip" },
      { id: "id8", name: "Foo" },
      { id: "id9", name: "Bar" },
    ],
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: false });

  const rows = await database.qb.user.selectFrom("Pet").selectAll().execute();

  expect(rows).toHaveLength(4);
  expect(rows[0]).toMatchObject({
    id: "id0",
    name: "Skip",
  });

  await cleanup();
});

test("flush() skips update w/ no data", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
    }),
  }));

  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  await indexingStore.create({
    tableName: "table",
    id: "id",
  });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const instance = await indexingStore.upsert({
    tableName: "table",
    id: "id",
  });

  expect(instance).toMatchObject({ id: "id" });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await database.qb.user.selectFrom("table").selectAll().execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "id",
  });

  await cleanup();
});
