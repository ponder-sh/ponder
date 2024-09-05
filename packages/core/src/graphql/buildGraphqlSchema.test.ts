import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { type GraphQLType, execute, parse } from "graphql";
import { beforeEach, expect, test } from "vitest";
import { buildGraphQLSchema } from "./buildGraphqlSchema.js";
import { buildLoaderCache } from "./buildLoaderCache.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const create = async (id: string, indexingStore: IndexingStore) => {
  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id,
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });
};

test("scalar", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

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
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x00",
      bigint: "0",
    },
  });

  await cleanup();
});

test("scalar list", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string().list(),
      int: p.int().list(),
      float: p.float().list(),
      boolean: p.boolean().list(),
      hex: p.hex().list(),
      bigint: p.bigint().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: ["0"],
      int: [0],
      float: [0],
      boolean: [false],
      hex: ["0x0"],
      bigint: [0n],
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

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
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      string: ["0"],
      int: [0],
      float: [0],
      boolean: [false],
      hex: ["0x0"],
      bigint: ["0"],
    },
  });

  await cleanup();
});

test("scalar optional", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string().optional(),
      int: p.int().optional(),
      float: p.float().optional(),
      boolean: p.boolean().optional(),
      hex: p.hex().optional(),
      bigint: p.bigint().optional(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: null,
      int: null,
      float: null,
      boolean: null,
      hex: null,
      bigint: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

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
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      string: null,
      int: null,
      float: null,
      boolean: null,
      hex: null,
      bigint: null,
    },
  });

  await cleanup();
});

test("scalar optional list", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string().optional().list(),
      int: p.int().optional().list(),
      float: p.float().optional().list(),
      boolean: p.boolean().optional().list(),
      hex: p.hex().optional().list(),
      bigint: p.bigint().optional().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: null,
      int: null,
      float: null,
      boolean: null,
      hex: null,
      bigint: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

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
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      string: null,
      int: null,
      float: null,
      boolean: null,
      hex: null,
      bigint: null,
    },
  });

  await cleanup();
});

test("json", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      json: p.json(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      json: { kevin: 52 },
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
      json
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      json: { kevin: 52 },
    },
  });

  await cleanup();
});

test("enum", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: "A",
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
      enum
    }
  }
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      enum: "A",
    },
  });

  await cleanup();
});

test("enum optional", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum").optional(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
      enum
    }
}
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      enum: null,
    },
  });

  await cleanup();
});

test("enum list", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum").list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: ["A"],
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      enum: ["B"],
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
      enum
    }
  }
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      enum: ["A"],
    },
  });

  await cleanup();
});

test("enum optional list", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum").optional().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: null,
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      enum: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
      enum
    }
  }
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
      enum: null,
    },
  });

  await cleanup();
});

test("one", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),

      ref: p.string().references("table.id"),
      one: p.one("ref"),

      refNull: p.string().references("table.id").optional(),
      oneNull: p.one("refNull"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      ref: "0",
      refNull: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      one {
        id
      }
      oneNull {
        id
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: {
      readonlyStore: indexingStore,
      getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.data).toMatchObject({
    table: {
      one: {
        id: "0",
      },
      oneNull: null,
    },
  });

  await cleanup();
});

test("many", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),

      ref: p.string().references("many.id"),
      // refNull: p.string().references("many.id").optional(),
    }),
    many: p.createTable({
      id: p.string(),
      manyCol: p.many("table.ref"),
      // manyNull: p.many("table.refNull"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      ref: "0",
      // refNull: null,
    },
  });

  await indexingStore.create({
    tableName: "many",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    many(id: "0") {
      manyCol { 
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
      readonlyStore: indexingStore,
      getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.data).toMatchObject({
    many: {
      manyCol: {
        items: [
          {
            id: "0",
          },
        ],
      },
    },
  });

  await cleanup();
});

test("many w/ filter", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      col: p.string(),
      ref: p.string().references("many.id"),
    }),
    many: p.createTable({
      id: p.string(),
      manyCol: p.many("table.ref"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      col: "kevin",
      ref: "0",
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      col: "kyle",
      ref: "0",
    },
  });

  await indexingStore.create({
    tableName: "many",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    many(id: "0") {
      manyCol (where: {col: "kevin"}) { 
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
      readonlyStore: indexingStore,
      getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.data).toMatchObject({
    many: {
      manyCol: {
        items: [
          {
            id: "0",
          },
        ],
      },
    },
  });

  await cleanup();
});

test("bigint id", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: 0n,
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0") {
      id
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0",
    },
  });

  await cleanup();
});

