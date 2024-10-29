import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainEnum, onchainTable, primaryKey } from "@/drizzle/index.js";
import { relations } from "drizzle-orm";
import { type GraphQLType, execute, parse } from "graphql";
import { beforeEach, expect, test, vi } from "vitest";
import { buildDataLoaderCache, buildGraphQLSchema } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("metadata", async (context) => {
  const schema = {};

  const { database, metadataStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  await metadataStore.setStatus({
    mainnet: {
      ready: true,
      block: {
        number: 10,
        timestamp: 20,
      },
    },
  });

  const result = await query(`
    query {
      _meta {
        status
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    _meta: {
      status: {
        mainnet: {
          ready: true,
          block: {
            number: 10,
            timestamp: 20,
          },
        },
      },
    },
  });

  await cleanup();
});

test("scalar, scalar not null, scalar array, scalar array not null", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),

      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.hex(),
      bigint: t.bigint(),

      stringNotNull: t.text().notNull(),
      intNotNull: t.integer().notNull(),
      floatNotNull: t.doublePrecision().notNull(),
      booleanNotNull: t.boolean().notNull(),
      hexNotNull: t.hex().notNull(),
      bigintNotNull: t.bigint().notNull(),

      stringArray: t.text().array(),
      intArray: t.integer().array(),
      floatArray: t.doublePrecision().array(),
      booleanArray: t.boolean().array(),
      hexArray: t.hex().array(),
      bigintArray: t.bigint().array(),

      stringArrayNotNull: t.text().array().notNull(),
      intArrayNotNull: t.integer().array().notNull(),
      floatArrayNotNull: t.doublePrecision().array().notNull(),
      booleanArrayNotNull: t.boolean().array().notNull(),
      hexArrayNotNull: t.hex().array().notNull(),
      bigintArrayNotNull: t.bigint().array().notNull(),
    })),
  };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: false,
    hex: "0x0",
    bigint: 0n,

    stringNotNull: "0",
    intNotNull: 0,
    floatNotNull: 0,
    booleanNotNull: false,
    hexNotNull: "0x0",
    bigintNotNull: 0n,

    stringArray: ["0"],
    intArray: [0],
    floatArray: [0],
    booleanArray: [false],
    hexArray: ["0x0"],
    bigintArray: [0n],

    stringArrayNotNull: ["0"],
    intArrayNotNull: [0],
    floatArrayNotNull: [0],
    booleanArrayNotNull: [false],
    hexArrayNotNull: ["0x0"],
    bigintArrayNotNull: [0n],
  });
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      table(id: "0") {
        id

        string
        int
        float
        boolean
        hex
        bigint

        stringNotNull
        intNotNull
        floatNotNull
        booleanNotNull
        hexNotNull
        bigintNotNull

        stringArray
        intArray
        floatArray
        booleanArray
        hexArray
        bigintArray

        stringArrayNotNull
        intArrayNotNull
        floatArrayNotNull
        booleanArrayNotNull
        hexArrayNotNull
        bigintArrayNotNull
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    table: {
      id: "0",

      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x00",
      bigint: "0",

      stringNotNull: "0",
      intNotNull: 0,
      floatNotNull: 0,
      booleanNotNull: false,
      hexNotNull: "0x00",
      bigintNotNull: "0",

      stringArray: ["0"],
      intArray: [0],
      floatArray: [0],
      booleanArray: [false],
      hexArray: ["0x00"],
      bigintArray: ["0"],

      stringArrayNotNull: ["0"],
      intArrayNotNull: [0],
      floatArrayNotNull: [0],
      booleanArrayNotNull: [false],
      hexArrayNotNull: ["0x00"],
      bigintArrayNotNull: ["0"],
    },
  });

  await cleanup();
});

test("enum, enum not null, enum array, enum array not null", async (context) => {
  const testEnum = onchainEnum("enum", ["A", "B"]);
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    enum: testEnum("enum"),
    enumNotNull: testEnum("enumNotNull").notNull(),
    enumArray: testEnum("enumArray").array(),
    enumArrayNotNull: testEnum("enumArrayNotNull").array().notNull(),
  }));
  const schema = { testEnum, table };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    enum: null,
    enumNotNull: "A",
    enumArray: null,
    enumArrayNotNull: ["A"],
  });
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      table(id: "0") {
        id
        enum
        enumNotNull
        enumArray
        enumArrayNotNull
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    table: {
      id: "0",
      enum: null,
      enumNotNull: "A",
      enumArray: null,
      enumArrayNotNull: ["A"],
    },
  });

  await cleanup();
});

test("json, json not null", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      json: t.json(),
      jsonNotNull: t.json().notNull(),
    })),
  };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    json: null,
    jsonNotNull: { kevin: 52 },
  });
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      table(id: "0") {
        id
        json
        jsonNotNull
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    table: {
      id: "0",
      json: null,
      jsonNotNull: { kevin: 52 },
    },
  });

  await cleanup();
});

test("singular", async (context) => {
  const transferEvents = onchainTable("transfer_events", (t) => ({
    id: t.text().primaryKey(),
    amount: t.bigint().notNull(),
  }));

  const allowances = onchainTable(
    "allowances",
    (t) => ({
      owner: t.text().notNull(),
      spender: t.text().notNull(),
      amount: t.bigint().notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.owner, table.spender] }),
    }),
  );
  const schema = { transferEvents, allowances };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.transferEvents).values([
    { id: "0", amount: 0n },
    { id: "1", amount: 10n },
  ]);
  indexingStore.insert(schema.allowances).values([
    { owner: "0", spender: "0", amount: 1n },
    { owner: "0", spender: "1", amount: 10n },
    { owner: "1", spender: "0", amount: 100n },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      transferEvents(id: "0") {
        id
        amount
      }
    }
  `);
  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    transferEvents: { id: "0", amount: "0" },
  });

  result = await query(`
    query {
      transferEvents(id: "1") {
        id
        amount
      }
    }
  `);
  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    transferEvents: { id: "1", amount: "10" },
  });

  result = await query(`
    query {
      allowances(owner: "0", spender: "0") {
        owner
        spender
        amount
      }
    }
  `);
  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    allowances: { owner: "0", spender: "0", amount: "1" },
  });

  result = await query(`
    query {
      allowances(owner: "1", spender: "0") {
        owner
        spender
        amount
      }
    }
  `);
  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    allowances: { owner: "1", spender: "0", amount: "100" },
  });

  await cleanup();
});

