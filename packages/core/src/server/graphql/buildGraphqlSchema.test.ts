import { setupDatabaseServices, setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { execute, parse } from "graphql";
import { beforeEach, expect, test } from "vitest";
import { buildGraphqlSchema } from "./buildGraphqlSchema.js";

beforeEach((context) => setupIsolatedDatabase(context));

test("build", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.bigint(),
    }),
  }));

  const { indexingStore, cleanup } = await setupDatabaseServices(context, {
    schema,
    tableIds: getTableIds(schema),
  });

  const graphqlSchema = buildGraphqlSchema(schema);

  const document = parse(`
  query {
    tables {
      id
    }
  }
  `);

  const result = await execute({
    schema: graphqlSchema,
    document,
    contextValue: { store: indexingStore },
  });

  expect(result.data).toMatchObject({ tables: {} });

  await cleanup();
});