test("hex id", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.hex(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0x00",
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    table(id: "0x00") {
      id
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    table: {
      id: "0x00",
    },
  });

  await cleanup();
});

test("filter string eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { string: "0" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter string in", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { string_in: ["0", "2"] }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter string contains", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "string",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { string_contains: "tr" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "string",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter string starts with", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "string",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { string_starts_with: "str" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "string",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter string not ends with", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "string",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { string_not_ends_with: "str" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "string",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter int eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { int: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter int gt", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "0",
      int: 1,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { int_gt: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 1,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter int lte", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { int_lte: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter int in", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { int_in: [0, 2] }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter float eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { float: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter float gt", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "0",
      int: 0,
      float: 1,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { float_gt: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 1,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter float lte", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { float_lte: 0 }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter float in", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { float_in: [0, 2] }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter bigint eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { bigint: "0" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter bigint gt", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 1n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { bigint_gt: "0" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "1",
        },
      ],
    },
  });

  await cleanup();
});

test("filter bigint lte", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { bigint_lte: "0" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter bigint in", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { bigint_in: ["0", "2"] }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filer hex eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { hex: "0x00" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x00",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter hex gt", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x1",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (where: { hex_gt: "0x00" }) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: "0",
          int: 0,
          float: 0,
          boolean: false,
          hex: "0x01",
          bigint: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("filter string list eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string().list(),
      int: p.int().list(),
      float: p.float().list(),
      boolean: p.boolean().list(),
      hex: p.hex().list(),
      bigint: p.bigint().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: ["0"],
      int: [0],
      float: [0],
      boolean: [false],
      hex: ["0x0"],
      bigint: [0n],
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(where: { string: ["0"] }) {
      items {
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: ["0"],
          int: [0],
          float: [0],
          boolean: [false],
          hex: ["0x0"],
          bigint: ["0"],
        },
      ],
    },
  });

  await cleanup();
});

test("filter string list has", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string().list(),
      int: p.int().list(),
      float: p.float().list(),
      boolean: p.boolean().list(),
      hex: p.hex().list(),
      bigint: p.bigint().list(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      string: ["0"],
      int: [0],
      float: [0],
      boolean: [false],
      hex: ["0x0"],
      bigint: [0n],
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(where: { string_has: "0" }) {
      items {
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          string: ["0"],
          int: [0],
          float: [0],
          boolean: [false],
          hex: ["0x0"],
          bigint: ["0"],
        },
      ],
    },
  });

  await cleanup();
});

test("filter enum eq", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: "A",
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(enum: "A") {
      items{
        id
        enum
      }
    }
  }
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          enum: "A",
        },
      ],
    },
  });

  await cleanup();
});

