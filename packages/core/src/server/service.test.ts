import request from "supertest";
import { beforeEach, expect, test, vi } from "vitest";

import { setupIndexingStore } from "@/_test/setup.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import type { Common } from "@/Ponder.js";
import { createSchema } from "@/schema/schema.js";
import { range } from "@/utils/range.js";

import { buildGqlSchema } from "./graphql/schema.js";
import { ServerService } from "./service.js";

beforeEach((context) => setupIndexingStore(context));

const s = createSchema((p) => ({
  TestEnum: p.createEnum(["ZERO", "ONE", "TWO"]),
  TestEntity: p.createTable({
    id: p.string(),
    string: p.string(),
    int: p.int(),
    float: p.float(),
    boolean: p.boolean(),
    bytes: p.bytes(),
    bigInt: p.bigint(),
    stringList: p.string().list(),
    intList: p.int().list(),
    floatList: p.float().list(),
    booleanList: p.boolean().list(),
    bytesList: p.bytes().list(),
    enum: p.enum("TestEnum"),
    derived: p.many("EntityWithBigIntId.testEntityId"),
  }),
  EntityWithIntId: p.createTable({ id: p.int() }),

  EntityWithBigIntId: p.createTable({
    id: p.bigint(),
    testEntityId: p.string().references("TestEntity.id"),
    testEntity: p.one("testEntityId"),
  }),
}));

const graphqlSchema = buildGqlSchema(s);

const setup = async ({
  common,
  indexingStore,
  options = {
    hasCompletedHistoricalIndexing: true,
  },
}: {
  common: Common;
  indexingStore: IndexingStore;
  options?: {
    hasCompletedHistoricalIndexing?: boolean;
  };
}) => {
  await indexingStore.reload({ schema: s });

  const service = new ServerService({ common, indexingStore });
  await service.start();
  service.reloadGraphqlSchema({ graphqlSchema });

  if (options.hasCompletedHistoricalIndexing) {
    service.setIsHistoricalIndexingComplete();
  }

  const gql = async (query: string) =>
    request(service.app)
      .post("/graphql")
      .send({ query: `query { ${query} }` });

  const createTestEntity = async ({ id }: { id: number }) => {
    await indexingStore.create({
      tableName: "TestEntity",
      timestamp: 0,
      id: String(id),
      data: {
        string: String(id),
        int: id,
        float: id / Math.pow(10, 1),
        boolean: id % 2 === 0,
        bytes: String(id),
        bigInt: BigInt(id),
        stringList: [String(id)],
        intList: [id],
        floatList: [id / Math.pow(10, 1)],
        booleanList: [id % 2 === 0],
        bytesList: [String(id)],
        enum: ["ZERO", "ONE", "TWO"][id % 3],
      },
    });
  };

  const createEntityWithBigIntId = async ({
    id,
    testEntityId,
  }: {
    id: bigint;
    testEntityId: string;
  }) => {
    await indexingStore.create({
      tableName: "EntityWithBigIntId",
      timestamp: 0,
      id,
      data: {
        testEntityId,
      },
    });
  };

  const createEntityWithIntId = async ({ id }: { id: number }) => {
    await indexingStore.create({
      tableName: "EntityWithIntId",
      timestamp: 0,
      id,
    });
  };

  return {
    service,
    gql,
    createTestEntity,
    createEntityWithBigIntId,
    createEntityWithIntId,
  };
};

// Graphql routes.
test("serves all scalar types correctly", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      id
      string
      int
      float
      boolean
      bytes
      bigInt
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: true,
    bytes: "0",
    bigInt: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
    string: "1",
    int: 1,
    float: 0.1,
    boolean: false,
    bytes: "1",
    bigInt: "1",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "2",
    string: "2",
    int: 2,
    float: 0.2,
    boolean: true,
    bytes: "2",
    bigInt: "2",
  });

  await service.kill();
});

test("serves all scalar list types correctly", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      id
      stringList
      intList
      floatList
      booleanList
      bytesList
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    stringList: ["0"],
    intList: [0],
    floatList: [0],
    booleanList: [true],
    bytesList: ["0"],
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
    stringList: ["1"],
    intList: [1],
    floatList: [0.1],
    booleanList: [false],
    bytesList: ["1"],
  });
  expect(testEntitys[2]).toMatchObject({
    id: "2",
    stringList: ["2"],
    intList: [2],
    floatList: [0.2],
    booleanList: [true],
    bytesList: ["2"],
  });

  await service.kill();
});

