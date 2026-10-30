import { count, relations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  type ExecutionResult,
  execute,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
  parse,
  printType,
} from "graphql";
import { expect, test } from "vitest";
import type { QB } from "@/database/queryBuilder.js";
import {
  onchainEnum,
  onchainTable,
  onchainView,
  primaryKey,
} from "@/drizzle/onchain.js";
import type { Schema } from "@/internal/types.js";
import { EVENT_TYPES, encodeCheckpoint } from "@/utils/checkpoint.js";
import { buildDataLoaderCache, buildGraphQLSchema } from "./index.js";

/**
 * Executes GraphQL operations against `schema` without a database.
 *
 * Every SQL statement is recorded in `queries`. `rows` returns the canned
 * result rows for a statement, as objects whose keys are in column order.
 */
const createGraphQL = (
  schema: Schema,
  rows: (
    sql: string,
    params: unknown[],
  ) => Record<string, unknown>[] = () => [],
) => {
  const queries: { sql: string; params: unknown[] }[] = [];

  const raw = drizzle(
    async (sql, params, method) => {
      queries.push({ sql, params });
      const result = rows(sql, params);
      // Note: `db.execute()` resolves to the node-postgres result object.
      return {
        rows:
          method === "all"
            ? result.map(Object.values)
            : ({ rows: result } as unknown as unknown[]),
      };
    },
    { casing: "snake_case", schema },
  );
  const qb = {
    raw,
    wrap: (...args: any[]) =>
      args.findLast((a) => typeof a === "function")(raw),
  } as unknown as QB;

  const graphqlSchema = buildGraphQLSchema({ schema });

  const query = (source: string) =>
    execute({
      schema: graphqlSchema,
      contextValue: { qb, getDataLoader: buildDataLoaderCache(qb) },
      document: parse(source),
    });

  return { graphqlSchema, query, queries };
};

const printTypes = (graphqlSchema: GraphQLSchema, ...names: string[]) =>
  names
    .map((name) => printType(graphqlSchema.getType(name) as GraphQLNamedType))
    .join("\n\n");

/** Returns the `pageInfo` of the plural `field` in `result`. */
const pageInfo = (result: ExecutionResult, field: string) =>
  (result.data as any)[field].pageInfo;

test("scalar, scalar not null, scalar array, scalar array not null", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),

    string: t.text(),
    int: t.integer(),
    float: t.doublePrecision(),
    boolean: t.boolean(),
    hex: t.hex(),
    bigint: t.bigint(),
    bytes: t.bytes(),

    stringNotNull: t.text().notNull(),
    intNotNull: t.integer().notNull(),
    floatNotNull: t.doublePrecision().notNull(),
    booleanNotNull: t.boolean().notNull(),
    hexNotNull: t.hex().notNull(),
    bigintNotNull: t.bigint().notNull(),
    bytesNotNull: t.bytes().notNull(),

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
  }));
  const { graphqlSchema } = createGraphQL({ table });

  expect(printTypes(graphqlSchema, "table")).toMatchInlineSnapshot(`
    "type table {
      id: String!
      string: String
      int: Int
      float: Float
      boolean: Boolean
      hex: String
      bigint: BigInt
      bytes: [Int!]
      stringNotNull: String!
      intNotNull: Int!
      floatNotNull: Float!
      booleanNotNull: Boolean!
      hexNotNull: String!
      bigintNotNull: BigInt!
      bytesNotNull: [Int!]!
      stringArray: [String!]
      intArray: [Int!]
      floatArray: [Float!]
      booleanArray: [Boolean!]
      hexArray: [String!]
      bigintArray: [BigInt!]
      stringArrayNotNull: [String!]!
      intArrayNotNull: [Int!]!
      floatArrayNotNull: [Float!]!
      booleanArrayNotNull: [Boolean!]!
      hexArrayNotNull: [String!]!
      bigintArrayNotNull: [BigInt!]!
    }"
  `);
});

test("filter numeric", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    number: t.integer(),
    bigintNumber: t.int8({ mode: "number" }),
    bigintBigint: t.int8({ mode: "bigint" }),
    float: t.doublePrecision(),
    bigint: t.bigint(),
    numeric: t.numeric(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(`{ persons(where: { number_gt: 1 }) { items { id } } }`),
    await query(`{ persons(where: { bigintNumber_lte: 1 }) { items { id } } }`),
    await query(
      `{ persons(where: { bigintBigint_lte: "1" }) { items { id } } }`,
    ),
    await query(`{ persons(where: { float_lt: 3.5 }) { items { id } } }`),
    await query(`{ persons(where: { bigint_gte: "2" }) { items { id } } }`),
    await query(`{ persons(where: { numeric_gte: "2.1" }) { items { id } } }`),
  ];

  expect(results.map((result) => result.errors)).toMatchInlineSnapshot(`
    [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          1,
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."number" > $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          1,
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."bigint_number" <= $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          1n,
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."bigint_bigint" <= $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          3.5,
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."float" < $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          2n,
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."bigint" >= $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "2.1",
          51,
        ],
        "sql": "select "id", "number", "bigint_number", "bigint_bigint", "float", "bigint", "numeric" from "person" where "person"."numeric" >= $1 order by "person"."id" asc limit $2",
      },
    ]
  `);
});

