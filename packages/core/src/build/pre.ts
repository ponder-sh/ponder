import path from "node:path";
import type { Config } from "@/config/index.js";
import { BuildError } from "@/internal/errors.js";
import type { Logger } from "@/internal/logger.js";
import type { Options } from "@/internal/options.js";
import type { DatabaseConfig } from "@/internal/types.js";

export function buildPre({
  config,
  options,
  logger,
}: {
  config: Config;
  options: Pick<Options, "rootDir" | "ponderDir">;
  logger: Logger;
}): {
  databaseConfig: DatabaseConfig;
  ordering: NonNullable<Config["ordering"]>;
} {
  // Build database.
  let databaseConfig: DatabaseConfig;

  // Determine PGlite directory, preferring config.database.directory if available
  const pgliteDir =
    config.database?.kind === "pglite" && config.database.directory
      ? config.database.directory === "memory://"
        ? "memory://"
        : path.resolve(config.database.directory)
      : path.join(options.ponderDir, "pglite");

  if (config.database?.kind) {
    if (config.database.kind === "postgres") {
      let connectionString: string | undefined = undefined;

      if (config.database.connectionString) {
        connectionString = config.database.connectionString;
      } else if (process.env.DATABASE_PRIVATE_URL) {
        connectionString = process.env.DATABASE_PRIVATE_URL;
      } else if (process.env.DATABASE_URL) {
        connectionString = process.env.DATABASE_URL;
      }

      if (connectionString === undefined) {
        if (config.database.poolConfig === undefined) {
          throw new BuildError(
            "Invalid database configuration: Either 'connectionString' or 'poolConfig' must be defined.",
          );
        }
        logger.warn({
          msg: "No database connection string set. Using 'poolConfig' for connection authentication.",
        });
      }

      const poolConfig = {
        // Note: Override `connectionString` with `poolConfig` if available.
        connectionString,
        ...(config.database.poolConfig ?? {}),
        max: config.database.poolConfig?.max ?? 30,
        ssl: config.database.poolConfig?.ssl ?? false,
      } satisfies (DatabaseConfig & { kind: "postgres" })["poolConfig"];

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  } else {
    let connectionString: string | undefined = undefined;
    if (process.env.DATABASE_PRIVATE_URL) {
      connectionString = process.env.DATABASE_PRIVATE_URL;
    } else if (process.env.DATABASE_URL) {
      connectionString = process.env.DATABASE_URL;
    }

    // If either of the DATABASE_URL env vars are set, use Postgres.
    if (connectionString !== undefined) {
      const poolConfig = { connectionString, max: 30 };

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      // Fall back to PGlite.

      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  }

  return {
    databaseConfig,
    ordering: config.ordering ?? "multichain",
  };
}
