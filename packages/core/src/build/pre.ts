import path from "node:path";
import { BuildError } from "@/common/errors.js";
import type { Options } from "@/common/options.js";
import type { Config } from "@/config/index.js";
import parse from "pg-connection-string";
import type { DatabaseConfig } from "./index.js";

function getDatabaseName(connectionString: string) {
  const parsed = (parse as unknown as typeof parse.parse)(connectionString);
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
}

export function buildPre({
  config,
  options,
}: {
  config: Config;
  options: Pick<Options, "rootDir" | "ponderDir">;
}): {
  databaseConfig: DatabaseConfig;
  logs: { level: "warn" | "info" | "debug"; msg: string }[];
} {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  // Build database.
  let databaseConfig: DatabaseConfig;

  // Determine PGlite directory, preferring config.database.directory if available
  const pgliteDir =
    config.database?.kind === "pglite" && config.database.directory
      ? config.database.directory === "memory://"
        ? "memory://"
        : path.resolve(config.database.directory)
      : path.join(options.ponderDir, "pglite");

  const pglitePrintPath =
    pgliteDir === "memory://"
      ? "memory://"
      : path.relative(options.rootDir, pgliteDir);

  if (config.database?.kind) {
    if (config.database.kind === "postgres") {
      let connectionString: string | undefined = undefined;
      let source: string | undefined = undefined;

      if (config.database.connectionString) {
        connectionString = config.database.connectionString;
        source = "from ponder.config.ts";
      } else if (process.env.DATABASE_PRIVATE_URL) {
        connectionString = process.env.DATABASE_PRIVATE_URL;
        source = "from DATABASE_PRIVATE_URL env var";
      } else if (process.env.DATABASE_URL) {
        connectionString = process.env.DATABASE_URL;
        source = "from DATABASE_URL env var";
      } else {
        throw new Error(
          `Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.`,
        );
      }

      logs.push({
        level: "info",
        msg: `Using Postgres database '${getDatabaseName(connectionString)}' (${source})`,
      });

      const poolConfig = {
        max: config.database.poolConfig?.max ?? 30,
        connectionString,
      };

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      logs.push({
        level: "info",
        msg: `Using PGlite database in '${pglitePrintPath}' (from ponder.config.ts)`,
      });

      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  } else {
    let connectionString: string | undefined = undefined;
    let source: string | undefined = undefined;
    if (process.env.DATABASE_PRIVATE_URL) {
      connectionString = process.env.DATABASE_PRIVATE_URL;
      source = "from DATABASE_PRIVATE_URL env var";
    } else if (process.env.DATABASE_URL) {
      connectionString = process.env.DATABASE_URL;
      source = "from DATABASE_URL env var";
    }

    // If either of the DATABASE_URL env vars are set, use Postgres.
    if (connectionString !== undefined) {
      logs.push({
        level: "info",
        msg: `Using Postgres database ${getDatabaseName(connectionString)} (${source})`,
      });

      const poolConfig = { max: 30, connectionString };

      databaseConfig = { kind: "postgres", poolConfig };
    } else {
      // Fall back to PGlite.
      logs.push({
        level: "info",
        msg: `Using PGlite database at ${pglitePrintPath} (default)`,
      });

      databaseConfig = { kind: "pglite", options: { dataDir: pgliteDir } };
    }
  }

  return {
    databaseConfig,
    logs,
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
    const result = buildPre({
      config,
      options,
    });

    return {
      status: "success",
      databaseConfig: result.databaseConfig,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