test("cursor pagination ascending", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const pets = [
    { id: "id1", name: "Skip" },
    { id: "id2", name: "Foo" },
    { id: "id3", name: "Bar" },
    { id: "id4", name: "Zarbar" },
    { id: "id5", name: "Winston" },
    { id: "id6", name: "Book" },
    { id: "id7", name: "Shea" },
    { id: "id8", name: "Snack" },
    { id: "id9", name: "Last" },
  ];
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ pet }, (sql) =>
    sql.startsWith("select count") ? [{ count: 9 }] : next,
  );
  const page = `
    items { id name }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    totalCount
  `;

  next = pets.slice(0, 6);
  const result1 = await query(`
    { pets(orderBy: "id", orderDirection: "asc", limit: 5) { ${page} } }
  `);

  // Note: The database includes the `after` cursor row.
  next = pets.slice(4);
  const result2 = await query(`
    {
      pets(orderBy: "id", orderDirection: "asc", after: "${pageInfo(result1, "pets").endCursor}") {
        ${page}
      }
    }
  `);

  // Note: The database includes the `before` cursor row, in reverse order.
  next = pets.slice(2, 6).reverse();
  const result3 = await query(`
    {
      pets(orderBy: "id", orderDirection: "asc", before: "${pageInfo(result2, "pets").startCursor}", limit: 2) {
        ${page}
      }
    }
  `);

  expect([result1, result2, result3]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id1",
                "name": "Skip",
              },
              {
                "id": "id2",
                "name": "Foo",
              },
              {
                "id": "id3",
                "name": "Bar",
              },
              {
                "id": "id4",
                "name": "Zarbar",
              },
              {
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7ImlkIjoiaWQ1In19",
              "hasNextPage": true,
              "hasPreviousPage": false,
              "startCursor": "eyJqc29uIjp7ImlkIjoiaWQxIn19",
            },
            "totalCount": 9,
          },
        },
      },
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id6",
                "name": "Book",
              },
              {
                "id": "id7",
                "name": "Shea",
              },
              {
                "id": "id8",
                "name": "Snack",
              },
              {
                "id": "id9",
                "name": "Last",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7ImlkIjoiaWQ5In19",
              "hasNextPage": false,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7ImlkIjoiaWQ2In19",
            },
            "totalCount": 9,
          },
        },
      },
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id4",
                "name": "Zarbar",
              },
              {
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7ImlkIjoiaWQ1In19",
              "hasNextPage": true,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7ImlkIjoiaWQ0In19",
            },
            "totalCount": 9,
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          6,
        ],
        "sql": "select "id", "name" from "pet" order by "pet"."id" asc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "id5",
          52,
        ],
        "sql": "select "id", "name" from "pet" where "pet"."id" >= $1 order by "pet"."id" asc limit $2",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "id6",
          4,
        ],
        "sql": "select "id", "name" from "pet" where "pet"."id" <= $1 order by "pet"."id" desc limit $2",
      },
    ]
  `);
});

test("metadata", async () => {
  const checkpoint = encodeCheckpoint({
    blockNumber: 10n,
    chainId: 1n,
    blockTimestamp: 20n,
    transactionIndex: 0n,
    eventType: EVENT_TYPES.blocks,
    eventIndex: 0n,
  });
  const { query } = createGraphQL({}, () => [
    {
      chain_name: "mainnet",
      chain_id: "1",
      latest_checkpoint: checkpoint,
      safe_checkpoint: checkpoint,
    },
  ]);

  expect(await query("{ _meta { status } }")).toMatchInlineSnapshot(`
    {
      "data": {
        "_meta": {
          "status": {
            "mainnet": {
              "block": {
                "number": 10,
                "timestamp": 20,
              },
              "id": 1,
            },
          },
        },
      },
    }
  `);
});

test("enum, enum not null, enum array, enum array not null", () => {
  const testEnum = onchainEnum("enum", ["A", "B"]);
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    enum: testEnum("enum"),
    enumNotNull: testEnum("enumNotNull").notNull(),
    enumArray: testEnum("enumArray").array(),
    enumArrayNotNull: testEnum("enumArrayNotNull").array().notNull(),
  }));
  const { graphqlSchema } = createGraphQL({ testEnum, table });

  expect(printTypes(graphqlSchema, "testEnum", "table")).toMatchInlineSnapshot(`
    "enum testEnum {
      A
      B
    }

    type table {
      id: String!
      enum: testEnum
      enumNotNull: testEnum!
      enumArray: [testEnum!]
      enumArrayNotNull: [testEnum!]!
    }"
  `);
});

test("enum primary key", () => {
  const testEnum = onchainEnum("enum", ["A", "B"]);
  const table = onchainTable(
    "table",
    (t) => ({
      a: t.text().notNull(),
      enum: testEnum("enum").notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.a, table.enum] }),
    }),
  );
  const { graphqlSchema } = createGraphQL({ testEnum, table });

  expect(printTypes(graphqlSchema, "table", "Query")).toMatchInlineSnapshot(`
    "type table {
      a: String!
      enum: testEnum!
    }

    type Query {
      table(a: String!, enum: String!): table
      tables(where: tableFilter, orderBy: String, orderDirection: String, before: String, after: String, limit: Int, offset: Int): tablePage!
      _meta: Meta
    }"
  `);
});

test("json, json not null", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    json: t.json(),
    jsonNotNull: t.json().notNull(),
  }));
  const { graphqlSchema } = createGraphQL({ table });

  expect(printTypes(graphqlSchema, "table")).toMatchInlineSnapshot(`
    "type table {
      id: String!
      json: JSON
      jsonNotNull: JSON!
    }"
  `);
});

test("singular", async () => {
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
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL(
    { transferEvents, allowances },
    () => next,
  );

  next = [{ id: "1", amount: "10" }];
  const result1 = await query(`{ transferEvents(id: "1") { id amount } }`);
  next = [{ owner: "1", spender: "0", amount: "100" }];
  const result2 = await query(`
    { allowances(owner: "1", spender: "0") { owner spender amount } }
  `);

  expect([result1, result2]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "transferEvents": {
            "amount": "10",
            "id": "1",
          },
        },
      },
      {
        "data": {
          "allowances": {
            "amount": "100",
            "owner": "1",
            "spender": "0",
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "1",
          1,
        ],
        "sql": "select "id", "amount" from "transfer_events" "transferEvents" where "transferEvents"."id" = $1 limit $2",
      },
      {
        "params": [
          "1",
          "0",
          1,
        ],
        "sql": "select "owner", "spender", "amount" from "allowances" "allowances" where ("allowances"."owner" = $1 and "allowances"."spender" = $2) limit $3",
      },
    ]
  `);
});

test("singular with one relation", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text().notNull(),
    ownerIdNullable: t.text(),
  }));
  // Note that regardless of whether the `fields` column(s) are nullable,
  // the field type corresponding to the `one` relation must be nullable.
  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
    ownerNullable: one(person, {
      fields: [pet.ownerIdNullable],
      references: [person.id],
    }),
  }));
  const { graphqlSchema, query, queries } = createGraphQL(
    { person, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [{ id: "dog1", ownerId: "jake", ownerIdNullable: null }]
        : [{ id: "jake", name: "jake" }],
  );

  expect(printTypes(graphqlSchema, "pet")).toMatchInlineSnapshot(`
    "type pet {
      id: String!
      ownerId: String!
      ownerIdNullable: String
      owner: person
      ownerNullable: person
    }"
  `);

  const result = await query(`
    {
      pet(id: "dog1") {
        owner { id name }
        ownerNullable { id }
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "pet": {
          "owner": {
            "id": "jake",
            "name": "jake",
          },
          "ownerNullable": null,
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "dog1",
          1,
        ],
        "sql": "select "id", "owner_id", "owner_id_nullable" from "pet" "pet" where "pet"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          2,
        ],
        "sql": "select "id", "name" from "person" "person" where ("person"."id" = $1 or "person"."id" is null) limit $2",
      },
    ]
  `);
});

test("singular with one relation using camel case 'references' column name", async () => {
  const person = onchainTable("person", (t) => ({
    camelCaseId: t.text().primaryKey(),
    name: t.text(),
  }));
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text(),
  }));
  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, {
      fields: [pet.ownerId],
      references: [person.camelCaseId],
    }),
  }));
  const { query, queries } = createGraphQL(
    { person, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [{ id: "dog1", ownerId: "jake" }]
        : [{ camelCaseId: "jake", name: "jake" }],
  );

  const result = await query(`{ pet(id: "dog1") { owner { camelCaseId } } }`);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "pet": {
          "owner": {
            "camelCaseId": "jake",
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "dog1",
          1,
        ],
        "sql": "select "id", "owner_id" from "pet" "pet" where "pet"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "camel_case_id", "name" from "person" "person" where "person"."camel_case_id" = $1 limit $2",
      },
    ]
  `);
});

test("singular with many relation", async () => {
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
  const { graphqlSchema, query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [
            { id: "dog1", ownerId: "jake" },
            { id: "dog2", ownerId: "jake" },
          ]
        : [{ id: "jake", name: "jake" }],
  );

  expect(printTypes(graphqlSchema, "person")).toMatchInlineSnapshot(`
    "type person {
      id: String!
      name: String
      pets(where: petFilter, orderBy: String, orderDirection: String, before: String, after: String, limit: Int, offset: Int): petPage
    }"
  `);

  const result = await query(
    `{ person(id: "jake") { pets { items { id } } } }`,
  );

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "person": {
          "pets": {
            "items": [
              {
                "id": "dog1",
              },
              {
                "id": "dog2",
              },
            ],
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "id", "name" from "person" "person" where "person"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "owner_id" from "pet" where "pet"."owner_id" = $1 order by "pet"."id" asc limit $2",
      },
    ]
  `);
});