test("singular with one relation", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));

  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text("ownooor_id"),
    ownerIdNotNull: t.text().notNull(),
  }));

  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
    ownerNotNull: one(person, {
      fields: [pet.ownerIdNotNull],
      references: [person.id],
    }),
  }));

  const schema = { person, pet, petRelations };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "jake", name: "jake" },
    { id: "kyle", name: "kyle" },
  ]);
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog1", ownerIdNotNull: "jake" });
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      pet(id: "dog1") {
        owner {
          id
        }
        ownerNotNull {
          id
          name
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pet: {
      owner: null,
      ownerNotNull: {
        id: "jake",
        name: "jake",
      },
    },
  });

  await cleanup();
});

test("singular with many relation", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));

  const personRelations = relations(person, ({ many }) => ({
    pets: many(pet),
  }));

  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text(),
  }));

  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
  }));

  const schema = { person, personRelations, pet, petRelations };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values([
    { id: "dog1", ownerId: "jake" },
    { id: "dog2", ownerId: "jake" },
    { id: "dog3", ownerId: "kyle" },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      person(id: "jake") {
        pets {
          items {
            id
          }
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    person: {
      pets: { items: [{ id: "dog1" }, { id: "dog2" }] },
    },
  });

  await cleanup();
});

test("singular with many relation using filter", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const personRelations = relations(person, ({ many }) => ({
    pets: many(pet),
  }));
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    age: t.integer(),
    ownerId: t.text(),
  }));
  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
  }));
  const schema = { person, personRelations, pet, petRelations };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values([
    { id: "dog1", age: 1, ownerId: "jake" },
    { id: "dog2", age: 2, ownerId: "jake" },
    { id: "dog3", age: 3, ownerId: "jake" },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      person(id: "jake") {
        pets(where: { id: "dog2" }) {
          items {
            id
          }
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    person: {
      pets: {
        items: [{ id: "dog2" }],
      },
    },
  });

  await cleanup();
});

