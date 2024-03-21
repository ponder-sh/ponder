import { setupDatabaseServices, setupIsolatedDatabase } from "@/_test/setup.js";
import { getFreePort, getTableIds, postGraphql } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import { buildGqlSchema } from "./graphql/schema.js";
import { ServerService } from "./service.js";

beforeEach((context) => setupIsolatedDatabase(context));

const schema = createSchema((p) => ({
  TestEnum: p.createEnum(["ZERO", "ONE", "TWO"]),
  TestEntity: p.createTable({
    id: p.string(),
    string: p.string(),
    int: p.int(),
    float: p.float(),
    boolean: p.boolean(),
    hex: p.hex(),
    bigInt: p.bigint(),
    stringList: p.string().list(),
    intList: p.int().list(),
    floatList: p.float().list(),
    booleanList: p.boolean().list(),
    hexList: p.hex().list(),
    optional: p.string().optional(),
    optionalList: p.string().list().optional(),
    enum: p.enum("TestEnum"),
    derived: p.many("EntityWithStringId.testEntityId"),
  }),
  EntityWithIntId: p.createTable({ id: p.int() }),

  EntityWithBigIntId: p.createTable({
    id: p.bigint(),
    testEntityId: p.string().references("TestEntity.id"),
    testEntity: p.one("testEntityId"),
  }),
  EntityWithStringId: p.createTable({
    id: p.string(),
    testEntityId: p.string().references("TestEntity.id"),
    testEntity: p.one("testEntityId"),
  }),
  EntityWithNullRef: p.createTable({
    id: p.string(),
    testEntityId: p.string().references("TestEntity.id").optional(),
    testEntity: p.one("testEntityId"),
  }),
}));

const graphqlSchema = buildGqlSchema(schema);

export const setup = async ({
  context,
}: {
  context: TestContext;
}) => {
  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  const port = await getFreePort();

  const common = {
    ...context.common,
    options: { ...context.common.options, port },
  };

  const service = new ServerService({
    common,
    indexingStore,
  });
  service.setup();
  await service.start();
  service.reloadGraphqlSchema({ graphqlSchema });

  const gql = async (query: string) => postGraphql(port, query);

  const createTestEntity = async ({ id }: { id: number }) => {
    await indexingStore.create({
      tableName: "TestEntity",
      checkpoint: zeroCheckpoint,
      id: String(id),
      data: {
        string: id.toString(),
        int: id,
        float: id / 10 ** 1,
        boolean: id % 2 === 0,
        hex: `0x${Math.abs(id).toString(16)}`,
        bigInt: BigInt(id),
        stringList: [id.toString()],
        intList: [id],
        floatList: [id / 10 ** 1],
        booleanList: [id % 2 === 0],
        hexList: [`0x${Math.abs(id).toString(16)}`],
        enum: ["ZERO", "ONE", "TWO"][id % 3],
      },
    });
  };

  const createEntityWithBigIntId = async ({
    id,
    testEntityId,
  }: { id: bigint; testEntityId: string }) => {
    await indexingStore.create({
      tableName: "EntityWithBigIntId",
      checkpoint: zeroCheckpoint,
      id,
      data: {
        testEntityId,
      },
    });
  };

  const createEntityWithIntId = async ({ id }: { id: number }) => {
    await indexingStore.create({
      tableName: "EntityWithIntId",
      checkpoint: zeroCheckpoint,
      id,
    });
  };

  const createEntityWithStringId = async ({
    id,
    testEntityId,
  }: {
    id: string;
    testEntityId: string;
  }) => {
    await indexingStore.create({
      tableName: "EntityWithStringId",
      checkpoint: zeroCheckpoint,
      id,
      data: {
        testEntityId,
      },
    });
  };

  const createEntityWithNullRef = async ({ id }: { id: string }) => {
    await indexingStore.create({
      tableName: "EntityWithNullRef",
      checkpoint: zeroCheckpoint,
      id,
    });
  };

  return {
    service,
    cleanup,
    gql,
    indexingStore,
    createTestEntity,
    createEntityWithBigIntId,
    createEntityWithStringId,
    createEntityWithIntId,
    createEntityWithNullRef,
  };
};

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