test("serves enum types correctly", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      id
      enum
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    enum: "ZERO",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
    enum: "ONE",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "2",
    enum: "TWO",
  });

  await service.kill();
});

test("serves derived types correctly", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ common, indexingStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "0" });

  const response = await gql(`
    testEntitys {
      id
      derived {
        id
      }
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    derived: [{ id: "0" }, { id: "1" }],
  });

  await service.kill();
});

test("serves relationship types correctly", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ common, indexingStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  const response = await gql(`
    entityWithBigIntIds {
      id
      testEntity {
        id
        string
        int
        float
        boolean
        bytes
        bigInt
      }
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(1);
  expect(entityWithBigIntIds[0]).toMatchObject({
    id: "0",
    testEntity: {
      id: "0",
      string: "0",
      int: 0,
      float: 0,
      boolean: true,
      bytes: "0",
      bigInt: "0",
    },
  });

  await service.kill();
});

test("finds unique entity by bigint id", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createEntityWithBigIntId } = await setup({
    common,
    indexingStore,
  });

  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  const response = await gql(`
    entityWithBigIntId(id: "0") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntId } = response.body.data;

  expect(entityWithBigIntId).toBeDefined();

  await service.kill();
});

test("finds unique entity with id: 0", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createEntityWithIntId } = await setup({
    common,
    indexingStore,
  });

  await createEntityWithIntId({ id: 0 });

  const response = await gql(`
    entityWithIntId(id: 0) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithIntId } = response.body.data;

  expect(entityWithIntId).toBeTruthy();

  await service.kill();
});

test("filters on string field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string: "123" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "123" });

  await service.kill();
});

test("filters on string field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_in: ["123", "125"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "123" });
  expect(testEntitys[1]).toMatchObject({ id: "125" });

  await service.kill();
});

test("filters on string field contains", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_contains: "5" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "125" });

  await service.kill();
});

test("filters on string field starts with", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_starts_with: "12" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "123" });
  expect(testEntitys[1]).toMatchObject({ id: "125" });

  await service.kill();
});

test("filters on string field not ends with", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_not_ends_with: "5" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "123" });
  expect(testEntitys[1]).toMatchObject({ id: "130" });

  await service.kill();
});

test("filters on integer field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int: 0 }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "0" });

  await service.kill();
});

test("filters on integer field greater than", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_gt: 1 }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on integer field less than or equal to", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_lte: 1 }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on integer field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_in: [0, 2] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on float field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float: 0.1 }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });

  await service.kill();
});

test("filters on float field greater than", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_gt: 0.1 }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on float field less than or equal to", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_lte: 0.1 }) {
      id
      int
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on float field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_in: [0, 0.2] }) {
      id
      int
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on bigInt field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt: "1" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });

  await service.kill();
});

