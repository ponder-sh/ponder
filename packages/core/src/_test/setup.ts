import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { createTelemetry } from "@/common/telemetry.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import { type Database, createDatabase } from "@/database/index.js";
import { createSchema } from "@/index.js";
import { getHistoricalStore } from "@/indexing-store/historical.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import type { IndexingStore, ReadonlyStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/common.js";
import { type SyncStore, createSyncStore } from "@/sync-store/index.js";
import type { BlockSource, ContractSource, LogFactory } from "@/sync/source.js";
import { createPglite } from "@/utils/pglite.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import { rimrafSync } from "rimraf";
import type { Address } from "viem";
import { type TestContext, afterAll } from "vitest";
import { deploy, simulate } from "./simulate.js";
import {
  getConfig,
  getNetworkAndSources,
  poolId,
  testClient,
} from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    databaseConfig: DatabaseConfig;
    sources: [
      ContractSource<"log", undefined>,
      ContractSource<"log", LogFactory>,
      ContractSource<"trace", LogFactory>,
      ContractSource<"trace", undefined>,
      BlockSource,
    ];
    networks: [Network];
    requestQueues: [RequestQueue];
    config: Config;
    erc20: { address: Address };
    factory: { address: Address; pair: Address };
  }
}

export function setupCommon(context: TestContext) {
  const cliOptions = {
    command: "start",
    config: "",
    root: "",
    logLevel: "silent",
    logFormat: "pretty",
  } as const;
  const options = { ...buildOptions({ cliOptions }), telemetryDisabled: true };
  const logger = createLogger({ level: cliOptions.logLevel });
  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  context.common = { options, logger, metrics, telemetry };

  return async () => {
    await telemetry.kill();
    await logger.kill();
  };
}

const pgliteDataDirs = new Map<number, string>();
afterAll(() => pgliteDataDirs.forEach((dataDir) => rimrafSync(dataDir)));

/**
 * Sets up an isolated database on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the database.
 * beforeEach(setupIsolatedDatabase)
 * ```
 */
export async function setupIsolatedDatabase(context: TestContext) {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString !== undefined) {
    const databaseName = `vitest_${poolId}`;

    const client = new pg.Client({ connectionString });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
    await client.end();

    const databaseUrl = new URL(connectionString);
    databaseUrl.pathname = `/${databaseName}`;
    const poolConfig = { max: 30, connectionString: databaseUrl.toString() };

    context.databaseConfig = { kind: "postgres", poolConfig, schema: "public" };
  } else {
    let dataDir = pgliteDataDirs.get(poolId);
    if (dataDir === undefined) {
      dataDir = path.join(os.tmpdir(), randomUUID());
      mkdirSync(dataDir, { recursive: true });
      pgliteDataDirs.set(poolId, dataDir);
    }

    const databaseName = `vitest_${poolId}`;

    const parent = createPglite({ dataDir });
    await parent.exec(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await parent.exec(`CREATE DATABASE "${databaseName}"`);
    await parent.close();

    const options = { dataDir, database: databaseName };

    context.databaseConfig = { kind: "pglite", options };
  }
}

type DatabaseServiceSetup = {
  buildId: string;
  schema: Schema;
  indexing: "realtime" | "historical";
};
const defaultDatabaseServiceSetup: DatabaseServiceSetup = {
  buildId: "test",
  schema: createSchema(() => ({})),
  indexing: "historical",
};

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<DatabaseServiceSetup> = {},
): Promise<{
  database: Database;
  syncStore: SyncStore;
  indexingStore: IndexingStore;
  readonlyStore: ReadonlyStore;
  cleanup: () => Promise<void>;
}> {
  const config = { ...defaultDatabaseServiceSetup, ...overrides };
  const database = await createDatabase({
    common: context.common,
    databaseConfig: context.databaseConfig,
    schema: config.schema,
  });

  await database.setup(config);

  await database.migrateSync().catch((err) => {
    console.log(err);
    throw err;
  });

  const syncStore = createSyncStore({
    common: context.common,
    db: database.qb.sync,
  });

  const readonlyStore = getReadonlyStore({
    schema: config.schema,
    db: database.qb.user,
    common: context.common,
  });

  const indexingStore =
    config.indexing === "historical"
      ? getHistoricalStore({
          schema: config.schema,
          readonlyStore,
          db: database.qb.user,
          common: context.common,
          isCacheExhaustive: true,
        })
      : {
          ...readonlyStore,
          ...getRealtimeStore({
            schema: config.schema,
            db: database.qb.user,
            common: context.common,
          }),
        };

  const cleanup = () => database.kill();

  return {
    database,
    readonlyStore,
    indexingStore,
    syncStore,
    cleanup,
  };
}

/**
 * Sets up an isolated Ethereum client on the test context, with the appropriate Erc20 + Factory state.
 *
 * ```ts
 * // Add this to any test suite that uses the Ethereum client.
 * beforeEach((context) => setupAnvil(context))
 * ```
 */
export async function setupAnvil(context: TestContext) {
  const emptySnapshotId = await testClient.snapshot();

  // Chain state setup shared across all tests.
  const addresses = await deploy();
  const pair = await simulate(addresses);
  await testClient.mine({ blocks: 1 });

  context.config = getConfig(addresses);

  const { networks, sources, requestQueues } = await getNetworkAndSources(
    addresses,
    context.common,
  );
  context.networks = networks as [Network];
  context.requestQueues = requestQueues as [RequestQueue];
  context.sources = sources as [
    ContractSource<"log", undefined>,
    ContractSource<"log", LogFactory>,
    ContractSource<"trace", LogFactory>,
    ContractSource<"trace", undefined>,
    BlockSource,
  ];
  context.erc20 = { address: addresses.erc20Address };
  context.factory = {
    address: addresses.factoryAddress,
    pair: pair.toLowerCase() as Address,
  };

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
