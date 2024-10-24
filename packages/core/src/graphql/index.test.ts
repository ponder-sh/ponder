import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable, pgEnum, relations } from "@/drizzle/db.js";
import { primaryKey } from "drizzle-orm/pg-core";
import { type GraphQLType, execute, parse, printSchema } from "graphql";
import { beforeEach, expect, test } from "vitest";
import { buildGraphQLSchema } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

// test("metadata", async (context) => {
//   const schema = createSchema(() => ({}));

//   const { indexingStore, cleanup, database } = await setupDatabaseServices(
//     context,
//     {
//       schema,
//     },
//   );

//   const metadataStore = getMetadataStore({
//     dialect: database.dialect,
//     db: database.qb.user,
//   });

//   await metadataStore.setStatus({
//     mainnet: {
//       ready: true,
//       block: {
//         number: 10,
//         timestamp: 20,
//       },
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     _meta {
//       status
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle, metadataStore },
//   });

//   expect(result.data).toMatchObject({
//     _meta: {
//       status: {
//         mainnet: {
//           ready: true,
//           block: {
//             number: 10,
//             timestamp: 20,
//           },
//         },
//       },
//     },
//   });

//   await cleanup();
// });

test("scalar, scalar not null, scalar array, scalar array not null", async (context) => {
  const schema = {
    table: onchainTable("test_table", (t) => ({
      id: t.text().primaryKey(),

      string: t.text(),
      int: t.integer(),
      float: t.doublePrecision(),
      boolean: t.boolean(),
      hex: t.evmHex(),
      bigint: t.evmBigint(),

      stringNotNull: t.text().notNull(),
      intNotNull: t.integer().notNull(),
      floatNotNull: t.doublePrecision().notNull(),
      booleanNotNull: t.boolean().notNull(),
      hexNotNull: t.evmHex().notNull(),
      bigintNotNull: t.evmBigint().notNull(),

      stringArray: t.text().array(),
      intArray: t.integer().array(),
      floatArray: t.doublePrecision().array(),
      booleanArray: t.boolean().array(),
      hexArray: t.evmHex().array(),
      bigintArray: t.evmBigint().array(),

      stringArrayNotNull: t.text().array().notNull(),
      intArrayNotNull: t.integer().array().notNull(),
      floatArrayNotNull: t.doublePrecision().array().notNull(),
      booleanArrayNotNull: t.boolean().array().notNull(),
      hexArrayNotNull: t.evmHex().array().notNull(),
      bigintArrayNotNull: t.evmBigint().array().notNull(),
    })),
  };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
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
  await indexingStore.flush({ force: true });

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

test.skip("enum, enum not null, enum array, enum array not null", async (context) => {
  const testEnum = pgEnum("test_enum", ["A", "B"]);
  const table = onchainTable("test_table", (t) => ({
    id: t.text(),
    enum: testEnum("enum"),
    enumNotNull: testEnum("enumOptional").notNull(),
    enumArray: testEnum("enumArray").array(),
    enumArrayNotNull: testEnum("enumOptionalArray").array().notNull(),
  }));
  const schema = { testEnum, table };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    enum: null,
    enumNotNull: "A",
    enumArray: null,
    enumArrayNotNull: ["A"],
  });
  await indexingStore.flush({ force: true });

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
      enum: "A",
      enumNotNull: "A",
      enumArray: [null],
      enumArrayNotNull: ["A"],
    },
  });

  await cleanup();
});

test("json, json not null", async (context) => {
  const schema = {
    table: onchainTable("test_table", (t) => ({
      id: t.text().primaryKey(),
      json: t.json(),
      jsonNotNull: t.json().notNull(),
    })),
  };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.table).values({
    id: "0",
    json: null,
    jsonNotNull: { kevin: 52 },
  });
  await indexingStore.flush({ force: true });

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
    amount: t.evmBigint().notNull(),
  }));

  const allowances = onchainTable(
    "allowances",
    (t) => ({
      owner: t.text().notNull(),
      spender: t.text().notNull(),
      amount: t.evmBigint().notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.owner, table.spender] }),
    }),
  );
  const schema = { transferEvents, allowances };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
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
  await indexingStore.flush({ force: true });

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