test("filters on bigInt field greater than", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_gt: "1" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on bigInt field less than or equal to", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_lte: "1" }) {
      id
      int
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on bigInt field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_in: ["0", "2"] }) {
      id
      int
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on string list field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { stringList: ["1"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on string list field has", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { stringList_has: "2" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "2" });

  await service.kill();
});

test("filters on enum field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { enum: ONE }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on enum field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { enum_in: [ONE, ZERO] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(2);
  expect(testEntitys[0]).toMatchObject({ id: "0" });
  expect(testEntitys[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on relationship field equals", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ common, indexingStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId: "0" }) {
      id
      testEntity {
        id
      }
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(1);
  expect(entityWithBigIntIds[0]).toMatchObject({
    id: "0",
    testEntity: {
      id: "0",
    },
  });

  await service.kill();
});

test("filters on relationship field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ common, indexingStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId_in: ["0", "1"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(2);
  expect(entityWithBigIntIds[0]).toMatchObject({ id: "0" });
  expect(entityWithBigIntIds[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("filters on relationship field in", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ common, indexingStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId_in: ["0", "1"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(2);
  expect(entityWithBigIntIds[0]).toMatchObject({ id: "0" });
  expect(entityWithBigIntIds[1]).toMatchObject({ id: "1" });

  await service.kill();
});

test("orders by on int field ascending", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "int", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({ id: "1" });
  expect(testEntitys[1]).toMatchObject({ id: "12" });
  expect(testEntitys[2]).toMatchObject({ id: "123" });

  await service.kill();
});

test("orders by on int field descending", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "int", orderDirection: "desc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({ id: "123" });
  expect(testEntitys[1]).toMatchObject({ id: "12" });
  expect(testEntitys[2]).toMatchObject({ id: "1" });

  await service.kill();
});

test("orders by on bigInt field ascending including negative values", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: -12 });
  await createTestEntity({ id: -9999 });

  const response = await gql(`
    testEntitys(orderBy: "bigInt", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(4);
  expect(testEntitys[0]).toMatchObject({ id: "-9999" });
  expect(testEntitys[1]).toMatchObject({ id: "-12" });
  expect(testEntitys[2]).toMatchObject({ id: "1" });
  expect(testEntitys[3]).toMatchObject({ id: "123" });

  await service.kill();
});

test("orders by on bigInt field descending", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "bigInt", orderDirection: "desc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({ id: "123" });
  expect(testEntitys[1]).toMatchObject({ id: "12" });
  expect(testEntitys[2]).toMatchObject({ id: "1" });

  await service.kill();
});

test("limits to the first 100 by default", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(100);
  expect(testEntitys[0]).toMatchObject({ id: "0" });

  await service.kill();
});

test("limits as expected if less than 1000", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(first: 15, orderBy: "int", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(15);
  expect(testEntitys[0]).toMatchObject({ id: "0" });

  await service.kill();
});

test("throws if limit is greater than 1000", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(first: 1005) {
      id
    }
  `);

  expect(response.body.errors[0].message).toBe(
    "Invalid query. Cannot take more than 1000 rows. Received: 1005 rows.",
  );
  expect(response.statusCode).toBe(200);

  await service.kill();
});

test("skips as expected", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(skip: 20, orderBy: "int", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(85);
  expect(testEntitys[0]).toMatchObject({ id: "20" });

  await service.kill();
});

test("throws if skip is greater than 5000", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(skip: 5005) {
      id
    }
  `);

  expect(response.body.errors[0].message).toBe(
    "Invalid query. Cannot skip more than 5000 rows. Received: 5005 rows.",
  );
  expect(response.statusCode).toBe(200);

  await service.kill();
});

test("limits and skips together as expected", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(skip: 50, first: 10, orderBy: "int", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(10);
  expect(testEntitys[0]).toMatchObject({ id: "50" });
  expect(testEntitys[9]).toMatchObject({ id: "59" });

  await service.kill();
});

test("serves singular entity versioned at specified timestamp", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await indexingStore.update({
    tableName: "TestEntity",
    timestamp: 10,
    id: String(1),
    data: {
      string: "updated",
    },
  });

  const responseOld = await gql(`
    testEntity(id: "1", timestamp: 5) {
      id
      string
    }
  `);
  expect(responseOld.body.errors).toBe(undefined);
  expect(responseOld.statusCode).toBe(200);
  const testEntityOld = responseOld.body.data.testEntity;
  expect(testEntityOld.string).toBe("1");

  const response = await gql(`
    testEntity(id: "1", timestamp: 15) {
      id
      string
    }
  `);
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const testEntity = response.body.data.testEntity;
  expect(testEntity.string).toBe("updated");

  await service.kill();
});

test("serves plural entities versioned at specified timestamp", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
  });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  await indexingStore.update({
    tableName: "TestEntity",
    timestamp: 10,
    id: String(1),
    data: {
      string: "updated",
    },
  });
  await indexingStore.update({
    tableName: "TestEntity",
    timestamp: 15,
    id: String(2),
    data: {
      string: "updated",
    },
  });

  const responseOld = await gql(`
    testEntitys(timestamp: 12, orderBy: "int") {
      id
      string
    }
  `);
  expect(responseOld.body.errors).toBe(undefined);
  expect(responseOld.statusCode).toBe(200);
  const testEntitysOld = responseOld.body.data.testEntitys;
  expect(testEntitysOld).toMatchObject([
    { id: "1", string: "updated" },
    { id: "2", string: "2" },
  ]);

  const response = await gql(`
    testEntitys(orderBy: "int") {
      id
      string
    }
  `);
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const testEntitys = response.body.data.testEntitys;
  expect(testEntitys).toMatchObject([
    { id: "1", string: "updated" },
    { id: "2", string: "updated" },
  ]);

  await service.kill();
});

test("derived field respects skip argument", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({
      common,
      indexingStore,
    });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "0" });

  const response = await gql(`
    testEntitys {
      id
      derived(skip: 2) {
        id
      }
    }
  `);
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const testEntitys = response.body.data.testEntitys;
  expect(testEntitys[0].derived).toHaveLength(1);
  expect(testEntitys[0].derived[0]).toMatchObject({
    id: "2",
  });

  await service.kill();
});

test("responds with appropriate status code pre and post historical sync", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity } = await setup({
    common,
    indexingStore,
    options: {
      hasCompletedHistoricalIndexing: false,
    },
  });

  await createTestEntity({ id: 0 });

  let response = await gql(`
    testEntitys {
      id
    }
  `);

  expect(response.body.errors).toHaveLength(1);
  expect(response.body.errors[0]).toMatchObject({
    message: "Historical indexing is not complete",
  });
  expect(response.statusCode).toBe(503);

  // Set the historical sync flag to true
  service.setIsHistoricalIndexingComplete();

  response = await gql(`
    testEntitys {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const testEntitys = response.body.data.testEntitys;
  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });

  await service.kill();
});

