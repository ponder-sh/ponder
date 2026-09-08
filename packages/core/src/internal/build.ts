import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { PoolConfig } from "pg";
import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { Ordering, Schema } from "./types.js";

/**
 * Build artefacts that name a database, an HTTP server, or generated SQL.
 *
 * These live apart from `./types.ts` because that module describes the
 * blockchain data model -- blocks, logs, filters, fragments -- which the sync
 * engine is built on. Keeping the two apart is what lets the engine be
 * compiled without Drizzle, PGlite, `pg`, or Hono in scope.
 */

import type { Prettify } from "@/types/utils.js";

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "pglite_test"; instance: PGlite }
  | { kind: "postgres"; poolConfig: Prettify<PoolConfig & { max: number }> };

/** Consolidated CLI, env vars, and config. */
export type PreBuild = {
  /** Database type and configuration */
  databaseConfig: DatabaseConfig;
  /** Ordering of events */
  ordering: Ordering;
};

export type SchemaBuild = {
  schema: Schema;
  /** SQL statements to create the schema */
  statements: SqlStatements;
};

export type ApiBuild = {
  /** Hostname for server */
  hostname?: string;
  /** Port number for server */
  port: number;
  /** Hono app exported from `ponder/api/index.ts`. */
  app: Hono;
};
