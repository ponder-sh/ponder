import path from "node:path";
import type { Config } from "@/config/index.js";
import { BuildError } from "@/internal/errors.js";
import type { Options } from "@/internal/options.js";
import type { DatabaseConfig } from "@/internal/types.js";

export function buildPre({
  config,
  options,
}: {
  config: Config;
  options: Pick<Options, "rootDir" | "ponderDir">;
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
      } else {
        throw new Error(
          `Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.`,
        );
      }

      const poolConfig = {
        connectionString,
        max: config.database.poolConfig?.max ?? 30,
        ssl: config.database.poolConfig?.ssl ?? false,
      };

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

export function safeBuildPre({
  config,
  options,
}: {
  config: Config;
  options: Pick<Options, "rootDir" | "ponderDir">;
}) {
  try {
    const result = buildPre({ config, options });

    return {
      status: "success",
      databaseConfig: result.databaseConfig,
      ordering: result.ordering,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
