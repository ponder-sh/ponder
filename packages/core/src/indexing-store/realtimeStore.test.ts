import { setupDatabaseServices, setupIsolatedDatabase } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { hash } from "@/utils/hash.js";
import { beforeEach, expect, test } from "vitest";

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

function calculateLogTableName(tableName: string) {
  return hash(["public", "test", tableName]);
}

test("create() inserts a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
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
  });

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
      id: "id1",
      data: { name: "Skip", age: 13 },
    }),
  ).rejects.toThrow(
    "Cannot create Pet record with ID id1 because a record already exists with that ID (UNIQUE constraint violation). Hint: Did you forget to await the promise returned by a store method? Or, consider using Pet.upsert().",
  );

  await cleanup();
});

test("create() respects optional fields", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
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
  });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    }),
  ).rejects.toThrow();

  await cleanup();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
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
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
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

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
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

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
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

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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

test("createMany() inserts multiple entities", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
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

test(
  "createMany() inserts a large number of entities",
  async (context) => {
    const { indexingStore, cleanup } = await setupDatabaseServices(context, {
      schema,
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
  },
  { timeout: 10_000 },
);

test("createMany() inserts into the log table", async (context) => {
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
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

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
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

  const logs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
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

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(13)),
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(15)),
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Bob" },
  });
  await indexingStore.update({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    id: "id1",
    data: { name: "Bobby" },
  });
  await indexingStore.create({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(12)),
    id: "id2",
    data: { name: "Kevin" },
  });

  await indexingStore.revert({
    checkpoint: createCheckpoint(12),
    isCheckpointSafe: true,
  });

  const { items: pets } = await indexingStore.findMany({ tableName: "Pet" });

  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");

  const { items: persons } = await indexingStore.findMany({
    tableName: "Person",
  });

  expect(persons.length).toBe(2);
  expect(persons[0].name).toBe("Bobby");
  expect(persons[1].name).toBe("Kevin");

  const PetLogs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
    .selectAll()
    .execute();

  expect(PetLogs).toHaveLength(1);

  const PersonLogs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Person"))
    .selectAll()
    .execute();
  expect(PersonLogs).toHaveLength(3);

  await cleanup();
});

test("revert() updates versions with intermediate logs", async (context) => {
  const { indexingStore, namespaceInfo, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(9)),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.delete({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
  });

  await indexingStore.revert({
    checkpoint: createCheckpoint(8),
    isCheckpointSafe: true,
  });

  const instancePet = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instancePet).toBe(null);

  const PetLogs = await indexingStore.db
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
    .selectAll()
    .execute();
  expect(PetLogs).toHaveLength(0);

  await cleanup();
});

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

test("update() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
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
