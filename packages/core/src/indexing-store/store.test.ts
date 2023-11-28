import { beforeEach, expect, test } from "vitest";

import { setupIndexingStore } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";

beforeEach((context) => setupIndexingStore(context));

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

test("reload() binds the schema", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  expect(indexingStore.schema).toBe(schema);
});

test("create() inserts a record that is effective after timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 25,
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("create() inserts a record that is effective at timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("create() inserts a record that is not effective before timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 8,
    id: "id1",
  });
  expect(instance).toBeNull();
});

test("create() throws on unique constraint violation", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      timestamp: 15,
      id: "id1",
      data: { name: "Skip", age: 13 },
    }),
  ).rejects.toThrow();
});

test("create() respects optional fields", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: null });
});

test("create() accepts enums", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", kind: "CAT" });
});

test("create() throws on invalid enum value", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await expect(() =>
    indexingStore.create({
      tableName: "Pet",
      timestamp: 10,
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    }),
  ).rejects.toThrow();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });
});

test("update() updates a record", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
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
    timestamp: 11,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("update() updates a record using an update function", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
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
    timestamp: 11,
    id: "id1",
    data: ({ current }) => ({
      name: current.name + " and Skipper",
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
});

test("update() updates a record and maintains older version", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  await indexingStore.update({
    tableName: "Pet",
    timestamp: 11,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const originalInstance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
  });
  expect(originalInstance).toMatchObject({
    id: "id1",
    name: "Skip",
    bigAge: 100n,
  });
});

test("update() throws if trying to update an instance in the past", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    indexingStore.update({
      tableName: "Pet",
      timestamp: 8,
      id: "id1",
      data: { name: "Peanut Butter" },
    }),
  ).rejects.toThrow();
});

test("update() updates a record in-place within the same timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await indexingStore.update({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("upsert() inserts a new record", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.upsert({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    create: { name: "Skip", age: 12 },
  });

  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("upsert() updates a record", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
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
    timestamp: 12,
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Jelly", age: 12 });
});

test("upsert() updates a record using an update function", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
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
    timestamp: 12,
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
});

test("upsert() throws if trying to update an instance in the past", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    indexingStore.upsert({
      tableName: "Pet",
      timestamp: 8,
      id: "id1",
      create: { name: "Jelly" },
      update: { name: "Peanut Butter" },
    }),
  ).rejects.toThrow();
});

test("upsert() updates a record in-place within the same timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await indexingStore.upsert({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    create: { name: "Jelly" },
    update: { name: "Peanut Butter" },
  });

  const updatedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("delete() removes a record", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.delete({ tableName: "Pet", timestamp: 15, id: "id1" });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() retains older version of record", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await indexingStore.delete({ tableName: "Pet", timestamp: 15, id: "id1" });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 12,
    id: "id1",
  });
  expect(deletedInstance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("delete() removes a record entirely if only present for one timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await indexingStore.delete({ tableName: "Pet", timestamp: 10, id: "id1" });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() removes a record entirely if only present for one timestamp after update()", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
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
    timestamp: 12,
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

  await indexingStore.delete({ tableName: "Pet", timestamp: 12, id: "id1" });

  const deletedInstance = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 12,
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() deletes versions effective in the delete timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await indexingStore.delete({ tableName: "Pet", timestamp: 15, id: "id1" });

  const instanceDuringDeleteTimestamp = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 15,
    id: "id1",
  });
  expect(instanceDuringDeleteTimestamp).toBe(null);

  const instancePriorToDelete = await indexingStore.findUnique({
    tableName: "Pet",
    timestamp: 14,
    id: "id1",
  });
  expect(instancePriorToDelete!.name).toBe("Skip");
});

test("findMany() returns current versions of all records", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 8,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  await indexingStore.update({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 100n },
  });

  const instances = await indexingStore.findMany({ tableName: "Pet" });
  expect(instances).toHaveLength(3);
  expect(instances.map((i) => i.name)).toMatchObject([
    "SkipUpdated",
    "Foo",
    "Bar",
  ]);
});

