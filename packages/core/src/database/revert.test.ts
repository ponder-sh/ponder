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

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

function calculateLogTableName(tableName: string) {
  return hash(["public", "test", tableName]);
}

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { indexingStore, database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context, { schema, indexing: "realtime" });

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

  await database.revert({
    checkpoint: createCheckpoint(12),
    namespaceInfo,
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

  const PetLogs = await database.indexingDb
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
    .selectAll()
    .execute();

  expect(PetLogs).toHaveLength(1);

  const PersonLogs = await database.indexingDb
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Person"))
    .selectAll()
    .execute();
  expect(PersonLogs).toHaveLength(3);

  await cleanup();
});

test("revert() updates versions with intermediate logs", async (context) => {
  const { indexingStore, database, namespaceInfo, cleanup } =
    await setupDatabaseServices(context, { schema, indexing: "realtime" });

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

  await database.revert({
    checkpoint: createCheckpoint(8),
    namespaceInfo,
  });

  const instancePet = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instancePet).toBe(null);

  const PetLogs = await database.indexingDb
    .withSchema(namespaceInfo.internalNamespace)
    .selectFrom(calculateLogTableName("Pet"))
    .selectAll()
    .execute();
  expect(PetLogs).toHaveLength(0);

  await cleanup();
});