test("filter enum in", async (context) => {
  const schema = createSchema((p) => ({
    enum: p.createEnum(["A", "B"]),
    table: p.createTable({
      id: p.string(),
      enum: p.enum("enum"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      enum: "A",
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(enum_in: ["A"]) {
      items{
        id
        enum
      }
    }
  }
`);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
          enum: "A",
        },
      ],
    },
  });

  await cleanup();
});

test("filter ref eq", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),

      ref: p.string().references("table.id"),
      one: p.one("ref"),

      refNull: p.string().references("table.id").optional(),
      oneNull: p.one("refNull"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      ref: "0",
      refNull: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(where: { ref: "0" }) {
      items {
        one {
          id
        }
        oneNull
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: {
      readonlyStore: indexingStore,
      getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          one: {
            id: "0",
          },
          oneNull: null,
        },
      ],
    },
  });

  await cleanup();
});

test("filter ref in", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),

      ref: p.string().references("table.id"),
      one: p.one("ref"),

      refNull: p.string().references("table.id").optional(),
      oneNull: p.one("refNull"),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "0",
    data: {
      ref: "0",
      refNull: null,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(where: { ref_in: ["0", "2"] }) {
      items {
        one {
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
      readonlyStore: indexingStore,
      getLoader: buildLoaderCache({ store: indexingStore }),
    },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          one: {
            id: "0",
          },
        },
      ],
    },
  });

  await cleanup();
});

test("order int asc", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      string: "0",
      int: 1_000,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "2",
    data: {
      string: "0",
      int: 5,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 0n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(orderBy: "int", orderDirection: "asc") {
      items {
        id
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
        },
        {
          id: "2",
        },
        {
          id: "1",
        },
      ],
    },
  });

  await cleanup();
});

test("order bigint asc", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 1_000n,
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "2",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 5n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(orderBy: "bigint", orderDirection: "asc") {
      items {
        id
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "0",
        },
        {
          id: "2",
        },
        {
          id: "1",
        },
      ],
    },
  });

  await cleanup();
});

test("order bigint desc", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  await create("0", indexingStore);

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "1",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 1_000n,
    },
  });

  await indexingStore.create({
    tableName: "table",
    encodedCheckpoint: encodeCheckpoint(zeroCheckpoint),
    id: "2",
    data: {
      string: "0",
      int: 0,
      float: 0,
      boolean: false,
      hex: "0x0",
      bigint: 5n,
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables(orderBy: "bigint", orderDirection: "desc") {
      items {
        id
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  expect(result.data).toMatchObject({
    tables: {
      items: [
        {
          id: "1",
        },
        {
          id: "2",
        },
        {
          id: "0",
        },
      ],
    },
  });

  await cleanup();
});

test("limit default", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  for (let i = 0; i < 100; i++) {
    await create(String(i), indexingStore);
  }

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  // @ts-ignore
  expect(result.data.tables.items).toHaveLength(50);

  await cleanup();
});

test("limit", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  for (let i = 0; i < 100; i++) {
    await create(String(i), indexingStore);
  }

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (limit: 15) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  // @ts-ignore
  expect(result.data.tables.items).toHaveLength(15);

  await cleanup();
});

test("limit error", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      string: p.string(),
      int: p.int(),
      float: p.float(),
      boolean: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  // for (let i = 0; i < 100; i++) {
  //   await create(String(i), indexingStore);
  // }

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    tables (limit: 1005) {
      items { 
        id
        string
        int
        float
        boolean
        hex
        bigint
      }
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore },
  });

  // @ts-ignore
  expect(result.errors[0].message).toBe(
    "Invalid limit. Got 1005, expected <=1000.",
  );

  await cleanup();
});

test("filter type has correct suffixes and types", () => {
  const s = createSchema((p) => ({
    SimpleEnum: p.createEnum(["VALUE", "ANOTHER_VALUE"]),
    RelatedTableStringId: p.createTable({ id: p.string() }),
    RelatedTableBigIntId: p.createTable({ id: p.bigint() }),
    Table: p.createTable({
      id: p.string(),
      int: p.int(),
      float: p.float(),
      bool: p.boolean(),
      hex: p.hex(),
      bigint: p.bigint(),
      enum: p.enum("SimpleEnum"),
      listString: p.string().list(),
      listBigInt: p.bigint().list(),
      listEnum: p.enum("SimpleEnum").list(),
      relatedTableStringId: p.string().references("RelatedTableStringId.id"),
      relatedTableBigIntId: p.bigint().references("RelatedTableBigIntId.id"),
      relatedTableString: p.one("relatedTableStringId"),
    }),
  }));

  const serverSchema = buildGraphQLSchema(s);

  const typeMap = serverSchema.getTypeMap();

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
});

test("metadata", async (context) => {
  const schema = createSchema(() => ({}));

  const { indexingStore, cleanup, database } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  const metadataStore = getMetadataStore({
    dialect: database.dialect,
    db: database.qb.user,
  });

  await metadataStore.setStatus({
    mainnet: {
      ready: true,
      block: {
        number: 10,
        timestamp: 20,
      },
    },
  });

  const graphqlSchema = buildGraphQLSchema(schema);

  const document = parse(`
  query {
    _meta {
      status
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { readonlyStore: indexingStore, metadataStore },
  });

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
