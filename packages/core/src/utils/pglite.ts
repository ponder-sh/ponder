import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type PGliteOptions as Options, PGlite } from "@electric-sql/pglite";
import { NonRetryableUserError } from "@/internal/errors.js";
import type { Prettify } from "@/types/utils.js";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

/** Postgres major version of the installed PGlite package. */
const PGLITE_POSTGRES_VERSION = "18";

export function createPglite(options: PGliteOptions) {
  // PGlite uses the memory FS by default, and Windows doesn't like the
  // "memory://" path, so it's better to pass `undefined` here.
  if (options.dataDir === "memory://") {
    const { dataDir: _, ...pgliteOptions } = options;
    return new PGlite(pgliteOptions);
  }

  // Postgres cannot open a data directory from a different major version.
  // Without this check, PGlite fails with "PGlite failed to initialize properly".
  const versionFile = path.join(options.dataDir, "PG_VERSION");
  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, "utf-8").trim();
    if (version !== PGLITE_POSTGRES_VERSION) {
      const error = new NonRetryableUserError(
        `The PGlite database in '${options.dataDir}' uses Postgres ${version}, but this version of Ponder uses Postgres ${PGLITE_POSTGRES_VERSION}. Delete the '${options.dataDir}' directory and restart.`,
      );
      error.stack = undefined;
      throw error;
    }
  }

  mkdirSync(options.dataDir, { recursive: true });
  return new PGlite(options);
}