test("serves all scalar types correctly", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      items {
        id
        string
        int
        float
        boolean
        hex
        bigInt
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({
    id: "0",
    string: "0",
    int: 0,
    float: 0,
    boolean: true,
    hex: "0x00",
    bigInt: "0",
  });
  expect(testEntitys.items[1]).toMatchObject({
    id: "1",
    string: "1",
    int: 1,
    float: 0.1,
    boolean: false,
    hex: "0x01",
    bigInt: "1",
  });
  expect(testEntitys.items[2]).toMatchObject({
    id: "2",
    string: "2",
    int: 2,
    float: 0.2,
    boolean: true,
    hex: "0x02",
    bigInt: "2",
  });

  await service.kill();
  await cleanup();
});

test("serves all scalar list types correctly", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      items {
        id
        stringList
        intList
        floatList
        booleanList
        hexList
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({
    id: "0",
    stringList: ["0"],
    intList: [0],
    floatList: [0],
    booleanList: [true],
    hexList: ["0x0"],
  });
  expect(testEntitys.items[1]).toMatchObject({
    id: "1",
    stringList: ["1"],
    intList: [1],
    floatList: [0.1],
    booleanList: [false],
    hexList: ["0x1"],
  });
  expect(testEntitys.items[2]).toMatchObject({
    id: "2",
    stringList: ["2"],
    intList: [2],
    floatList: [0.2],
    booleanList: [true],
    hexList: ["0x2"],
  });

  await service.kill();
  await cleanup();
});

test("serves all optional types correctly", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });

  const response = await gql(`
    testEntitys {
      items {
        optional
        optionalList
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    optional: null,
    optionalList: null,
  });

  await service.kill();
  await cleanup();
});

test("serves enum types correctly", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys {
      items {
        id
        enum
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({
    id: "0",
    enum: "ZERO",
  });
  expect(testEntitys.items[1]).toMatchObject({
    id: "1",
    enum: "ONE",
  });
  expect(testEntitys.items[2]).toMatchObject({
    id: "2",
    enum: "TWO",
  });

  await service.kill();
  await cleanup();
});

test("serves many column types correctly", async (context) => {
  const { service, cleanup, gql, createTestEntity, createEntityWithStringId } =
    await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithStringId({ id: "0", testEntityId: "0" });
  await createEntityWithStringId({ id: "1", testEntityId: "0" });

  const response = await gql(`
    testEntitys {
      items {
        id
        derived {
          items {
            id
          }
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    id: "0",
    derived: { items: [{ id: "0" }, { id: "1" }] },
  });

  await service.kill();
  await cleanup();
});

test("serves one column types correctly", async (context) => {
  const {
    service,
    cleanup,
    gql,
    createTestEntity,
    createEntityWithBigIntId,
    createEntityWithNullRef,
  } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  await createEntityWithNullRef({ id: "0" });

  const response = await gql(`
    entityWithBigIntIds {
      items {
        id
        testEntity {
          id
          string
          int
          float
          boolean
          hex
          bigInt
        }
      }
    }
    entityWithNullRefs {
      items {
        id
        testEntityId
        testEntity {
          id
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntIds, entityWithNullRefs } = body.data;

  expect(entityWithBigIntIds.items).toHaveLength(1);
  expect(entityWithBigIntIds.items[0]).toMatchObject({
    id: "0",
    testEntity: {
      id: "0",
      string: "0",
      int: 0,
      float: 0,
      boolean: true,
      hex: "0x00",
      bigInt: "0",
    },
  });

  expect(entityWithNullRefs.items).toHaveLength(1);
  expect(entityWithNullRefs.items[0]).toMatchObject({
    id: "0",
    testEntityId: null,
    testEntity: null,
  });

  await service.kill();
  await cleanup();
});

test("finds unique entity by bigint id", async (context) => {
  const { service, cleanup, gql, createEntityWithBigIntId } = await setup({
    context,
  });
  service.setIsHealthy(true);

  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  const response = await gql(`
    entityWithBigIntId(id: "0") {
      id
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntId } = body.data;

  expect(entityWithBigIntId).toBeDefined();

  await service.kill();
  await cleanup();
});

test("finds unique entity with id: 0", async (context) => {
  const { service, cleanup, gql, createEntityWithIntId } = await setup({
    context,
  });
  service.setIsHealthy(true);

  await createEntityWithIntId({ id: 0 });

  const response = await gql(`
    entityWithIntId(id: 0) {
      id
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithIntId } = body.data;

  expect(entityWithIntId).toBeTruthy();

  await service.kill();
  await cleanup();
});

test("filters on string field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string: "123" }) {
        items {
          id
        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });

  await service.kill();
  await cleanup();
});

test("filters on string field in", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_in: ["123", "125"] }) {
        items {
          id
        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });
  expect(testEntitys.items[1]).toMatchObject({ id: "125" });

  await service.kill();
  await cleanup();
});

test("filters on string field contains", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_contains: "5" }) {
        items {

      id
        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "125" });

  await service.kill();
  await cleanup();
});

test("filters on string field starts with", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_starts_with: "12" }) {
        items {
      id

        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });
  expect(testEntitys.items[1]).toMatchObject({ id: "125" });

  await service.kill();
  await cleanup();
});

test("filters on string field not ends with", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 125 });
  await createTestEntity({ id: 130 });

  const response = await gql(`
    testEntitys(where: { string_not_ends_with: "5" }) {
        items {

      id
        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });
  expect(testEntitys.items[1]).toMatchObject({ id: "130" });

  await service.kill();
  await cleanup();
});

test("filters on integer field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int: 0 }) {
        items {

      id
        }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });

  await service.kill();
  await cleanup();
});

