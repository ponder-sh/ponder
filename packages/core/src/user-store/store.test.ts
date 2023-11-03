import { buildSchema as buildGraphqlSchema } from "graphql";
import { beforeEach, expect, test } from "vitest";

import { setupUserStore } from "@/_test/setup";
import { schemaHeader } from "@/build/schema";
import { buildSchema } from "@/schema/schema";

beforeEach((context) => setupUserStore(context));

const graphqlSchema = buildGraphqlSchema(`
  ${schemaHeader}

  type Pet @entity {
    id: String!
    name: String!
    age: Int
    bigAge: BigInt
    kind: PetKind
  }

  enum PetKind {
    CAT
    DOG
  }

  type Person @entity {
    id: String!
    name: String!
  }
`);
const schema = buildSchema(graphqlSchema);

test("reload() binds the schema", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  expect(userStore.schema).toBe(schema);
});

test("create() inserts a record that is effective after timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 25,
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("create() inserts a record that is effective at timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("create() inserts a record that is not effective before timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 8,
    id: "id1",
  });
  expect(instance).toBeNull();
});

test("create() throws on unique constraint violation", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await expect(() =>
    userStore.create({
      modelName: "Pet",
      timestamp: 15,
      id: "id1",
      data: { name: "Skip", age: 13 },
    })
  ).rejects.toThrow();
});

test("create() respects optional fields", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: null });
});

test("create() accepts enums", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", kind: "CAT" });
});

test("create() throws on invalid enum value", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await expect(() =>
    userStore.create({
      modelName: "Pet",
      timestamp: 10,
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    })
  ).rejects.toThrow();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
  });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });
});

test("update() updates a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await userStore.update({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("update() updates a record using an update function", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await userStore.update({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
    data: ({ current }) => ({
      name: current.name + " and Skipper",
    }),
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({
    id: "id1",
    name: "Skip and Skipper",
  });
});

test("update() updates a record and maintains older version", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  await userStore.update({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const originalInstance = await userStore.findUnique({
    modelName: "Pet",
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
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    userStore.update({
      modelName: "Pet",
      timestamp: 8,
      id: "id1",
      data: { name: "Peanut Butter" },
    })
  ).rejects.toThrow();
});

test("update() updates a record in-place within the same timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await userStore.update({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("upsert() inserts a new record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.upsert({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    create: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("upsert() updates a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.upsert({
    modelName: "Pet",
    timestamp: 12,
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Jelly", age: 12 });
});

test("upsert() updates a record using an update function", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.upsert({
    modelName: "Pet",
    timestamp: 12,
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: ({ current }) => ({
      age: (current.age as number) - 5,
    }),
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Skip", age: 7 });
});

test("upsert() throws if trying to update an instance in the past", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await expect(() =>
    userStore.upsert({
      modelName: "Pet",
      timestamp: 8,
      id: "id1",
      create: { name: "Jelly" },
      update: { name: "Peanut Butter" },
    })
  ).rejects.toThrow();
});

test("upsert() updates a record in-place within the same timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });

  await userStore.upsert({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    create: { name: "Jelly" },
    update: { name: "Peanut Butter" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });
});

test("delete() removes a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.delete({ modelName: "Pet", timestamp: 15, id: "id1" });

  const deletedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() retains older version of record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await userStore.delete({ modelName: "Pet", timestamp: 15, id: "id1" });

  const deletedInstance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 12,
    id: "id1",
  });
  expect(deletedInstance).toMatchObject({ id: "id1", name: "Skip", age: 12 });
});

test("delete() removes a record entirely if only present for one timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.delete({ modelName: "Pet", timestamp: 10, id: "id1" });

  const deletedInstance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() removes a record entirely if only present for one timestamp after update()", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.update({
    modelName: "Pet",
    timestamp: 12,
    id: "id1",
    data: { name: "Skipper", age: 12 },
  });
  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({
    id: "id1",
    name: "Skipper",
    age: 12,
  });

  await userStore.delete({ modelName: "Pet", timestamp: 12, id: "id1" });

  const deletedInstance = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 12,
    id: "id1",
  });
  expect(deletedInstance).toBe(null);
});

test("delete() deletes versions effective in the delete timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await userStore.delete({ modelName: "Pet", timestamp: 15, id: "id1" });

  const instanceDuringDeleteTimestamp = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 15,
    id: "id1",
  });
  expect(instanceDuringDeleteTimestamp).toBe(null);

  const instancePriorToDelete = await userStore.findUnique({
    modelName: "Pet",
    timestamp: 14,
    id: "id1",
  });
  expect(instancePriorToDelete!.name).toBe("Skip");
});