test("singular with many relation using camel case 'references' column name", async () => {
  const person = onchainTable("person", (t) => ({
    camelCaseId: t.text().primaryKey(),
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
    owner: one(person, {
      fields: [pet.ownerId],
      references: [person.camelCaseId],
    }),
  }));
  const { query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [
            { id: "dog1", ownerId: "jake" },
            { id: "dog2", ownerId: "jake" },
          ]
        : [{ camelCaseId: "jake", name: "jake" }],
  );

  const result = await query(`
    { person(camelCaseId: "jake") { pets { items { id } } } }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "person": {
          "pets": {
            "items": [
              {
                "id": "dog1",
              },
              {
                "id": "dog2",
              },
            ],
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "camel_case_id", "name" from "person" "person" where "person"."camel_case_id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "owner_id" from "pet" where "pet"."owner_id" = $1 order by "pet"."id" asc limit $2",
      },
    ]
  `);
});

test("singular with many relation and extra one relation", async () => {
  const extra = onchainTable("extra", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const user = onchainTable("user", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const userRelations = relations(user, ({ many }) => ({
    heroes: many(hero),
  }));
  const hero = onchainTable("hero", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text(),
    extraId: t.text(),
  }));
  const heroRelations = relations(hero, ({ one }) => ({
    extra: one(extra, { fields: [hero.extraId], references: [extra.id] }),
    owner: one(user, { fields: [hero.ownerId], references: [user.id] }),
  }));
  const extraRelations = relations(extra, ({ one }) => ({
    cuh: one(user, { fields: [extra.id], references: [user.id] }),
  }));
  const { query, queries } = createGraphQL(
    { extra, extraRelations, hero, heroRelations, user, userRelations },
    (sql) =>
      sql.includes('from "hero"')
        ? [
            { id: "dog1", ownerId: "jake", extraId: null },
            { id: "dog2", ownerId: "jake", extraId: null },
          ]
        : [{ id: "jake", name: "jake" }],
  );

  const result = await query(`
    { user(id: "jake") { heroes { items { id } } } }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "user": {
          "heroes": {
            "items": [
              {
                "id": "dog1",
              },
              {
                "id": "dog2",
              },
            ],
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "id", "name" from "user" "user" where "user"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "owner_id", "extra_id" from "hero" where "hero"."owner_id" = $1 order by "hero"."id" asc limit $2",
      },
    ]
  `);
});

test("multiple many relations", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const personRelations = relations(person, ({ many }) => ({
    pets1: many(pet, { relationName: "owner1_relation" }),
    pets2: many(pet, { relationName: "owner2_relation" }),
  }));
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    owner1: t.text(),
    owner2: t.text(),
  }));
  const petRelations = relations(pet, ({ one }) => ({
    owner1Relation: one(person, {
      fields: [pet.owner1],
      relationName: "owner1_relation",
      references: [person.id],
    }),
    owner2Relation: one(person, {
      fields: [pet.owner2],
      relationName: "owner2_relation",
      references: [person.id],
    }),
  }));
  const { query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) => {
      if (sql.includes('"pet"."owner1" =')) {
        return [
          { id: "dog1", owner1: "jake", owner2: "jim" },
          { id: "dog2", owner1: "jake", owner2: "kyle" },
        ];
      }
      if (sql.includes('"pet"."owner2" =')) return [];
      return [{ id: "jake", name: "jake" }];
    },
  );

  const result = await query(`
    {
      person(id: "jake") {
        pets1 { items { id } }
        pets2 { items { id } }
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "person": {
          "pets1": {
            "items": [
              {
                "id": "dog1",
              },
              {
                "id": "dog2",
              },
            ],
          },
          "pets2": {
            "items": [],
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "id", "name" from "person" "person" where "person"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "owner1", "owner2" from "pet" where "pet"."owner1" = $1 order by "pet"."id" asc limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "owner1", "owner2" from "pet" where "pet"."owner2" = $1 order by "pet"."id" asc limit $2",
      },
    ]
  `);
});

test("singular with many relation using filter", async () => {
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
  const { query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) => {
      if (sql.startsWith("select count")) return [{ count: 1 }];
      if (sql.includes('from "pet"')) {
        return [{ id: "dog2", age: 2, ownerId: "jake" }];
      }
      return [{ id: "jake", name: "jake" }];
    },
  );

  const result = await query(`
    {
      person(id: "jake") {
        pets(where: { id: "dog2" }) { items { id } totalCount }
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "person": {
          "pets": {
            "items": [
              {
                "id": "dog2",
              },
            ],
            "totalCount": 1,
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "id", "name" from "person" "person" where "person"."id" = $1 limit $2",
      },
      {
        "params": [
          "dog2",
          "jake",
        ],
        "sql": "select count(*) from "pet" where ("pet"."id" = $1 and "pet"."owner_id" = $2)",
      },
      {
        "params": [
          "dog2",
          "jake",
          51,
        ],
        "sql": "select "id", "age", "owner_id" from "pet" where ("pet"."id" = $1 and "pet"."owner_id" = $2) order by "pet"."id" asc limit $3",
      },
    ]
  `);
});

test("singular with many relation using order by", async () => {
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
  const { query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [
            { id: "dog3", age: 3, ownerId: "jake" },
            { id: "dog2", age: 2, ownerId: "jake" },
            { id: "dog1", age: 1, ownerId: "jake" },
          ]
        : [{ id: "jake", name: "jake" }],
  );

  const result = await query(`
    {
      person(id: "jake") {
        pets(orderBy: "age", orderDirection: "desc") { items { id } }
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "person": {
          "pets": {
            "items": [
              {
                "id": "dog3",
              },
              {
                "id": "dog2",
              },
              {
                "id": "dog1",
              },
            ],
          },
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "jake",
          1,
        ],
        "sql": "select "id", "name" from "person" "person" where "person"."id" = $1 limit $2",
      },
      {
        "params": [
          "jake",
          51,
        ],
        "sql": "select "id", "age", "owner_id" from "pet" where "pet"."owner_id" = $1 order by "pet"."age" desc, "pet"."id" desc limit $2",
      },
    ]
  `);
});

test("plural with one relation uses dataloader", async () => {
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
  const { query, queries } = createGraphQL(
    { person, personRelations, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [
            { id: "dog1", ownerId: "jake" },
            { id: "dog2", ownerId: "jake" },
            { id: "dog3", ownerId: "kyle" },
          ]
        : [{ id: "jake", name: "jake" }],
  );

  const result = await query(`{ pets { items { id owner { id } } } }`);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "pets": {
          "items": [
            {
              "id": "dog1",
              "owner": {
                "id": "jake",
              },
            },
            {
              "id": "dog2",
              "owner": {
                "id": "jake",
              },
            },
            {
              "id": "dog3",
              "owner": null,
            },
          ],
        },
      },
    }
  `);
  // One statement for the pets and one batched statement for all owners.
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          51,
        ],
        "sql": "select "id", "owner_id" from "pet" order by "pet"."id" asc limit $1",
      },
      {
        "params": [
          "jake",
          "kyle",
          2,
        ],
        "sql": "select "id", "name" from "person" "person" where ("person"."id" = $1 or "person"."id" = $2) limit $3",
      },
    ]
  `);
});

