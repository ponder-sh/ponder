import { createBuild } from "@/build/index.js";
import { createDatabase, getPonderMeta } from "@/database/index.js";
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

export async function createView({
  cliOptions,
}: {
  cliOptions: CliOptions & {
    schema?: string | undefined;
    publishSchema?: string | undefined;
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
  if (cliOptions.publishSchema === undefined) {
    logger.warn({
      service: "create-views",
      msg: "Required CLI option '--publish-schema' not provided.",
    });
    await exit({ reason: "Create views failed", code: 1 });
    return;
  }

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

  const PONDER_META = getPonderMeta(cliOptions.schema);

  const meta = await database.qb.drizzle
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

  await database.qb.drizzle.execute(
    sql.raw(`CREATE SCHEMA IF NOT EXISTS ${cliOptions.publishSchema}`),
  );

  for (const table of meta[0]!.app.table_names) {
    await database.qb.drizzle.execute(
      sql.raw(
        `CREATE OR REPLACE VIEW "${cliOptions.publishSchema}"."${table}" AS SELECT * FROM "${cliOptions.schema}"."${table}"`,
      ),
    );
  }

  logger.warn({
    service: "create-views",
    msg: `Created ${meta[0]!.app.table_names.length} views in schema "${cliOptions.publishSchema}"`,
  });

  await database.qb.drizzle.execute(
    sql.raw(
      `CREATE OR REPLACE VIEW "${cliOptions.publishSchema}"."_ponder_meta" AS SELECT * FROM "${cliOptions.schema}"."_ponder_meta"`,
    ),
  );

  await database.qb.drizzle.execute(
    sql.raw(
      `CREATE OR REPLACE VIEW "${cliOptions.publishSchema}"."_ponder_status" AS SELECT * FROM "${cliOptions.schema}"."_ponder_status"`,
    ),
  );

  const trigger = `status_${cliOptions.publishSchema}_trigger`;
  const notification = "status_notify()";
  const channel = `${cliOptions.publishSchema}_status_channel`;

  await database.qb.drizzle.execute(
    sql.raw(`
CREATE OR REPLACE FUNCTION "${cliOptions.publishSchema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
  );

  await database.qb.drizzle.execute(
    sql.raw(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${cliOptions.schema}"._ponder_status
FOR EACH STATEMENT
EXECUTE PROCEDURE "${cliOptions.publishSchema}".${notification};`),
  );

  await exit({ reason: "Success", code: 0 });
}
