import { buildSchema as buildGraphqlSchema } from "graphql";
import request from "supertest";
import { expect, test } from "vitest";

import { testResources } from "@/_test/utils";
import { schemaHeader } from "@/reload/graphql";
import { buildSchema } from "@/schema/schema";
import { UserStore } from "@/user-store/store";
import { range } from "@/utils/range";

import { buildGqlSchema } from "./graphql/buildGqlSchema";
import { ServerService } from "./service";

const userSchema = buildGraphqlSchema(`
  ${schemaHeader}

  type TestEntity @entity {
    id: String!
    string: String!
    int: Int!
    float: Float!
    boolean: Boolean!
    bytes: Bytes!
    bigInt: BigInt!
    stringList: [String!]!
    intList: [Int!]!
    floatList: [Float!]!
    booleanList: [Boolean!]!
    bytesList: [Bytes!]!
    # Basic lists of bigints are not supported yet.
    # bigIntList: [BigInt!]!
    enum: TestEnum!
    derived: [EntityWithBigIntId!]! @derivedFrom(field: "testEntity")
  }

  enum TestEnum {
    ZERO
    ONE
    TWO
  }

  type EntityWithBigIntId @entity {
    id: BigInt!
    testEntity: TestEntity!
  }
`);
const schema = buildSchema(userSchema);
const graphqlSchema = buildGqlSchema(schema);

const setup = async ({ userStore }: { userStore: UserStore }) => {
  await userStore.reload({ schema });

  const service = new ServerService({ resources: testResources, userStore });
  await service.start();
  service.reload({ graphqlSchema });

  const gql = async (query: string) =>
    request(service.app)
      .post("/")
      .send({ query: `query { ${query} }` });

  const createTestEntity = async ({ id }: { id: number }) => {
    await userStore.create({
      modelName: "TestEntity",
      timestamp: id,
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
    await userStore.create({
      modelName: "EntityWithBigIntId",
      timestamp: Number(id),
      id,
      data: {
        testEntity: testEntityId,
      },
    });
  };

  return { service, gql, createTestEntity, createEntityWithBigIntId };
};

test("serves the _meta object", async (context) => {
  const { userStore } = context;
  const { service, gql } = await setup({ userStore });

  const response = await gql(`
    _meta {
      entityStoreVersionId
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { _meta } = response.body.data;

  expect(_meta.entityStoreVersionId).toEqual(userStore.versionId);

  await service.teardown();
  await userStore.teardown();
});

test("serves all scalar types correctly", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("serves all scalar list types correctly", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("serves enum types correctly", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("serves derived types correctly", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ userStore });

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
    derived: [
      {
        id: "0",
      },
      {
        id: "1",
      },
    ],
  });

  await service.teardown();
  await userStore.teardown();
});

test("serves relationship types correctly", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("filters on string field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "125",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string field contains", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "125",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string field starts with", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "125",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string field not ends with", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "130",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on integer field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on integer field greater than", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on integer field less than or equal to", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on integer field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on float field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("filters on float field greater than", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on float field less than or equal to", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on float field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test.todo("filters on bigInt field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test.todo("filters on bigInt field greater than", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test.todo("filters on bigInt field less than or equal to", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test.todo("filters on bigInt field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string list field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on string list field contains", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(where: { stringList_contains: "2" }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(1);
  expect(testEntitys[0]).toMatchObject({
    id: "2",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on enum field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on enum field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "0",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on relationship field equals", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ userStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntity: "0" }) {
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

  await service.teardown();
  await userStore.teardown();
});

test("filters on relationship field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ userStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntity_in: ["0", "1"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(2);
  expect(entityWithBigIntIds[0]).toMatchObject({
    id: "0",
  });
  expect(entityWithBigIntIds[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("filters on relationship field in", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity, createEntityWithBigIntId } =
    await setup({ userStore });

  await createTestEntity({ id: 0 });
  await createEntityWithBigIntId({ id: BigInt(0), testEntityId: "0" });
  await createEntityWithBigIntId({ id: BigInt(1), testEntityId: "1" });
  await createEntityWithBigIntId({ id: BigInt(2), testEntityId: "2" });

  const response = await gql(`
    entityWithBigIntIds(where: { testEntity_in: ["0", "1"] }) {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { entityWithBigIntIds } = response.body.data;

  expect(entityWithBigIntIds).toHaveLength(2);
  expect(entityWithBigIntIds[0]).toMatchObject({
    id: "0",
  });
  expect(entityWithBigIntIds[1]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("orders by on int field ascending", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "12",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "123",
  });

  await service.teardown();
  await userStore.teardown();
});

test("orders by on int field descending", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "12",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("orders by on bigInt field ascending", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 123 });
  await createTestEntity({ id: 12 });

  const response = await gql(`
    testEntitys(orderBy: "bigInt", orderDirection: "asc") {
      id
    }
  `);

  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  const { testEntitys } = response.body.data;

  expect(testEntitys).toHaveLength(3);
  expect(testEntitys[0]).toMatchObject({
    id: "1",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "12",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "123",
  });

  await service.teardown();
  await userStore.teardown();
});

test("orders by on bigInt field descending", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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
  expect(testEntitys[0]).toMatchObject({
    id: "123",
  });
  expect(testEntitys[1]).toMatchObject({
    id: "12",
  });
  expect(testEntitys[2]).toMatchObject({
    id: "1",
  });

  await service.teardown();
  await userStore.teardown();
});

test("limits to the first 100 by default", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("limits as expected if less than 1000", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("throws if limit is greater than 1000", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

  await createTestEntity({ id: 0 });
  await createTestEntity({ id: 1 });
  await createTestEntity({ id: 2 });

  const response = await gql(`
    testEntitys(first: 1005) {
      id
    }
  `);

  expect(response.body.errors[0].message).toBe(
    "Cannot query more than 1000 rows."
  );
  expect(response.statusCode).toBe(500);

  await service.teardown();
  await userStore.teardown();
});

test("skips as expected", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});

test("throws if skip is greater than 5000", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

  await Promise.all(range(0, 105).map((n) => createTestEntity({ id: n })));

  const response = await gql(`
    testEntitys(skip: 5005) {
      id
    }
  `);

  expect(response.body.errors[0].message).toBe(
    "Cannot skip more than 5000 rows."
  );
  expect(response.statusCode).toBe(500);

  await service.teardown();
  await userStore.teardown();
});

test("limits and skips together as expected", async (context) => {
  const { userStore } = context;
  const { service, gql, createTestEntity } = await setup({ userStore });

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

  await service.teardown();
  await userStore.teardown();
});