test("filter input type", () => {
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

    numeric: t.numeric(),
    numericArray: t.numeric().array(),

    bigint: t.bigint(),
    bigintArray: t.bigint().array(),

    enum: simpleEnum(),
    enumArray: simpleEnum().array(),
  }));
  const { graphqlSchema } = createGraphQL({ simpleEnum, table });

  expect(printTypes(graphqlSchema, "tableFilter")).toMatchInlineSnapshot(`
    "input tableFilter {
      AND: [tableFilter]
      OR: [tableFilter]
      text: String
      text_not: String
      text_in: [String]
      text_not_in: [String]
      text_contains: String
      text_not_contains: String
      text_starts_with: String
      text_ends_with: String
      text_not_starts_with: String
      text_not_ends_with: String
      text_contains_nocase: String
      text_not_contains_nocase: String
      text_starts_with_nocase: String
      text_ends_with_nocase: String
      text_not_starts_with_nocase: String
      text_not_ends_with_nocase: String
      hex: String
      hex_not: String
      hex_in: [String]
      hex_not_in: [String]
      hex_contains: String
      hex_not_contains: String
      hex_starts_with: String
      hex_ends_with: String
      hex_not_starts_with: String
      hex_not_ends_with: String
      bool: Boolean
      bool_not: Boolean
      bool_in: [Boolean]
      bool_not_in: [Boolean]
      int: Int
      int_not: Int
      int_in: [Int]
      int_not_in: [Int]
      int_gt: Int
      int_lt: Int
      int_gte: Int
      int_lte: Int
      int8Number: Int
      int8Number_not: Int
      int8Number_in: [Int]
      int8Number_not_in: [Int]
      int8Number_gt: Int
      int8Number_lt: Int
      int8Number_gte: Int
      int8Number_lte: Int
      int8Bigint: BigInt
      int8Bigint_not: BigInt
      int8Bigint_in: [BigInt]
      int8Bigint_not_in: [BigInt]
      int8Bigint_gt: BigInt
      int8Bigint_lt: BigInt
      int8Bigint_gte: BigInt
      int8Bigint_lte: BigInt
      real: Float
      real_not: Float
      real_in: [Float]
      real_not_in: [Float]
      real_gt: Float
      real_lt: Float
      real_gte: Float
      real_lte: Float
      doublePrecision: Float
      doublePrecision_not: Float
      doublePrecision_in: [Float]
      doublePrecision_not_in: [Float]
      doublePrecision_gt: Float
      doublePrecision_lt: Float
      doublePrecision_gte: Float
      doublePrecision_lte: Float
      numeric: Numeric
      numeric_not: Numeric
      numeric_in: [Numeric]
      numeric_not_in: [Numeric]
      numeric_gt: Numeric
      numeric_lt: Numeric
      numeric_gte: Numeric
      numeric_lte: Numeric
      numericArray: [Numeric]
      numericArray_not: [Numeric]
      numericArray_has: Numeric
      numericArray_not_has: Numeric
      bigint: BigInt
      bigint_not: BigInt
      bigint_in: [BigInt]
      bigint_not_in: [BigInt]
      bigint_gt: BigInt
      bigint_lt: BigInt
      bigint_gte: BigInt
      bigint_lte: BigInt
      bigintArray: [BigInt]
      bigintArray_not: [BigInt]
      bigintArray_has: BigInt
      bigintArray_not_has: BigInt
      enum: simpleEnum
      enum_not: simpleEnum
      enum_in: [simpleEnum]
      enum_not_in: [simpleEnum]
      enumArray: [simpleEnum]
      enumArray_not: [simpleEnum]
      enumArray_has: simpleEnum
      enumArray_not_has: simpleEnum
    }"
  `);
});

test("filter universal", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.bigint().primaryKey(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(`{ persons(where: { id: "1" }) { items { id } } }`),
    await query(`{ persons(where: { id_not: "1" }) { items { id } } }`),
  ];

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          1n,
          51,
        ],
        "sql": "select "id" from "person" where "person"."id" = $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          1n,
          51,
        ],
        "sql": "select "id" from "person" where "person"."id" <> $1 order by "person"."id" asc limit $2",
      },
    ]
  `);
});

test("filter null equality", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.bigint().primaryKey(),
    nullable: t.text(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(`{ persons(where: { nullable: null }) { items { id } } }`),
    await query(`{ persons(where: { nullable_not: null }) { items { id } } }`),
  ];

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          51,
        ],
        "sql": "select "id", "nullable" from "person" where "person"."nullable" is null order by "person"."id" asc limit $1",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "nullable" from "person" where "person"."nullable" is not null order by "person"."id" asc limit $1",
      },
    ]
  `);
});

test("filter singular", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.hex().primaryKey(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(
      `{ persons(where: { id_in: ["0x01", "0x02"] }) { items { id } } }`,
    ),
    await query(
      `{ persons(where: { id_not_in: ["0x01", "0x02"] }) { items { id } } }`,
    ),
  ];

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "0x01",
          "0x02",
          51,
        ],
        "sql": "select "id" from "person" where "person"."id" in ($1, $2) order by "person"."id" asc limit $3",
      },
      {
        "params": [
          "0x01",
          "0x02",
          51,
        ],
        "sql": "select "id" from "person" where "person"."id" not in ($1, $2) order by "person"."id" asc limit $3",
      },
    ]
  `);
});

test("filter plural", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    number: t.integer().array().notNull(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(`{ persons(where: { number: [1, 2, 3] }) { items { id } } }`),
    await query(`{ persons(where: { number_not: [5] }) { items { id } } }`),
    await query(`{ persons(where: { number_has: 3 }) { items { id } } }`),
    await query(`{ persons(where: { number_not_has: 4 }) { items { id } } }`),
  ];

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "{1,2,3}",
          "{1,2,3}",
          51,
        ],
        "sql": "select "id", "number" from "person" where ("person"."number" @> $1 and "person"."number" <@ $2) order by "person"."id" asc limit $3",
      },
      {
        "params": [
          "{5}",
          "{5}",
          51,
        ],
        "sql": "select "id", "number" from "person" where not ("person"."number" @> $1 and "person"."number" <@ $2) order by "person"."id" asc limit $3",
      },
      {
        "params": [
          "{3}",
          51,
        ],
        "sql": "select "id", "number" from "person" where "person"."number" @> $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "{4}",
          51,
        ],
        "sql": "select "id", "number" from "person" where not "person"."number" @> $1 order by "person"."id" asc limit $2",
      },
    ]
  `);
});

