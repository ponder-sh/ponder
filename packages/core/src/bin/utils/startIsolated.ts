import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { getPonderMetaTable } from "@/database/index.js";
import { AggregatorMetricsService } from "@/internal/metrics.js";
import type { Chain } from "@/internal/types.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { wait } from "@/utils/wait.js";
import { isTable, sql } from "drizzle-orm";
import type { PonderApp } from "../commands/start.js";
import type { CliOptions } from "../ponder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function startIsolated(
  {
    common,
    namespaceBuild,
    schemaBuild,
    indexingBuild,
    crashRecoveryCheckpoint,
    database,
  }: PonderApp,
  cliOptions: CliOptions,
) {
  const appState: {
    [chainName: string]: {
      state: "historical" | "realtime" | "complete" | "degraded" | "failed";
      chain: Chain;
      worker: Worker;
    };
  } = {};

  const workerPath = join(__dirname, "..", "..", "runtime", "isolated.js");

  let isAllReady = false;
  const callback = async () => {
    if (
      isAllReady === false &&
      indexingBuild.chains.every(
        (chain) =>
          appState[chain.name]!.state !== "historical" &&
          appState[chain.name]!.state !== "degraded",
      )
    ) {
      isAllReady = true;
      await createIndexes(database.adminQB, {
        statements: schemaBuild.statements,
      });

      if (namespaceBuild.viewsSchema !== undefined) {
        const tables = Object.values(schemaBuild.schema).filter(isTable);
        await createViews(database.adminQB, {
          tables,
          namespaceBuild,
        });

        common.logger.info({
          service: "app",
          msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
        });
      }

      await database.adminQB.wrap({ label: "update_ready" }, (db) =>
        db
          .update(getPonderMetaTable(namespaceBuild.schema))
          .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
      );

      common.logger.info({
        service: "server",
        msg: "Started returning 200 responses from /ready endpoint",
      });
    }
  };

  indexingBuild.chains.map((chain) => {
    appState[chain.name] = {
      state: "historical",
      chain,
      worker: new Worker(workerPath, {
        workerData: {
          cliOptions,
          crashRecoveryCheckpoint,
          chainId: chain.id,
        },
      }),
    };
  });

  common.metrics = new AggregatorMetricsService(appState);
  common.metrics.addListeners();

  const RETRY_COUNT = 9;
  const BASE_DURATION = 10_000;

  Promise.allSettled(
    Object.keys(appState).map(async (chainName) => {
      const pwr = promiseWithResolvers<void>();
      let timeout: NodeJS.Timeout | undefined = undefined;

      for (let i = 0; i <= RETRY_COUNT; ++i) {
        const pwr2 = promiseWithResolvers<void>();
        appState[chainName]!.worker.on("message", (message) => {
          switch (message.type) {
            case "ready": {
              appState[chainName]!.state = "realtime";
              i = 0;
              clearTimeout(timeout);
              break;
            }
            case "complete": {
              appState[chainName]!.state = "complete";
              i = 0;
              clearTimeout(timeout);
              pwr2.resolve();
              pwr.resolve();
            }
          }

          callback();
        });

        appState[chainName]!.worker.on("exit", async (code) => {
          if (code === 75) {
            appState[chainName]!.state = "degraded";

            if (i === RETRY_COUNT) {
              common.logger.error({
                service: "rpc",
                msg: `Chain '${chainName}' exited with code ${code} after ${i + 1} conseccutive retries.`,
              });
              appState[chainName]!.state = "failed";
              pwr.reject(
                new Error(
                  `Chain '${chainName}' exited with code ${code} after ${i + 1} conseccutive retries.`,
                ),
              );
            } else {
              const duration = BASE_DURATION * 2 ** i;
              common.logger.warn({
                service: "rpc",
                msg: `Chain '${chainName}' exited with code ${code}, retrying after ${duration / 1_000} seconds.`,
              });
              await wait(duration);

              appState[chainName]!.worker = new Worker(workerPath, {
                workerData: {
                  cliOptions,
                  crashRecoveryCheckpoint,
                  chainId: appState[chainName]!.chain.id,
                },
              });

              timeout = setTimeout(() => {
                appState[chainName]!.state = "historical";
              }, 30_000);

              pwr2.resolve();
            }
          } else {
            appState[chainName]!.state = "failed";
            pwr.reject(
              new Error(`Chain '${chainName}' exited with code ${code}`),
            );
          }
          callback();
        });

        await pwr2.promise;
        if (appState[chainName]!.state === "complete") {
          break;
        }
      }

      return pwr.promise.then(() => appState[chainName]!.worker.terminate());
    }),
  );
}
