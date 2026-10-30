import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createBuild } from "@/build/index.js";
import { makeDb } from "@/database/db.js";
import {
  getPonderMetaTable,
  PONDER_CHECKPOINT_TABLE_NAME,
  PONDER_META_TABLE_NAME,
  type PonderApp0,
  type PonderApp1,
  type PonderApp2,
  type PonderApp3,
  type PonderApp4,
  type PonderApp5,
  type PonderApp6,
  SCHEMATA,
} from "@/database/index.js";
import {
  getLiveQueryChannelName,
  getLiveQueryNotifyProcedureName,
  getLiveQueryNotifyProcedureSql,
  getViewsLiveQueryNotifyTriggerName,
} from "@/drizzle/onchain.js";
import { sql } from "@/index.js";
import { buildOptions } from "@/internal/options.js";
import { startClockEffect } from "@/utils/timer.js";
import type { CliOptions } from "../ponder.js";
import { failBuild, isBuildFailed } from "../utils/command.js";
import { runMain } from "../utils/exit.js";

export function createViews({
  cliOptions,
}: {
  cliOptions: CliOptions & {
    schema?: string | undefined;
    viewsSchema?: string | undefined;
  };
}) {
  const options = buildOptions({ cliOptions });

  const program = Effect.gen(function* () {
    const build = yield* createBuild({ cliOptions });

    if (cliOptions.schema === undefined) {
      yield* Effect.logError({
        msg: "Required CLI option '--schema' not provided.",
      });
      return 1;
    }
    if (cliOptions.viewsSchema === undefined) {
      yield* Effect.logError({
        msg: "Required CLI option '--views-schema' not provided.",
      });
      return 1;
    }

    const configResult = yield* build.executeConfig.pipe(failBuild("config"));
    const preBuild = yield* build
      .preCompile(configResult)
      .pipe(failBuild("pre-compile"));
    yield* build
      .databaseDiagnostic({ preBuild })
      .pipe(failBuild("diagnostic", 75));

    const db = yield* makeDb({
      // Note: `namespace` is not used in this command
      namespace: {
        schema: cliOptions.schema!,
        viewsSchema: undefined,
      },
      preBuild,
      schemaBuild: { schema: {} },
    });

    const endClock = yield* startClockEffect;

    const schemas = yield* db.admin.query((db) =>
      db
        .select()
        .from(SCHEMATA)
        .where(eq(SCHEMATA.schemaName, cliOptions.schema!)),
    );

    if (schemas.length === 0) {
      yield* Effect.logError({
        msg: "Schema does not exist.",
        schema: cliOptions.schema!,
      });
      return 1;
    }

    const PONDER_META = getPonderMetaTable(cliOptions.schema!);

    const meta = (yield* db.admin.query((db) =>
      db
        .select({ app: PONDER_META.value })
        .from(PONDER_META)
        .where(eq(PONDER_META.key, "app")),
    )) as
      | [
          {
            app:
              | Partial<PonderApp0>
              | PonderApp1
              | PonderApp2
              | PonderApp3
              | PonderApp4
              | PonderApp5
              | PonderApp6;
          },
        ]
      | [];

    if (meta.length === 0) {
      yield* Effect.logWarning({
        msg: "Found 0 Ponder apps",
        schema: cliOptions.schema!,
      });
      return 0;
    }

    if ("table_names" in meta[0]!.app === false) {
      yield* Effect.logWarning({
        msg: "Ponder app version not compatible with this command",
        schema: cliOptions.schema!,
      });
      return 0;
    }

    yield* db.admin.query((db) =>
      db.execute(`CREATE SCHEMA IF NOT EXISTS "${cliOptions.viewsSchema}"`),
    );

    // Note: Drop views before creating new ones because Postgres does not support
    // altering the schema of a view with CREATE OR REPLACE VIEW.

    for (const table of meta[0]!.app.table_names!) {
      yield* db.admin.query((db) =>
        db.execute(
          `DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${table}"`,
        ),
      );

      yield* db.admin.query((db) =>
        db.execute(
          `CREATE VIEW "${cliOptions.viewsSchema}"."${table}" AS SELECT * FROM "${cliOptions.schema!}"."${table}"`,
        ),
      );
    }

    if ("view_names" in meta[0]!.app) {
      for (const view of meta[0]!.app.view_names!) {
        yield* db.admin.query((db) =>
          db.execute(
            `DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${view}"`,
          ),
        );

        yield* db.admin.query((db) =>
          db.execute(
            `CREATE VIEW "${cliOptions.viewsSchema}"."${view}" AS SELECT * FROM "${cliOptions.schema!}"."${view}"`,
          ),
        );
      }
    }

    yield* Effect.logWarning({
      msg: "Created database views",
      schema: cliOptions.viewsSchema,
      count:
        meta[0]!.app.table_names!.length +
        ((meta[0]!.app as { view_names?: string[] }).view_names?.length ?? 0),
      duration: yield* endClock,
    });

    yield* db.admin.query((db) =>
      db.execute(
        sql.raw(
          `DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${PONDER_META_TABLE_NAME}"`,
        ),
      ),
    );

    yield* db.admin.query((db) =>
      db.execute(
        sql.raw(
          `DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`,
        ),
      ),
    );

    yield* db.admin.query((db) =>
      db.execute(
        sql.raw(
          `CREATE VIEW "${cliOptions.viewsSchema}"."${PONDER_META_TABLE_NAME}" AS SELECT * FROM "${cliOptions.schema!}"."${PONDER_META_TABLE_NAME}"`,
        ),
      ),
    );

    yield* db.admin.query((db) =>
      db.execute(
        sql.raw(
          `CREATE VIEW "${cliOptions.viewsSchema}"."${PONDER_CHECKPOINT_TABLE_NAME}" AS SELECT * FROM "${cliOptions.schema!}"."${PONDER_CHECKPOINT_TABLE_NAME}"`,
        ),
      ),
    );

    const notifyProcedure = getLiveQueryNotifyProcedureName();
    const channel = getLiveQueryChannelName(cliOptions.viewsSchema);

    yield* db.admin.query((db) =>
      db.execute(
        getLiveQueryNotifyProcedureSql({
          schema: cliOptions.viewsSchema!,
          channel,
        }),
      ),
    );

    const trigger = getViewsLiveQueryNotifyTriggerName(cliOptions.viewsSchema);

    yield* db.admin.query((db) =>
      db.execute(
        `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${cliOptions.schema!}"."${PONDER_CHECKPOINT_TABLE_NAME}"
FOR EACH STATEMENT
EXECUTE PROCEDURE "${cliOptions.viewsSchema}".${notifyProcedure};`,
      ),
    );

    return 0;
  }).pipe(Effect.catchIf(isBuildFailed, ({ code }) => Effect.succeed(code)));

  runMain({ options, logLevel: "warn", program });
}
