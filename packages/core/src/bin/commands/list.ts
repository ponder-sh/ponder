import { createBuild } from "@/build/index.js";
import { createDatabase, getPonderMeta } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { buildTable } from "@/ui/app.js";
import { formatEta } from "@/utils/format.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { pgSchema } from "drizzle-orm/pg-core";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

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
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };

  const build = await createBuild({ common, cliOptions });

  const exit = createExit({ common });

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const buildResult = build.preCompile(configResult.result);

  if (buildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const database = await createDatabase({
    common,
    // Note: `namespace` is not used in this command
    namespace: "public",
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const SCHEMATA = pgSchema("information_schema").table("schemata", (t) => ({
    schema_name: t.text().notNull(),
  }));

  const TABLES = pgSchema("information_schema").table("tables", (t) => ({
    table_name: t.text().notNull(),
    table_schema: t.text().notNull(),
  }));

  const ponderSchemas = await database.qb.drizzle
    .select({ tableName: TABLES.table_name, tableSchema: TABLES.table_schema })
    .from(TABLES)
    .where(
      and(
        eq(TABLES.table_name, "_ponder_meta"),
        inArray(
          TABLES.table_schema,
          database.qb.drizzle
            .select({ schemaName: SCHEMATA.schema_name })
            .from(SCHEMATA),
        ),
      ),
    );

  const queries = ponderSchemas.map((row) =>
    database.qb.drizzle
      .select({
        value: getPonderMeta(row.tableSchema).value,
        schema: sql<string>`${row.tableSchema}`.as("schema"),
      })
      .from(getPonderMeta(row.tableSchema))
      .where(eq(getPonderMeta(row.tableSchema).key, "app")),
  );

  // @ts-ignore
  const result = await unionAll(...queries);

  const columns = [
    { title: "Schema", key: "table_schema", align: "left" },
    { title: "Active", key: "active", align: "right" },
    { title: "Last active", key: "last_active", align: "right" },
    { title: "Table count", key: "table_count", align: "right" },
  ];

  const rows = result
    .filter((row) => row.value.is_dev === 0)
    .map((row) => ({
      table_schema: row.schema,
      active:
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
    }));

  if (rows.length === 0) {
    console.log("No 'ponder start' apps found in this database.\n");
    await exit({ reason: "Success", code: 0 });
    return;
  }

  const lines = buildTable(rows, columns);
  const text = [...lines, ""].join("\n");
  console.log(text);

  await exit({ reason: "Success", code: 0 });
}