test("findMany() sorts on bigint field", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Patch" },
  });

  const instances = await indexingStore.findMany({
    tableName: "Pet",
    orderBy: { bigAge: "asc" },
  });
  expect(instances.map((i) => i.bigAge)).toMatchObject([null, 10n, 105n, 190n]);
});

test("findMany() filters on bigint gt", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Patch" },
  });

  const instances = await indexingStore.findMany({
    tableName: "Pet",
    where: { bigAge: { gt: 50n } },
  });

  expect(instances.map((i) => i.bigAge)).toMatchObject([105n, 190n]);
});

test("findMany() sorts and filters together", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Zarbar" },
  });

  const instances = await indexingStore.findMany({
    tableName: "Pet",
    where: { name: { endsWith: "ar" } },
    orderBy: { name: "asc" },
  });

  expect(instances.map((i) => i.name)).toMatchObject(["Bar", "Zarbar"]);
});

test("findMany() errors on invalid filter condition", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  expect(() =>
    indexingStore.findMany({
      tableName: "Pet",
      where: { name: { invalidWhereCondition: "ar" } },
    }),
  ).rejects.toThrow("Invalid filter condition name: invalidWhereCondition");
});

test("findMany() errors on orderBy object with multiple keys", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  expect(() =>
    indexingStore.findMany({
      tableName: "Pet",
      orderBy: { name: "asc", bigAge: "desc" },
    }),
  ).rejects.toThrow("Invalid sort condition: Must have exactly one property");
});

test("createMany() inserts multiple entities", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  const createdInstances = await indexingStore.createMany({
    tableName: "Pet",
    timestamp: 10,
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });
  expect(createdInstances.length).toBe(3);

  const instances = await indexingStore.findMany({ tableName: "Pet" });
  expect(instances.length).toBe(3);
});

test("createMany() inserts a large number of entities", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  const ENTITY_COUNT = 100_000;

  const createdInstances = await indexingStore.createMany({
    tableName: "Pet",
    timestamp: 10,
    data: [...Array(ENTITY_COUNT).keys()].map((i) => ({
      id: `id${i}`,
      name: "Alice",
      bigAge: BigInt(i),
    })),
  });
  expect(createdInstances.length).toBe(ENTITY_COUNT);

  const instances = await indexingStore.findMany({ tableName: "Pet" });
  expect(instances.length).toBe(ENTITY_COUNT);
});

test("updateMany() updates multiple entities", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.createMany({
    tableName: "Pet",
    timestamp: 10,
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updatedInstances = await indexingStore.updateMany({
    tableName: "Pet",
    timestamp: 11,
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  expect(updatedInstances.length).toBe(2);

  const instances = await indexingStore.findMany({ tableName: "Pet" });

  expect(instances.map((i) => i.bigAge)).toMatchObject([10n, 300n, 300n]);
});

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.create({
    tableName: "Pet",
    timestamp: 13,
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.update({
    tableName: "Pet",
    timestamp: 15,
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Person",
    timestamp: 10,
    id: "id1",
    data: { name: "Bob" },
  });
  await indexingStore.update({
    tableName: "Person",
    timestamp: 11,
    id: "id1",
    data: { name: "Bobby" },
  });

  await indexingStore.revert({ safeTimestamp: 12 });

  const pets = await indexingStore.findMany({ tableName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");

  const persons = await indexingStore.findMany({ tableName: "Person" });
  expect(persons.length).toBe(1);
  expect(persons[0].name).toBe("Bobby");
});

test("revert() updates versions that only existed during the safe timestamp to latest", async (context) => {
  const { indexingStore } = context;
  await indexingStore.reload({ schema });

  await indexingStore.create({
    tableName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.delete({
    tableName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  await indexingStore.revert({ safeTimestamp: 10 });

  const pets = await indexingStore.findMany({ tableName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");
});
