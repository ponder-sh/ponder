import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
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
    list: p.string().list().optional(),
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

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

test("findUnique() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "0x0a",
    data: { n: 1 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    id: "0x0A",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 1 });

  await cleanup();
});

test("findUnique() deserializes json", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: {
      name: "Skip",
      age: 12,
      json: {
        kevin: 52,
      },
    },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });

  expect(instance).toMatchObject({
    name: "Skip",
    age: 12,
    json: {
      kevin: 52,
    },
  });

  await cleanup();
});

test("findMany() returns current versions of all records", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(8)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id3",
    data: { name: "Bar", bigAge: 100n },
  });

  const { items } = await indexingStore.findMany({ tableName: "Pet" });
  expect(items).toHaveLength(3);
  expect(items.map((i) => i.name)).toMatchObject(["SkipUpdated", "Foo", "Bar"]);

  await cleanup();
});

test("findMany() orders by bigint field", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id4",
    data: { name: "Patch" },
  });

  const { items } = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { bigAge: "asc" },
  });
  expect(items.map((i) => i.bigAge)).toMatchObject([null, 10n, 105n, 190n]);

  await cleanup();
});

test("findMany() filters on bigint gt", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id4",
    data: { name: "Patch" },
  });

  const { items } = await indexingStore.findMany({
    tableName: "Pet",
    where: { bigAge: { gt: 50n } },
  });

  expect(items.map((i) => i.bigAge)).toMatchObject([105n, 190n]);

  await cleanup();
});

test("findMany() filters with complex OR condition", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
      { id: "id4", name: "Zarbar" },
      { id: "id5", name: "Winston", age: 12 },
    ],
  });

  const { items } = await indexingStore.findMany({
    tableName: "Pet",
    where: {
      OR: [
        { bigAge: { gt: 50n } },
        { AND: [{ name: "Foo" }, { bigAge: { lt: 20n } }] },
      ],
    },
  });

  expect(items).toMatchObject([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
  ]);

  await cleanup();
});

test("findMany() sorts and filters together", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id4",
    data: { name: "Zarbar" },
  });

  const { items } = await indexingStore.findMany({
    tableName: "Pet",
    where: { name: { endsWith: "ar" } },
    orderBy: { name: "asc" },
  });

  expect(items.map((i) => i.name)).toMatchObject(["Bar", "Zarbar"]);

  await cleanup();
});

test("findMany() errors on invalid filter condition", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  expect(() =>
    indexingStore.findMany({
      tableName: "Pet",
      where: { name: { invalidWhereCondition: "ar" } },
    }),
  ).rejects.toThrow(
    "Invalid filter condition for column 'name'. Got 'invalidWhereCondition', expected one of ['equals', 'not', 'in', 'notIn', 'contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith']",
  );

  await cleanup();
});

test("findMany() cursor pagination ascending", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip" },
      { id: "id2", name: "Foo" },
      { id: "id3", name: "Bar" },
      { id: "id4", name: "Zarbar" },
      { id: "id5", name: "Winston" },
      { id: "id6", name: "Book" },
      { id: "id7", name: "Shea" },
      { id: "id8", name: "Snack" },
      { id: "id9", name: "Last" },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { id: "asc" },
    limit: 5,
  });

  expect(
    resultOne.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id1", name: "Skip" },
    { id: "id2", name: "Foo" },
    { id: "id3", name: "Bar" },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston" },
  ]);
  expect(resultOne.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: false,
    hasNextPage: true,
  });

  const resultTwo = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { id: "asc" },
    after: resultOne.pageInfo.endCursor,
  });

  expect(
    resultTwo.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id6", name: "Book" },
    { id: "id7", name: "Shea" },
    { id: "id8", name: "Snack" },
    { id: "id9", name: "Last" },
  ]);
  expect(resultTwo.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: true,
    hasNextPage: false,
  });

  const resultThree = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { id: "asc" },
    before: resultTwo.pageInfo.startCursor,
    limit: 2,
  });

  expect(
    resultThree.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston" },
  ]);
  expect(resultThree.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: true,
    hasNextPage: true,
  });

  await cleanup();
});

