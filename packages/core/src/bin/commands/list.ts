import { createBuild } from "@/build/index.js";
import {
  type PonderApp0,
  type PonderApp1,
  type PonderApp2,
  type PonderApp3,
  type PonderApp4,
  type PonderApp5,
  VIEWS,
  createDatabase,
  getPonderMetaTable,
} from "@/database/index.js";
import { TABLES } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { buildTable } from "@/ui/app.js";
import { formatEta } from "@/utils/format.js";
import { eq, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

const emptySchemaBuild = {
  schema: {},
  statements: {
    tables: { sql: [], json: [] },
    views: { sql: [], json: [] },
    enums: { sql: [], json: [] },
    indexes: { sql: [], json: [] },
    sequences: { sql: [], json: [] },
  },
};

export async function list({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: "warn",
    mode: options.logFormat,
  });

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = {
    options,
    logger,
    metrics,
    telemetry,
    shutdown,
    buildShutdown: shutdown,
    apiShutdown: shutdown,
  };

  const build = await createBuild({ common, cliOptions });

  const exit = createExit({ common, options });

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "config",
      error: configResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const buildResult = build.preCompile(configResult.result);

  if (buildResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "pre-compile",
      error: buildResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const databaseDiagnostic = await build.databaseDiagnostic({
    preBuild: buildResult.result,
  });
  if (databaseDiagnostic.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "diagnostic",
      error: databaseDiagnostic.error,
    });
    await exit({ code: 75 });
    return;
  }

  const database = createDatabase({
    common,
    // Note: `namespace` is not used in this command
    namespace: { schema: "public", viewsSchema: undefined },
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const ponderSchemas = await database.adminQB.wrap((db) =>
    db
      .select({ schema: TABLES.table_schema })
      .from(TABLES)
      .where(eq(TABLES.table_name, "_ponder_meta")),
  );

  const ponderViewSchemas = await database.adminQB.wrap((db) =>
    db
      .select({ schema: VIEWS.table_schema })
      .from(VIEWS)
      .where(eq(VIEWS.table_name, "_ponder_meta")),
  );

  const queries = ponderSchemas.map((row) =>
    database.adminQB.wrap((db) =>
      db
        .select({
          value: getPonderMetaTable(row.schema).value,
          schema: sql<string>`${row.schema}`.as("schema"),
        })
        .from(getPonderMetaTable(row.schema))
        .where(eq(getPonderMetaTable(row.schema).key, "app")),
    ),
  );

  if (queries.length === 0) {
    logger.warn({
      msg: "Found 0 'ponder start' apps",
    });
    await exit({ code: 0 });
    return;
  }

  let result: {
    value:
      | Partial<PonderApp0>
      | PonderApp1
      | PonderApp2
      | PonderApp3
      | PonderApp4
      | PonderApp5;
    schema: string;
  }[];

  if (queries.length === 1) {
    result = await queries[0]!;
  } else {
    // @ts-ignore
    result = await unionAll(...queries);
  }

  const columns = [
    { title: "Schema", key: "table_schema", align: "left" },
    { title: "Active", key: "active", align: "right" },
    { title: "Last active", key: "last_active", align: "right" },
    { title: "Relation count", key: "relation_count", align: "right" },
    { title: "Is view", key: "is_view", align: "right" },
  ];

  // "start" apps with metadata version >=2
  const filteredResults = result.filter(
    (
      row,
    ): row is {
      value: PonderApp2 | PonderApp3 | PonderApp4 | PonderApp5;
      schema: string;
    } => "is_dev" in row.value && row.value.is_dev === 0,
  );

  const rows = filteredResults.map((row) => ({
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
    relation_count:
      (row.value.table_names?.length ?? 0) +
      ((row.value as { view_names?: string[] }).view_names?.length ?? 0),
    is_view: ponderViewSchemas.some((schema) => schema.schema === row.schema)
      ? "yes"
      : "no",
  }));

  if (rows.length === 0) {
    logger.warn({ msg: "Found 0 'ponder start' apps" });
    await exit({ code: 0 });
    return;
  }

  const lines = buildTable(rows, columns);
  const text = [...lines, ""].join("\n");
  console.log(text);

  await exit({ code: 0 });
}