// This is a known limitation for now, which is that the timestamp version of entities
// returned in derived fields does not inherit the timestamp argument provided to the parent.
// So, if you want to use time-travel queries with derived fields, you need to manually
// include the desired timestamp at every level of the query.
test.skip("serves derived entities versioned at provided timestamp", async (context) => {
  const { common, indexingStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({
      common,
      indexingStore,
    });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  await indexingStore.update({
    tableName: "EntityWithBigIntId",
    timestamp: 10,
    id: BigInt(0),
    data: {
      testEntity: "2",
    },
  });

  const responseOld = await gql(`
    testEntitys(timestamp: 5) {
      id
      derivedTestEntity {
        id
      }
    }
  `);
  expect(responseOld.body.errors).toBe(undefined);
  expect(responseOld.statusCode).toBe(200);
  const testEntitysOld = responseOld.body.data.testEntitys;
  expect(testEntitysOld).toHaveLength(1);
  expect(testEntitysOld[0]).toMatchObject({
    id: "0",
    derivedTestEntity: [{ id: "0" }],
  });

  const response = await gql(`
    testEntitys {
      id
      derivedTestEntity {
        id
      }
    }
  `);
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;
  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    derivedTestEntity: [],
  });

  await service.kill();
});

// Admin routes.
test("/admin/reload emits chainIds in reload event", async (context) => {
  const { common, indexingStore } = context;
  const { service } = await setup({
    common,
    indexingStore,
    options: {
      hasCompletedHistoricalIndexing: false,
    },
  });
  service.registerDevRoutes();

  const emitSpy = vi.spyOn(service, "emit");

  await request(service.app)
    .post("/admin/reload")
    .query({ chainId: "1" })
    .expect(200);

  expect(emitSpy).toHaveBeenCalledWith("admin:reload", {
    chainId: 1,
  });

  await service.kill();
});

test("/admin/reload fails with non-integer chain IDs", async (context) => {
  const { common, indexingStore } = context;
  const { service } = await setup({
    common,
    indexingStore,
    options: {
      hasCompletedHistoricalIndexing: false,
    },
  });
  service.registerDevRoutes();

  const emitSpy = vi.spyOn(service, "emit");

  await request(service.app)
    .post("/admin/reload")
    .query({ chainId: "badchainid" })
    .expect(400);

  expect(emitSpy).not.toHaveBeenCalled();

  await service.kill();
});

test("/admin/reload does not exist if dev routes aren't registered", async (context) => {
  const { common, indexingStore } = context;
  const { service } = await setup({
    common,
    indexingStore,
    options: {
      hasCompletedHistoricalIndexing: false,
    },
  });

  const emitSpy = vi.spyOn(service, "emit");

  await request(service.app)
    .post("/admin/reload")
    .query({ chainId: "badchainid" })
    .expect(404);

  expect(emitSpy).not.toHaveBeenCalled();

  await service.kill();
});
