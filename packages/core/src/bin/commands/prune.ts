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
import { sqlToReorgTableName } from "@/drizzle/kit/index.js";
import {
  getLiveQueryNotifyProcedureName,
  getLiveQueryProcedureName,
} from "@/drizzle/onchain.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { startClock } from "@/utils/timer.js";
import { count, eq, inArray, sql } from "drizzle-orm";
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

export async function prune({ cliOptions }: { cliOptions: CliOptions }) {
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
      .select({ schema: TABLES.table_schema, tableCount: count() })
      .from(TABLES)
      .where(
        inArray(
          TABLES.table_schema,
          database.adminQB.raw
            .select({ schema: TABLES.table_schema })
            .from(TABLES)
            .where(eq(TABLES.table_name, "_ponder_meta")),
        ),
      )
      .groupBy(TABLES.table_schema),
  );

  const ponderViewSchemas = await database.adminQB.wrap((db) =>
    db
      .select({ schema: VIEWS.table_schema })
      .from(VIEWS)
      .where(eq(VIEWS.table_name, "_ponder_meta")),
  );

  const queries = ponderSchemas.map((row) =>
    database.adminQB.raw
      .select({
        value: getPonderMetaTable(row.schema).value,
        schema: sql<string>`${row.schema}`.as("schema"),
      })
      .from(getPonderMetaTable(row.schema))
      .where(eq(getPonderMetaTable(row.schema).key, "app")),
  );

  if (queries.length === 0) {
    logger.warn({
      msg: "Found 0 inactive Ponder apps",
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

  const tablesToDrop: string[] = [];
  const viewsToDrop: string[] = [];
  const schemasToDrop: string[] = [];
  const functionsToDrop: string[] = [];

  // "start" apps with metadata version >=2
  const filteredResults = result.filter(
    (
      row,
    ): row is {
      value: PonderApp2 | PonderApp3 | PonderApp4 | PonderApp5;
      schema: string;
    } => "is_dev" in row.value && row.value.is_dev === 0,
  );

  for (const { value, schema } of filteredResults) {
    if (value.is_dev === 1) continue;
    if (
      value.is_locked === 1 &&
      value.heartbeat_at + common.options.databaseHeartbeatTimeout > Date.now()
    ) {
      continue;
    }

    if (ponderViewSchemas.some((vs) => vs.schema === schema)) {
      for (const table of value.table_names) {
        viewsToDrop.push(`"${schema}"."${table}"`);
      }
      if ("view_names" in value) {
        for (const view of value.view_names) {
          viewsToDrop.push(`"${schema}"."${view}"`);
        }
      }
      viewsToDrop.push(`"${schema}"."_ponder_meta"`);
      if (value.version === "2") {
        viewsToDrop.push(`"${schema}"."_ponder_checkpoint"`);
      } else {
        viewsToDrop.push(`"${schema}"."_ponder_status"`);
      }

      const tableCount = ponderSchemas.find(
        (s) => s.schema === schema,
      )!.tableCount;

      if (schema !== "public" && tableCount <= 2 + value.table_names.length) {
        schemasToDrop.push(`"${schema}"`);
      }
    } else {
      for (const table of value.table_names) {
        tablesToDrop.push(`"${schema}"."${table}"`);
        tablesToDrop.push(`"${schema}"."${sqlToReorgTableName(table)}"`);
        functionsToDrop.push(`"${schema}"."operation_reorg__${table}"`);
      }
      functionsToDrop.push(`"${schema}".${getLiveQueryProcedureName()}`);
      functionsToDrop.push(`"${schema}".${getLiveQueryNotifyProcedureName()}`);
      if ("view_names" in value) {
        for (const view of value.view_names) {
          viewsToDrop.push(`"${schema}"."${view}"`);
        }
      }
      tablesToDrop.push(`"${schema}"."_ponder_meta"`);
      if (value.version === "2") {
        tablesToDrop.push(`"${schema}"."_ponder_checkpoint"`);
      } else {
        tablesToDrop.push(`"${schema}"."_ponder_status"`);
      }

      const tableCount = ponderSchemas.find(
        (s) => s.schema === schema,
      )!.tableCount;

      if (
        schema !== "public" &&
        tableCount <= 2 + value.table_names.length * 2
      ) {
        schemasToDrop.push(`"${schema}"`);
      }
    }
  }

  if (tablesToDrop.length === 0 && viewsToDrop.length === 0) {
    logger.warn({
      msg: "Found 0 inactive Ponder apps",
    });
    await exit({ code: 0 });
    return;
  }

  let endClock = startClock();

  if (tablesToDrop.length > 0) {
    await database.adminQB.wrap((db) =>
      db.execute(`DROP TABLE IF EXISTS ${tablesToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      msg: "Dropped database tables",
      count: tablesToDrop.length,
      duration: endClock(),
    });
  }

  endClock = startClock();

  if (viewsToDrop.length > 0) {
    await database.adminQB.wrap((db) =>
      db.execute(`DROP VIEW IF EXISTS ${viewsToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      msg: "Dropped database views",
      count: viewsToDrop.length,
      duration: endClock(),
    });
  }

  endClock = startClock();

  if (functionsToDrop.length > 0) {
    await database.adminQB.wrap((db) =>
      db.execute(
        `DROP FUNCTION IF EXISTS ${functionsToDrop.join(", ")} CASCADE`,
      ),
    );

    logger.warn({
      msg: "Dropped database functions",
      count: functionsToDrop.length,
      duration: endClock(),
    });
  }

  endClock = startClock();

  if (schemasToDrop.length > 0) {
    await database.adminQB.wrap((db) =>
      db.execute(`DROP SCHEMA IF EXISTS ${schemasToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      msg: "Dropped database schemas",
      count: schemasToDrop.length,
      duration: endClock(),
    });
  }

  await exit({ code: 0 });
}
