import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { IndexingBuild } from "@/build/index.js";
import { buildSchema } from "@/build/schema.js";
import { createDatabase } from "@/database/index.js";
import { onchainTable } from "@/drizzle/index.js";
import { promiseWithResolvers } from "@ponder/common";
import { beforeEach, expect, test, vi } from "vitest";
import { run } from "./run.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

// const graphqlSchema = buildGraphQLSchema({ schema: { account } });

test("run() setup", async (context) => {
  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const { statements, namespace } = buildSchema({
    schema: { account },
    instanceId: "1234",
  });

  const build: IndexingBuild = {
    buildId: "buildId",
    instanceId: "1234",
    schema: { account },
    databaseConfig: context.databaseConfig,
    networks: context.networks,
    sources: context.sources,
    indexingFunctions,
    statements,
    namespace,
  };

  const database = createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "buildId",
    statements,
    namespace,
  });

  const kill = await run({
    common: context.common,
    build,
    database,
    onFatalError: vi.fn(),
    onReloadableError: vi.fn(),
  });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledOnce();

  await kill();
  await database.unlock();
  await database.kill();
});

test("run() setup error", async (context) => {
  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };
  const onReloadableErrorPromiseResolver = promiseWithResolvers<void>();

  const { statements, namespace } = buildSchema({
    schema: { account },
    instanceId: "1234",
  });

  const build: IndexingBuild = {
    buildId: "buildId",
    instanceId: "1234",
    schema: { account },
    databaseConfig: context.databaseConfig,
    networks: context.networks,
    sources: context.sources,
    indexingFunctions,
    statements,
    namespace,
  };

  const database = createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "buildId",
    statements,
    namespace,
  });

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const kill = await run({
    common: context.common,
    build,
    database,
    onFatalError: vi.fn(),
    onReloadableError: () => {
      onReloadableErrorPromiseResolver.resolve();
    },
  });

  await onReloadableErrorPromiseResolver.promise;

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(1);

  await kill();
  await database.unlock();
  await database.kill();
});

test.todo("run() checkpoint");

test.todo("run() reorg ignored");

test.todo("run() reorg");

test.todo("run() finalize");

test.todo("run() error");

test.todo("run() healthy");