test("plural with one relation uses dataloader", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));

  const personRelations = relations(person, ({ many }) => ({
    pets: many(pet),
  }));

  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text(),
  }));

  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
  }));

  const schema = { person, personRelations, pet, petRelations };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values([
    { id: "dog1", ownerId: "jake" },
    { id: "dog2", ownerId: "jake" },
    { id: "dog3", ownerId: "kyle" },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  // @ts-expect-error
  const personFindManySpy = vi.spyOn(database.drizzle.query.person, "findMany");
  // @ts-expect-error
  const petFindManySpy = vi.spyOn(database.drizzle.query.pet, "findMany");

  const result = await query(`
    query {
      pets {
        items {
          id
          owner {
            id
          }
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "dog1", owner: { id: "jake" } },
        { id: "dog2", owner: { id: "jake" } },
        { id: "dog3", owner: null },
      ],
    },
  });

  expect(personFindManySpy).toHaveBeenCalledTimes(1);
  expect(petFindManySpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("filter input type", async (context) => {
  const simpleEnum = onchainEnum("SimpleEnum", ["VALUE", "ANOTHER_VALUE"]);
  const table = onchainTable("table", (t) => ({
    text: t.text().primaryKey(),
    hex: t.hex(),
    bool: t.boolean(),

    int: t.integer(),
    int8Number: t.int8({ mode: "number" }),
    int8Bigint: t.int8({ mode: "bigint" }),
    real: t.real(),
    doublePrecision: t.doublePrecision(),

    bigint: t.bigint(),
    bigintArray: t.bigint().array(),

    enum: simpleEnum(),
    enumArray: simpleEnum().array(),
  }));
  const schema = { simpleEnum, table };

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);
  const typeMap = graphqlSchema.getTypeMap();
  const tableFilterType = typeMap.tableFilter!;
  const fields = (tableFilterType.toConfig() as any).fields as Record<
    string,
    { name: string; type: GraphQLType }
  >;
  const fieldsPretty = Object.entries(fields).reduce<Record<string, any>>(
    (acc, [key, value]) => {
      acc[key] = value.type.toString();
      return acc;
    },
    {},
  );

  expect(fieldsPretty).toMatchObject({
    AND: "[tableFilter]",
    OR: "[tableFilter]",

    text: "String",
    text_not: "String",
    text_in: "[String]",
    text_not_in: "[String]",
    text_contains: "String",
    text_not_contains: "String",
    text_starts_with: "String",
    text_ends_with: "String",
    text_not_starts_with: "String",
    text_not_ends_with: "String",

    hex: "String",
    hex_not: "String",
    hex_in: "[String]",
    hex_not_in: "[String]",
    hex_contains: "String",
    hex_not_contains: "String",
    hex_starts_with: "String",
    hex_ends_with: "String",
    hex_not_starts_with: "String",
    hex_not_ends_with: "String",

    bool: "Boolean",
    bool_not: "Boolean",
    bool_in: "[Boolean]",
    bool_not_in: "[Boolean]",

    int: "Int",
    int_not: "Int",
    int_in: "[Int]",
    int_not_in: "[Int]",
    int_gt: "Int",
    int_lt: "Int",
    int_gte: "Int",
    int_lte: "Int",

    // NOTE: Not ideal that int8 number uses GraphQLFloat.
    int8Number: "Float",
    int8Number_not: "Float",
    int8Number_in: "[Float]",
    int8Number_not_in: "[Float]",
    int8Number_gt: "Float",
    int8Number_lt: "Float",
    int8Number_gte: "Float",
    int8Number_lte: "Float",

    // NOTE: Not ideal that int8 bigint uses GraphQLString.
    int8Bigint: "String",
    int8Bigint_not: "String",
    int8Bigint_in: "[String]",
    int8Bigint_not_in: "[String]",
    int8Bigint_contains: "String",
    int8Bigint_not_contains: "String",
    int8Bigint_starts_with: "String",
    int8Bigint_ends_with: "String",
    int8Bigint_not_starts_with: "String",
    int8Bigint_not_ends_with: "String",

    real: "Float",
    real_not: "Float",
    real_in: "[Float]",
    real_not_in: "[Float]",
    real_gt: "Float",
    real_lt: "Float",
    real_gte: "Float",
    real_lte: "Float",

    doublePrecision: "Float",
    doublePrecision_not: "Float",
    doublePrecision_in: "[Float]",
    doublePrecision_not_in: "[Float]",
    doublePrecision_gt: "Float",
    doublePrecision_lt: "Float",
    doublePrecision_gte: "Float",
    doublePrecision_lte: "Float",

    bigint: "BigInt",
    bigint_not: "BigInt",
    bigint_in: "[BigInt]",
    bigint_not_in: "[BigInt]",
    bigint_gt: "BigInt",
    bigint_lt: "BigInt",
    bigint_gte: "BigInt",
    bigint_lte: "BigInt",

    bigintArray: "[BigInt]",
    bigintArray_not: "[BigInt]",
    bigintArray_has: "BigInt",
    bigintArray_not_has: "BigInt",

    enum: "simpleEnum",
    enum_not: "simpleEnum",
    enum_in: "[simpleEnum]",
    enum_not_in: "[simpleEnum]",
    enumArray: "[simpleEnum]",
    enumArray_not: "[simpleEnum]",
    enumArray_has: "simpleEnum",
    enumArray_not_has: "simpleEnum",
  });

  await cleanup();
});

test("filter universal", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.bigint().primaryKey(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore
    .insert(schema.person)
    .values([{ id: 1n }, { id: 2n }, { id: 3n }]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(where: { id: "1" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({ persons: { items: [{ id: "1" }] } });

  result = await query(`
    query {
      persons(where: { id_not: "1" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }, { id: "3" }] },
  });

  await cleanup();
});

