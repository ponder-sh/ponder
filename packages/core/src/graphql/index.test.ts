import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable, pgEnum, primaryKey, relations } from "@/drizzle/db.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import { type GraphQLType, execute, parse, printSchema } from "graphql";
import { beforeEach, expect, test } from "vitest";
import { buildGraphQLSchema } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

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

  const document = parse(`
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

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { db: database.drizzle },
  });

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

  indexingStore.insert(schema.table).values({
    id: "0",
    enum: null,
    enumNotNull: "A",
    enumArray: null,
    enumArrayNotNull: ["A"],
  });
  await indexingStore.flush({ force: true });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const document = parse(`
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

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { db: database.drizzle },
  });

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

  indexingStore.insert(schema.table).values({
    id: "0",
    json: null,
    jsonNotNull: { kevin: 52 },
  });
  await indexingStore.flush({ force: true });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const document = parse(`
    query {
      table(id: "0") {
        id
        json
        jsonNotNull
      }
    }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { db: database.drizzle },
  });

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

test("one", async (context) => {
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

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.person).values({ id: "kyle", name: "jake" });
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog1", ownerIdNotNull: "jake" });
  await indexingStore.flush({ force: true });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const document = parse(`
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

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: {
      db: database.drizzle,
      // getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

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

test("many", async (context) => {
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

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore.insert(schema.pet).values({ id: "dog1", ownerId: "jake" });
  indexingStore.insert(schema.pet).values({ id: "dog2", ownerId: "jake" });
  indexingStore.insert(schema.pet).values({ id: "dog3", ownerId: "kyle" });
  await indexingStore.flush({ force: true });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const document = parse(`
    query {
      person(id: "jake") {
        pets {
          id
        }
      }
    }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: {
      db: database.drizzle,
      // getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.errors?.[0]?.message).toBeUndefined();
  expect(result.data).toMatchObject({
    person: {
      pets: [{ id: "dog1" }, { id: "dog2" }],
    },
  });

  await cleanup();
});

test.only("many w/ filter", async (context) => {
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

  indexingStore.insert(schema.person).values({ id: "jake", name: "jake" });
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog1", age: 1, ownerId: "jake" });
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog2", age: 2, ownerId: "jake" });
  indexingStore
    .insert(schema.pet)
    .values({ id: "dog3", age: 3, ownerId: "jake" });
  await indexingStore.flush({ force: true });

  const graphqlSchema = buildGraphQLSchema(database.drizzle);

  const document = parse(`
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

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: {
      db: database.drizzle,
      // getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

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

// test("bigint id", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: 0n,
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     table(id: "0") {
//       id
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     table: {
//       id: "0",
//     },
//   });

//   await cleanup();
// });

// test("hex id", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.hex(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0x00",
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     table(id: "0x00") {
//       id
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     table: {
//       id: "0x00",
//     },
//   });

//   await cleanup();
// });

// test("filter string eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { string: "0" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string in", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { string_in: ["0", "2"] }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string contains", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "string",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { string_contains: "tr" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "string",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string starts with", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "string",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { string_starts_with: "str" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "string",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string not ends with", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "string",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { string_not_ends_with: "str" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "string",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter int eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { int: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter int gt", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "0",
//       int: 1,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { int_gt: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 1,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter int lte", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { int_lte: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter int in", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { int_in: [0, 2] }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter float eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { float: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter float gt", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "0",
//       int: 0,
//       float: 1,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { float_gt: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 1,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter float lte", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { float_lte: 0 }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter float in", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { float_in: [0, 2] }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter bigint eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { bigint: "0" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter bigint gt", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 1n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { bigint_gt: "0" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "1",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter bigint lte", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { bigint_lte: "0" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter bigint in", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { bigint_in: ["0", "2"] }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filer hex eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { hex: "0x00" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x00",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter hex gt", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x1",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (where: { hex_gt: "0x00" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: "0",
//           int: 0,
//           float: 0,
//           boolean: false,
//           hex: "0x01",
//           bigint: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string list eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string().list(),
//       int: p.int().list(),
//       float: p.float().list(),
//       boolean: p.boolean().list(),
//       hex: p.hex().list(),
//       bigint: p.bigint().list(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: ["0"],
//       int: [0],
//       float: [0],
//       boolean: [false],
//       hex: ["0x0"],
//       bigint: [0n],
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(where: { string: ["0"] }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: ["0"],
//           int: [0],
//           float: [0],
//           boolean: [false],
//           hex: ["0x0"],
//           bigint: ["0"],
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter string list has", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string().list(),
//       int: p.int().list(),
//       float: p.float().list(),
//       boolean: p.boolean().list(),
//       hex: p.hex().list(),
//       bigint: p.bigint().list(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       string: ["0"],
//       int: [0],
//       float: [0],
//       boolean: [false],
//       hex: ["0x0"],
//       bigint: [0n],
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(where: { string_has: "0" }) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           string: ["0"],
//           int: [0],
//           float: [0],
//           boolean: [false],
//           hex: ["0x0"],
//           bigint: ["0"],
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter enum eq", async (context) => {
//   const schema = createSchema((p) => ({
//     enum: p.createEnum(["A", "B"]),
//     table: p.createTable({
//       id: p.string(),
//       enum: p.enum("enum"),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       enum: "A",
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(enum: "A") {
//       items{
//         id
//         enum
//       }
//     }
//   }
// `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           enum: "A",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter enum in", async (context) => {
//   const schema = createSchema((p) => ({
//     enum: p.createEnum(["A", "B"]),
//     table: p.createTable({
//       id: p.string(),
//       enum: p.enum("enum"),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       enum: "A",
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(enum_in: ["A"]) {
//       items{
//         id
//         enum
//       }
//     }
//   }
// `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//           enum: "A",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter ref eq", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),

//       ref: p.string().references("table.id"),
//       one: p.one("ref"),

//       refNull: p.string().references("table.id").optional(),
//       oneNull: p.one("refNull"),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       ref: "0",
//       refNull: null,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(where: { ref: "0" }) {
//       items {
//         one {
//           id
//         }
//         oneNull
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: {
//       db: database.drizzle,
//       getLoader: buildLoaderCache({ store: indexingStore }),
//     },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           one: {
//             id: "0",
//           },
//           oneNull: null,
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("filter ref in", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),

//       ref: p.string().references("table.id"),
//       one: p.one("ref"),

//       refNull: p.string().references("table.id").optional(),
//       oneNull: p.one("refNull"),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "0",
//     data: {
//       ref: "0",
//       refNull: null,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(where: { ref_in: ["0", "2"] }) {
//       items {
//         one {
//           id
//         }

//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: {
//       db: database.drizzle,
//       getLoader: buildLoaderCache({ store: indexingStore }),
//     },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           one: {
//             id: "0",
//           },
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("order int asc", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "1",
//     data: {
//       string: "0",
//       int: 1_000,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "2",
//     data: {
//       string: "0",
//       int: 5,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 0n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(orderBy: "int", orderDirection: "asc") {
//       items {
//         id
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//         },
//         {
//           id: "2",
//         },
//         {
//           id: "1",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("order bigint asc", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "1",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 1_000n,
//     },
//   });

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "2",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 5n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(orderBy: "bigint", orderDirection: "asc") {
//       items {
//         id
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "0",
//         },
//         {
//           id: "2",
//         },
//         {
//           id: "1",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("order bigint desc", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   await create("0", indexingStore);

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "1",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 1_000n,
//     },
//   });

//   await indexingStore.create({
//     tableName: "table",
//     encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
//     id: "2",
//     data: {
//       string: "0",
//       int: 0,
//       float: 0,
//       boolean: false,
//       hex: "0x0",
//       bigint: 5n,
//     },
//   });

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables(orderBy: "bigint", orderDirection: "desc") {
//       items {
//         id
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   expect(result.data).toMatchObject({
//     tables: {
//       items: [
//         {
//           id: "1",
//         },
//         {
//           id: "2",
//         },
//         {
//           id: "0",
//         },
//       ],
//     },
//   });

//   await cleanup();
// });

// test("limit default", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   for (let i = 0; i < 100; i++) {
//     await create(String(i), indexingStore);
//   }

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   // @ts-ignore
//   expect(result.data.tables.items).toHaveLength(50);

//   await cleanup();
// });

// test("limit", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   for (let i = 0; i < 100; i++) {
//     await create(String(i), indexingStore);
//   }

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (limit: 15) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   // @ts-ignore
//   expect(result.data.tables.items).toHaveLength(15);

//   await cleanup();
// });

// test("limit error", async (context) => {
//   const schema = createSchema((p) => ({
//     table: p.createTable({
//       id: p.string(),
//       string: p.string(),
//       int: p.int(),
//       float: p.float(),
//       boolean: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//     }),
//   }));

//   const { database, indexingStore, cleanup } = await setupDatabaseServices(
//     context,
//     { schema },
//   );

//   // for (let i = 0; i < 100; i++) {
//   //   await create(String(i), indexingStore);
//   // }

//   const graphqlSchema = buildGraphQLSchema(database.drizzle);

//   const document = parse(`
//   query {
//     tables (limit: 1005) {
//       items {
//         id
//         string
//         int
//         float
//         boolean
//         hex
//         bigint
//       }
//     }
//   }
//   `);

//   const result = await execute({
//     schema: graphqlSchema,
//     document,
//     contextValue: { db: database.drizzle },
//   });

//   // @ts-ignore
//   expect(result.errors[0].message).toBe(
//     "Invalid limit. Got 1005, expected <=1000.",
//   );

//   await cleanup();
// });

// test("filter type has correct suffixes and types", () => {
//   const s = createSchema((p) => ({
//     SimpleEnum: p.createEnum(["VALUE", "ANOTHER_VALUE"]),
//     RelatedTableStringId: p.createTable({ id: p.string() }),
//     RelatedTableBigIntId: p.createTable({ id: p.bigint() }),
//     Table: p.createTable({
//       id: p.string(),
//       int: p.int(),
//       float: p.float(),
//       bool: p.boolean(),
//       hex: p.hex(),
//       bigint: p.bigint(),
//       enum: p.enum("SimpleEnum"),
//       listString: p.string().list(),
//       listBigInt: p.bigint().list(),
//       listEnum: p.enum("SimpleEnum").list(),
//       relatedTableStringId: p.string().references("RelatedTableStringId.id"),
//       relatedTableBigIntId: p.bigint().references("RelatedTableBigIntId.id"),
//       relatedTableString: p.one("relatedTableStringId"),
//     }),
//   }));

//   const serverSchema = buildGraphQLSchema(s);

//   const typeMap = serverSchema.getTypeMap();

//   const tableFilterType = typeMap.TableFilter!;
//   const fields = (tableFilterType.toConfig() as any).fields as Record<
//     string,
//     { name: string; type: GraphQLType }
//   >;

//   const fieldsPretty = Object.entries(fields).reduce<Record<string, any>>(
//     (acc, [key, value]) => {
//       acc[key] = value.type.toString();
//       return acc;
//     },
//     {},
//   );

//   expect(fieldsPretty).toMatchObject({
//     id: "String",
//     id_not: "String",
//     id_in: "[String]",
//     id_not_in: "[String]",
//     id_contains: "String",
//     id_not_contains: "String",
//     id_starts_with: "String",
//     id_ends_with: "String",
//     id_not_starts_with: "String",
//     id_not_ends_with: "String",
//     int: "Int",
//     int_not: "Int",
//     int_in: "[Int]",
//     int_not_in: "[Int]",
//     int_gt: "Int",
//     int_lt: "Int",
//     int_gte: "Int",
//     int_lte: "Int",
//     float: "Float",
//     float_not: "Float",
//     float_in: "[Float]",
//     float_not_in: "[Float]",
//     float_gt: "Float",
//     float_lt: "Float",
//     float_gte: "Float",
//     float_lte: "Float",
//     bool: "Boolean",
//     bool_not: "Boolean",
//     bool_in: "[Boolean]",
//     bool_not_in: "[Boolean]",
//     hex: "String",
//     hex_gt: "String",
//     hex_lt: "String",
//     hex_gte: "String",
//     hex_lte: "String",
//     hex_not: "String",
//     hex_in: "[String]",
//     hex_not_in: "[String]",
//     bigint: "BigInt",
//     bigint_not: "BigInt",
//     bigint_in: "[BigInt]",
//     bigint_not_in: "[BigInt]",
//     bigint_gt: "BigInt",
//     bigint_lt: "BigInt",
//     bigint_gte: "BigInt",
//     bigint_lte: "BigInt",
//     enum: "SimpleEnum",
//     enum_not: "SimpleEnum",
//     enum_in: "[SimpleEnum]",
//     enum_not_in: "[SimpleEnum]",
//     listString: "[String]",
//     listString_not: "[String]",
//     listString_has: "String",
//     listString_not_has: "String",
//     listBigInt: "[BigInt]",
//     listBigInt_not: "[BigInt]",
//     listBigInt_has: "BigInt",
//     listBigInt_not_has: "BigInt",
//     listEnum: "[SimpleEnum]",
//     listEnum_not: "[SimpleEnum]",
//     listEnum_has: "SimpleEnum",
//     listEnum_not_has: "SimpleEnum",
//     relatedTableStringId: "String",
//     relatedTableStringId_not: "String",
//     relatedTableStringId_in: "[String]",
//     relatedTableStringId_not_in: "[String]",
//     relatedTableStringId_contains: "String",
//     relatedTableStringId_not_contains: "String",
//     relatedTableStringId_starts_with: "String",
//     relatedTableStringId_ends_with: "String",
//     relatedTableStringId_not_starts_with: "String",
//     relatedTableStringId_not_ends_with: "String",
//     relatedTableBigIntId: "BigInt",
//     relatedTableBigIntId_not: "BigInt",
//     relatedTableBigIntId_in: "[BigInt]",
//     relatedTableBigIntId_not_in: "[BigInt]",
//     relatedTableBigIntId_gt: "BigInt",
//     relatedTableBigIntId_lt: "BigInt",
//     relatedTableBigIntId_gte: "BigInt",
//     relatedTableBigIntId_lte: "BigInt",
//   });
// });

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
