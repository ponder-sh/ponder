import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type { ApiBuild } from "@/internal/types.js";
import { createServer } from "@/server/index.js";

/**
 * Starts the server for the specified build.
 */
export async function runServer(params: {
  common: Common;
  apiBuild: ApiBuild;
  database: Database;
}) {
  const server = await createServer(params);

  return async () => {
    await server.kill();
  };
}