test("filter string", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    text: t.text(),
    hex: t.hex(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [
    await query(
      `{ persons(where: { text_starts_with: "o" }) { items { id } } }`,
    ),
    await query(
      `{ persons(where: { text_starts_with_nocase: "O" }) { items { id } } }`,
    ),
    await query(
      `{ persons(where: { text_not_ends_with: "e" }) { items { id } } }`,
    ),
    await query(
      `{ persons(where: { text_not_ends_with_nocase: "E" }) { items { id } } }`,
    ),
    await query(`{ persons(where: { hex_contains: "c" }) { items { id } } }`),
  ];

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "o%",
          51,
        ],
        "sql": "select "id", "text", "hex" from "person" where "person"."text" like $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "O%",
          51,
        ],
        "sql": "select "id", "text", "hex" from "person" where "person"."text" ilike $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "%e",
          51,
        ],
        "sql": "select "id", "text", "hex" from "person" where "person"."text" not like $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "%E",
          51,
        ],
        "sql": "select "id", "text", "hex" from "person" where "person"."text" not ilike $1 order by "person"."id" asc limit $2",
      },
      {
        "params": [
          "%c%",
          51,
        ],
        "sql": "select "id", "text", "hex" from "person" where "person"."hex" like $1 order by "person"."id" asc limit $2",
      },
    ]
  `);
});

test("filter and/or", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const { query, queries } = createGraphQL({ pet });

  const result = await query(`
    {
      pets(where: { OR: [{ bigAge_gt: "50" }, { AND: [{ name: "Foo" }, { bigAge_lt: "20" }] }] }) {
        items { id }
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "pets": {
          "items": [],
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          50n,
          "Foo",
          20n,
          51,
        ],
        "sql": "select "id", "name", "big_age", "age" from "pet" where ("pet"."big_age" > $1 or ("pet"."name" = $2 and "pet"."big_age" < $3)) order by "pet"."id" asc limit $4",
      },
    ]
  `);
});

test("order by", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    integer: t.integer(),
    bigintBigint: t.int8({ mode: "bigint" }),
    float: t.doublePrecision(),
    bigint: t.bigint(),
    hex: t.hex(),
  }));
  const { query, queries } = createGraphQL({ person });

  const results = [];
  for (const column of ["integer", "bigintBigint", "float", "bigint", "hex"]) {
    results.push(
      await query(`
        { persons(orderBy: "${column}", orderDirection: "desc") { items { id } } }
      `),
    );
  }

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
      {
        "data": {
          "persons": {
            "items": [],
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          51,
        ],
        "sql": "select "id", "integer", "bigint_bigint", "float", "bigint", "hex" from "person" order by "person"."integer" desc, "person"."id" desc limit $1",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "integer", "bigint_bigint", "float", "bigint", "hex" from "person" order by "person"."bigint_bigint" desc, "person"."id" desc limit $1",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "integer", "bigint_bigint", "float", "bigint", "hex" from "person" order by "person"."float" desc, "person"."id" desc limit $1",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "integer", "bigint_bigint", "float", "bigint", "hex" from "person" order by "person"."bigint" desc, "person"."id" desc limit $1",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "integer", "bigint_bigint", "float", "bigint", "hex" from "person" order by "person"."hex" desc, "person"."id" desc limit $1",
      },
    ]
  `);
});

test("limit", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
  }));
  // Note: Returns as many of 100 rows as the `limit` parameter allows.
  const { query, queries } = createGraphQL({ person }, (_sql, params) =>
    Array.from({ length: Math.min(100, params.at(-1) as number) }, (_, i) => ({
      id: String(i),
    })),
  );

  const results = [
    await query("{ persons { items { id } pageInfo { hasNextPage } } }"),
    await query(
      "{ persons(limit: 75) { items { id } pageInfo { hasNextPage } } }",
    ),
    await query(
      "{ persons(limit: 1005) { items { id } pageInfo { hasNextPage } } }",
    ),
  ];

  expect(
    results.map((result) =>
      result.errors === undefined
        ? {
            items: (result.data as any).persons.items.length,
            pageInfo: pageInfo(result, "persons"),
          }
        : result,
    ),
  ).toMatchInlineSnapshot(`
    [
      {
        "items": 50,
        "pageInfo": {
          "hasNextPage": true,
        },
      },
      {
        "items": 75,
        "pageInfo": {
          "hasNextPage": true,
        },
      },
      {
        "data": null,
        "errors": [
          [GraphQLError: Invalid limit. Got 1005, expected <=1000.],
        ],
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          51,
        ],
        "sql": "select "id" from "person" order by "person"."id" asc limit $1",
      },
      {
        "params": [
          76,
        ],
        "sql": "select "id" from "person" order by "person"."id" asc limit $1",
      },
    ]
  `);
});