test("filter singular", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.hex().primaryKey(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore
    .insert(schema.person)
    .values([{ id: "0x01" }, { id: "0x02" }, { id: "0x03" }]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(where: { id_in: ["0x01", "0x02"] }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "0x01" }, { id: "0x02" }] },
  });

  result = await query(`
    query {
      persons(where: { id_not_in: ["0x01", "0x02"] }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "0x03" }] },
  });

  await cleanup();
});

test("filter plural", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    number: t.integer().array().notNull(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "1", number: [1, 2, 3] },
    { id: "2", number: [3, 4, 5] },
    { id: "3", number: [5, 6, 7] },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(where: { number: [1, 2, 3] }) {
        items {
          id
          number
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "1", number: [1, 2, 3] }] },
  });

  result = await query(`
    query {
      persons(where: { number_not: [5] }) {
        items {
          id
          number
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: {
      items: [
        { id: "1", number: [1, 2, 3] },
        { id: "2", number: [3, 4, 5] },
        { id: "3", number: [5, 6, 7] },
      ],
    },
  });

  result = await query(`
    query {
      persons(where: { number_has: 3 }) {
        items {
          id
          number
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: {
      items: [
        { id: "1", number: [1, 2, 3] },
        { id: "2", number: [3, 4, 5] },
      ],
    },
  });

  result = await query(`
    query {
      persons(where: { number_not_has: 4 }) {
        items {
          id
          number
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: {
      items: [
        { id: "1", number: [1, 2, 3] },
        { id: "3", number: [5, 6, 7] },
      ],
    },
  });

  await cleanup();
});

test("filter numeric", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    number: t.integer(),
    bigintNumber: t.int8({ mode: "number" }),
    bigintBigint: t.int8({ mode: "bigint" }),
    float: t.doublePrecision(),
    bigint: t.bigint(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    {
      id: "1",
      number: 1,
      bigintNumber: 1,
      bigintBigint: 1n,
      float: 1.5,
      bigint: 1n,
    },
    {
      id: "2",
      number: 2,
      bigintNumber: 2,
      bigintBigint: 2n,
      float: 2.5,
      bigint: 2n,
    },
    {
      id: "3",
      number: 3,
      bigintNumber: 3,
      bigintBigint: 3n,
      float: 3.5,
      bigint: 3n,
    },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(where: { number_gt: 1 }) {
        items {
          id
          number
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }, { id: "3" }] },
  });

  result = await query(`
    query {
      persons(where: { bigintNumber_lte: 1 }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "1" }] },
  });

  // NOTE: bigintBigint gets interpreted as a string, so the numeric filter
  // operators are not available. Not sure how to proceed here.
  // result = await query(`
  //   query {
  //     persons(where: { bigintBigint_lte: 1 }) {
  //       items {
  //         id
  //       }
  //     }
  //   }
  // `);

  // expect(result.errors?.[0]?.message).toBeUndefined();
  // expect(result.data).toMatchObject({
  //   persons: { items: [{ id: "1" }, { id: "2" }] },
  // });

  result = await query(`
    query {
      persons(where: { float_lt: 3.5 }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "1" }, { id: "2" }] },
  });

  result = await query(`
    query {
      persons(where: { bigint_gte: "2" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }, { id: "3" }] },
  });

  await cleanup();
});

test("filter string", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    text: t.text(),
    hex: t.hex(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "1", text: "one", hex: "0xabc" },
    { id: "2", text: "two", hex: "0xcde" },
    { id: "3", text: "three", hex: "0xef0" },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(where: { text_starts_with: "o" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({ persons: { items: [{ id: "1" }] } });

  result = await query(`
    query {
      persons(where: { text_not_ends_with: "e" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }] },
  });

  result = await query(`
    query {
      persons(where: { hex_contains: "c" }) {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "1" }, { id: "2" }] },
  });

  await cleanup();
});

