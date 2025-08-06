import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { getPonderMetaTable } from "@/database/index.js";
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
  const state: {
    [chainName: string]: "historical" | "realtime" | "complete" | "failed";
  } = {};

  const callback = async () => {
    let isAllReady = true;
    for (const chain of indexingBuild.chains) {
      if (
        state[chain.name] === undefined ||
        state[chain.name] === "historical"
      ) {
        isAllReady = false;
        break;
      }
    }

    if (isAllReady) {
      const endTimestamp = Math.round(Date.now() / 1000);
      common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

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

  Promise.all(
    indexingBuild.chains.map((chain) => {
      const workerPath = join(__dirname, "..", "..", "runtime", "isolated.js");
      const worker = new Worker(workerPath, {
        workerData: {
          cliOptions,
          crashRecoveryCheckpoint,
          chainId: chain.id,
        },
      });

      return new Promise<void>((resolve, reject) => {
        worker.on("message", (message) => {
          if (message.type === "ready") {
            state[chain.name] = "realtime";
            callback();
          } else if (message.type === "complete") {
            state[chain.name] = "complete";
            resolve();
            common.logger.info({
              service: "indexing",
              msg: `Chain '${chain.name}' completed indexing.`,
            });
          } else if (message.type === "error") {
            state[chain.name] = "failed";
            callback();
            reject();
            common.logger.error({
              service: "server",
              msg: `Chain '${chain.name}' failed.`,
            });
          }
        });
      }).then(() => {
        worker.terminate();
      });
    }),
  );
}
