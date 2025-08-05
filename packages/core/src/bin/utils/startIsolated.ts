import { createIndexes, createViews } from "@/database/actions.js";
import { getPonderMetaTable } from "@/database/index.js";
import { runIsolated } from "@/runtime/isolated.js";
import { isTable, sql } from "drizzle-orm";
import type { PonderApp } from "../commands/start.js";
import type { CliOptions } from "../ponder.js";

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
    indexingBuild.chains.map(async (chain) => {
      state[chain.name] = "historical";

      await runIsolated({
        cliOptions,
        crashRecoveryCheckpoint,
        chainId: chain.id,
        onReady: async () => {
          state[chain.name] = "realtime";
          await callback();
        },
      })
        .then(() => {
          state[chain.name] = "complete";
        })
        .catch(async (error) => {
          state[chain.name] = "failed";
          common.logger.info({
            service: "server",
            msg: `Chain '${chain.name}' failed. `,
          });

          await callback();

          for (const chain of indexingBuild.chains) {
            if (state[chain.name] !== "failed") {
              return;
            }
          }

          throw error;
        });
    }),
  );
}
