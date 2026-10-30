import path from "node:path";
import { Effect } from "effect";
import type { Config } from "@/config/index.js";
import { BuildError } from "@/internal/errors.js";
import type { Options } from "@/internal/options.js";
import type { DatabaseConfig } from "@/internal/types.js";

export function buildPre({
  config,
  options,
}: {
  config: Config;
  options: Pick<Options["Service"], "rootDir" | "ponderDir">;
}): {
  databaseConfig: DatabaseConfig;
  ordering: NonNullable<Config["ordering"]>;
  logs: { level: "warn"; msg: string }[];
} {
  const logs: { level: "warn"; msg: string }[] = [];

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
      let connectionString: string | undefined;

      if (config.database.connectionString) {
        connectionString = config.database.connectionString;
      } else if (process.env.DATABASE_PRIVATE_URL) {
        connectionString = process.env.DATABASE_PRIVATE_URL;
      } else if (process.env.DATABASE_URL) {
        connectionString = process.env.DATABASE_URL;
      }

      if (connectionString === undefined) {
        if (config.database.poolConfig === undefined) {
          throw new Error(
            "Invalid database configuration: Either 'connectionString' or 'poolConfig' must be defined.",
          );
        }
        logs.push({
          level: "warn",
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
    let connectionString: string | undefined;
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

  const ordering = config.ordering ?? "multichain";
  if (
    ordering !== "omnichain" &&
    ordering !== "multichain" &&
    ordering !== "experimental_isolated"
  ) {
    throw new Error(
      `Invalid ordering: Expected 'omnichain', 'multichain', or 'experimental_isolated', got '${String(ordering)}'.`,
    );
  }

  return { databaseConfig, ordering, logs };
}

export const safeBuildPre = ({
  config,
  options,
}: {
  config: Config;
  options: Pick<Options["Service"], "rootDir" | "ponderDir">;
}) =>
  Effect.try({
    try: () => buildPre({ config, options }),
    catch: (_error) => {
      const buildError = new BuildError((_error as Error).message);
      buildError.stack = undefined;
      return buildError;
    },
  });
