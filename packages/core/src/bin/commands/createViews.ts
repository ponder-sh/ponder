import { createBuild } from "@/build/index.js";
import {
  type PonderApp0,
  type PonderApp1,
  type PonderApp2,
  type PonderApp3,
  type PonderApp4,
  type PonderApp5,
  SCHEMATA,
  createDatabase,
  getPonderMetaTable,
} from "@/database/index.js";
import {
  getLiveQueryChannelName,
  getLiveQueryNotifyProcedureName,
  getViewsLiveQueryNotifyTriggerName,
} from "@/drizzle/onchain.js";
import { sql } from "@/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { startClock } from "@/utils/timer.js";
import { eq } from "drizzle-orm";
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

export async function createViews({
  cliOptions,
}: {
  cliOptions: CliOptions & {
    schema?: string | undefined;
    viewsSchema?: string | undefined;
  };
}) {
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

  if (cliOptions.schema === undefined) {
    logger.error({
      msg: "Required CLI option '--schema' not provided.",
    });
    await exit({ code: 1 });
    return;
  }
  if (cliOptions.viewsSchema === undefined) {
    logger.error({
      msg: "Required CLI option '--views-schema' not provided.",
    });
    await exit({ code: 1 });
    return;
  }

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
    namespace: {
      schema: cliOptions.schema!,
      viewsSchema: undefined,
    },
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const endClock = startClock();

  const schemaExists = await database.adminQB
    .wrap((db) =>
      db
        .select()
        .from(SCHEMATA)
        .where(eq(SCHEMATA.schemaName, cliOptions.schema!)),
    )
    .then((res) => res.length > 0);

  if (schemaExists === false) {
    common.logger.error({
      msg: "Schema does not exist.",
      schema: cliOptions.schema!,
    });
    await exit({ code: 1 });
    return;
  }

  const PONDER_META = getPonderMetaTable(cliOptions.schema!);

  const meta = (await database.adminQB.wrap((db) =>
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
            | PonderApp5;
        },
      ]
    | [];

  if (meta.length === 0) {
    logger.warn({
      msg: "Found 0 Ponder apps",
      schema: cliOptions.schema!,
    });
    await exit({ code: 0 });
    return;
  }

  if ("table_names" in meta[0]!.app === false) {
    logger.warn({
      msg: "Ponder app version not compatible with this command",
      schema: cliOptions.schema!,
    });
    await exit({ code: 0 });
    return;
  }

  await database.adminQB.wrap((db) =>
    db.execute(`CREATE SCHEMA IF NOT EXISTS "${cliOptions.viewsSchema}"`),
  );

  // Note: Drop views before creating new ones because Postgres does not support
  // altering the schema of a view with CREATE OR REPLACE VIEW.

  for (const table of meta[0]!.app.table_names!) {
    await database.adminQB.wrap((db) =>
      db.execute(`DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${table}"`),
    );

    await database.adminQB.wrap((db) =>
      db.execute(
        `CREATE VIEW "${cliOptions.viewsSchema}"."${table}" AS SELECT * FROM "${cliOptions.schema!}"."${table}"`,
      ),
    );
  }

  if ("view_names" in meta[0]!.app) {
    for (const view of meta[0]!.app.view_names!) {
      await database.adminQB.wrap((db) =>
        db.execute(`DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${view}"`),
      );

      await database.adminQB.wrap((db) =>
        db.execute(
          `CREATE VIEW "${cliOptions.viewsSchema}"."${view}" AS SELECT * FROM "${cliOptions.schema!}"."${view}"`,
        ),
      );
    }
  }

  logger.warn({
    msg: "Created database views",
    schema: cliOptions.viewsSchema,
    count:
      meta[0]!.app.table_names!.length +
      ((meta[0]!.app as { view_names?: string[] }).view_names?.length ?? 0),
    duration: endClock(),
  });

  await database.adminQB.wrap((db) =>
    db.execute(
      sql.raw(`DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."_ponder_meta"`),
    ),
  );

  await database.adminQB.wrap((db) =>
    db.execute(
      sql.raw(
        `DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."_ponder_checkpoint"`,
      ),
    ),
  );

  await database.adminQB.wrap((db) =>
    db.execute(
      sql.raw(
        `CREATE VIEW "${cliOptions.viewsSchema}"."_ponder_meta" AS SELECT * FROM "${cliOptions.schema!}"."_ponder_meta"`,
      ),
    ),
  );

  await database.adminQB.wrap((db) =>
    db.execute(
      sql.raw(
        `CREATE VIEW "${cliOptions.viewsSchema}"."_ponder_checkpoint" AS SELECT * FROM "${cliOptions.schema!}"."_ponder_checkpoint"`,
      ),
    ),
  );

  const notifyProcedure = getLiveQueryNotifyProcedureName();
  const channel = getLiveQueryChannelName(cliOptions.viewsSchema);

  await database.adminQB.wrap((db) =>
    db.execute(`
CREATE OR REPLACE FUNCTION "${cliOptions.viewsSchema}".${notifyProcedure}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
  DECLARE
    table_names json;
    table_exists boolean := false;
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'live_query_tables'
      AND table_type = 'LOCAL TEMPORARY'
    ) INTO table_exists;

    IF table_exists THEN
      SELECT json_agg(table_name) INTO table_names
      FROM live_query_tables;

      table_names := COALESCE(table_names, '[]'::json);
      PERFORM pg_notify('${channel}', table_names::text);
    END IF;

    RETURN NULL;
  END;
$$;`),
  );

  const trigger = getViewsLiveQueryNotifyTriggerName(cliOptions.viewsSchema);

  await database.adminQB.wrap((db) =>
    db.execute(
      `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${cliOptions.schema!}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${cliOptions.viewsSchema}".${notifyProcedure};`,
    ),
  );

  await exit({ code: 0 });
}
