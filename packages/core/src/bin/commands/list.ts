import { eq, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { Clock, Effect } from "effect";
import { createBuild } from "@/build/index.js";
import { makeDb } from "@/database/db.js";
import {
  getPonderMetaTable,
  PONDER_META_TABLE_NAME,
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
import { buildOptions } from "@/internal/options.js";
import { buildTable } from "@/ui/app.js";
import { formatEta } from "@/utils/format.js";
import type { CliOptions } from "../ponder.js";
import { failBuild, isBuildFailed } from "../utils/command.js";
import { runMain } from "../utils/exit.js";

export function list({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const program = Effect.gen(function* () {
    const build = yield* createBuild({ cliOptions });

    const configResult = yield* build.executeConfig.pipe(failBuild("config"));
    const preBuild = yield* build
      .preCompile(configResult)
      .pipe(failBuild("pre-compile"));
    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75));

    const db = yield* makeDb({
      // Note: `namespace` is not used in this command
      namespace: { schema: "public", viewsSchema: undefined },
      preBuild,
      schemaBuild: { schema: {} },
    });

    const ponderSchemas = yield* db.admin.query((db) =>
      db
        .select({ schema: TABLES.table_schema })
        .from(TABLES)
        .where(eq(TABLES.table_name, PONDER_META_TABLE_NAME)),
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
        msg: "Found 0 'ponder start' apps",
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
        value: PonderApp2 | PonderApp3 | PonderApp4 | PonderApp5 | PonderApp6;
        schema: string;
      } => "is_dev" in row.value && row.value.is_dev === 0,
    );

    const now = yield* Clock.currentTimeMillis;

    const rows = filteredResults.map((row) => ({
      table_schema: row.schema,
      active:
        row.value.is_locked === 1 &&
        row.value.heartbeat_at + options.databaseHeartbeatTimeout > now
          ? "yes"
          : "no",
      last_active:
        row.value.is_locked === 1
          ? "---"
          : `${formatEta(now - row.value.heartbeat_at)} ago`,
      relation_count:
        (row.value.table_names?.length ?? 0) +
        ((row.value as { view_names?: string[] }).view_names?.length ?? 0),
      is_view: ponderViewSchemas.some((schema) => schema.schema === row.schema)
        ? "yes"
        : "no",
    }));

    if (rows.length === 0) {
      yield* Effect.logWarning({ msg: "Found 0 'ponder start' apps" });
      return 0;
    }

    const lines = buildTable(rows, columns);
    const text = [...lines, ""].join("\n");
    console.log(text);

    return 0;
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

  runMain({ options, logLevel: "warn", program });
}
