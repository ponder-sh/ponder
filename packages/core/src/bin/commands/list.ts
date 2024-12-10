import { createBuild } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { createTelemetry } from "@/common/telemetry.js";
import {
  type PonderApp,
  type PonderInternalSchema,
  createDatabase,
} from "@/database/index.js";
import { printTable } from "@/ui/Table.js";
import { formatEta } from "@/utils/format.js";
import { type SelectQueryBuilder, sql } from "kysely";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

const emptySchemaBuild = {
  schema: {},
  statements: {
    tables: { sql: [], json: [] },
    enums: { sql: [], json: [] },
    indexes: { sql: [], json: [] },
  },
};

export async function list({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  const common = { options, logger, metrics, telemetry };

  const build = await createBuild({ common });

  const cleanup = async () => {
    await build.kill();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const executeResult = await build.execute();

  if (executeResult.configResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return;
  }

  const buildResult = build.preCompile(executeResult.configResult.result);

  if (buildResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return;
  }

  const database = createDatabase({
    common,
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const ponderSchemas = await database.qb.internal
    .selectFrom("information_schema.tables")
    // @ts-ignore
    .select(["table_name", "table_schema"])
    // @ts-ignore
    .where("table_name", "=", "_ponder_meta")
    .where(
      // @ts-ignore
      "table_schema",
      "in",
      database.qb.internal
        // @ts-ignore
        .selectFrom("information_schema.schemata")
        // @ts-ignore
        .select("schema_name"),
    )
    .execute();

  let union:
    | SelectQueryBuilder<
        PonderInternalSchema,
        "_ponder_meta",
        {
          value: PonderApp;
          schema: string;
        }
      >
    | undefined;

  for (const row of ponderSchemas) {
    // @ts-ignore
    const query = database.qb.internal
      .selectFrom(`${row.table_schema}._ponder_meta`)
      .select(["value", sql<string>`${row.table_schema}`.as("schema")])
      // @ts-ignore
      .where("key", "=", "app") as NonNullable<typeof union>;

    if (union === undefined) {
      union = query;
    } else {
      union = union.unionAll(query);
    }
  }

  const result = ponderSchemas.length === 0 ? [] : await union!.execute();

  printTable({
    columns: [
      { title: "Schema", key: "table_schema", align: "left" },
      { title: "Is live?", key: "is_live", align: "right" },
      { title: "Last active", key: "last_active", align: "right" },
      { title: "Table count", key: "table_count", align: "right" },
    ],
    rows: result
      .filter((row) => row.value.is_dev === 0)
      .map((row) => ({
        table_schema: row.schema,
        is_live:
          row.value.is_locked === 1 &&
          row.value.heartbeat_at + common.options.databaseHeartbeatTimeout >
            Date.now()
            ? "yes"
            : "no",
        last_active:
          row.value.is_locked === 1
            ? "---"
            : `${formatEta(Date.now() - row.value.heartbeat_at)} ago`,
        table_count: row.value.table_names.length,
      })),
  });

  await database.kill();

  await shutdown({ reason: "Success", code: 0 });
}
