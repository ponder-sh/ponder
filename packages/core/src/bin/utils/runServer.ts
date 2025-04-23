import type { PonderApp } from "@/internal/types.js";
import { createServer } from "@/server/index.js";

/**
 * Starts the server for the specified build.
 */
export const runServer = async (
  app: Omit<PonderApp, "buildId" | "indexingBuild">,
) => {
  await createServer(app);
};
