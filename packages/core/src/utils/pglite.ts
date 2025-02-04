import { mkdirSync } from "node:fs";
import type { Prettify } from "@/types/utils.js";
import { type PGliteOptions as Options, PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

export function createPglite(options: PGliteOptions) {
  // PGlite uses the memory FS by default, and Windows doesn't like the
  // "memory://" path, so it's better to pass `undefined` here.
  if (options.dataDir === "memory://") {
    // @ts-expect-error
    options.dataDir = undefined;
  } else {
    mkdirSync(options.dataDir, { recursive: true });
  }

  return new PGlite(options);
}

// Adapted from dnlsandiego/kysely-pglite
// https://github.com/dnlsandiego/kysely-pglite/blob/3891a0c4d9327a21bff26addf371784f0109260b/src/kysely-pglite.ts
export function createPgliteKyselyDialect(instance: PGlite) {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(instance),
    createIntrospector: (db: Kysely<any>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  } satisfies Dialect;
}

// Adapted from dnlsandiego/kysely-pglite
// https://github.com/dnlsandiego/kysely-pglite/blob/3891a0c4d9327a21bff26addf371784f0109260b/src/pglite-driver.ts
export class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async destroy(): Promise<void> {
    await this.#client.close();
  }

  async init(): Promise<void> {}
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class PGliteConnection implements DatabaseConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery<any>,
  ): Promise<QueryResult<R>> {
    return await this.#client.query<R>(compiledQuery.sql, [
      ...compiledQuery.parameters,
    ]);
  }

  // biome-ignore lint/correctness/useYield: <explanation>
  async *streamQuery(): AsyncGenerator<never, void, unknown> {
    throw new Error("PGlite does not support streaming.");
  }
}
