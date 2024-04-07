import { setupAnvil, setupIsolatedDatabase } from "@/_test/setup.js";
import type { Build } from "@/build/service.js";
import { createSchema } from "@/schema/schema.js";
import { buildGqlSchema } from "@/server/graphql/schema.js";
import { beforeEach, test, vi } from "vitest";
import { run } from "./run.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

const schema = createSchema((p) => ({
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
  }),
  Supply: p.createTable({
    id: p.string(),
    supply: p.bigint(),
  }),
}));

const graphqlSchema = buildGqlSchema(schema);

test("run()", async (context) => {
  const build: Build = {
    buildId: "buildId",
    schema,
    graphqlSchema,
    databaseConfig: context.databaseConfig,
    networks: context.networks,
    sources: context.sources,
    indexingFunctions: {},
  };

  const cleanup = await run({
    common: context.common,
    build,
    onFatalError: vi.fn(),
    onReloadableError: vi.fn(),
  });

  await cleanup();
});