test("cursor pagination descending", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    bigAge: t.bigint(),
    age: t.integer(),
  }));
  const pets = {
    id1: { id: "id1", name: "Skip", bigAge: "105", age: null },
    id2: { id: "id2", name: "Foo", bigAge: "10", age: null },
    id3: { id: "id3", name: "Bar", bigAge: "190", age: null },
    id4: { id: "id4", name: "Zarbar", bigAge: null, age: null },
    id5: { id: "id5", name: "Winston", bigAge: null, age: 12 },
  };
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ pet }, (sql) =>
    sql.startsWith("select count") ? [{ count: 5 }] : next,
  );
  const page = `
    items { id name }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    totalCount
  `;

  next = [pets.id4, pets.id5, pets.id1];
  const result1 = await query(`
    { pets(orderBy: "name", orderDirection: "desc", limit: 2) { ${page} } }
  `);

  // Note: The database includes the `after` cursor row.
  next = [pets.id5, pets.id1, pets.id2, pets.id3];
  const result2 = await query(`
    {
      pets(orderBy: "name", orderDirection: "desc", after: "${pageInfo(result1, "pets").endCursor}") {
        ${page}
      }
    }
  `);

  // Note: The database includes the `before` cursor row, in reverse order.
  next = [pets.id1, pets.id5, pets.id4];
  const result3 = await query(`
    {
      pets(orderBy: "name", orderDirection: "desc", before: "${pageInfo(result2, "pets").startCursor}", limit: 1) {
        ${page}
      }
    }
  `);

  expect([result1, result2, result3]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id4",
                "name": "Zarbar",
              },
              {
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im5hbWUiOiJXaW5zdG9uIiwiaWQiOiJpZDUifX0=",
              "hasNextPage": true,
              "hasPreviousPage": false,
              "startCursor": "eyJqc29uIjp7Im5hbWUiOiJaYXJiYXIiLCJpZCI6ImlkNCJ9fQ==",
            },
            "totalCount": 5,
          },
        },
      },
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id1",
                "name": "Skip",
              },
              {
                "id": "id2",
                "name": "Foo",
              },
              {
                "id": "id3",
                "name": "Bar",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im5hbWUiOiJCYXIiLCJpZCI6ImlkMyJ9fQ==",
              "hasNextPage": false,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7Im5hbWUiOiJTa2lwIiwiaWQiOiJpZDEifX0=",
            },
            "totalCount": 5,
          },
        },
      },
      {
        "data": {
          "pets": {
            "items": [
              {
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im5hbWUiOiJXaW5zdG9uIiwiaWQiOiJpZDUifX0=",
              "hasNextPage": true,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7Im5hbWUiOiJXaW5zdG9uIiwiaWQiOiJpZDUifX0=",
            },
            "totalCount": 5,
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          3,
        ],
        "sql": "select "id", "name", "big_age", "age" from "pet" order by "pet"."name" desc, "pet"."id" desc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "Winston",
          "Winston",
          "id5",
          52,
        ],
        "sql": "select "id", "name", "big_age", "age" from "pet" where ("pet"."name" < $1 or ("pet"."name" = $2 and "pet"."id" <= $3)) order by "pet"."name" desc, "pet"."id" desc limit $4",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "Skip",
          "Skip",
          "id1",
          3,
        ],
        "sql": "select "id", "name", "big_age", "age" from "pet" where ("pet"."name" > $1 or ("pet"."name" = $2 and "pet"."id" >= $3)) order by "pet"."name" asc, "pet"."id" asc limit $4",
      },
    ]
  `);
});

test("cursor pagination start and end cursors", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const { query, queries } = createGraphQL({ pet }, (sql) =>
    sql.startsWith("select count")
      ? [{ count: 5 }]
      : [
          { id: "id3", name: "Bar" },
          { id: "id2", name: "Foo" },
          { id: "id1", name: "Skip" },
          { id: "id5", name: "Winston" },
          { id: "id4", name: "Zarbar" },
        ],
  );

  // Should return start and end cursors when returning full result
  const result = await query(`
    {
      pets(orderBy: "name", orderDirection: "asc") {
        items { id name }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        totalCount
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "pets": {
          "items": [
            {
              "id": "id3",
              "name": "Bar",
            },
            {
              "id": "id2",
              "name": "Foo",
            },
            {
              "id": "id1",
              "name": "Skip",
            },
            {
              "id": "id5",
              "name": "Winston",
            },
            {
              "id": "id4",
              "name": "Zarbar",
            },
          ],
          "pageInfo": {
            "endCursor": "eyJqc29uIjp7Im5hbWUiOiJaYXJiYXIiLCJpZCI6ImlkNCJ9fQ==",
            "hasNextPage": false,
            "hasPreviousPage": false,
            "startCursor": "eyJqc29uIjp7Im5hbWUiOiJCYXIiLCJpZCI6ImlkMyJ9fQ==",
          },
          "totalCount": 5,
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "name" from "pet" order by "pet"."name" asc, "pet"."id" asc limit $1",
      },
    ]
  `);
});

test("cursor pagination has previous page", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ pet }, (sql) =>
    sql.startsWith("select count") ? [{ count: 5 }] : next,
  );
  const page = `
    items { id name }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    totalCount
  `;

  next = [
    { id: "id3", name: "Bar" },
    { id: "id2", name: "Foo" },
    { id: "id1", name: "Skip" },
    { id: "id5", name: "Winston" },
    { id: "id4", name: "Zarbar" },
  ];
  const result1 = await query(`
    { pets(orderBy: "name", orderDirection: "asc") { ${page} } }
  `);

  // Note: The database only returns the `after` cursor row.
  next = [{ id: "id4", name: "Zarbar" }];
  const result2 = await query(`
    {
      pets(orderBy: "name", orderDirection: "asc", after: "${pageInfo(result1, "pets").endCursor}") {
        ${page}
      }
    }
  `);

  // Should return `hasPreviousPage: true` even if the current page is empty
  expect(result2).toMatchInlineSnapshot(`
    {
      "data": {
        "pets": {
          "items": [],
          "pageInfo": {
            "endCursor": null,
            "hasNextPage": false,
            "hasPreviousPage": true,
            "startCursor": null,
          },
          "totalCount": 5,
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          51,
        ],
        "sql": "select "id", "name" from "pet" order by "pet"."name" asc, "pet"."id" asc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "Zarbar",
          "Zarbar",
          "id4",
          52,
        ],
        "sql": "select "id", "name" from "pet" where ("pet"."name" > $1 or ("pet"."name" = $2 and "pet"."id" >= $3)) order by "pet"."name" asc, "pet"."id" asc limit $4",
      },
    ]
  `);
});

test("cursor pagination composite primary key", async () => {
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
  // Note: Sorted by `owner`, then by the primary key.
  const allowances = [
    { owner: "alice", spender: "bob", amount: "100" },
    { owner: "bill", spender: "bill", amount: "600" },
    { owner: "bill", spender: "jenny", amount: "700" },
    { owner: "bob", spender: "alice", amount: "400" },
    { owner: "bob", spender: "bill", amount: "500" },
    { owner: "jenny", spender: "bill", amount: "800" },
  ];
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ allowance }, (sql) =>
    sql.startsWith("select count") ? [{ count: 6 }] : next,
  );
  const page = `
    items { owner spender amount }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    totalCount
  `;

  next = allowances.slice(0, 5);
  const result1 = await query(`
    { allowances(orderBy: "owner", orderDirection: "asc", limit: 4) { ${page} } }
  `);

  // Note: The database includes the `after` cursor row.
  next = allowances.slice(3);
  const result2 = await query(`
    {
      allowances(orderBy: "owner", orderDirection: "asc", after: "${pageInfo(result1, "allowances").endCursor}") {
        ${page}
      }
    }
  `);

  // Note: The database includes the `before` cursor row, in reverse order.
  next = allowances.slice(1, 5).reverse();
  const result3 = await query(`
    {
      allowances(orderBy: "owner", orderDirection: "asc", before: "${pageInfo(result2, "allowances").startCursor}", limit: 2) {
        ${page}
      }
    }
  `);

  expect([result1, result2, result3]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "allowances": {
            "items": [
              {
                "amount": "100",
                "owner": "alice",
                "spender": "bob",
              },
              {
                "amount": "600",
                "owner": "bill",
                "spender": "bill",
              },
              {
                "amount": "700",
                "owner": "bill",
                "spender": "jenny",
              },
              {
                "amount": "400",
                "owner": "bob",
                "spender": "alice",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im93bmVyIjoiYm9iIiwic3BlbmRlciI6ImFsaWNlIn19",
              "hasNextPage": true,
              "hasPreviousPage": false,
              "startCursor": "eyJqc29uIjp7Im93bmVyIjoiYWxpY2UiLCJzcGVuZGVyIjoiYm9iIn19",
            },
            "totalCount": 6,
          },
        },
      },
      {
        "data": {
          "allowances": {
            "items": [
              {
                "amount": "500",
                "owner": "bob",
                "spender": "bill",
              },
              {
                "amount": "800",
                "owner": "jenny",
                "spender": "bill",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im93bmVyIjoiamVubnkiLCJzcGVuZGVyIjoiYmlsbCJ9fQ==",
              "hasNextPage": false,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7Im93bmVyIjoiYm9iIiwic3BlbmRlciI6ImJpbGwifX0=",
            },
            "totalCount": 6,
          },
        },
      },
      {
        "data": {
          "allowances": {
            "items": [
              {
                "amount": "700",
                "owner": "bill",
                "spender": "jenny",
              },
              {
                "amount": "400",
                "owner": "bob",
                "spender": "alice",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7Im93bmVyIjoiYm9iIiwic3BlbmRlciI6ImFsaWNlIn19",
              "hasNextPage": true,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7Im93bmVyIjoiYmlsbCIsInNwZW5kZXIiOiJqZW5ueSJ9fQ==",
            },
            "totalCount": 6,
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "allowance"",
      },
      {
        "params": [
          5,
        ],
        "sql": "select "owner", "speeeeender", "amount" from "allowance" order by "allowance"."owner" asc, "allowance"."speeeeender" asc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "allowance"",
      },
      {
        "params": [
          "bob",
          "bob",
          "alice",
          52,
        ],
        "sql": "select "owner", "speeeeender", "amount" from "allowance" where ("allowance"."owner" > $1 or ("allowance"."owner" = $2 and "allowance"."speeeeender" >= $3)) order by "allowance"."owner" asc, "allowance"."speeeeender" asc limit $4",
      },
      {
        "params": [],
        "sql": "select count(*) from "allowance"",
      },
      {
        "params": [
          "bob",
          "bob",
          "bill",
          4,
        ],
        "sql": "select "owner", "speeeeender", "amount" from "allowance" where ("allowance"."owner" < $1 or ("allowance"."owner" = $2 and "allowance"."speeeeender" <= $3)) order by "allowance"."owner" desc, "allowance"."speeeeender" desc limit $4",
      },
    ]
  `);
});

