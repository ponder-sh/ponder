import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20 } from "@/_test/simulate.js";
import { getErc20ConfigAndIndexingFunctions } from "@/_test/utils.js";
import { getNetwork } from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { IndexingBuild, SchemaBuild } from "@/build/index.js";
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

const schema = { account };

test("run() setup", async (context) => {
  const network = getNetwork();

  const { address } = await deployErc20({ sender: ALICE });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const { statements } = buildSchema({
    schema,
  });

  const schemaBuild: SchemaBuild = {
    schema,
    statements,
  };

  const indexingBuild: IndexingBuild = {
    buildId: "buildId",
    networks: [network],
    sources,
    indexingFunctions,
  };

  const database = createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema,
      statements,
    },
  });

  const kill = await run({
    common: context.common,
    database,
    schemaBuild,
    indexingBuild,
    onFatalError: vi.fn(),
    onReloadableError: vi.fn(),
  });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledOnce();

  await kill();
  await database.unlock();
  await database.kill();
});

test("run() setup error", async (context) => {
  const network = getNetwork();

  const { address } = await deployErc20({ sender: ALICE });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };
  const onReloadableErrorPromiseResolver = promiseWithResolvers<void>();

  const { statements } = buildSchema({
    schema,
  });

  const schemaBuild: SchemaBuild = {
    schema,
    statements,
  };

  const indexingBuild: IndexingBuild = {
    buildId: "buildId",
    networks: [network],
    sources,
    indexingFunctions,
  };

  const database = createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema,
      statements,
    },
  });

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const kill = await run({
    common: context.common,
    database,
    schemaBuild,
    indexingBuild,
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
