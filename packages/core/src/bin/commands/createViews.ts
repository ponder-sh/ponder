import { createBuild } from "@/build/index.js";
import { createDatabase, getPonderMetaTable } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { eq, sql } from "drizzle-orm";
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
  const common = { options, logger, metrics, telemetry, shutdown };

  const build = await createBuild({ common, cliOptions });

  const exit = createExit({ common });

  if (cliOptions.schema === undefined) {
    logger.warn({
      service: "create-views",
      msg: "Required CLI option '--schema' not provided.",
    });
    await exit({ reason: "Create views failed", code: 1 });
    return;
  }
  if (cliOptions.viewsSchema === undefined) {
    logger.warn({
      service: "create-views",
      msg: "Required CLI option '--views-schema' not provided.",
    });
    await exit({ reason: "Create views failed", code: 1 });
    return;
  }

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
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: buildResult.result,
    schemaBuild: emptySchemaBuild,
  });

  const PONDER_META = getPonderMetaTable(cliOptions.schema);

  const meta = await database.adminQB
    .select({ app: PONDER_META.value })
    .from(PONDER_META)
    .where(eq(PONDER_META.key, "app"));

  if (meta.length === 0) {
    logger.warn({
      service: "create-views",
      msg: `No Ponder app found in schema ${cliOptions.schema}.`,
    });
    await exit({ reason: "Create views failed", code: 0 });
    return;
  }

  await database.adminQB.execute(
    sql.raw(`CREATE SCHEMA IF NOT EXISTS "${cliOptions.viewsSchema}"`),
  );

  for (const table of meta[0]!.app.table_names) {
    // Note: drop views before creating new ones to avoid enum errors.
    await database.adminQB.execute(
      sql.raw(`DROP VIEW IF EXISTS "${cliOptions.viewsSchema}"."${table}"`),
    );

    await database.adminQB.execute(
      sql.raw(
        `CREATE VIEW "${cliOptions.viewsSchema}"."${table}" AS SELECT * FROM "${cliOptions.schema}"."${table}"`,
      ),
    );
  }

  logger.warn({
    service: "create-views",
    msg: `Created ${meta[0]!.app.table_names.length} views in schema "${cliOptions.viewsSchema}"`,
  });

  await database.adminQB.execute(
    sql.raw(
      `CREATE OR REPLACE VIEW "${cliOptions.viewsSchema}"."_ponder_meta" AS SELECT * FROM "${cliOptions.schema}"."_ponder_meta"`,
    ),
  );

  await database.adminQB.execute(
    sql.raw(
      `CREATE OR REPLACE VIEW "${cliOptions.viewsSchema}"."_ponder_checkpoint" AS SELECT * FROM "${cliOptions.schema}"."_ponder_checkpoint"`,
    ),
  );

  const trigger = `status_${cliOptions.viewsSchema}_trigger`;
  const notification = "status_notify()";
  const channel = `${cliOptions.viewsSchema}_status_channel`;

  await database.adminQB.execute(
    sql.raw(`
CREATE OR REPLACE FUNCTION "${cliOptions.viewsSchema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
  );

  await database.adminQB.execute(
    sql.raw(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${cliOptions.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${cliOptions.viewsSchema}".${notification};`),
  );

  await exit({ reason: "Success", code: 0 });
}