test("filters on integer field greater than", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_gt: 1 }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on integer field less than or equal to", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_lte: 1 }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on integer field in", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { int_in: [0, 2] }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on float field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float: 0.1 }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    id: "1",
  });

  await service.kill();
  await cleanup();
});

test("filters on float field greater than", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_gt: 0.1 }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on float field less than or equal to", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_lte: 0.1 }) {
      items {
        id
        int
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on float field in", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { float_in: [0, 0.2] }) {
      items {
        id
        int
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on bigInt field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt: "1" }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    id: "1",
  });

  await service.kill();
  await cleanup();
});

test("filters on bigInt field greater than", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_gt: "1" }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on hex field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { hex: "0x01" }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    id: "1",
  });

  await service.kill();
  await cleanup();
});

test("filters on hex field greater than", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { hex_gt: "0x01" }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on bigInt field less than or equal to", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_lte: "1" }) {
      items {
        id
        int
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on bigInt field in", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { bigInt_in: ["0", "2"] }) {
      items {
        id
        int
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on string list field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { stringList: ["1"] }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on string list field has", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { stringList_has: "2" }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "2" });

  await service.kill();
  await cleanup();
});

test("filters on enum field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { enum: ONE }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on enum field in", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { enum_in: [ONE, ZERO] }) {
      items {
          id

      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(2);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });
  expect(testEntitys.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on relationship field equals", async (context) => {
  const { service, cleanup, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId: "0" }) {
      items {
        id
        testEntity {
          id
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntIds } = body.data;

  expect(entityWithBigIntIds.items).toHaveLength(1);
  expect(entityWithBigIntIds.items[0]).toMatchObject({
    id: "0",
    testEntity: {
      id: "0",
    },
  });

  await service.kill();
  await cleanup();
});

test("filters on relationship field in", async (context) => {
  const { service, cleanup, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId_in: ["0", "1"] }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntIds } = body.data;

  expect(entityWithBigIntIds.items).toHaveLength(2);
  expect(entityWithBigIntIds.items[0]).toMatchObject({ id: "0" });
  expect(entityWithBigIntIds.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("filters on relationship field in", async (context) => {
  const { service, cleanup, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntityId_in: ["0", "1"] }) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntIds } = body.data;

  expect(entityWithBigIntIds.items).toHaveLength(2);
  expect(entityWithBigIntIds.items[0]).toMatchObject({ id: "0" });
  expect(entityWithBigIntIds.items[1]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("orders by on int field ascending", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "int", orderDirection: "asc") {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({ id: "1" });
  expect(testEntitys.items[1]).toMatchObject({ id: "12" });
  expect(testEntitys.items[2]).toMatchObject({ id: "123" });

  await service.kill();
  await cleanup();
});

test("orders by on int field descending", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "int", orderDirection: "desc") {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });
  expect(testEntitys.items[1]).toMatchObject({ id: "12" });
  expect(testEntitys.items[2]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("orders by on bigInt field ascending including negative values", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: -12 });
  await createTestEntity({ id: -9999 });

  const response = await gql(`
    testEntitys(orderBy: "bigInt", orderDirection: "asc") {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(4);
  expect(testEntitys.items[0]).toMatchObject({ id: "-9999" });
  expect(testEntitys.items[1]).toMatchObject({ id: "-12" });
  expect(testEntitys.items[2]).toMatchObject({ id: "1" });
  expect(testEntitys.items[3]).toMatchObject({ id: "123" });

  await service.kill();
  await cleanup();
});

test("orders by on bigInt field descending", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "bigInt", orderDirection: "desc") {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(3);
  expect(testEntitys.items[0]).toMatchObject({ id: "123" });
  expect(testEntitys.items[1]).toMatchObject({ id: "12" });
  expect(testEntitys.items[2]).toMatchObject({ id: "1" });

  await service.kill();
  await cleanup();
});

test("limits to the first 50 by default", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(50);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });

  await service.kill();
  await cleanup();
});

test("limits as expected if less than 1000", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(limit: 15, orderBy: "int", orderDirection: "asc") {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { testEntitys } = body.data;

  expect(testEntitys.items).toHaveLength(15);
  expect(testEntitys.items[0]).toMatchObject({ id: "0" });

  await service.kill();
  await cleanup();
});

test("throws if limit is greater than 1000", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(limit: 1005) {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;

  expect(body.errors[0].message).toBe(
    "Invalid limit. Got 1005, expected <=1000.",
  );

  await service.kill();
  await cleanup();
});

test("serves singular entity versioned at specified timestamp", async (context) => {
  const { service, cleanup, gql, indexingStore, createTestEntity } =
    await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 1 });
  await indexingStore.update({
    tableName: "TestEntity",
    checkpoint: createCheckpoint(10),
    id: String(1),
    data: {
      string: "updated",
    },
  });

  let response = await gql(`
    testEntity(id: "1", timestamp: 5) {
      id
      string
    }
  `);

  expect(response.status).toBe(200);
  let body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  let testEntity = body.data.testEntity;

  expect(testEntity.string).toBe("1");

  response = await gql(`
    testEntity(id: "1", timestamp: 15) {
      id
      string
    }
  `);
  expect(response.status).toBe(200);
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  testEntity = body.data.testEntity;
  expect(testEntity.string).toBe("updated");

  await service.kill();
  await cleanup();
});

test("responds with appropriate status code pre and post historical sync", async (context) => {
  const { service, cleanup, gql, createTestEntity } = await setup({ context });

  await createTestEntity({ id: 0 });

  let response = await gql(`
    testEntitys {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(503);
  let body = (await response.json()) as any;
  expect(body.errors).toHaveLength(1);
  expect(body.errors[0]).toMatchObject({
    message: "Historical indexing is not complete",
  });

  service.setIsHealthy(true);

  response = await gql(`
    testEntitys {
      items {
        id
      }
    }
  `);

  expect(response.status).toBe(200);
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);

  const testEntitys = body.data.testEntitys.items;
  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });

  await service.kill();
  await cleanup();
});

