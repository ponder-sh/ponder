import type { ApiBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import type { Database } from "@/database/index.js";
import { createServer } from "@/server/index.js";

/**
 * Starts the server for the specified build.
 */
export async function runServer({
  common,
  build,
  database,
}: {
  common: Common;
  build: ApiBuild;
  database: Database;
}) {
  const { schema, instanceId } = build;

  const server = await createServer({
    app: build.app,
    common,
    schema,
    database,
    instanceId,
  });

  return async () => {
    await server.kill();
  };
}