test("filter and/or", async (context) => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      pets(where: { OR: [{ bigAge_gt: "50" }, { AND: [{ name: "Foo" }, { bigAge_lt: "20" }] }] }) {
        items {
          id
          name
          bigAge
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  // @ts-ignore
  expect(result.data.pets.items).toMatchObject([
    { id: "id1", name: "Skip", bigAge: "105" },
    { id: "id2", name: "Foo", bigAge: "10" },
    { id: "id3", name: "Bar", bigAge: "190" },
  ]);

  await cleanup();
});

test("order by", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    integer: t.integer(),
    bigintBigint: t.int8({ mode: "bigint" }),
    float: t.doublePrecision(),
    bigint: t.bigint(),
    hex: t.hex(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    {
      id: "1",
      integer: 1,
      bigintBigint: 1n,
      float: 1.5,
      bigint: 1n,
      hex: "0xa",
    },
    {
      id: "2",
      integer: 2,
      bigintBigint: 2n,
      float: 2.5,
      bigint: 3n,
      hex: "0xc",
    },
    {
      id: "3",
      integer: 3,
      bigintBigint: 3n,
      float: 3.5,
      bigint: 2n,
      hex: "0xb",
    },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      persons(orderBy: "integer", orderDirection: "desc") {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "3" }, { id: "2" }, { id: "1" }] },
  });

  result = await query(`
    query {
      persons(orderBy: "bigintBigint", orderDirection: "desc") {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "3" }, { id: "2" }, { id: "1" }] },
  });

  result = await query(`
    query {
      persons(orderBy: "float", orderDirection: "desc") {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "3" }, { id: "2" }, { id: "1" }] },
  });

  result = await query(`
    query {
      persons(orderBy: "bigint", orderDirection: "desc") {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }, { id: "3" }, { id: "1" }] },
  });

  result = await query(`
    query {
      persons(orderBy: "hex", orderDirection: "desc") {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    persons: { items: [{ id: "2" }, { id: "3" }, { id: "1" }] },
  });

  await cleanup();
});

