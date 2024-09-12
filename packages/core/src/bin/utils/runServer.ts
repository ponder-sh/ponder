import type { ApiBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { createDatabase } from "@/database/index.js";
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

  const database = createDatabase({
    common,
    schema,
    databaseConfig,
  });

  const server = await createServer({
    app: build.app,
    routes: build.routes,
    common,
    schema,
    database,
  });

  return async () => {
    await server.kill();
  };
}