test("cursor pagination with date order", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
    createdAt: t.date({ mode: "date" }).notNull(),
  }));
  const pets = ["Skip", "Foo", "Bar", "Zarbar", "Winston", "Book", "Shea"]
    .concat(["Snack", "Last"])
    .map((name, i) => ({
      id: `id${i + 1}`,
      name,
      createdAt: `2021-01-0${i + 1}`,
    }));
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ pet }, (sql) =>
    sql.startsWith("select count") ? [{ count: 9 }] : next,
  );
  const page = `
    items { id name createdAt }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    totalCount
  `;

  next = pets.slice(0, 6);
  const result1 = await query(`
    { pets(orderBy: "createdAt", orderDirection: "asc", limit: 5) { ${page} } }
  `);

  // Note: The database includes the `after` cursor row.
  next = pets.slice(4);
  const result2 = await query(`
    {
      pets(orderBy: "createdAt", orderDirection: "asc", after: "${pageInfo(result1, "pets").endCursor}") {
        ${page}
      }
    }
  `);

  expect([result1, result2]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "pets": {
            "items": [
              {
                "createdAt": "1609459200000",
                "id": "id1",
                "name": "Skip",
              },
              {
                "createdAt": "1609545600000",
                "id": "id2",
                "name": "Foo",
              },
              {
                "createdAt": "1609632000000",
                "id": "id3",
                "name": "Bar",
              },
              {
                "createdAt": "1609718400000",
                "id": "id4",
                "name": "Zarbar",
              },
              {
                "createdAt": "1609804800000",
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7ImNyZWF0ZWRBdCI6IjIwMjEtMDEtMDVUMDA6MDA6MDAuMDAwWiIsImlkIjoiaWQ1In0sIm1ldGEiOnsidmFsdWVzIjp7ImNyZWF0ZWRBdCI6WyJEYXRlIl19fX0=",
              "hasNextPage": true,
              "hasPreviousPage": false,
              "startCursor": "eyJqc29uIjp7ImNyZWF0ZWRBdCI6IjIwMjEtMDEtMDFUMDA6MDA6MDAuMDAwWiIsImlkIjoiaWQxIn0sIm1ldGEiOnsidmFsdWVzIjp7ImNyZWF0ZWRBdCI6WyJEYXRlIl19fX0=",
            },
            "totalCount": 9,
          },
        },
      },
      {
        "data": {
          "pets": {
            "items": [
              {
                "createdAt": "1609891200000",
                "id": "id6",
                "name": "Book",
              },
              {
                "createdAt": "1609977600000",
                "id": "id7",
                "name": "Shea",
              },
              {
                "createdAt": "1610064000000",
                "id": "id8",
                "name": "Snack",
              },
              {
                "createdAt": "1610150400000",
                "id": "id9",
                "name": "Last",
              },
            ],
            "pageInfo": {
              "endCursor": "eyJqc29uIjp7ImNyZWF0ZWRBdCI6IjIwMjEtMDEtMDlUMDA6MDA6MDAuMDAwWiIsImlkIjoiaWQ5In0sIm1ldGEiOnsidmFsdWVzIjp7ImNyZWF0ZWRBdCI6WyJEYXRlIl19fX0=",
              "hasNextPage": false,
              "hasPreviousPage": true,
              "startCursor": "eyJqc29uIjp7ImNyZWF0ZWRBdCI6IjIwMjEtMDEtMDZUMDA6MDA6MDAuMDAwWiIsImlkIjoiaWQ2In0sIm1ldGEiOnsidmFsdWVzIjp7ImNyZWF0ZWRBdCI6WyJEYXRlIl19fX0=",
            },
            "totalCount": 9,
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          6,
        ],
        "sql": "select "id", "name", "created_at" from "pet" order by "pet"."created_at" asc, "pet"."id" asc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet"",
      },
      {
        "params": [
          "2021-01-05T00:00:00.000Z",
          "2021-01-05T00:00:00.000Z",
          "id5",
          52,
        ],
        "sql": "select "id", "name", "created_at" from "pet" where ("pet"."created_at" > $1 or ("pet"."created_at" = $2 and "pet"."id" >= $3)) order by "pet"."created_at" asc, "pet"."id" asc limit $4",
      },
    ]
  `);
});

test("column casing", async () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    userName: t.text("user_name"),
    camelCase: t.text(),
  }));
  const { graphqlSchema, query, queries } = createGraphQL({ table }, () => [
    { id: "0", userName: "0", camelCase: "0" },
  ]);

  expect(printTypes(graphqlSchema, "table")).toMatchInlineSnapshot(`
    "type table {
      id: String!
      userName: String
      camelCase: String
    }"
  `);

  const result = await query(`{ table(id: "0") { id userName camelCase } }`);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "table": {
          "camelCase": "0",
          "id": "0",
          "userName": "0",
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "0",
          1,
        ],
        "sql": "select "id", "user_name", "camel_case" from "table" "table" where "table"."id" = $1 limit $2",
      },
    ]
  `);
});

test("snake case table and column names with where clause", async () => {
  const deposited_token = onchainTable(
    "deposited_token",
    (t) => ({
      chain_id: t.bigint().notNull(),
      token_address: t.hex().notNull(),
      first_seen_at: t.bigint().notNull(),
      total_supply: t.bigint().notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.token_address, table.chain_id] }),
    }),
  );
  const { query, queries } = createGraphQL({ deposited_token }, () => [
    {
      chain_id: "1",
      token_address: "0x0000000000000000000000000000000000000000",
      first_seen_at: "0",
      total_supply: "0",
    },
  ]);

  const result = await query(`
    {
      deposited_token(token_address: "0x0000000000000000000000000000000000000000", chain_id: "1") {
        chain_id
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "deposited_token": {
          "chain_id": "1",
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "0x0000000000000000000000000000000000000000",
          1n,
          1,
        ],
        "sql": "select "chain_id", "token_address", "first_seen_at", "total_supply" from "deposited_token" "deposited_token" where ("deposited_token"."token_address" = $1 and "deposited_token"."chain_id" = $2) limit $3",
      },
    ]
  `);
});

test("singular with hex primary key uses case insensitive where", async () => {
  const CHECKSUM_ADDRESS = "0x67BD7c89B54Fa52826186A57363A9303DB3E7626";
  const LOWERCASE_ADDRESS = "0x67bd7c89b54fa52826186a57363a9303db3e7626";

  const account = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
  }));
  const { query, queries } = createGraphQL({ account }, () => [
    { address: LOWERCASE_ADDRESS },
  ]);

  const result = await query(`
    {
      account(address: "${CHECKSUM_ADDRESS}") { address }
      accounts(where: { address: "${CHECKSUM_ADDRESS}" }) { items { address } }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "account": {
          "address": "0x67bd7c89b54fa52826186a57363a9303db3e7626",
        },
        "accounts": {
          "items": [
            {
              "address": "0x67bd7c89b54fa52826186a57363a9303db3e7626",
            },
          ],
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [
          "0x67bd7c89b54fa52826186a57363a9303db3e7626",
          51,
        ],
        "sql": "select "address" from "account" where "account"."address" = $1 order by "account"."address" asc limit $2",
      },
      {
        "params": [
          "0x67bd7c89b54fa52826186a57363a9303db3e7626",
          1,
        ],
        "sql": "select "address" from "account" "account" where "account"."address" = $1 limit $2",
      },
    ]
  `);
});