// This is a known limitation for now, which is that the timestamp version of entities
// returned in derived fields does not inherit the timestamp argument provided to the parent.
// So, if you want to use time-travel queries with derived fields, you need to manually
// include the desired timestamp at every level of the query.
test.skip("serves derived entities versioned at provided timestamp", async (context) => {
  const {
    service,
    cleanup,
    gql,
    indexingStore,
    createTestEntity,
    createEntityWithBigIntId,
  } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });

  await indexingStore.update({
    tableName: "EntityWithBigIntId",
    checkpoint: createCheckpoint(10),
    id: BigInt(0),
    data: {
      testEntity: "2",
    },
  });

  let response = await gql(`
    testEntitys(timestamp: 5) {
      items {
        id
        derivedTestEntity {
          id
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  let body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);

  let testEntitys = body.data.testEntitys.items;
  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "0",
    derivedTestEntity: [{ id: "0" }],
  });

  response = await gql(`
    testEntitys {
      items {
          id
          derivedTestEntity {
            id
          }
      }
    }
  `);

  expect(response.status).toBe(200);
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);

  testEntitys = body.data.testEntitys.items;
  expect(testEntitys.items).toHaveLength(1);
  expect(testEntitys.items[0]).toMatchObject({
    id: "0",
    derivedTestEntity: [],
  });

  await service.kill();
  await cleanup();
});

test("serves nested records at the timestamp/version specified at the top level", async (context) => {
  const {
    service,
    indexingStore,
    gql,
    createTestEntity,
    createEntityWithStringId,
    cleanup,
  } = await setup({ context });
  service.setIsHealthy(true);

  await createTestEntity({ id: 0 });
  await createEntityWithStringId({ id: "0", testEntityId: "0" });

  await indexingStore.update({
    tableName: "EntityWithStringId",
    checkpoint: createCheckpoint(10),
    id: "0",
    data: { testEntityId: "2" },
  });

  let response = await gql(`
    testEntitys(timestamp: 5) {
      items {
        id
        derived {
          items {
            id
          }
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  let body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);

  let testEntitys = body.data.testEntitys.items;
  expect(testEntitys).toMatchObject([
    { id: "0", derived: { items: [{ id: "0" }] } },
  ]);

  response = await gql(`
    testEntitys {
      items {
        id
        derived {
          items {
            id
          }
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);

  testEntitys = body.data.testEntitys.items;
  expect(testEntitys).toMatchObject([{ id: "0", derived: { items: [] } }]);

  await service.kill();
  await cleanup();
});

test("uses dataloader to resolve a plural -> p.one() path", async (context) => {
  const {
    service,
    gql,
    createTestEntity,
    createEntityWithBigIntId,
    indexingStore,
    cleanup,
  } = await setup({ context });
  service.setIsHealthy(true);

  const findUniqueSpy = vi.spyOn(indexingStore, "findUnique");
  const findManySpy = vi.spyOn(indexingStore, "findMany");

  await Promise.all(
    range(0, 50).map(async (n) => {
      await createTestEntity({ id: n });
      await createEntityWithBigIntId({
        id: BigInt(n),
        testEntityId: String(n),
      });
    }),
  );

  const response = await gql(`
    entityWithBigIntIds {
      items {
        id
        testEntity {
          id
          string
          int
          float
          boolean
          hex
          bigInt
        }
      }
    }
  `);

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  const { entityWithBigIntIds } = body.data;
  expect(entityWithBigIntIds.items).toHaveLength(50);

  expect(findUniqueSpy).toHaveBeenCalledTimes(0);
  expect(findManySpy).toHaveBeenCalledTimes(2);

  await service.kill();
  await cleanup();
});

test.skip.fails(
  "uses dataloader to resolve a plural -> p.many() path",
  async (context) => {
    const {
      service,
      indexingStore,
      gql,
      createTestEntity,
      createEntityWithStringId,
      cleanup,
    } = await setup({ context });
    service.setIsHealthy(true);

    const findUniqueSpy = vi.spyOn(indexingStore, "findUnique");
    const findManySpy = vi.spyOn(indexingStore, "findMany");

    await Promise.all(
      range(0, 50).map(async (n) => {
        await createTestEntity({ id: n });
        await createEntityWithStringId({
          id: String(n),
          testEntityId: String(n),
        });
      }),
    );

    const response = await gql(`
    entityWithBigIntIds {
      items {
        id
        testEntity {
          id
          derived {
            items {
              id
            }
          }
        }
      }
    }
  `);

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.errors).toBe(undefined);

    const { entityWithBigIntIds } = body.data;
    expect(entityWithBigIntIds.items).toHaveLength(50);

    // Fails because we haven't implemented the dataloader for this path yet.
    expect(findUniqueSpy).toHaveBeenCalledTimes(0);
    expect(findManySpy).toHaveBeenCalledTimes(2);

    await service.kill();
    await cleanup();
  },
);