test("findMany() cursor pagination descending", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
      { id: "id4", name: "Zarbar" },
      { id: "id5", name: "Winston", age: 12 },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "desc" },
    limit: 2,
  });

  expect(
    resultOne.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston" },
  ]);
  expect(resultOne.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: false,
    hasNextPage: true,
  });

  const resultTwo = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "desc" },
    after: resultOne.pageInfo.endCursor,
  });

  expect(
    resultTwo.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id1", name: "Skip" },
    { id: "id2", name: "Foo" },
    { id: "id3", name: "Bar" },
  ]);
  expect(resultTwo.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: true,
    hasNextPage: false,
  });

  const resultThree = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "desc" },
    before: resultTwo.pageInfo.startCursor,
    limit: 1,
  });

  expect(
    resultThree.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([{ id: "id5", name: "Winston" }]);
  expect(resultThree.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: true,
    hasNextPage: true,
  });

  await cleanup();
});

test("findMany() returns start and end cursor if limited", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
      { id: "id4", name: "Zarbar" },
      { id: "id5", name: "Winston", age: 12 },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "asc" },
  });

  expect(
    resultOne.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id3", name: "Bar" },
    { id: "id2", name: "Foo" },
    { id: "id1", name: "Skip" },
    { id: "id5", name: "Winston" },
    { id: "id4", name: "Zarbar" },
  ]);
  expect(resultOne.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: false,
    hasNextPage: false,
  });

  await cleanup();
});

test("findMany() returns hasPreviousPage if no results", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
      { id: "id4", name: "Zarbar" },
      { id: "id5", name: "Winston", age: 12 },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "asc" },
  });

  const resultTwo = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "asc" },
    after: resultOne.pageInfo.endCursor,
  });

  expect(resultTwo.items).toHaveLength(0);
  expect(resultTwo.pageInfo).toMatchObject({
    startCursor: null,
    endCursor: null,
    hasPreviousPage: true,
    hasNextPage: false,
  });

  await cleanup();
});

test("findMany() errors on orderBy object with multiple keys", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  expect(() =>
    indexingStore.findMany({
      tableName: "Pet",
      orderBy: { name: "asc", bigAge: "desc" },
    }),
  ).rejects.toThrow("Invalid sort. Cannot sort by multiple columns.");

  await cleanup();
});

test("findMany() ordering secondary sort inherits primary", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
      { id: "id4", name: "Zarbar", bigAge: 10n },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { bigAge: "desc" },
  });

  expect(resultOne.items).toMatchObject([
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id4", name: "Zarbar", bigAge: 10n }, // secondary sort by ID is descending
    { id: "id2", name: "Foo", bigAge: 10n },
  ]);

  const resultTwo = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { bigAge: "asc" },
  });

  expect(resultTwo.items).toMatchObject([
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id4", name: "Zarbar", bigAge: 10n }, // secondary sort by ID is ascending
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id3", name: "Bar", bigAge: 190n },
  ]);

  await cleanup();
});

test("findMany() where list", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.createMany({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "id1", name: "Skip", list: ["kevin", "kyle", "jay"] },
      { id: "id2", name: "Foo", list: ["widget", "gadget"] },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "Pet",
    where: { list: { has: "kevin" } },
  });

  expect(resultOne.items).toMatchObject([
    { id: "id1", name: "Skip", list: ["kevin", "kyle", "jay"] },
  ]);

  await cleanup();
});

test("findMany() where hex list", async (context) => {
  const hexSchema = createSchema((p) => ({
    table: p.createTable({
      id: p.hex(),
      list: p.hex().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
  });

  await indexingStore.createMany({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    data: [
      { id: "0x00", list: ["0x0A", "0x0B"] },
      { id: "0x01", list: ["0x0a", "0x0b", "0x0c"] },
    ],
  });

  const resultOne = await indexingStore.findMany({
    tableName: "table",
    where: { list: { has: "0x0a" } },
  });

  expect(resultOne.items).toMatchObject([
    { id: "0x00", list: ["0x0a", "0x0b"] },
    { id: "0x01", list: ["0x0a", "0x0b", "0x0c"] },
  ]);

  const resultTwo = await indexingStore.findMany({
    tableName: "table",
    where: { list: { has: "0x0c" } },
  });

  expect(resultTwo.items).toMatchObject([
    { id: "0x01", list: ["0x0a", "0x0b", "0x0c"] },
  ]);

  await cleanup();
});
