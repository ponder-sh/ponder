import path from "node:path";
import { realtimeBlockEngine, sim } from "@/_test/simulation.js";
import { createBuild } from "@/build/index.js";
import { type Database, createDatabase } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import type { SyncBlock } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { mergeResults } from "@/utils/result.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { custom, hexToNumber } from "viem";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";
import { run } from "../utils/run.js";
import { runServer } from "../utils/runServer.js";

export type SimParams = {
  SEED: string;
  ERROR_RATE: number;
  ETH_GET_LOGS_RESPONSE_LIMIT: number;
  ETH_GET_LOGS_BLOCK_LIMIT: number;
  REALTIME_REORG_RATE: number;
  REALTIME_DEEP_REORG_RATE: number;
  REALTIME_FAST_FORWARD_RATE: number;
  REALTIME_DELAY_RATE: number;
  FINALIZED_RATE: number;
};

export async function debug({
  cliOptions,
  params,
  connectionString,
  onReady,
  onComplete,
}: {
  cliOptions: CliOptions;
  params: SimParams;
  connectionString?: string;
  onReady: () => void;
  onComplete: () => void;
}) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const [major, minor, _patch] = process.versions.node
    .split(".")
    .map(Number) as [number, number, number];
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });
    process.exit(1);
  }

  const configRelPath = path.relative(options.rootDir, options.configFile);
  logger.debug({
    service: "app",
    msg: `Started using config file: ${configRelPath}`,
  });

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };
  const exit = createExit({ common });

  if (options.version) {
    metrics.ponder_version_info.set(
      {
        version: options.version.version,
        major: options.version.major,
        minor: options.version.minor,
        patch: options.version.patch,
      },
      1,
    );
  }

  const build = await createBuild({ common, cliOptions });

  // biome-ignore lint/style/useConst: <explanation>
  let database: Database | undefined;

  const namespaceResult = build.namespaceCompile();
  if (namespaceResult.status === "error") {
    await exit({ reason: "Failed to initialize namespace", code: 1 });
    return;
  }

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const schemaResult = await build.executeSchema();
  if (schemaResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const buildResult1 = mergeResults([
    build.preCompile(configResult.result),
    build.compileSchema(schemaResult.result),
  ]);

  if (buildResult1.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const [preBuild, schemaBuild] = buildResult1.result;

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const indexingBuildResult = await build.compileIndexing({
    configResult: configResult.result,
    schemaResult: schemaResult.result,
    indexingResult: indexingResult.result,
  });

  if (indexingBuildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  database = await createDatabase({
    common,
    namespace: namespaceResult.result,
    preBuild,
    schemaBuild,
  });
  const crashRecoveryCheckpoint = await database.migrate(
    indexingBuildResult.result,
  );

  const apiResult = await build.executeApi({
    indexingBuild: indexingBuildResult.result,
    database,
  });
  if (apiResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const apiBuildResult = await build.compileApi({
    apiResult: apiResult.result,
  });

  if (apiBuildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "start",
      ...buildPayload({
        preBuild,
        schemaBuild,
        indexingBuild: indexingBuildResult.result,
      }),
    },
  });

  metrics.ponder_settings_info.set(
    {
      ordering: preBuild.ordering,
      database: preBuild.databaseConfig.kind,
      command: cliOptions.command,
    },
    1,
  );

  const chains: Parameters<typeof realtimeBlockEngine>[0] = new Map();
  for (let i = 0; i < indexingBuildResult.result.chains.length; i++) {
    const chain = indexingBuildResult.result.chains[i]!;
    const rpc = indexingBuildResult.result.rpcs[i]!;

    chain.rpc = sim(
      custom({
        async request(body) {
          return rpc.request(body);
        },
      }),
      params,
      connectionString,
    );

    indexingBuildResult.result.rpcs[i] = createRpc({
      common,
      chain,
      concurrency: Math.floor(
        common.options.rpcMaxConcurrency /
          indexingBuildResult.result.chains.length,
      ),
    });

    const start = Math.min(
      ...indexingBuildResult.result.sources.map(
        ({ filter }) => filter.fromBlock ?? 0,
      ),
    );

    const end = Math.max(
      ...indexingBuildResult.result.sources.map(
        ({ filter }) => filter.toBlock!,
      ),
    );

    indexingBuildResult.result.finalizedBlocks[i] = await _eth_getBlockByNumber(
      rpc,
      {
        blockNumber: start + Math.floor((end - start) * params.FINALIZED_RATE),
      },
    );

    chains.set(chain.id, {
      // @ts-ignore
      request: rpc.request,
      interval: [
        hexToNumber(indexingBuildResult.result.finalizedBlocks[i]!.number) + 1,
        end,
      ],
    });

    common.logger.warn({
      service: "sim",
      msg: `Mocking eip1193 transport for chain '${chain.name}'`,
    });
  }

  const getRealtimeBlockGenerator = await realtimeBlockEngine(
    chains,
    params,
    connectionString,
  );

  for (let i = 0; i < indexingBuildResult.result.chains.length; i++) {
    const chain = indexingBuildResult.result.chains[i]!;
    const rpc = indexingBuildResult.result.rpcs[i]!;

    rpc.subscribe = ({ onBlock }) => {
      (async () => {
        for await (const block of getRealtimeBlockGenerator(chain.id)) {
          await onBlock(block as SyncBlock);
        }
        common.logger.warn({
          service: "sim",
          msg: `Realtime block subscription for chain '${chain.name}' completed`,
        });
        onComplete();
      })();
    };

    common.logger.warn({
      service: "sim",
      msg: `Mocking realtime block subscription for chain '${chain.name}'`,
    });
  }

  run({
    common,
    database,
    preBuild,
    schemaBuild,
    indexingBuild: indexingBuildResult.result,
    crashRecoveryCheckpoint,
    onFatalError: () => {
      exit({ reason: "Received fatal error", code: 1 });
    },
    onReloadableError: () => {
      exit({ reason: "Encountered indexing error", code: 1 });
    },
    onReady,
    onComplete,
  });

  runServer({
    common,
    database,
    apiBuild: apiBuildResult.result,
  });

  return shutdown.kill;
}
