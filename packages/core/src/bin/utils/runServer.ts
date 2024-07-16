import type { ApiBuild, IndexingBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createServer } from "@/server/service.js";

/**
 * Starts the server for the specified build.
 */
export async function runServer({
  common,
  indexingBuild,
  apiBuild,
}: {
  common: Common;
  indexingBuild: IndexingBuild;
  apiBuild: ApiBuild | undefined;
}) {
  const { databaseConfig, optionsConfig, schema } = indexingBuild;

  common.options = { ...common.options, ...optionsConfig };

  let database: DatabaseService;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
  } else {
    const { poolConfig, schema: userNamespace, publishSchema } = databaseConfig;
    database = new PostgresDatabaseService({
      common,
      poolConfig,
      userNamespace,
      publishSchema,
    });
  }

  const server = await createServer({
    app: apiBuild?.app,
    routes: apiBuild?.routes,
    common,
    schema,
    database,
    dbNamespace:
      databaseConfig.kind === "sqlite" ? "public" : databaseConfig.schema,
  });

  return async () => {
    await server.kill();
  };
}