test("findMany() returns current versions of all records", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 8,
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  await userStore.update({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo" },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 100n },
  });

  const instances = await userStore.findMany({ modelName: "Pet" });
  expect(instances).toHaveLength(3);
  expect(instances.map((i) => i.name)).toMatchObject([
    "SkipUpdated",
    "Foo",
    "Bar",
  ]);
});

test("findMany() sorts on bigint field", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Patch" },
  });

  const instances = await userStore.findMany({
    modelName: "Pet",
    orderBy: { bigAge: "asc" },
  });
  expect(instances.map((i) => i.bigAge)).toMatchObject([null, 10n, 105n, 190n]);
});

test("findMany() filters on bigint gt", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Patch" },
  });

  const instances = await userStore.findMany({
    modelName: "Pet",
    where: { bigAge: { gt: 50n } },
  });

  expect(instances.map((i) => i.bigAge)).toMatchObject([105n, 190n]);
});

test("findMany() sorts and filters together", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip", bigAge: 105n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id2",
    data: { name: "Foo", bigAge: 10n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id3",
    data: { name: "Bar", bigAge: 190n },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id4",
    data: { name: "Zarbar" },
  });

  const instances = await userStore.findMany({
    modelName: "Pet",
    where: { name: { endsWith: "ar" } },
    orderBy: { name: "asc" },
  });

  expect(instances.map((i) => i.name)).toMatchObject(["Bar", "Zarbar"]);
});

test("findMany() errors on invalid filter condition", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  expect(() =>
    userStore.findMany({
      modelName: "Pet",
      where: { name: { invalidWhereCondition: "ar" } },
    })
  ).rejects.toThrow("Invalid filter condition name: invalidWhereCondition");
});

test("findMany() errors on orderBy object with multiple keys", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  expect(() =>
    userStore.findMany({
      modelName: "Pet",
      orderBy: { name: "asc", bigAge: "desc" },
    })
  ).rejects.toThrow("Invalid sort condition: Must have exactly one property");
});

test("createMany() inserts multiple entities", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  const createdInstances = await userStore.createMany({
    modelName: "Pet",
    timestamp: 10,
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });
  expect(createdInstances.length).toBe(3);

  const instances = await userStore.findMany({ modelName: "Pet" });
  expect(instances.length).toBe(3);
});

test("createMany() inserts a large number of entities", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  const ENTITY_COUNT = 100_000;

  const createdInstances = await userStore.createMany({
    modelName: "Pet",
    timestamp: 10,
    data: [...Array(ENTITY_COUNT).keys()].map((i) => ({
      id: `id${i}`,
      name: "Alice",
      bigAge: BigInt(i),
    })),
  });
  expect(createdInstances.length).toBe(ENTITY_COUNT);

  const instances = await userStore.findMany({ modelName: "Pet" });
  expect(instances.length).toBe(ENTITY_COUNT);
});

test("updateMany() updates multiple entities", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.createMany({
    modelName: "Pet",
    timestamp: 10,
    data: [
      { id: "id1", name: "Skip", bigAge: 105n },
      { id: "id2", name: "Foo", bigAge: 10n },
      { id: "id3", name: "Bar", bigAge: 190n },
    ],
  });

  const updatedInstances = await userStore.updateMany({
    modelName: "Pet",
    timestamp: 11,
    where: { bigAge: { gt: 50n } },
    data: { bigAge: 300n },
  });

  expect(updatedInstances.length).toBe(2);

  const instances = await userStore.findMany({ modelName: "Pet" });

  expect(instances.map((i) => i.bigAge)).toMatchObject([10n, 300n, 300n]);
});

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });
  await userStore.create({
    modelName: "Pet",
    timestamp: 13,
    id: "id2",
    data: { name: "Foo" },
  });
  await userStore.update({
    modelName: "Pet",
    timestamp: 15,
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await userStore.create({
    modelName: "Person",
    timestamp: 10,
    id: "id1",
    data: { name: "Bob" },
  });
  await userStore.update({
    modelName: "Person",
    timestamp: 11,
    id: "id1",
    data: { name: "Bobby" },
  });

  await userStore.revert({ safeTimestamp: 12 });

  const pets = await userStore.findMany({ modelName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");

  const persons = await userStore.findMany({ modelName: "Person" });
  expect(persons.length).toBe(1);
  expect(persons[0].name).toBe("Bobby");
});

test("revert() updates versions that only existed during the safe timestamp to latest", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    timestamp: 10,
    id: "id1",
    data: { name: "Skip" },
  });
  await userStore.delete({
    modelName: "Pet",
    timestamp: 11,
    id: "id1",
  });

  await userStore.revert({ safeTimestamp: 10 });

  const pets = await userStore.findMany({ modelName: "Pet" });
  expect(pets.length).toBe(1);
  expect(pets[0].name).toBe("Skip");
});
