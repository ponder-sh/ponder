import { count, eq, inArray, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { Clock, Effect } from "effect";
import { createBuild } from "@/build/index.js";
import { Db, makeDb, makeDbTransports } from "@/database/db.js";
import {
  getPonderMetaTable,
  PONDER_CHECKPOINT_TABLE_NAME,
  PONDER_META_TABLE_NAME,
  PONDER_STATUS_TABLE_NAME,
  type PonderApp0,
  type PonderApp1,
  type PonderApp2,
  type PonderApp3,
  type PonderApp4,
  type PonderApp5,
  type PonderApp6,
  TABLES,
  VIEWS,
} from "@/database/index.js";
import {
  getLiveQueryNotifyProcedureName,
  getLiveQueryProcedureName,
  getReorgProcedureName,
  getReorgTableName,
} from "@/drizzle/onchain.js";
import { buildOptions } from "@/internal/options.js";
import { startClockEffect } from "@/utils/timer.js";
import type { CliOptions } from "../ponder.js";
import { failBuild, isBuildFailed } from "../utils/command.js";
import { runMain } from "../utils/exit.js";

export function prune({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const program = Effect.gen(function* () {
    const build = yield* createBuild({ cliOptions });

    const configResult = yield* build.executeConfig.pipe(failBuild("config"));
    const preBuild = yield* build
      .preCompile(configResult)
      .pipe(failBuild("pre-compile"));

    const db = yield* makeDb(
      yield* makeDbTransports({
        // Note: `namespace` is not used in this command
        namespace: { schema: "public", viewsSchema: undefined },
        preBuild,
        schemaBuild: { schema: {} },
      }),
    );
    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75), Effect.provideService(Db, db));

    const ponderSchemas = yield* db.admin.query((db) =>
      db
        .select({ schema: TABLES.table_schema, tableCount: count() })
        .from(TABLES)
        .where(
          inArray(
            TABLES.table_schema,
            db
              .select({ schema: TABLES.table_schema })
              .from(TABLES)
              .where(eq(TABLES.table_name, PONDER_META_TABLE_NAME)),
          ),
        )
        .groupBy(TABLES.table_schema),
    );

    const ponderViewSchemas = yield* db.admin.query((db) =>
      db
        .select({ schema: VIEWS.table_schema })
        .from(VIEWS)
        .where(eq(VIEWS.table_name, PONDER_META_TABLE_NAME)),
    );

    const queries = ponderSchemas.map((row) =>
      db.admin.drizzle
        .select({
          value: getPonderMetaTable(row.schema).value,
          schema: sql<string>`${row.schema}`.as("schema"),
        })
        .from(getPonderMetaTable(row.schema))
        .where(eq(getPonderMetaTable(row.schema).key, "app")),
    );

    if (queries.length === 0) {
      yield* Effect.logWarning({
        msg: "Found 0 inactive Ponder apps",
      });
      return 0;
    }

    let result: {
      value:
        | Partial<PonderApp0>
        | PonderApp1
        | PonderApp2
        | PonderApp3
        | PonderApp4
        | PonderApp5
        | PonderApp6;
      schema: string;
    }[];

    if (queries.length === 1) {
      result = yield* db.admin.query(() => queries[0]!);
    } else {
      // @ts-expect-error
      result = yield* db.admin.query(() => unionAll(...queries));
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
        value: PonderApp2 | PonderApp3 | PonderApp4 | PonderApp5 | PonderApp6;
        schema: string;
      } => "is_dev" in row.value && row.value.is_dev === 0,
    );

    const now = yield* Clock.currentTimeMillis;

    for (const { value, schema } of filteredResults) {
      if (value.is_dev === 1) continue;
      if (
        value.is_locked === 1 &&
        value.heartbeat_at + options.databaseHeartbeatTimeout > now
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
        viewsToDrop.push(`"${schema}"."${PONDER_META_TABLE_NAME}"`);
        if (value.version === "2") {
          viewsToDrop.push(`"${schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`);
        } else {
          viewsToDrop.push(`"${schema}"."${PONDER_STATUS_TABLE_NAME}"`);
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
          tablesToDrop.push(`"${schema}"."${getReorgTableName(table)}"`);
          functionsToDrop.push(`"${schema}"."${getReorgProcedureName(table)}"`);
        }
        functionsToDrop.push(`"${schema}".${getLiveQueryProcedureName()}`);
        functionsToDrop.push(
          `"${schema}".${getLiveQueryNotifyProcedureName()}`,
        );
        if ("view_names" in value) {
          for (const view of value.view_names) {
            viewsToDrop.push(`"${schema}"."${view}"`);
          }
        }
        tablesToDrop.push(`"${schema}"."${PONDER_META_TABLE_NAME}"`);
        if (value.version === "2") {
          tablesToDrop.push(`"${schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`);
        } else {
          tablesToDrop.push(`"${schema}"."${PONDER_STATUS_TABLE_NAME}"`);
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
      yield* Effect.logWarning({
        msg: "Found 0 inactive Ponder apps",
      });
      return 0;
    }

    let endClock = yield* startClockEffect;

    if (tablesToDrop.length > 0) {
      yield* db.admin.query((db) =>
        db.execute(`DROP TABLE IF EXISTS ${tablesToDrop.join(", ")} CASCADE`),
      );

      yield* Effect.logWarning({
        msg: "Dropped database tables",
        count: tablesToDrop.length,
        duration: yield* endClock,
      });
    }

    endClock = yield* startClockEffect;

    if (viewsToDrop.length > 0) {
      yield* db.admin.query((db) =>
        db.execute(`DROP VIEW IF EXISTS ${viewsToDrop.join(", ")} CASCADE`),
      );

      yield* Effect.logWarning({
        msg: "Dropped database views",
        count: viewsToDrop.length,
        duration: yield* endClock,
      });
    }

    endClock = yield* startClockEffect;

    if (functionsToDrop.length > 0) {
      yield* db.admin.query((db) =>
        db.execute(
          `DROP FUNCTION IF EXISTS ${functionsToDrop.join(", ")} CASCADE`,
        ),
      );

      yield* Effect.logWarning({
        msg: "Dropped database functions",
        count: functionsToDrop.length,
        duration: yield* endClock,
      });
    }

    endClock = yield* startClockEffect;

    if (schemasToDrop.length > 0) {
      yield* db.admin.query((db) =>
        db.execute(`DROP SCHEMA IF EXISTS ${schemasToDrop.join(", ")} CASCADE`),
      );

      yield* Effect.logWarning({
        msg: "Dropped database schemas",
        count: schemasToDrop.length,
        duration: yield* endClock,
      });
    }

    return 0;
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

  runMain({ options, logLevel: "warn", program });
}
