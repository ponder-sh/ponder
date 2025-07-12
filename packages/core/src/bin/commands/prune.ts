import { createBuild } from "@/build/index.js";
import {
  type PonderApp,
  VIEWS,
  createDatabase,
  getPonderMetaTable,
} from "@/database/index.js";
import { TABLES } from "@/database/index.js";
import { sqlToReorgTableName } from "@/drizzle/kit/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { count, eq, inArray, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
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

export async function prune({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: "warn",
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

  const buildResult = await build.preCompile(configResult.result);

  if (buildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const database = await createDatabase({
    common,
    // Note: `namespace` is not used in this command
    namespace: { schema: "public", viewsSchema: undefined },
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const ponderSchemas = await database.adminQB
    .select({ schema: TABLES.table_schema, tableCount: count() })
    .from(TABLES)
    .where(
      inArray(
        TABLES.table_schema,
        database.adminQB
          .select({ schema: TABLES.table_schema })
          .from(TABLES)
          .where(eq(TABLES.table_name, "_ponder_meta")),
      ),
    )
    .groupBy(TABLES.table_schema);

  const ponderViewSchemas = await database.adminQB
    .select({ schema: VIEWS.table_schema })
    .from(VIEWS)
    .where(eq(VIEWS.table_name, "_ponder_meta"));

  const queries = ponderSchemas.map((row) =>
    database.adminQB
      .select({
        value: getPonderMetaTable(row.schema).value,
        schema: sql<string>`${row.schema}`.as("schema"),
      })
      .from(getPonderMetaTable(row.schema))
      .where(eq(getPonderMetaTable(row.schema).key, "app")),
  );

  if (queries.length === 0) {
    logger.warn({
      service: "prune",
      msg: "No inactive Ponder apps found in this database.",
    });
    await exit({ reason: "Success", code: 0 });
    return;
  }

  let result: { value: PonderApp; schema: string }[];

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

  for (const { value, schema } of result) {
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
      service: "prune",
      msg: "No inactive Ponder apps found in this database.",
    });
    await exit({ reason: "Success", code: 0 });
    return;
  }

  if (tablesToDrop.length > 0) {
    await database.adminQB.execute(
      sql.raw(`DROP TABLE IF EXISTS ${tablesToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      service: "prune",
      msg: `Dropped ${tablesToDrop.length} tables`,
    });
  }

  if (viewsToDrop.length > 0) {
    await database.adminQB.execute(
      sql.raw(`DROP VIEW IF EXISTS ${viewsToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      service: "prune",
      msg: `Dropped ${viewsToDrop.length} views`,
    });
  }

  if (functionsToDrop.length > 0) {
    await database.adminQB.execute(
      sql.raw(`DROP FUNCTION IF EXISTS ${functionsToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      service: "prune",
      msg: `Dropped ${functionsToDrop.length} functions`,
    });
  }

  if (schemasToDrop.length > 0) {
    await database.adminQB.execute(
      sql.raw(`DROP SCHEMA IF EXISTS ${schemasToDrop.join(", ")} CASCADE`),
    );

    logger.warn({
      service: "prune",
      msg: `Dropped ${schemasToDrop.length} schemas`,
    });
  }

  await exit({ reason: "Success", code: 0 });
}