test("singular one", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));

  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text(),
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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "jake", name: "jake" },
    { id: "kyle", name: "kyle" },
  ]);
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog1", ownerIdNotNull: "jake" });
  await indexingStore.flush({ force: true });

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

test("singular many", async (context) => {
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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values([
    { id: "dog1", ownerId: "jake" },
    { id: "dog2", ownerId: "jake" },
    { id: "dog3", ownerId: "kyle" },
  ]);
  await indexingStore.flush({ force: true });

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

test("singular many with additional filter", async (context) => {
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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values([
    { id: "dog1", age: 1, ownerId: "jake" },
    { id: "dog2", age: 2, ownerId: "jake" },
    { id: "dog3", age: 3, ownerId: "jake" },
  ]);
  await indexingStore.flush({ force: true });

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

test.skip("filter input type", async (context) => {
  const simpleEnum = pgEnum("SimpleEnum", ["VALUE", "ANOTHER_VALUE"]);
  const table = onchainTable("table", (t) => ({
    text: t.text().primaryKey(),
    evmHex: t.evmHex(),
    bool: t.boolean(),
    int: t.integer(),
    bigintNumber: t.bigint({ mode: "number" }),
    bigintBigint: t.bigint({ mode: "bigint" }),
    real: t.real(),
    float: t.doublePrecision(),
    evmBigint: t.evmBigint(),
    enum: simpleEnum(),
    evmBigintArray: t.evmBigint().array(),
    enumArray: simpleEnum().array(),
  }));
  const schema = { simpleEnum, table };

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const typeMap = graphqlSchema.getTypeMap();
  const tableFilterType = typeMap.TableFilter!;
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
    id: "String",
    id_not: "String",
    id_in: "[String]",
    id_not_in: "[String]",
    id_contains: "String",
    id_not_contains: "String",
    id_starts_with: "String",
    id_ends_with: "String",
    id_not_starts_with: "String",
    id_not_ends_with: "String",
    int: "Int",
    int_not: "Int",
    int_in: "[Int]",
    int_not_in: "[Int]",
    int_gt: "Int",
    int_lt: "Int",
    int_gte: "Int",
    int_lte: "Int",
    float: "Float",
    float_not: "Float",
    float_in: "[Float]",
    float_not_in: "[Float]",
    float_gt: "Float",
    float_lt: "Float",
    float_gte: "Float",
    float_lte: "Float",
    bool: "Boolean",
    bool_not: "Boolean",
    bool_in: "[Boolean]",
    bool_not_in: "[Boolean]",
    hex: "String",
    hex_gt: "String",
    hex_lt: "String",
    hex_gte: "String",
    hex_lte: "String",
    hex_not: "String",
    hex_in: "[String]",
    hex_not_in: "[String]",
    bigint: "BigInt",
    bigint_not: "BigInt",
    bigint_in: "[BigInt]",
    bigint_not_in: "[BigInt]",
    bigint_gt: "BigInt",
    bigint_lt: "BigInt",
    bigint_gte: "BigInt",
    bigint_lte: "BigInt",
    enum: "SimpleEnum",
    enum_not: "SimpleEnum",
    enum_in: "[SimpleEnum]",
    enum_not_in: "[SimpleEnum]",
    listString: "[String]",
    listString_not: "[String]",
    listString_has: "String",
    listString_not_has: "String",
    listBigInt: "[BigInt]",
    listBigInt_not: "[BigInt]",
    listBigInt_has: "BigInt",
    listBigInt_not_has: "BigInt",
    listEnum: "[SimpleEnum]",
    listEnum_not: "[SimpleEnum]",
    listEnum_has: "SimpleEnum",
    listEnum_not_has: "SimpleEnum",
    relatedTableStringId: "String",
    relatedTableStringId_not: "String",
    relatedTableStringId_in: "[String]",
    relatedTableStringId_not_in: "[String]",
    relatedTableStringId_contains: "String",
    relatedTableStringId_not_contains: "String",
    relatedTableStringId_starts_with: "String",
    relatedTableStringId_ends_with: "String",
    relatedTableStringId_not_starts_with: "String",
    relatedTableStringId_not_ends_with: "String",
    relatedTableBigIntId: "BigInt",
    relatedTableBigIntId_not: "BigInt",
    relatedTableBigIntId_in: "[BigInt]",
    relatedTableBigIntId_not_in: "[BigInt]",
    relatedTableBigIntId_gt: "BigInt",
    relatedTableBigIntId_lt: "BigInt",
    relatedTableBigIntId_gte: "BigInt",
    relatedTableBigIntId_lte: "BigInt",
  });

  await cleanup();
});

test("filter universal", async (context) => {
  const person = onchainTable("person", (t) => ({
    id: t.evmBigint().primaryKey(),
  }));
  const schema = { person };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore
    .insert(schema.person)
    .values([{ id: 1n }, { id: 2n }, { id: 3n }]);
  await indexingStore.flush({ force: true });

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
    id: t.evmHex().primaryKey(),
  }));
  const schema = { person };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore
    .insert(schema.person)
    .values([{ id: "0x01" }, { id: "0x02" }, { id: "0x03" }]);
  await indexingStore.flush({ force: true });

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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "1", number: [1, 2, 3] },
    { id: "2", number: [3, 4, 5] },
    { id: "3", number: [5, 6, 7] },
  ]);
  await indexingStore.flush({ force: true });

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
    bigintNumber: t.bigint({ mode: "number" }),
    bigintBigint: t.bigint({ mode: "bigint" }),
    float: t.doublePrecision(),
    evmBigint: t.evmBigint(),
  }));
  const schema = { person };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    {
      id: "1",
      number: 1,
      bigintNumber: 1,
      bigintBigint: 1n,
      float: 1.5,
      evmBigint: 1n,
    },
    {
      id: "2",
      number: 2,
      bigintNumber: 2,
      bigintBigint: 2n,
      float: 2.5,
      evmBigint: 2n,
    },
    {
      id: "3",
      number: 3,
      bigintNumber: 3,
      bigintBigint: 3n,
      float: 3.5,
      evmBigint: 3n,
    },
  ]);
  await indexingStore.flush({ force: true });

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
      persons(where: { evmBigint_gte: "2" }) {
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
    hex: t.evmHex(),
  }));
  const schema = { person };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    { id: "1", text: "one", hex: "0xabc" },
    { id: "2", text: "two", hex: "0xcde" },
    { id: "3", text: "three", hex: "0xef0" },
  ]);
  await indexingStore.flush({ force: true });

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
    bigAge: t.evmBigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush({ force: true });

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
    bigintBigint: t.bigint({ mode: "bigint" }),
    float: t.doublePrecision(),
    evmBigint: t.evmBigint(),
    hex: t.evmHex(),
  }));
  const schema = { person };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.person).values([
    {
      id: "1",
      integer: 1,
      bigintBigint: 1n,
      float: 1.5,
      evmBigint: 1n,
      hex: "0xa",
    },
    {
      id: "2",
      integer: 2,
      bigintBigint: 2n,
      float: 2.5,
      evmBigint: 3n,
      hex: "0xc",
    },
    {
      id: "3",
      integer: 3,
      bigintBigint: 3n,
      float: 3.5,
      evmBigint: 2n,
      hex: "0xb",
    },
  ]);
  await indexingStore.flush({ force: true });

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
      persons(orderBy: "evmBigint", orderDirection: "desc") {
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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  for (let i = 0; i < 100; i++) {
    indexingStore.insert(schema.person).values({ id: String(i) });
  }
  await indexingStore.flush({ force: true });

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

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
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
  await indexingStore.flush({ force: true });

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
    bigAge: t.evmBigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush({ force: true });

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
    bigAge: t.evmBigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush({ force: true });

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
    bigAge: t.evmBigint(),
    age: t.integer(),
  }));
  const schema = { pet };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
  const query = (source: string) =>
    execute({ schema: graphqlSchema, contextValue, document: parse(source) });

  indexingStore.insert(schema.pet).values([
    { id: "id1", name: "Skip", bigAge: 105n },
    { id: "id2", name: "Foo", bigAge: 10n },
    { id: "id3", name: "Bar", bigAge: 190n },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston", age: 12 },
  ]);
  await indexingStore.flush({ force: true });

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
      spender: t.text().notNull(),
      amount: t.evmBigint().notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.owner, table.spender] }),
    }),
  );

  const schema = { allowance };

  const { database, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );
  const contextValue = { db: database.drizzle };
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
  await indexingStore.flush({ force: true });

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
