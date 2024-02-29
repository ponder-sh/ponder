import { setupDatabaseServices, setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
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

test("create() inserts a record that is effective after specified checkpoint", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(25),
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("create() inserts a record that is effective at timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("create() inserts a record that is not effective before timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(8),
    id: "id1",
  });
  expect(instance).toBeNull();

  await cleanup();
});

test("create() throws on unique constraint violation even if checkpoint is different", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      checkpoint: createCheckpoint(15),
      id: "id1",
      data: { name: "Skip", age: 13 },
    }),
  ).rejects.toThrow();

  await cleanup();
});

test("create() respects optional fields", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(11),
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: null });

  await cleanup();
});

test("create() accepts enums", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(11),
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", kind: "CAT" });

  await cleanup();
});

test("create() throws on invalid enum value", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      checkpoint: createCheckpoint(10),
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    }),
  ).rejects.toThrow();

  await cleanup();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await cleanup();
});

test("update() updates a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(11),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(11),
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

test("update() updates a record and maintains older version", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  await indexingStore.update({
    tableName: "Pet",
    checkpoint: createCheckpoint(11),
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const originalInstance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
  });
  expect(originalInstance).toMatchObject({
    id: "id1",
    name: "Skip",
    bigAge: 100n,
  });

  await cleanup();
});

test("update() throws if trying to update an instance in the past", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(8),
      id: "id1",
      data: { name: "Peanut Butter" },
    }),
  ).rejects.toThrow();

  await cleanup();
});

test("update() updates a record in-place within the same timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });

  await indexingStore.update({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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

test("upsert() inserts a new record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.upsert({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(12),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(12),
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

test("upsert() throws if trying to update an instance in the past", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    indexingStore.upsert({
      tableName: "Pet",
      checkpoint: createCheckpoint(8),
      id: "id1",
      create: { name: "Jelly" },
      update: { name: "Peanut Butter" },
    }),
  ).rejects.toThrow();

  await cleanup();
});

test("upsert() updates a record in-place within the same timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });

  await indexingStore.upsert({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    create: { name: "Jelly" },
    update: { name: "Peanut Butter" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  await cleanup();
});

test("delete() removes a record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(15),
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("delete() retains older version of record", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await indexingStore.delete({
    tableName: "Pet",
    checkpoint: createCheckpoint(15),
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(12),
    id: "id1",
  });
  expect(deletedInstance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await cleanup();
});

test("delete() removes a record entirely if only present for one timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    checkpoint: createCheckpoint(10),
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("delete() removes a record entirely if only present for one timestamp after update()", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.update({
    tableName: "Pet",
    checkpoint: createCheckpoint(12),
    id: "id1",
    data: { name: "Skipper", age: 12 },
  });
  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({
    id: "id1",
    name: "Skipper",
    age: 12,
  });

  await indexingStore.delete({
    tableName: "Pet",
    checkpoint: createCheckpoint(12),
    id: "id1",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(12),
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await cleanup();
});

test("delete() deletes versions effective in the delete timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await indexingStore.delete({
    tableName: "Pet",
    checkpoint: createCheckpoint(15),
    id: "id1",
  });

  const instanceDuringDeleteTimestamp = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(15),
    id: "id1",
  });
  expect(instanceDuringDeleteTimestamp).toBe(null);

  const instancePriorToDelete = await indexingStore.findUnique({
    tableName: "Pet",
    checkpoint: createCheckpoint(14),
    id: "id1",
  });
  expect(instancePriorToDelete).toBeTruthy();
  expect(instancePriorToDelete!.name).toBe("Skip");

  await cleanup();
});

test("findMany() returns current versions of all records", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(8),
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  await indexingStore.update({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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

test("findMany() sorts and filters together", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    limit: 2,
  });

  expect(
    resultOne.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id3", name: "Bar" },
    { id: "id2", name: "Foo" },
  ]);
  expect(resultOne.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: false,
    hasNextPage: true,
  });

  const resultTwo = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "asc" },
    after: resultOne.pageInfo.endCursor,
  });

  expect(
    resultTwo.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([
    { id: "id1", name: "Skip" },
    { id: "id5", name: "Winston" },
    { id: "id4", name: "Zarbar" },
  ]);
  expect(resultTwo.pageInfo).toMatchObject({
    startCursor: expect.any(String),
    endCursor: expect.any(String),
    hasPreviousPage: true,
    hasNextPage: false,
  });

  const resultThree = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { name: "asc" },
    before: resultTwo.pageInfo.startCursor,
    limit: 1,
  });

  expect(
    resultThree.items.map((i) => ({ id: i.id, name: i.name })),
  ).toMatchObject([{ id: "id2", name: "Foo" }]);
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  const RECORD_COUNT = 100_000;

  const createdItems = await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
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
    tableIds: getTableIds(schema),
  });

  await indexingStore.createMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updateditems = await indexingStore.updateMany({
    tableName: "Pet",
    checkpoint: createCheckpoint(11),
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  expect(updateditems.length).toBe(2);

  const { items } = await indexingStore.findMany({ tableName: "Pet" });

  expect(items.map((i) => i.bigAge)).toMatchObject([300n, 10n, 300n]);

  await cleanup();
});

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(13),
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.update({
    tableName: "Pet",
    checkpoint: createCheckpoint(15),
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Person",
    checkpoint: createCheckpoint(10),
    id: "id1",
    data: { name: "Bob" },
  });
  await indexingStore.update({
    tableName: "Person",
    checkpoint: createCheckpoint(11),
    id: "id1",
    data: { name: "Bobby" },
  });
  await indexingStore.create({
    tableName: "Person",
    checkpoint: createCheckpoint(12),
    id: "id2",
    data: { name: "Kevin" },
  });

  await indexingStore.revert({ checkpoint: createCheckpoint(12) });

  const { items: pets } = await indexingStore.findMany({ tableName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");

  const { items: persons } = await indexingStore.findMany({
    tableName: "Person",
  });
  expect(persons.length).toBe(1);
  expect(persons[0].name).toBe("Bobby");

  await cleanup();
});