test("limit", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
  }));
  const schema = { person };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  for (let i = 0; i < 100; i++) {
    indexingStore.insert(schema.person).values({ id: String(i) });
  }
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  // Default limit of 50
  let result = await query(`
    query {
      persons {
        items {
          id
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  // @ts-ignore
  expect(result.data.persons.items).toHaveLength(50);

  // Custom limit (below max)
  result = await query(`
    query {
      persons(limit: 75) {
        items {
          id
        }
      }
    }
  `);
  expect(result.errors?.[0]?.message).toBeUndefined();
  // @ts-ignore
  expect(result.data.persons.items).toHaveLength(75);

  // Custom limit (above max)
  result = await query(`
    query {
      persons(limit: 1005) {
        items {
          id
        }
      }
    }
  `);
  // @ts-ignore
  expect(result.errors?.[0]?.message).toBe(
    "Invalid limit. Got 1005, expected <=1000.",
  );

  await cleanup();
});

test("cursor pagination ascending", async (context) => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const schema = { pet };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip" },
    { id: "id2", name: "Foo" },
    { id: "id3", name: "Bar" },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston" },
    { id: "id6", name: "Book" },
    { id: "id7", name: "Shea" },
    { id: "id8", name: "Snack" },
    { id: "id9", name: "Last" },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      pets(orderBy: "id", orderDirection: "asc", limit: 5) {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id1", name: "Skip" },
        { id: "id2", name: "Foo" },
        { id: "id3", name: "Bar" },
        { id: "id4", name: "Zarbar" },
        { id: "id5", name: "Winston" },
      ],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const endCursor = result.data.pets.pageInfo.endCursor;

  result = await query(`
    query {
      pets(orderBy: "id", orderDirection: "asc", after: "${endCursor}") {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id6", name: "Book" },
        { id: "id7", name: "Shea" },
        { id: "id8", name: "Snack" },
        { id: "id9", name: "Last" },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const startCursor = result.data.pets.pageInfo.startCursor;

  result = await query(`
    query {
      pets(orderBy: "id", orderDirection: "asc", before: "${startCursor}", limit: 2) {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id4", name: "Zarbar" },
        { id: "id5", name: "Winston" },
      ],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  await cleanup();
});

test("cursor pagination descending", async (context) => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "desc", limit: 2) {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id4", name: "Zarbar" },
        { id: "id5", name: "Winston" },
      ],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const endCursor = result.data.pets.pageInfo.endCursor;

  result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "desc", after: "${endCursor}") {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id1", name: "Skip" },
        { id: "id2", name: "Foo" },
        { id: "id3", name: "Bar" },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const startCursor = result.data.pets.pageInfo.startCursor;

  result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "desc", before: "${startCursor}", limit: 1) {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [{ id: "id5", name: "Winston" }],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  await cleanup();
});

test("cursor pagination start and end cursors", async (context) => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "asc") {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  // Should return start and end cursors when returning full result
  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    pets: {
      items: [
        { id: "id3", name: "Bar" },
        { id: "id2", name: "Foo" },
        { id: "id1", name: "Skip" },
        { id: "id5", name: "Winston" },
        { id: "id4", name: "Zarbar" },
      ],
      pageInfo: {
        startCursor: expect.any(String),
        endCursor: expect.any(String),
        hasPreviousPage: false,
        hasNextPage: false,
      },
    },
  });

  await cleanup();
});

test("cursor pagination has previous page", async (context) => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "asc") {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();

  // @ts-ignore
  const endCursor = result.data.pets.pageInfo.endCursor;

  result = await query(`
    query {
      pets(orderBy: "name", orderDirection: "asc", after: "${endCursor}") {
        items {
          id
          name
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  // @ts-ignore
  expect(result.data.pets.items).toHaveLength(0);
  // @ts-ignore
  expect(result.data.pets.pageInfo).toMatchObject({
    startCursor: null,
    endCursor: null,
    // Should return true even if the current page is empty
    hasPreviousPage: true,
    hasNextPage: false,
  });

  await cleanup();
});

test("cursor pagination composite primary key", async (context) => {
  const allowance = onchainTable(
    "allowance",
    (t) => ({
      owner: t.text().notNull(),
      spender: t.text("speeeeender").notNull(),
      amount: t.bigint().notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.owner, table.spender] }),
    }),
  );

  const schema = { allowance };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.allowance).values([
    { owner: "alice", spender: "bob", amount: 100n },
    { owner: "bob", spender: "alice", amount: 400n },
    { owner: "bob", spender: "bill", amount: 500n },
    { owner: "bill", spender: "bill", amount: 600n },
    { owner: "bill", spender: "jenny", amount: 700n },
    { owner: "jenny", spender: "bill", amount: 800n },
  ]);
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  let result = await query(`
    query {
      allowances(orderBy: "owner", orderDirection: "asc", limit: 4) {
        items {
          owner
          spender
          amount
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    allowances: {
      items: [
        { owner: "alice", spender: "bob", amount: "100" },
        { owner: "bill", spender: "bill", amount: "600" },
        { owner: "bill", spender: "jenny", amount: "700" },
        { owner: "bob", spender: "alice", amount: "400" },
      ],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const endCursor = result.data.allowances.pageInfo.endCursor;

  result = await query(`
    query {
      allowances(orderBy: "owner", orderDirection: "asc", after: "${endCursor}") {
        items {
          owner
          spender
          amount
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    allowances: {
      items: [
        { owner: "bob", spender: "bill", amount: "500" },
        { owner: "jenny", spender: "bill", amount: "800" },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  // @ts-ignore
  const startCursor = result.data.allowances.pageInfo.startCursor;

  result = await query(`
    query {
      allowances(orderBy: "owner", orderDirection: "asc", before: "${startCursor}", limit: 2) {
        items {
          owner
          spender
          amount
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    allowances: {
      items: [
        { owner: "bill", spender: "jenny", amount: "700" },
        { owner: "bob", spender: "alice", amount: "400" },
      ],
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: true,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    },
  });

  await cleanup();
});

test("column casing", async (context) => {
  const schema = {
    table: onchainTable("table", (t) => ({
      id: t.text().primaryKey(),
      userName: t.text("user_name"),
      camelCase: t.text(),
    })),
  };

  const { database, indexingStore, metadataStore, cleanup } =
    await setupDatabaseServices(context, { schema });
  const getDataLoader = buildDataLoaderCache({ drizzle: database.drizzle });
  const contextValue = { metadataStore, getDataLoader };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    userName: "0",
    camelCase: "0",
  });
  await indexingStore.flush();

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const result = await query(`
    query {
      table(id: "0") {
        id
        userName
        camelCase
      }
    }
  `);

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    table: {
      id: "0",
      userName: "0",
      camelCase: "0",
    },
  });

  await cleanup();
});
