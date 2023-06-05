import { buildSchema as buildGraphqlSchema } from "graphql";
import { expect, test } from "vitest";

import { schemaHeader } from "@/reload/readGraphqlSchema";
import { buildSchema } from "@/schema/schema";

/**
 * This test suite uses the `store` object injected during setup.
 * At the moment, this could be either a PostgresUserStore or a
 * SqliteUserStore; the tests run as expected either way.
 */

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
`);
const schema = buildSchema(graphqlSchema);

test("reload() binds the schema", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  expect(userStore.schema).toBe(schema);

  await userStore.teardown();
});

test("create() inserts a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.teardown();
});

test("create() throws on unique constraint violation", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });

  await expect(() =>
    userStore.create({
      modelName: "Pet",
      id: "id1",
      data: { name: "Skip", age: 13 },
    })
  ).rejects.toThrow();

  await userStore.teardown();
});

test("create() respects optional fields", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip" },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: null });

  await userStore.teardown();
});

test("create() accepts enums", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", kind: "CAT" },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", kind: "CAT" });

  await userStore.teardown();
});

test("create() throws on invalid enum value", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await expect(() =>
    userStore.create({
      modelName: "Pet",
      id: "id1",
      data: { name: "Skip", kind: "NOTACAT" },
    })
  ).rejects.toThrow();

  await userStore.teardown();
});

test("create() accepts BigInt fields as bigint and returns as bigint", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });

  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await userStore.teardown();
});

test("update() updates the record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", bigAge: 100n },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", bigAge: 100n });

  await userStore.update({
    modelName: "Pet",
    id: "id1",
    data: { name: "Peanut Butter" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Peanut Butter" });

  await userStore.teardown();
});

test("upsert() inserts a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.upsert({
    modelName: "Pet",
    id: "id1",
    create: { name: "Skip", age: 12 },
  });

  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.teardown();
});

test("upsert() updates a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.upsert({
    modelName: "Pet",
    id: "id1",
    create: { name: "Skip", age: 24 },
    update: { name: "Jelly" },
  });

  const updatedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(updatedInstance).toMatchObject({ id: "id1", name: "Jelly", age: 12 });

  await userStore.teardown();
});

test("delete() removes a record", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  const instance = await userStore.findUnique({ modelName: "Pet", id: "id1" });
  expect(instance).toMatchObject({ id: "id1", name: "Skip", age: 12 });

  await userStore.delete({ modelName: "Pet", id: "id1" });

  const deletedInstance = await userStore.findUnique({
    modelName: "Pet",
    id: "id1",
  });
  expect(deletedInstance).toBe(null);

  await userStore.teardown();
});

test("findMany() returns multiple records", async (context) => {
  const { userStore } = context;
  await userStore.reload({ schema });

  await userStore.create({
    modelName: "Pet",
    id: "id1",
    data: { name: "Skip", age: 12 },
  });
  await userStore.create({
    modelName: "Pet",
    id: "id2",
    data: { name: "Foo" },
  });
  await userStore.create({
    modelName: "Pet",
    id: "id3",
    data: { name: "Bar", bigAge: 100n },
  });

  const instances = await userStore.findMany({ modelName: "Pet" });
  expect(instances).toHaveLength(3);

  await userStore.teardown();
});
