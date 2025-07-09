import type { Schema } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import type { PGlite } from "@electric-sql/pglite";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import pg from "pg";

/**
 * Query builder with built-in retry logic, logging, and metrics.
 */
export type QB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = (Omit<Drizzle<TSchema>, "transaction"> & {
  transaction<T>(
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}) &
  (
    | { $dialect: "pglite"; $client: PGlite }
    | { $dialect: "postgres"; $client: pg.Pool | pg.PoolClient }
  );

/**
 * Create a query builder.
 *
 * @example
 * ```ts
 * const qb = createQB(common, drizzle(pool, { casing: "snake_case" }));
 * const result = await qb.label("test").select().from(accounts);
 * ```
 */
export const createQB = <
  TSchema extends Schema = { [name: string]: never },
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
>(
  db: PgDatabase<PgQueryResultHKT, TSchema> & { $client: TClient },
): QB<TSchema, TClient> => {
  const assignClient = (qb: QB<TSchema, TClient>, client: TClient) => {
    if (client instanceof pg.Pool || client instanceof pg.Client) {
      Object.assign(qb, { $dialect: "postgres" });
    } else {
      Object.assign(qb, { $dialect: "pglite" });
    }

    Object.assign(qb, { $client: client });
  };

  const wrapTx = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
    const _transaction = db.transaction.bind(db);
    db.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (tx) => {
        wrapTx(tx);

        // @ts-expect-error
        assignClient(tx, tx.session.client);
        return callback(tx);
      };
      return _transaction(...args);
    };
  };

  wrapTx(db);

  assignClient(db as unknown as QB<TSchema, TClient>, db.$client);

  return db as unknown as QB<TSchema, TClient>;
};