test("view", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const petView = onchainView("pet_view").as((qb) => qb.select().from(pet));
  const { graphqlSchema, query, queries } = createGraphQL(
    { pet, petView },
    (sql) =>
      sql.startsWith("select count")
        ? [{ count: 9 }]
        : [
            { id: "id1", name: "Skip" },
            { id: "id2", name: "Foo" },
            { id: "id3", name: "Bar" },
            { id: "id4", name: "Zarbar" },
            { id: "id5", name: "Winston" },
          ],
  );

  expect(printTypes(graphqlSchema, "petView")).toMatchInlineSnapshot(`
    "type petView {
      id: String!
      name: String!
    }"
  `);

  const result = await query(`
    {
      petViews(orderBy: "id", orderDirection: "asc", limit: 5) {
        items { id name }
        totalCount
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "petViews": {
          "items": [
            {
              "id": "id1",
              "name": "Skip",
            },
            {
              "id": "id2",
              "name": "Foo",
            },
            {
              "id": "id3",
              "name": "Bar",
            },
            {
              "id": "id4",
              "name": "Zarbar",
            },
            {
              "id": "id5",
              "name": "Winston",
            },
          ],
          "totalCount": 9,
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet_view"",
      },
      {
        "params": [
          6,
        ],
        "sql": "select "id", "name" from "pet_view" order by "pet_view"."id" asc limit $1",
      },
    ]
  `);
});

test("view with alias", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const petView = onchainView("pet_view").as((qb) =>
    qb
      .select({ id: pet.id, name: pet.name, count: count().as("count") })
      .from(pet)
      .groupBy(pet.id),
  );
  const { graphqlSchema, query, queries } = createGraphQL(
    { pet, petView },
    (sql) =>
      sql.startsWith("select count")
        ? [{ count: 9 }]
        : [
            { id: "id1", name: "Skip", count: "1" },
            { id: "id2", name: "Foo", count: "1" },
            { id: "id3", name: "Bar", count: "1" },
            { id: "id4", name: "Zarbar", count: "1" },
            { id: "id5", name: "Winston", count: "1" },
          ],
  );

  expect(printTypes(graphqlSchema, "petView")).toMatchInlineSnapshot(`
    "type petView {
      id: String!
      name: String!
      count: JSON
    }"
  `);

  const result = await query(`
    {
      petViews(orderBy: "id", orderDirection: "asc", limit: 5) {
        items { id name count }
        totalCount
      }
    }
  `);

  expect(result).toMatchInlineSnapshot(`
    {
      "data": {
        "petViews": {
          "items": [
            {
              "count": 1,
              "id": "id1",
              "name": "Skip",
            },
            {
              "count": 1,
              "id": "id2",
              "name": "Foo",
            },
            {
              "count": 1,
              "id": "id3",
              "name": "Bar",
            },
            {
              "count": 1,
              "id": "id4",
              "name": "Zarbar",
            },
            {
              "count": 1,
              "id": "id5",
              "name": "Winston",
            },
          ],
          "totalCount": 9,
        },
      },
    }
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet_view"",
      },
      {
        "params": [
          6,
        ],
        "sql": "select "id", "name", "count" from "pet_view" order by "pet_view"."id" asc limit $1",
      },
    ]
  `);
});

test("view limit/offset pagination", async () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const petView = onchainView("pet_view").as((qb) => qb.select().from(pet));
  const pets = ["Skip", "Foo", "Bar", "Zarbar", "Winston", "Book", "Shea"]
    .concat(["Snack", "Last"])
    .map((name, i) => ({ id: `id${i + 1}`, name }));
  let next: Record<string, unknown>[] = [];
  const { query, queries } = createGraphQL({ pet, petView }, (sql) =>
    sql.startsWith("select count") ? [{ count: 9 }] : next,
  );
  const page = `
    items { id name }
    pageInfo { hasNextPage hasPreviousPage }
    totalCount
  `;

  next = pets.slice(0, 6);
  const result1 = await query(`
    { petViews(orderBy: "id", orderDirection: "asc", limit: 5) { ${page} } }
  `);
  next = pets.slice(5);
  const result2 = await query(`
    { petViews(orderBy: "id", orderDirection: "asc", offset: 5) { ${page} } }
  `);

  expect([result1, result2]).toMatchInlineSnapshot(`
    [
      {
        "data": {
          "petViews": {
            "items": [
              {
                "id": "id1",
                "name": "Skip",
              },
              {
                "id": "id2",
                "name": "Foo",
              },
              {
                "id": "id3",
                "name": "Bar",
              },
              {
                "id": "id4",
                "name": "Zarbar",
              },
              {
                "id": "id5",
                "name": "Winston",
              },
            ],
            "pageInfo": {
              "hasNextPage": true,
              "hasPreviousPage": false,
            },
            "totalCount": 9,
          },
        },
      },
      {
        "data": {
          "petViews": {
            "items": [
              {
                "id": "id6",
                "name": "Book",
              },
              {
                "id": "id7",
                "name": "Shea",
              },
              {
                "id": "id8",
                "name": "Snack",
              },
              {
                "id": "id9",
                "name": "Last",
              },
            ],
            "pageInfo": {
              "hasNextPage": false,
              "hasPreviousPage": true,
            },
            "totalCount": 9,
          },
        },
      },
    ]
  `);
  expect(queries).toMatchInlineSnapshot(`
    [
      {
        "params": [],
        "sql": "select count(*) from "pet_view"",
      },
      {
        "params": [
          6,
        ],
        "sql": "select "id", "name" from "pet_view" order by "pet_view"."id" asc limit $1",
      },
      {
        "params": [],
        "sql": "select count(*) from "pet_view"",
      },
      {
        "params": [
          51,
          5,
        ],
        "sql": "select "id", "name" from "pet_view" order by "pet_view"."id" asc limit $1 offset $2",
      },
    ]
  `);
});

// BUG: The singular field takes an enum primary key column as `String!`,
// though the column and its filter use the GraphQL enum type.
test.fails("enum primary key argument uses the enum type", () => {
  const testEnum = onchainEnum("enum", ["A", "B"]);
  const table = onchainTable(
    "table",
    (t) => ({
      a: t.text().notNull(),
      enum: testEnum("enum").notNull(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.a, table.enum] }),
    }),
  );
  const { graphqlSchema } = createGraphQL({ testEnum, table });

  const arg = graphqlSchema
    .getQueryType()!
    .getFields()
    .table!.args.find(({ name }) => name === "enum")!;
  expect(String(arg.type)).toBe("testEnum!");
});

// BUG: A view's `count()` column is exposed as `JSON`, though it is a number.
test.fails("view aggregate column is not typed JSON", () => {
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    name: t.text().notNull(),
  }));
  const petView = onchainView("pet_view").as((qb) =>
    qb
      .select({ id: pet.id, count: count().as("count") })
      .from(pet)
      .groupBy(pet.id),
  );
  const { graphqlSchema } = createGraphQL({ pet, petView });

  const field = (
    graphqlSchema.getType("petView") as GraphQLObjectType
  ).getFields().count!;
  expect(String(field.type)).not.toBe("JSON");
});

// BUG: The dataloader batches a null foreign key into the relation lookup.
test.fails("one relation with a null foreign key is not looked up", async () => {
  const person = onchainTable("person", (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
  }));
  const pet = onchainTable("pet", (t) => ({
    id: t.text().primaryKey(),
    ownerId: t.text().notNull(),
    ownerIdNullable: t.text(),
  }));
  const petRelations = relations(pet, ({ one }) => ({
    owner: one(person, { fields: [pet.ownerId], references: [person.id] }),
    ownerNullable: one(person, {
      fields: [pet.ownerIdNullable],
      references: [person.id],
    }),
  }));
  const { query, queries } = createGraphQL(
    { person, pet, petRelations },
    (sql) =>
      sql.includes('from "pet"')
        ? [{ id: "dog1", ownerId: "jake", ownerIdNullable: null }]
        : [{ id: "jake", name: "jake" }],
  );

  await query(`{ pet(id: "dog1") { owner { id } ownerNullable { id } } }`);

  expect(queries.map(({ sql }) => sql).join("\n")).not.toContain("is null");
});
