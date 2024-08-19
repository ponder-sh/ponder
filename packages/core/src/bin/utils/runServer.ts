import type { ApiBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createServer } from "@/server/index.js";

/**
 * Starts the server for the specified build.
 */
export async function runServer({
  common,
  build,
}: {
  common: Common;
  build: ApiBuild;
}) {
  const { databaseConfig, schema } = build;

  let database: DatabaseService;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
  } else {
    const { poolConfig, schema: userNamespace } = databaseConfig;
    database = new PostgresDatabaseService({
      common,
      poolConfig,
      userNamespace,
    });
  }

  const server = await createServer({
    app: build.app,
    routes: build.routes,
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