test("revert() updates versions that only existed during the safe timestamp to latest", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  await indexingStore.create({
    tableName: "Pet",
    checkpoint: createCheckpoint(9),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.delete({
    tableName: "Pet",
    checkpoint: createCheckpoint(11),
    id: "id1",
  });

  await indexingStore.revert({ checkpoint: createCheckpoint(10) });

  const { items: pets } = await indexingStore.findMany({ tableName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");

  await cleanup();
});

test("findUnique() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    tableIds: getTableIds(hexSchema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0x0a",
    data: { n: 1 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0x0A",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 1 });

  await cleanup();
});

test("update() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    tableIds: getTableIds(hexSchema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.update({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0x0A",
    data: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0x0A",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("updateMany() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    tableIds: getTableIds(hexSchema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.updateMany({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    where: { n: { gt: 0 } },
    data: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0x0a",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("upsert() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    tableIds: getTableIds(hexSchema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0x0a",
    data: { n: 1 },
  });

  await indexingStore.upsert({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0xA",
    update: { n: 2 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0xA",
  });
  expect(instance).toMatchObject({ id: "0x0a", n: 2 });

  await cleanup();
});

test("delete() works with hex case sensitivity", async (context) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema: hexSchema,
    tableIds: getTableIds(hexSchema),
  });

  await indexingStore.create({
    tableName: "table",
    checkpoint: createCheckpoint(10),
    id: "0xa",
    data: { n: 1 },
  });

  await indexingStore.delete({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0xA",
  });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "table",
    checkpoint: createCheckpoint(25),
    id: "0xa",
  });

  expect(deletedInstance).toBe(null);

  await cleanup();
});
